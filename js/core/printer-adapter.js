// Printer Adapter 架構（見需求單第十九、二十節）。
//
// 目的：未來新增其他印表機連線方式時，只需要新增一個 Adapter，
// 不需要更動 Editor / Renderer。第一階段不實作真正的實體連線，
// 只先把介面定義出來，並提供瀏覽器連線能力偵測，
// 讓 UI 知道目前環境「可以」提供哪些連線方式（而不是假設全部都可以）。

/** 所有 Adapter 需要實作的介面（JSDoc 型別，non-enforced）。
 * @typedef {Object} PrinterAdapter
 * @property {() => boolean} isSupported - 目前瀏覽器/環境是否支援這個連線方式
 * @property {() => Promise<void>} connect
 * @property {(renderResult: {canvas: HTMLCanvasElement}) => Promise<void>} print
 * @property {() => Promise<void>} disconnect
 */

/**
 * 瀏覽器實體列印連線能力偵測。
 * 說明用途，不代表印表機本身一定支援（例如 TM-T82II 標準款沒有藍牙）。
 */
export function detectBrowserCapabilities() {
    return {
        webUsb: typeof navigator !== "undefined" && "usb" in navigator,
        webSerial: typeof navigator !== "undefined" && "serial" in navigator,
        webBluetooth: typeof navigator !== "undefined" && "bluetooth" in navigator,
    };
}

/**
 * 第一階段唯一可用的「輸出」：走系統列印對話框（window.print）或 PDF 匯出。
 * 不需要 WebUSB/WebSerial 權限，任何瀏覽器都能運作，是最保守但最可靠的路徑。
 */
export class SystemDialogAdapter {
    isSupported() {
        return typeof window !== "undefined" && typeof window.print === "function";
    }

    async connect() {
        // 系統列印對話框不需要預先建立連線。
    }

    /**
     * @param {{canvas: HTMLCanvasElement, widthMm: number, heightMm: number}} renderResult
     */
    async print(renderResult) {
        const dataUrl = renderResult.canvas.toDataURL("image/png");
        const printWindow = window.open("", "_blank");
        if (!printWindow) throw new Error("瀏覽器封鎖了列印視窗，請允許彈出視窗後再試一次");
        printWindow.document.write(`<!DOCTYPE html><html><head><title>列印</title>
            <style>
                @page { size: ${renderResult.widthMm}mm ${renderResult.heightMm}mm; margin: 0; }
                html, body { margin: 0; padding: 0; }
                img { display: block; width: ${renderResult.widthMm}mm; }
            </style>
            </head><body><img src="${dataUrl}"></body></html>`);
        printWindow.document.close();
        printWindow.onload = () => {
            printWindow.focus();
            printWindow.print();
        };
    }

    async disconnect() {}
}

const ESCPOS_CHUNK_SIZE = 4096; // 分段傳輸，避免單次 transferOut 過大

function concatUint8Arrays(chunks) {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}

/**
 * 把熱感模擬後的 canvas（renderTemplate 傳 mode:"thermal"，像素只剩純黑 0 或純白 255）
 * 轉成 ESC/POS GS v 0 raster bit image 需要的點陣資料：每 8 個水平點打包成 1 byte，
 * MSB 對應最左邊的點，bit=1 代表要打點（黑）。寬度不是 8 的倍數時，最後一 byte
 * 多出來的 bit 補 0（白），印表機不會多印超出範圍的點。
 */
function canvasToEscposRaster(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const { data } = ctx.getImageData(0, 0, width, height);
    const bytesPerLine = Math.ceil(width / 8);
    const raster = new Uint8Array(bytesPerLine * height);
    for (let y = 0; y < height; y++) {
        const rowOffset = y * bytesPerLine;
        for (let x = 0; x < width; x++) {
            const isBlack = data[(y * width + x) * 4] < 128;
            if (isBlack) raster[rowOffset + (x >> 3)] |= 0x80 >> (x & 7);
        }
    }
    return { bytesPerLine, height, raster };
}

/**
 * 組出完整一次列印工作的 ESC/POS 指令位元組：初始化 → raster 點陣圖 → 走紙 → 切紙。
 * @param {{canvas: HTMLCanvasElement}} renderResult
 * @param {{feedLines?: number, cutPaper?: boolean}} options
 */
