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

function normalizeIdText(text) {
    return String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 用印表機自報的名稱（WebUSB productName、GS I 回傳的型號字串等）比對註冊表裡的 profile。
 * 正規化成小寫英數後，只要候選字串的任一「詞」或相鄰兩詞相連（"TM-T82II" 拆成 "tm"、"t82ii"
 * 也要能對回 "tmt82ii"）等於 profile.model 就算命中；不做模糊比對（例如 TM-T82III 不會誤判成 TM-T82II）。
 * @param {Array<string|null|undefined>} candidates
 * @returns {string|null} 命中的 profile id，比對不到回傳 null
 */
export function matchPrinterProfile(candidates) {
    for (const text of candidates) {
        const raw = String(text ?? "");
        const whole = normalizeIdText(raw);
        const words = raw.split(/[\s_]+/).map(normalizeIdText).filter(Boolean);
        const grams = new Set([whole, ...words]);
        for (let i = 0; i + 1 < words.length; i += 1) grams.add(words[i] + words[i + 1]);
        for (const profile of Object.values(PRINTER_PROFILES)) {
            const model = normalizeIdText(profile.model);
            if (model && (grams.has(model) || whole === model)) return profile.id;
        }
    }
    return null;
}

// 使用者可覆寫的「可列印點數」合理範圍：下限避免填錯變成幾乎印不出東西，
// 上限 1024 涵蓋常見 4 吋（832 點）以下的熱感機。
export const PRINTABLE_DOTS_MIN = 64;
export const PRINTABLE_DOTS_MAX = 1024;

/**
 * 把使用者自訂的 { 紙寬id: 可列印點數 } 整理成乾淨的物件：只留下範圍內的整數，其他丟掉。
 * 給讀 localStorage（可能被手動改壞）與輸入欄位共用，不認得的紙寬 id 留著也無害，
 * withPrintableDotsOverrides 只會套用到 profile 實際有的紙寬。
 */
export function sanitizePrintableDotsOverrides(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [paperId, value] of Object.entries(raw)) {
        const dots = Math.round(Number(value));
        if (Number.isFinite(dots) && dots >= PRINTABLE_DOTS_MIN && dots <= PRINTABLE_DOTS_MAX) out[paperId] = dots;
    }
    return out;
}

/**
 * 回傳套用「可列印點數」覆寫後的 profile 副本（不動註冊表本身）。
 * 內建規格的點數是 Epson TM-T82II 的，別牌印表機的同樣紙寬可能不同（例如 58mm 機常見 384 點），
 * 讓使用者自行覆寫；可列印寬度（mm）跟著點數依 DPI 換算，預覽紙張框與版面才會一致。
 * 渲染（renderTemplate 的 options.profile）、預覽紙張框、列印頭寬度都要吃同一份有效 profile。
 */
export function withPrintableDotsOverrides(profile, overrides) {
    const clean = sanitizePrintableDotsOverrides(overrides);
    if (Object.keys(clean).length === 0) return profile;
    return {
        ...profile,
        paperWidths: profile.paperWidths.map((paper) => {
            const dots = clean[paper.id];
            if (!dots) return paper;
            return { ...paper, printableWidthDots: dots, printableWidthMm: (dots / profile.dpi.x) * 25.4 };
        }),
    };
}

// 左右邊距校正：熱感頭實際起印位置常有幾毫米的機差，量出「印在紙上的左右留白」後，
// 把留白較小的一側補白到跟較大的一側一樣寬，內容才會真正置中；補白的點數要從排版寬度扣掉。
export const MARGIN_MM_MAX = 20;

/** 整理成 { 紙寬id: { leftMm, rightMm } }：左右都要是 0–20 mm 的數字（取到 0.1 mm），其他丟掉。 */
export function sanitizeMarginCalibration(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    const pick = (v) => {
        const n = Math.round(Number(v) * 10) / 10;
        return Number.isFinite(n) && n > 0 ? Math.min(n, MARGIN_MM_MAX) : null;
    };
    for (const [paperId, value] of Object.entries(raw)) {
        const leftMm = pick(value?.leftMm);
        const rightMm = pick(value?.rightMm);
        if (leftMm !== null && rightMm !== null) out[paperId] = { leftMm, rightMm };
    }
    return out;
}

/** 量到的左右留白（mm）→ 要補的左右點數；只有留白較小的那側需要補。 */
export function marginPadDots(margin, dpiX) {
    const diff = Math.round((Math.abs(margin.rightMm - margin.leftMm) / 25.4) * dpiX);
    return { left: margin.rightMm > margin.leftMm ? diff : 0, right: margin.leftMm > margin.rightMm ? diff : 0 };
}

/**
 * 回傳套用「左右邊距校正」後的 profile 副本：該紙寬的可列印點數（與 mm）扣掉補白，
 * 並記下 marginPadDots，送出 raster 時 printer-adapter.js 會用它把內容擺到正確的水平位置。
 * 要算列印頭最大寬度時請用「校正前」的 profile，不然補白會被誤算成列印頭變窄。
 */
export function withMarginCalibration(profile, margins) {
    const clean = sanitizeMarginCalibration(margins);
    if (Object.keys(clean).length === 0) return profile;
    return {
        ...profile,
        paperWidths: profile.paperWidths.map((paper) => {
            const margin = clean[paper.id];
            if (!margin) return paper;
            const pad = marginPadDots(margin, profile.dpi.x);
            const room = Math.max(paper.printableWidthDots - PRINTABLE_DOTS_MIN, 0);
            const left = Math.min(pad.left, room);
            const right = Math.min(pad.right, room);
            const dots = paper.printableWidthDots - left - right;
            return { ...paper, printableWidthDots: dots, printableWidthMm: (dots / profile.dpi.x) * 25.4, marginPadDots: { left, right } };
        }),
    };
}

/** 目前紙寬要補的左右點數（沒校正就是 0）。 */
export function getMarginPad(profile, widthId) {
    return profile.paperWidths.find((p) => p.id === widthId)?.marginPadDots || { left: 0, right: 0 };
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
