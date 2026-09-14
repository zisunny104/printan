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

// 未來新增（第二階段，見需求單第二十節）：
//   - WebUsbEscposAdapter：透過 navigator.usb 直接送 ESC/POS raster bit image 指令
//   - WebSerialEscposAdapter：透過 navigator.serial 走 RS-232 介面
//   - NetworkAdapter：Ethernet 介面印表機，瀏覽器無法直接開 TCP socket，
//     需要經由後端 / 本機代理服務轉送
export const PRINTER_ADAPTERS = {
    "system-dialog": SystemDialogAdapter,
};