function buildEscposJob(renderResult, { feedLines = 0, cutPaper = false } = {}) {
    const { bytesPerLine, height, raster } = canvasToEscposRaster(renderResult.canvas);
    if (bytesPerLine > 0xffff || height > 0xffff) {
        throw new Error("圖片尺寸超過 ESC/POS raster 指令支援的範圍");
    }

    const parts = [
        new Uint8Array([0x1b, 0x40]), // ESC @：初始化印表機
        new Uint8Array([
            0x1d, 0x76, 0x30, 0x00, // GS v 0 m：raster bit image，m=0 一般模式
            bytesPerLine & 0xff, (bytesPerLine >> 8) & 0xff,
            height & 0xff, (height >> 8) & 0xff,
        ]),
        raster,
    ];
    if (feedLines > 0) {
        parts.push(new Uint8Array([0x1b, 0x64, Math.min(Math.round(feedLines), 255)])); // ESC d n：走紙 n 行
    }
    if (cutPaper) {
        parts.push(new Uint8Array([0x1d, 0x56, 0x01])); // GS V 1：局部切紙
    }
    return concatUint8Arrays(parts);
}

// 即時狀態查詢（DLE EOT n）回應位元組解讀，2026-09 查證：
// - n=1（印表機狀態）bit3＝離線狀態（0=online／1=offline）：這個位元在各家 ESC/POS
//   相容機型的實作幾乎一致（python-escpos RT_MASK_ONLINE=8 對應同一個 bit，該專案的
//   DLE EOT 查詢功能實際在 Epson TM-T20II 上測過，跟 TM-T82II 同屬 Epson TM 系列）：
//   https://github.com/python-escpos/python-escpos/pull/242
// - n=4（紙張感應器）bit5+6 同時為 1＝缺紙、bit2+3 同時為 1＝紙快用完，這組是 TM-T82
//   系列專門記錄的結果：
//   https://www.matthewswong.com/en/blog/epson-tm-t82-cash-drawer-cutter-status/
// - n=2（離線原因）／n=3（錯誤原因）目前沒有查到可信、可交叉比對的位元定義來源，
//   Epson 官方文件（download4.epson.biz）擋自動化擷取讀不到，這裡刻意不猜、不解讀，
//   避免像 bladeOffsetMm 那次一樣把沒把握的猜測講得太肯定；只回報 n=1／n=4。
export function interpretRealtimeStatus(n, byte) {
    if (n === 1) return { online: (byte & 0x08) === 0 };
    if (n === 4) {
        if ((byte & 0x60) === 0x60) return { paper: "out" };
        if ((byte & 0x0c) === 0x0c) return { paper: "near-end" };
        return { paper: "ok" };
    }
    return {};
}

/**
 * WebUSB 直送 ESC/POS 指令，不透過系統列印對話框／驅動程式。
 * 只認得 profile 有宣告 webUsb.vendorId 的印表機（見 printer-profiles.js），
 * 避免對不明裝置亂猜相容性。
 */
export class WebUsbEscposAdapter {
    constructor() {
        this.device = null;
        this.endpointNumber = null;
        this.inEndpointNumber = null;
    }

    isSupported() {
        return typeof navigator !== "undefined" && "usb" in navigator;
    }

    /** 瀏覽器已經授權過（之前 requestDevice 選過）的裝置，讀取不會跳出授權對話框。 */
    async listAuthorizedDevices() {
        if (!this.isSupported()) return [];
        return navigator.usb.getDevices();
    }

    /**
     * 嘗試沿用瀏覽器記住的裝置授權直接重新連線，不跳出選擇對話框。
     * 給頁面載入時用，不需要使用者手勢就能恢復「已連接」狀態。
     * @returns {Promise<boolean>} 是否成功恢復連線
     */
    async reconnectIfAuthorized(vendorId) {
        const devices = await this.listAuthorizedDevices();
        const device = devices.find((d) => !vendorId || d.vendorId === vendorId);
        if (!device) return false;
        await this._openAndClaim(device);
        return true;
    }

    /**
     * 跳出瀏覽器裝置選擇對話框——必須在使用者手勢（例如按鈕 click handler）內呼叫，
     * 否則瀏覽器會直接拒絕。
     */
    async connect({ vendorId } = {}) {
        if (!this.isSupported()) throw new Error("此瀏覽器不支援 WebUSB，請改用 Chrome 或 Edge");
        if (await this.reconnectIfAuthorized(vendorId)) return;
        if (!vendorId) throw new Error("此印表機規格未設定 WebUSB vendorId，無法搜尋裝置");
        const device = await navigator.usb.requestDevice({ filters: [{ vendorId }] });
        await this._openAndClaim(device);
    }

