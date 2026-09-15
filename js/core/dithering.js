// 灰階 / 二值化 / 誤差擴散抖色，把畫面轉成熱感紙真正輸出的 1-bit 黑白。
// 只操作 ImageData，不碰 DOM，符合 core 可嵌入的原則。

export function toGrayscale(imageData) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        // ITU-R BT.601 亮度加權
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = gray;
    }
    return imageData;
}

/** 簡單閾值二值化，level 0-255，預設 128。 */
export function threshold(imageData, level = 128) {
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
        const v = d[i] < level ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v;
    }
    return imageData;
}

/** Floyd–Steinberg 誤差擴散抖色，畫質比單純閾值更接近真實熱感紙效果。 */
export function floydSteinberg(imageData, level = 128) {
    const { width, height, data } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const old = gray[idx];
            const nv = old < level ? 0 : 255;
            const err = old - nv;
            gray[idx] = nv;

            if (x + 1 < width) gray[idx + 1] += (err * 7) / 16;
            if (y + 1 < height) {
                if (x > 0) gray[idx + width - 1] += (err * 3) / 16;
                gray[idx + width] += (err * 5) / 16;
                if (x + 1 < width) gray[idx + width + 1] += (err * 1) / 16;
            }
        }
    }

    for (let p = 0, i = 0; p < gray.length; p += 1, i += 4) {
        const v = gray[p] < level ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v;
    }
    return imageData;
}

const BAYER_4X4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
];

/** 4x4 Bayer matrix 排序抖色，呈現規則網點（印刷網屏）效果，跟誤差擴散比起來邊緣較銳利、噪點較規律。 */
export function orderedDither(imageData, level = 128) {
    const { width, height, data } = imageData;
    const bias = level - 128;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const mapValue = ((BAYER_4X4[y % 4][x % 4] + 0.5) / 16) * 255;
            const v = data[i] - bias < mapValue ? 0 : 255;
            data[i] = data[i + 1] = data[i + 2] = v;
        }
    }
    return imageData;
}

/** 依「取樣方式」名稱分派抖色演算法，圖片元素的網點設定統一從這裡進入。 */
export function applyDither(imageData, mode = "floyd-steinberg", level = 128) {
    if (mode === "ordered") return orderedDither(imageData, level);
    if (mode === "threshold") return threshold(imageData, level);
    return floydSteinberg(imageData, level);
}

/**
 * 把畫布內容轉成熱感紙 1-bit 輸出模擬。
 * mode: "threshold" | "floyd-steinberg"
 */
export function applyThermalSimulation(ctx, width, height, mode = "floyd-steinberg", thresholdLevel = 128) {
    const imageData = ctx.getImageData(0, 0, width, height);
    toGrayscale(imageData);
    if (mode === "threshold") {
        threshold(imageData, thresholdLevel);
    } else {
        floydSteinberg(imageData, thresholdLevel);
    }
    ctx.putImageData(imageData, 0, 0);
    return ctx;
}
