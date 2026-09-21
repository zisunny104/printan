// Printer Adapter 架構（見需求單第十九、二十節）。
//
// 目的：新增其他印表機連線方式時，只需要新增一個 Adapter，
// 不需要更動 Editor / Renderer。

/** 所有 Adapter 需要實作的介面（JSDoc 型別，non-enforced）。
 * @typedef {Object} PrinterAdapter
 * @property {() => boolean} isSupported - 目前瀏覽器/環境是否支援這個連線方式
 * @property {() => Promise<void>} connect
 * @property {(renderResult: {canvas: HTMLCanvasElement}) => Promise<void>} print
 * @property {() => Promise<void>} disconnect
 */

/**
 * 走系統列印對話框（window.print）或 PDF 匯出。
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
        // 寫進 document.write 的只有數字（限縮成有限數值）與 canvas 自己產生的 PNG data URL
        const widthMm = Number(renderResult.widthMm) || 0;
        const heightMm = Number(renderResult.heightMm) || 0;
        const printWindow = window.open("", "_blank");
        if (!printWindow) throw new Error("瀏覽器封鎖了列印視窗，請允許彈出視窗後再試一次");
        printWindow.document.write(`<!DOCTYPE html><html><head><title>列印</title>
            <style>
                @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
                html, body { margin: 0; padding: 0; }
                img { display: block; width: ${widthMm}mm; }
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

const TRANSFER_TIMEOUT_MS = 15000; // 單段傳輸上限：缺紙、上蓋打開時印表機不再收資料，transferOut／write 會一直不 resolve

function withTimeout(promise, ms = TRANSFER_TIMEOUT_MS) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("傳輸逾時"), { name: "TimeoutError" })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 把瀏覽器丟的英文例外（NetworkError、NotFoundError…）換成一句短的中文；本程式自己丟的中文訊息原樣保留。 */
export function describePrinterError(err) {
    const msg = String(err?.message ?? "");
    if (/[一-鿿]/.test(msg) && err?.name !== "TimeoutError") return msg;
    switch (err?.name) {
        case "TimeoutError": return "印表機沒有回應，請檢查紙張、上蓋與電源";
        case "NetworkError": return "傳輸中斷，請檢查連接線與電源";
        case "NotFoundError": return "印表機已中斷連線";
        case "InvalidStateError": return "印表機連線已失效，請重新連線";
        case "NotAllowedError":
        case "SecurityError": return "沒有存取印表機的權限";
        default: return "無法傳送資料到印表機";
    }
}

/** 使用者在裝置選擇對話框按取消（USB／序列埠都是 NotFoundError）不算錯誤。 */
export function isSelectionCancelled(err) {
    return err?.name === "NotFoundError" && /no (device|port) selected/i.test(String(err.message));
}

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
export function canvasToEscposRaster(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const bytesPerLine = Math.ceil(width / 8);
    const raster = new Uint8Array(bytesPerLine * height);
    if (!width || !height) return { bytesPerLine, height, raster }; // getImageData 不接受 0 尺寸
    const { data } = ctx.getImageData(0, 0, width, height);
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
 * 把來源 canvas 貼到一張指定寬度、白底的新 canvas 正中央（只水平置中，高度不變）。
 * 目的：紙寬設定比印表機列印頭最大寬度窄時，直接送「目前紙寬」大小的 raster，
 * 印表機韌體預設的起印水平位置不一定跟紙張實際擺放位置對齊，可能造成印出來的內容
 * 偏移；統一都送「列印頭最大寬度」的 raster、把實際內容置中，不管韌體從哪裡起印，
 * 內容相對紙張的位置都一致。來源本來就等於或超過目標寬度時直接回傳原 canvas。
 * padLeftDots／padRightDots 是左右邊距校正的補白（見 printer-profiles.js withMarginCalibration）：
 * canvas 已經扣掉補白，位置＝原本的置中位置再往右 padLeftDots；沒校正時兩者為 0，跟單純置中一樣。
 */
export function centerCanvasOnWidth(canvas, targetWidthDots, padLeftDots = 0, padRightDots = 0) {
    if (!targetWidthDots || canvas.width >= targetWidthDots) return canvas;
    const padded = document.createElement("canvas");
    padded.width = targetWidthDots;
    padded.height = canvas.height;
    const ctx = padded.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, padded.width, padded.height);
    const slack = targetWidthDots - (canvas.width + padLeftDots + padRightDots);
    // 寬或高為 0 的 canvas 傳給 drawImage 會丟例外，空內容就只留白底
    if (canvas.width > 0 && canvas.height > 0) ctx.drawImage(canvas, Math.max(0, Math.floor(slack / 2)) + padLeftDots, 0);
    return padded;
}

