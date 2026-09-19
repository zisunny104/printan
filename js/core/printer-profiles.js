// Printer Profile 註冊表。
// 新增印表機型號時，只需要在這裡加入新的 profile 物件，
// 不應更動 Editor / Renderer 的核心邏輯（見需求單第十九節）。
//
// Epson TM-T82II 數值來源（2026-09 查證，勿再用猜測值覆蓋）：
// - Technical Reference Guide (TM-T82II_trg_en_revF.pdf, Epson)
//   https://download4.epson.biz/sec_pubs/bs/pdf/TM-T82II_trg_en_revF.pdf
// - User's Manual (TM-T82II_EN_um_02.pdf, Epson) — 紙寬公差、捲紙外徑
//   https://download4.epson.biz/sec_pubs/bs/pdf/TM-T82II_EN_um_02.pdf
// - Epson Australia 產品頁（介面組合、列印速度）
//   https://www.epson.com.au/pos/products/receiptprinters/DisplaySpecs.asp?id=tmt82ii
// - autocutter.bladeOffsetMm：TRG p.29「Automatic cutting position」，切刀刀片距離
//   print start 約 10.5mm；download4.epson.biz 擋自動化擷取，內容經
//   https://www.manualslib.com/manual/1488029/Epson-Tm-T82ii.html 鏡像版本核對（2026-09）

export const PRINTER_PROFILES = {
    "epson-tm-t82ii": {
        id: "epson-tm-t82ii",
        brand: "Epson",
        model: "TM-T82II",
        printMethod: "thermal-line",
        dpi: { x: 203, y: 203 },
        printSpeedMmPerSec: 200,
        connections: ["usb", "serial", "parallel", "ethernet"],
        escpos: {
            supported: true,
            rasterImageCommand: "GS v 0",
        },
        // USB Vendor ID 0x04B8 = Seiko Epson Corp.（USB-IF 廠商代碼登記資料，非型號專屬，
        // 具體 Product ID 依連接埠與韌體設定而異，用 vendorId 篩選讓 WebUSB 裝置選擇對話框
        // 只列出 Epson 裝置，避免要求使用者從所有 USB 裝置裡自己找）
        webUsb: {
            vendorId: 0x04b8,
        },
        // 連續熱感紙沒有像左右紙寬那樣固定的「上邊界」（每次列印都從 print start 位置 0
        // 開始，沒有強制留白）；唯一跟紙張長度方向有關的實體限制是切刀刀片跟列印頭本來就
        // 有一段固定距離，這段距離決定了「切下去會不會切到剛印的內容」，數值見上方來源。
        autocutter: {
            bladeOffsetMm: 10.5,
        },
        color: "monochrome-1bit",
        imageCapabilities: {
            grayscale: true,
            dithering: true,
            maxColorDepth: 1,
        },
        paperWidths: [
            {
                id: "80mm",
                label: "80 mm",
                rollWidthMm: 79.5,
                rollWidthToleranceMm: 0.5,
                maxRollDiameterMm: 83,
                printableWidthMm: 72.0,
                printableWidthDots: 576,
            },
            {
                id: "58mm",
                label: "58 mm",
                rollWidthMm: 57.5,
                rollWidthToleranceMm: 0.5,
                printableWidthMm: 52.5,
                printableWidthDots: 420,
            },
        ],
        defaultPaperWidthId: "80mm",
    },
};

export function getPrinterProfile(id) {
    const profile = PRINTER_PROFILES[id];
    if (!profile) throw new Error(`未知的 Printer Profile: ${id}`);
    return profile;
}

export function getPaperWidth(profile, widthId) {
    const paper = profile.paperWidths.find((p) => p.id === widthId);
    if (!paper) throw new Error(`Printer Profile ${profile.id} 不支援紙寬 ${widthId}`);
    return paper;
}

export function getDefaultPrinterProfileId() {
    return "epson-tm-t82ii";
}

/**
 * 印表機列印頭的最大點陣寬度，用該 profile 所有紙寬選項裡最寬的 printableWidthDots 推得
 * （同一顆列印頭通常固定寬度，紙寬只是切換用哪一段列印頭在打點）。
 * 給 printer-adapter.js 的 buildEscposJob 統一送「列印頭最大寬度」的 raster、
 * 把實際內容置中用，避免紙寬設定較窄時印表機韌體預設起印位置跟紙張實際位置沒對齊、
 * 印出來的內容偏移。此為工程假設，尚待實機驗證（見 README 已知限制）。
 */
export function getPrintHeadWidthDots(profile) {
    return Math.max(...profile.paperWidths.map((p) => p.printableWidthDots));
}