    async _openAndClaim(device) {
        await device.open();
        if (!device.configuration) await device.selectConfiguration(1);
        let claimed = null;
        for (const iface of device.configuration.interfaces) {
            const out = iface.alternates[0].endpoints.find((e) => e.direction === "out" && e.type === "bulk");
            // IN 端點只用來讀「即時狀態查詢」的回應（見 queryStatus），沒有也不影響一般列印，
            // 所以找不到就留 null，不當成連線失敗。
            const inEp = iface.alternates[0].endpoints.find((e) => e.direction === "in" && e.type === "bulk");
            if (out) {
                claimed = { interfaceNumber: iface.interfaceNumber, endpointNumber: out.endpointNumber, inEndpointNumber: inEp?.endpointNumber ?? null };
                break;
            }
        }
        if (!claimed) {
            await device.close();
            throw new Error("這台裝置找不到印表機用的 USB Bulk OUT 端點，可能不是標準 ESC/POS 印表機");
        }
        await device.claimInterface(claimed.interfaceNumber);
        this.device = device;
        this.endpointNumber = claimed.endpointNumber;
        this.inEndpointNumber = claimed.inEndpointNumber;
    }

    /** 目前連接裝置的顯示名稱，尚未連接時回傳空字串。 */
    get deviceLabel() {
        if (!this.device) return "";
        return [this.device.manufacturerName, this.device.productName].filter(Boolean).join(" ") || "USB 印表機";
    }

    /**
     * @param {{canvas: HTMLCanvasElement}} renderResult
     * @param {{feedLines?: number, cutPaper?: boolean}} options
     */
    async print(renderResult, options = {}) {
        if (!this.device) throw new Error("尚未連接印表機");
        const bytes = buildEscposJob(renderResult, options);
        for (let offset = 0; offset < bytes.length; offset += ESCPOS_CHUNK_SIZE) {
            const chunk = bytes.subarray(offset, offset + ESCPOS_CHUNK_SIZE);
            const result = await this.device.transferOut(this.endpointNumber, chunk);
            if (result.status !== "ok") throw new Error(`列印資料傳輸失敗（狀態：${result.status}）`);
        }
    }

