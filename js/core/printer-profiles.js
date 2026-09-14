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
        color: "monochrome-1bit",
        imageCapabilities: {
            grayscale: true,
            dithering: true,
            maxColorDepth: 1,
        },
        paperWidths: [
            {
                id: "80mm",
                label: "80 mm（預設）",
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

export function listPrinterProfiles() {
    return Object.values(PRINTER_PROFILES);
}

export function getPaperWidth(profile, widthId) {
    const paper = profile.paperWidths.find((p) => p.id === widthId);
    if (!paper) throw new Error(`Printer Profile ${profile.id} 不支援紙寬 ${widthId}`);
    return paper;
}

export function getDefaultPrinterProfileId() {
    return "epson-tm-t82ii";
}
