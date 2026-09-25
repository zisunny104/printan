// 實體單位轉換：physical paper width → printer DPI → printable dots
// 全部以「點（dot）」作為 document 內部座標系統的基本單位（見需求單「重要」段落）。

const MM_PER_INCH = 25.4;

export function dotsPerMm(dpi) {
    return dpi / MM_PER_INCH;
}

export function dotsToMm(dots, dpi) {
    return dots / dotsPerMm(dpi);
}
export function mmToDots(mm, dpi) {
    return Math.round(mm * dotsPerMm(dpi));
}

/** pt↔dots 換算：兩個方向都四捨五入到整數，讓使用者打一個 pt 整數、存回 dots、
 * 再讀出顯示，看到的還是同一個數字，不會有「明明打 12 怎麼變 11.9」的觀感問題。
 * 印表機／字級輸入介面共用同一份公式，避免各處各算一套互相對不齊。 */
export function dotsToPt(dots, dpi) {
    return Math.round((dots * 72) / dpi);
}
export function ptToDots(pt, dpi) {
    return Math.round((pt * dpi) / 72);
}

/**
 * 依比例陣列（例如 [1,1] 或 [2,1]）把總點數切成整數欄寬，
 * 確保各欄寬度總和精確等於 totalDots（最後一欄吸收捨入誤差）。
 */
export const MAX_ROW_GAP = 48;

/** 多欄欄距（點）：只認有限數字，夾在 0～48 並四捨五入；字串、NaN、負值一律 0（缺欄位＝舊專案＝0）。 */
export function normalizeRowGap(gap) {
    return typeof gap === "number" && Number.isFinite(gap) ? Math.min(MAX_ROW_GAP, Math.max(0, Math.round(gap))) : 0;
}

/** 多欄實際欄寬：先扣掉欄距再依比例分配，回傳 { widths, gap }；紙很窄時欄距縮小，確保每欄至少 1 點、總寬不溢出。 */
export function splitRowColumns(totalDots, ratio, gap) {
    const n = ratio.length;
    const g = n > 1 ? Math.min(normalizeRowGap(gap), Math.max(0, Math.floor((totalDots - n) / (n - 1)))) : 0;
    return { widths: splitDotsByRatio(totalDots - g * (n - 1), ratio), gap: g };
}

export function splitDotsByRatio(totalDots, ratio) {
    const sum = ratio.reduce((a, b) => a + b, 0);
    const widths = ratio.map((r) => Math.floor((totalDots * r) / sum));
    const used = widths.reduce((a, b) => a + b, 0);
    widths[widths.length - 1] += totalDots - used;
    return widths;
}