    /**
     * 即時狀態查詢（DLE EOT n）：印表機規格上叫「即時」是因為韌體會馬上回應，
     * 不用等前面排隊的列印工作跑完，所以就算沒有真的接印表機的當下也能拿來確認連線。
     * 不是每個裝置都有 Bulk IN 端點、也不是每次都會回應，讀不到就當作「這個環境查不到」，
     * 回傳空陣列讓呼叫端自己決定要顯示什麼，不當成致命錯誤。
     * @param {1 | 2 | 3 | 4} n
     * @returns {Promise<Uint8Array>}
     */
    async queryStatus(n) {
        if (!this.device) throw new Error("尚未連接印表機");
        await this.device.transferOut(this.endpointNumber, new Uint8Array([0x10, 0x04, n]));
        if (this.inEndpointNumber == null) return new Uint8Array();
        const transferPromise = this.device.transferIn(this.inEndpointNumber, 64).catch(() => null);
        const result = await Promise.race([
            transferPromise,
            new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (!result || !result.data) return new Uint8Array();
        return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    }

    async disconnect() {
        if (!this.device) return;
        try {
            await this.device.close();
        } finally {
            this.device = null;
            this.endpointNumber = null;
            this.inEndpointNumber = null;
        }
    }
}

const DEFAULT_SERIAL_BAUD_RATE = 9600; // ESC/POS 序列印表機常見出廠預設值，各機型可能透過 DIP 開關調整，故 UI 開放使用者覆寫

/**
 * WebSerial 直送 ESC/POS 指令，給 RS-232／USB-to-Serial 介面的印表機使用。
 * 跟 WebUsbEscposAdapter 共用同一套 ESC/POS raster 組包邏輯（buildEscposJob），
 * 差別只在連線層：這裡走 navigator.serial 的 port，不是 navigator.usb 的 device。
 * 有些印表機用 USB 傳輸線但實際是 USB-to-Serial 晶片，作業系統會把它列成序列埠而不是
 * WebUSB 裝置，這種情況也走這個 Adapter。
 */
export class WebSerialEscposAdapter {
    constructor() {
        this.port = null;
        this.writer = null;
    }

    isSupported() {
        return typeof navigator !== "undefined" && "serial" in navigator;
    }

    /** 瀏覽器已經授權過（之前 requestPort 選過）的序列埠，讀取不會跳出授權對話框。 */
    async listAuthorizedPorts() {
        if (!this.isSupported()) return [];
        return navigator.serial.getPorts();
    }

    /**
     * 嘗試沿用瀏覽器記住的序列埠授權直接重新連線，不跳出選擇對話框。
     * @returns {Promise<boolean>} 是否成功恢復連線
     */
    async reconnectIfAuthorized(vendorId, baudRate = DEFAULT_SERIAL_BAUD_RATE) {
        const ports = await this.listAuthorizedPorts();
        const port = vendorId
            ? ports.find((p) => p.getInfo().usbVendorId === vendorId)
            : ports[0];
        if (!port) return false;
        await this._openPort(port, baudRate);
        return true;
    }

    /**
     * 跳出瀏覽器序列埠選擇對話框——必須在使用者手勢（例如按鈕 click handler）內呼叫，
     * 否則瀏覽器會直接拒絕。vendorId 有值時只用來篩選裝置清單（USB-to-Serial 晶片才有
     * usbVendorId），真正的 RS-232 序列埠沒有這個欄位，篩選不到就顯示全部序列埠讓使用者自己選。
     */
    async connect({ vendorId, baudRate = DEFAULT_SERIAL_BAUD_RATE } = {}) {
        if (!this.isSupported()) throw new Error("此瀏覽器不支援 Web Serial API，請改用 Chrome 或 Edge");
        if (await this.reconnectIfAuthorized(vendorId, baudRate)) return;
        const port = await navigator.serial.requestPort(vendorId ? { filters: [{ usbVendorId: vendorId }] } : {});
        await this._openPort(port, baudRate);
    }

    async _openPort(port, baudRate) {
        await port.open({ baudRate });
        this.port = port;
        this.writer = port.writable.getWriter();
    }

    /** 目前連接序列埠的顯示名稱，尚未連接時回傳空字串。序列埠沒有裝置名稱可讀，只能顯示 VID。 */
    get deviceLabel() {
        if (!this.port) return "";
        const info = this.port.getInfo();
        return info.usbVendorId ? `序列埠印表機（VID 0x${info.usbVendorId.toString(16)}）` : "序列埠印表機";
    }

    /**
     * @param {{canvas: HTMLCanvasElement}} renderResult
     * @param {{feedLines?: number, cutPaper?: boolean}} options
     */
    async print(renderResult, options = {}) {
        if (!this.writer) throw new Error("尚未連接印表機");
        const bytes = buildEscposJob(renderResult, options);
        for (let offset = 0; offset < bytes.length; offset += ESCPOS_CHUNK_SIZE) {
            await this.writer.write(bytes.subarray(offset, offset + ESCPOS_CHUNK_SIZE));
        }
    }

    /**
     * 即時狀態查詢（DLE EOT n），見 WebUsbEscposAdapter.queryStatus 的說明。
     * 序列埠沒有另外的「讀取端點」，讀寫共用同一個 port，所以每次查詢都要重新
     * getReader()／releaseLock()，不能長期佔用，否則會擋到之後 print() 之類的操作。
     * @param {1 | 2 | 3 | 4} n
     * @returns {Promise<Uint8Array>}
     */
    async queryStatus(n) {
        if (!this.writer || !this.port) throw new Error("尚未連接印表機");
        await this.writer.write(new Uint8Array([0x10, 0x04, n]));
        const reader = this.port.readable.getReader();
        const readPromise = reader.read().catch(() => null);
        const result = await Promise.race([
            readPromise,
            new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        reader.releaseLock();
        if (!result || result.done || !result.value) return new Uint8Array();
        return result.value;
    }

    async disconnect() {
        if (!this.port) return;
        try {
            if (this.writer) {
                await this.writer.close();
                this.writer = null;
            }
            await this.port.close();
        } finally {
            this.port = null;
            this.writer = null;
        }
    }
}

// 未來可能新增：
//   - NetworkAdapter：Ethernet 介面印表機，瀏覽器無法直接開 TCP socket，
//     需要經由後端 / 本機代理服務轉送
export const PRINTER_ADAPTERS = {
    "system-dialog": SystemDialogAdapter,
    "webusb-escpos": WebUsbEscposAdapter,
    "webserial-escpos": WebSerialEscposAdapter,
};
