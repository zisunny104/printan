// 實體單位轉換：physical paper width → printer DPI → printable dots
// 全部以「點（dot）」作為 document 內部座標系統的基本單位（見需求單「重要」段落）。

const MM_PER_INCH = 25.4;

export function dotsPerMm(dpi) {
    return dpi / MM_PER_INCH;
}

export function dotsToMm(dots, dpi) {
    return dots / dotsPerMm(dpi);
}

/**
 * 依比例陣列（例如 [1,1] 或 [2,1]）把總點數切成整數欄寬，
 * 確保各欄寬度總和精確等於 totalDots（最後一欄吸收捨入誤差）。
 */
export function splitDotsByRatio(totalDots, ratio) {
    const sum = ratio.reduce((a, b) => a + b, 0);
    const widths = ratio.map((r) => Math.floor((totalDots * r) / sum));
    const used = widths.reduce((a, b) => a + b, 0);
    widths[widths.length - 1] += totalDots - used;
    return widths;
}
