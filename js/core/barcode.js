// 條碼／QR Code 產生：QR 透過全域 window.qrcode（qrcode-generator）取得原始模組矩陣自行繪製
// （才能維持「1 canvas pixel = 1 印字點」的座標系統一致性），一維條碼透過全域 window.JsBarcode
// 直接繪製到 canvas（含 displayValue 明碼文字，交給該函式庫處理較不易出錯）。
// 需要頁面先載入：
//   https://cdn.jsdelivr.net/npm/qrcode-generator@{version}/qrcode.min.js
//   https://cdn.jsdelivr.net/npm/qrcode-generator@{version}/qrcode_UTF8.js   （讓中文等多位元組字元能正確編碼，須排在上一行之後）
//   https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/{version}/JsBarcode.all.min.js
// 注意：cdnjs 上的 qrcode-generator 套件本身沒有實際檔案（request 會被瀏覽器 ORB 悄悄擋下，
// 完全不會出現在 console 錯誤或 network 錯誤裡，非常難察覺），所以改用 jsdelivr 直接讀 npm 內容。

export const BARCODE_FORMATS = [
    ["qrcode", "QR Code"],
    ["code128", "條碼（Code128，英數混合）"],
    ["ean13", "條碼（EAN-13，商品條碼）"],
];

const JSBARCODE_FORMAT = { code128: "CODE128", ean13: "EAN13" };

/** 產生條碼／QR 的 canvas；heightDots 是條碼本身高度（QR 為邊長），maxWidthDots 限制輸出寬度上限。內容為空或編碼失敗時回傳 null，不讓整份輸出失敗。 */
export function renderBarcodeCanvas(el, maxWidthDots) {
    const value = el.value || "";
    if (!value) return null;
    try {
        if (el.format === "qrcode") return renderQrCode(value, el.heightDots, maxWidthDots);
        return renderBarcode1D(el, value, maxWidthDots);
    } catch (err) {
        return null;
    }
}

function renderQrCode(value, sizeDots, maxWidthDots) {
    if (!window.qrcode) throw new Error("尚未載入 qrcode-generator，請確認頁面有引入 qrcode-generator 的 CDN script");
    const qr = window.qrcode(0, "M"); // typeNumber 0 = 依內容長度自動選擇版本大小
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    const size = Math.max(count, Math.min(sizeDots || 160, maxWidthDots || sizeDots || 160));
    const cell = Math.max(1, Math.floor(size / count));
    const canvasSize = cell * count;

    const canvas = document.createElement("canvas");
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvasSize, canvasSize);
    ctx.fillStyle = "#000";
    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
        }
    }
    return canvas;
}

function renderBarcode1D(el, value, maxWidthDots) {
    if (!window.JsBarcode) throw new Error("尚未載入 JsBarcode，請確認頁面有引入 JsBarcode 的 CDN script");
    const heightDots = el.heightDots || 100;
    const canvas = document.createElement("canvas");
    window.JsBarcode(canvas, value, {
        format: JSBARCODE_FORMAT[el.format] || "CODE128",
        displayValue: el.showText !== false,
        height: heightDots,
        margin: 0,
        width: 2,
        fontSize: Math.max(10, Math.round(heightDots * 0.16)),
    });

    if (!maxWidthDots || canvas.width <= maxWidthDots) return canvas;

    const scale = maxWidthDots / canvas.width;
    const scaled = document.createElement("canvas");
    scaled.width = Math.max(1, Math.round(maxWidthDots));
    scaled.height = Math.max(1, Math.round(canvas.height * scale));
    const sctx = scaled.getContext("2d");
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    return scaled;
}