/**
 * 組出完整一次列印工作的 ESC/POS 指令位元組：初始化 → raster 點陣圖 → 走紙 → 切紙。
 * @param {{canvas: HTMLCanvasElement}} renderResult
 * @param {{feedLines?: number, cutPaper?: boolean, targetWidthDots?: number|null, padLeftDots?: number, padRightDots?: number}} options
 *   targetWidthDots：印表機列印頭最大寬度（見 printer-profiles.js getPrintHeadWidthDots），
 *   有值時會把 canvas 置中貼到這個寬度再組 raster，見 centerCanvasOnWidth。
 */
export function buildEscposJob(renderResult, { feedLines = 0, cutPaper = false, targetWidthDots = null, padLeftDots = 0, padRightDots = 0 } = {}) {
    const canvas = centerCanvasOnWidth(renderResult.canvas, targetWidthDots, padLeftDots, padRightDots);
    const { bytesPerLine, height, raster } = canvasToEscposRaster(canvas);
    if (bytesPerLine > 0xffff || height > 0xffff) {
        throw new Error("圖片尺寸超過 ESC/POS raster 指令支援的範圍");
    }

    // ESC @ 之後再明確送一次左邊界歸零與靠左對齊：規格上 ESC @ 就會把這兩項重設為預設值，
    // 這裡是保險用的重複設定，避免印表機韌體殘留左邊界／對齊設定造成 raster 起印位置偏左偏右。
    // 尚待實機驗證（開發環境沒有實體印表機），確認有效前不要當成已解決偏移問題的結論。
    const parts = [
        new Uint8Array([0x1b, 0x40]), // ESC @：初始化印表機
        new Uint8Array([0x1d, 0x4c, 0x00, 0x00]), // GS L nL nH：左邊界 = 0
        new Uint8Array([0x1b, 0x61, 0x00]), // ESC a 0：靠左對齊
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
 * 解析 GS I n（傳送印表機 ID，1D 49 n）的字串型回應：n=65 韌體版本、66 廠牌、67 型號。
 * 回應格式是標頭 0x5F、內容、結尾 NUL（0x00）；印表機沒有這項資料時只回 5F 00。
 * 來源是第二手整理（引用 Epson TM-T20III 文件，Epson 官方 PDF 擋自動化擷取讀不到），
 * 沒有實機驗證過，見 README 已知限制。
 * @param {Uint8Array} bytes
 * @returns {string|null} null＝沒有有效回應（沒回應、或不是 0x5F 開頭）；""＝印表機回報沒有這項資料
 */
export function parsePrinterIdResponse(bytes) {
    if (!bytes || bytes.length === 0 || bytes[0] !== 0x5f) return null;
    const end = bytes.indexOf(0x00, 1);
    const body = end === -1 ? bytes.subarray(1) : bytes.subarray(1, end);
    return new TextDecoder("ascii").decode(body).trim();
}

const USB_PRINTER_CLASS_CODE = 0x07; // USB-IF 定義的 Printer Class，標準印表機（不限廠牌）會用這個類別

function formatUsbId(id) {
    return id.toString(16).toUpperCase().padStart(4, "0");
}

function isPrinterClassInterface(iface) {
    return iface.alternates.some((alt) => alt.interfaceClass === USB_PRINTER_CLASS_CODE);
}

/** 裝置本身或它任一組態的任一介面宣告為 Printer Class。 */
function isUsbPrinterClassDevice(device) {
    if (device.deviceClass === USB_PRINTER_CLASS_CODE) return true;
    return (device.configurations || []).some((config) => config.interfaces.some(isPrinterClassInterface));
}

/**
 * WebUSB 直送 ESC/POS 指令，不透過系統列印對話框／驅動程式。
 * 裝置篩選：profile 有宣告 webUsb.vendorId 的廠牌優先，其他廠牌只認宣告 USB Printer Class
 * 的裝置（見 connect／reconnectIfAuthorized），不會列出鍵盤、隨身碟這類不相干的 USB 裝置。
 */
export class WebUsbEscposAdapter {
    constructor() {
        this.device = null;
        this.endpointNumber = null;
        this.inEndpointNumber = null;
        this.transferTimeoutMs = TRANSFER_TIMEOUT_MS;
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
     * 給頁面載入時用，不需要使用者手勢就能恢復「已連線」狀態。
     * 已授權的裝置優先挑 vendorId 相符的（規格檔指定的廠牌），其次才是宣告 USB Printer Class 的其他廠牌。
     * @returns {Promise<boolean>} 是否成功恢復連線
     */
    async reconnectIfAuthorized(vendorId) {
        const devices = await this.listAuthorizedDevices();
        const device = (vendorId && devices.find((d) => d.vendorId === vendorId))
            || devices.find(isUsbPrinterClassDevice);
        if (!device) return false;
        await this._openAndClaim(device);
        return true;
    }

    /**
     * 跳出瀏覽器裝置選擇對話框——必須在使用者手勢（例如按鈕 click handler）內呼叫，
     * 否則瀏覽器會直接拒絕。篩選條件是「規格檔指定廠牌 OR 任何 USB Printer Class 裝置」：
     * 內建規格是 Epson，但只要是宣告標準印表機類別的裝置（別牌 ESC/POS 熱感機大多如此）也列出來。
     * 無法實機驗證別牌機，見 README 已知限制。
     */
    async connect({ vendorId } = {}) {
        if (!this.isSupported()) throw new Error("此瀏覽器不支援 WebUSB，請改用 Chrome 或 Edge");
        if (await this.reconnectIfAuthorized(vendorId)) return;
        const filters = [{ classCode: USB_PRINTER_CLASS_CODE }];
        if (vendorId) filters.unshift({ vendorId });
        const device = await navigator.usb.requestDevice({ filters });
        await this._openAndClaim(device);
    }

    /**
     * 忘記瀏覽器記住的所有已授權裝置（換印表機、或想重新出現選擇對話框時用）。
     * device.forget() 只有較新的 Chromium 才有，不支援時回傳 null 讓呼叫端知道不能用。
     * @returns {Promise<number|null>} 忘記的裝置數；不支援 forget 時為 null
     */
    async forgetAuthorizedDevices() {
        if (!this.canForget()) return null;
        await this.disconnect();
        const devices = await this.listAuthorizedDevices();
        for (const device of devices) await device.forget();
        return devices.length;
    }

    canForget() {
        return this.isSupported() && typeof USBDevice !== "undefined" && typeof USBDevice.prototype.forget === "function";
    }

    async _openAndClaim(device) {
        await device.open();
        if (!device.configuration) await device.selectConfiguration(1);
        let claimed = null;
        // 組合裝置（印表機＋其他功能）先挑 Printer Class 介面，沒有再退回第一個有 Bulk OUT 的介面
        const interfaces = [...device.configuration.interfaces].sort(
            (a, b) => Number(isPrinterClassInterface(b)) - Number(isPrinterClassInterface(a)),
        );
        for (const iface of interfaces) {
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

    /** 目前連線裝置的顯示名稱，尚未連線時回傳空字串。 */
    get deviceLabel() {
        if (!this.device) return "";
        return [this.device.manufacturerName, this.device.productName].filter(Boolean).join(" ") || "USB 印表機";
    }

    /** 目前連線裝置的識別資訊（VID:PID），給印表機資訊顯示用，尚未連線時回傳空字串。 */
    get deviceDetail() {
        if (!this.device) return "";
        return `USB ${formatUsbId(this.device.vendorId)}:${formatUsbId(this.device.productId)}`;
    }

    /**
     * @param {{canvas: HTMLCanvasElement}} renderResult
     * @param {{feedLines?: number, cutPaper?: boolean}} options
     */
    async print(renderResult, options = {}) {
        if (!this.device) throw new Error("尚未連線印表機");
        const bytes = buildEscposJob(renderResult, options);
        for (let offset = 0; offset < bytes.length; offset += ESCPOS_CHUNK_SIZE) {
            const chunk = bytes.subarray(offset, offset + ESCPOS_CHUNK_SIZE);
            const result = await withTimeout(this.device.transferOut(this.endpointNumber, chunk), this.transferTimeoutMs);
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
        if (!this.device) throw new Error("尚未連線印表機");
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

    /**
     * 讀印表機自報的識別資料（GS I n），見 parsePrinterIdResponse。逾時或沒有讀取端點回傳 null。
     * 逾時後那次 transferIn 沒辦法取消，還會掛在 USB 佇列上、之後可能吃掉下一個回應，
     * 所以呼叫端第一次收到 null 就該停止連續查詢（見 editor.js identifyConnectedPrinter）。
     * @param {65 | 66 | 67} n 65 韌體版本、66 廠牌、67 型號
     * @returns {Promise<string|null>}
     */
    async queryPrinterId(n) {
        if (!this.device) throw new Error("尚未連線印表機");
        if (this.inEndpointNumber == null) return null;
        await this.device.transferOut(this.endpointNumber, new Uint8Array([0x1d, 0x49, n]));
        const transferPromise = this.device.transferIn(this.inEndpointNumber, 64).catch(() => null);
        const result = await Promise.race([
            transferPromise,
            new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (!result || !result.data) return null;
        return parsePrinterIdResponse(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength));
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
        this.transferTimeoutMs = TRANSFER_TIMEOUT_MS;
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
        const port = (vendorId && ports.find((p) => p.getInfo().usbVendorId === vendorId)) || ports[0];
        if (!port) return false;
        await this._openPort(port, baudRate);
        return true;
    }

    /**
     * 跳出瀏覽器序列埠選擇對話框——必須在使用者手勢（例如按鈕 click handler）內呼叫，
     * 否則瀏覽器會直接拒絕。序列埠不像 USB 有 Printer Class 可以篩選：真正的 RS-232 埠沒有
     * usbVendorId、別牌的 USB-to-Serial 晶片（FTDI／CH340 等）的 VID 也不是印表機廠牌，
     * 一旦帶 filters，Chrome 就只列出符合的埠（不會退回全部），所以這裡不帶篩選、
     * 列出全部序列埠讓使用者自己選。vendorId 只用在 reconnectIfAuthorized 的優先順序。
     */
    async connect({ vendorId, baudRate = DEFAULT_SERIAL_BAUD_RATE } = {}) {
        if (!this.isSupported()) throw new Error("此瀏覽器不支援 Web Serial API，請改用 Chrome 或 Edge");
        if (await this.reconnectIfAuthorized(vendorId, baudRate)) return;
        const port = await navigator.serial.requestPort();
        await this._openPort(port, baudRate);
    }

    /**
     * 忘記瀏覽器記住的所有已授權序列埠，見 WebUsbEscposAdapter.forgetAuthorizedDevices。
     * @returns {Promise<number|null>} 忘記的序列埠數；不支援 forget 時為 null
     */
    async forgetAuthorizedPorts() {
        if (!this.canForget()) return null;
        await this.disconnect();
        const ports = await this.listAuthorizedPorts();
        for (const port of ports) await port.forget();
        return ports.length;
    }

    canForget() {
        return this.isSupported() && typeof SerialPort !== "undefined" && typeof SerialPort.prototype.forget === "function";
    }

    async _openPort(port, baudRate) {
        await port.open({ baudRate });
        this.port = port;
        this.writer = port.writable.getWriter();
    }

    /** 目前連線序列埠的顯示名稱，尚未連線時回傳空字串。序列埠沒有裝置名稱可讀，只能顯示 VID。 */
    get deviceLabel() {
        if (!this.port) return "";
        const info = this.port.getInfo();
        return info.usbVendorId ? `序列埠印表機（VID 0x${info.usbVendorId.toString(16)}）` : "序列埠印表機";
    }

    /** 目前連線序列埠的識別資訊，給印表機資訊顯示用；非 USB 轉接的 RS-232 埠沒有可讀的識別資料。 */
    get deviceDetail() {
        if (!this.port) return "";
        const info = this.port.getInfo();
        return info.usbVendorId
            ? `USB 序列轉接 ${formatUsbId(info.usbVendorId)}:${formatUsbId(info.usbProductId ?? 0)}`
            : "序列埠（無 USB 辨識資訊）";
    }

    /**
     * @param {{canvas: HTMLCanvasElement}} renderResult
     * @param {{feedLines?: number, cutPaper?: boolean}} options
     */
    async print(renderResult, options = {}) {
        if (!this.writer) throw new Error("尚未連線印表機");
        const bytes = buildEscposJob(renderResult, options);
        for (let offset = 0; offset < bytes.length; offset += ESCPOS_CHUNK_SIZE) {
            await withTimeout(this.writer.write(bytes.subarray(offset, offset + ESCPOS_CHUNK_SIZE)), this.transferTimeoutMs);
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
        if (!this.writer || !this.port) throw new Error("尚未連線印表機");
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

    /**
     * 讀印表機自報的識別資料（GS I n），見 WebUsbEscposAdapter.queryPrinterId。
     * 序列埠是位元組串流，回應可能分成好幾段到達，所以讀到結尾的 NUL 或逾時才停。
     * 逾時時 read() 還掛著，releaseLock() 在較舊的 Chrome 會丟例外，這裡吞掉；
     * 呼叫端第一次收到 null 就該停止連續查詢。
     * @param {65 | 66 | 67} n
     * @returns {Promise<string|null>}
     */
    async queryPrinterId(n) {
        if (!this.writer || !this.port) throw new Error("尚未連線印表機");
        await this.writer.write(new Uint8Array([0x1d, 0x49, n]));
        const reader = this.port.readable.getReader();
        const chunks = [];
        const deadline = Date.now() + 1500;
        try {
            while (Date.now() < deadline) {
                const result = await Promise.race([
                    reader.read().catch(() => null),
                    new Promise((resolve) => setTimeout(() => resolve(null), Math.max(deadline - Date.now(), 1))),
                ]);
                if (!result || result.done || !result.value) break;
                chunks.push(...result.value);
                if (result.value.includes(0x00)) break;
            }
        } finally {
            try {
                reader.releaseLock();
            } catch {
                // read() 還沒結束時較舊的 Chrome 不允許釋放，讓它留著等連線關閉
            }
        }
        return parsePrinterIdResponse(new Uint8Array(chunks));
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
