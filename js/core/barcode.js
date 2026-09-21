// 條碼／QR Code 產生：QR 透過全域 window.qrcode（qrcode-generator）取得原始模組矩陣自行繪製
// （才能維持「1 canvas pixel = 1 印字點」的座標系統一致性），一維條碼透過全域 window.JsBarcode
// 直接繪製到 canvas（含 displayValue 明碼文字，交給該函式庫處理較不易出錯）。
// 需要頁面先載入：
//   https://cdn.jsdelivr.net/npm/qrcode-generator@{version}/qrcode.min.js
//   https://cdn.jsdelivr.net/npm/qrcode-generator@{version}/qrcode_UTF8.js   （讓中文等多位元組字元能正確編碼，須排在上一行之後）
//   https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/{version}/JsBarcode.all.min.js
// 注意：cdnjs 上的 qrcode-generator 套件本身沒有實際檔案（request 會被瀏覽器 ORB 悄悄擋下，
// 完全不會出現在 console 錯誤或 network 錯誤裡，非常難察覺），所以改用 jsdelivr 直接讀 npm 內容。

// [格式 id, 下拉選單顯示名稱]，順序即選單順序；用途說明在 BARCODE_FORMAT_INFO。
export const BARCODE_FORMATS = [
    ["qrcode", "QR Code（二維碼）"],
    ["code128", "Code128（英數通用）"],
    ["ean13", "EAN-13（商品）"],
    ["ean8", "EAN-8（小型商品）"],
    ["upca", "UPC-A（北美商品）"],
    ["code39", "Code39（大寫英數）"],
    ["itf", "ITF（偶數位數字）"],
];

/** 屬性面板在下拉選單下方顯示的一行用途說明。 */
export const BARCODE_FORMAT_INFO = {
    qrcode: "可放網址、中文與長文字，容錯高，手機最好掃。",
    code128: "英數與半形符號都能編，最通用，適合單號、編號。",
    ean13: "商品條碼（13 碼數字），填 12 碼會自動補檢查碼。",
    ean8: "小包裝商品條碼（8 碼數字），填 7 碼會自動補檢查碼。",
    upca: "北美商品條碼（12 碼數字），填 11 碼會自動補檢查碼。",
    code39: "大寫英文、數字與 - . 空白 $ / + %，工業與倉儲常見。",
    itf: "只能放數字且位數要是偶數，常用於物流外箱。",
};

// JsBarcode 的 format 名稱；沒列在這裡的舊資料／未知格式沿用 CODE128
const JSBARCODE_FORMAT = { code128: "CODE128", ean13: "EAN13", ean8: "EAN8", upca: "UPC", code39: "CODE39", itf: "ITF" };

const DEFAULT_MODULE_WIDTH = 2; // 一維條碼最窄線寬（dot）；紙寬放不下時降為 1，一律取整數，不做非整數縮放（熱感二值化後線寬會不均、掃不到）
const PLACEHOLDER_FONT_SIZE = 20;

class BarcodeInputError extends Error {}

function fail(message) {
    return { ok: false, message };
}

function pass(value, note = "") {
    return { ok: true, value, note };
}

// EAN-13／EAN-8／UPC-A 共用的檢查碼：由右往左，奇數位 ×3、偶數位 ×1
function eanCheckDigit(payload) {
    let sum = 0;
    for (let i = 0; i < payload.length; i++) {
        const digit = Number(payload[payload.length - 1 - i]);
        sum += i % 2 === 0 ? digit * 3 : digit;
    }
    return (10 - (sum % 10)) % 10;
}

function checkEanLike(name, raw, payloadLength) {
    const value = raw.trim();
    if (!/^\d+$/.test(value)) return fail(`${name} 只能輸入數字`);
    if (value.length !== payloadLength && value.length !== payloadLength + 1) {
        return fail(`${name} 需要 ${payloadLength} 或 ${payloadLength + 1} 位數字（目前 ${value.length} 位）`);
    }
    if (value.length === payloadLength) return pass(value, `檢查碼會自動補上 ${eanCheckDigit(value)}`);
    const expected = eanCheckDigit(value.slice(0, -1));
    if (expected !== Number(value[payloadLength])) {
        return fail(`${name} 檢查碼不符，最後一碼應為 ${expected}（或只填前 ${payloadLength} 位讓系統自動補）`);
    }
    return pass(value);
}

function listInvalidChars(text, allowed) {
    const bad = [...new Set([...text].filter((ch) => !allowed.test(ch)))];
    const shown = bad.slice(0, 4).map((ch) => (ch === " " ? "空白" : `「${ch}」`)).join("");
    return bad.length > 4 ? `${shown}…` : shown;
}

const CODE128_CHAR = /^[\x00-\x7F]$/;
const CODE39_CHAR = /^[0-9A-Z\-. $/+%]$/;

const VALIDATORS = {
    qrcode: (raw) => pass(raw),
    code128(raw) {
        if ([...raw].every((ch) => CODE128_CHAR.test(ch))) return pass(raw);
        return fail(`Code128 只能用英數與半形符號，不能含 ${listInvalidChars(raw, CODE128_CHAR)}（中文請改用 QR Code）`);
    },
    ean13: (raw) => checkEanLike("EAN-13", raw, 12),
    ean8: (raw) => checkEanLike("EAN-8", raw, 7),
    upca: (raw) => checkEanLike("UPC-A", raw, 11),
    code39(raw) {
        const value = raw.toUpperCase();
        if ([...value].every((ch) => CODE39_CHAR.test(ch))) return pass(value, value !== raw ? "小寫會自動轉成大寫" : "");
        return fail(`Code39 只能用大寫英文、數字與 - . 空白 $ / + %，不能含 ${listInvalidChars(value, CODE39_CHAR)}`);
    },
    itf(raw) {
        const value = raw.trim();
        if (!/^\d+$/.test(value)) return fail("ITF 只能輸入數字");
        if (value.length % 2 !== 0) return fail(`ITF 位數必須是偶數（目前 ${value.length} 位），可在前面補 0`);
        return pass(value);
    },
};

/**
 * 檢查內容是否符合該格式的規則。回傳 { ok, message, value?, note? }：
 * ok=false 時 message 是給使用者看的原因；ok=true 時 value 是實際送去編碼的內容（已 trim／轉大寫），note 是補充說明（如自動補檢查碼）。
 * 空內容視為通過（由呼叫端決定要不要提示）；含 {{變數}} 的內容要等套用資料後才知道實際值，呼叫端不該拿範本原文來檢查。
 */
export function validateBarcodeValue(format, value) {
    const raw = String(value ?? "");
    if (!raw) return pass(raw);
    return (VALIDATORS[format] || VALIDATORS.code128)(raw);
}

/**
 * 產生條碼／QR 的結果 { canvas, error }。heightDots 是條碼本身高度（QR 為邊長），maxWidthDots 限制輸出寬度上限。
 * 內容為空、內容不合格式、紙寬放不下時 canvas 為 null、error 是原因；不丟例外，不讓整份輸出失敗。
 */
export function renderBarcodeResult(el, maxWidthDots) {
    const value = el.value || "";
    if (!value) return { canvas: null, error: "尚未輸入內容" };
    try {
        if (el.format === "qrcode") return { canvas: renderQrCode(value, el.heightDots, maxWidthDots), error: null };
        return { canvas: renderBarcode1D(el, value, maxWidthDots), error: null };
    } catch (err) {
        return { canvas: null, error: err instanceof BarcodeInputError ? err.message : `條碼無法產生（${err.message}）` };
    }
}

/** 編輯預覽用的佔位框：條碼產生不出來時在畫面上留一塊虛線框寫明原因，避免元素憑空消失又選不到。 */
export function renderBarcodeErrorCanvas(message, widthDots) {
    const width = Math.max(1, Math.round(widthDots || 240));
    const font = `${PLACEHOLDER_FONT_SIZE}px "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = font;
    const lines = [];
    let line = "";
    for (const ch of `條碼無法產生：${message}`) {
        if (line && measure.measureText(line + ch).width > width - 16) {
            lines.push(line);
            line = "";
        }
        line += ch;
    }
    if (line) lines.push(line);

    const lineHeight = Math.round(PLACEHOLDER_FONT_SIZE * 1.4);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = lines.length * lineHeight + 16;
    const ctx = canvas.getContext("2d");
    // 只出現在預覽（thermal 不畫），用螢光黃底＋紅框紅字，一眼就看得到哪個條碼壞了
    ctx.fillStyle = "#fff200";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#e00000";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.fillStyle = "#c00000";
    ctx.font = `bold ${font}`;
    ctx.textBaseline = "top";
    lines.forEach((text, i) => ctx.fillText(text, 8, 8 + i * lineHeight));
    return canvas;
}

function renderQrCode(value, sizeDots, maxWidthDots) {
    if (!window.qrcode) throw new Error("尚未載入 qrcode-generator，請確認頁面有引入 qrcode-generator 的 CDN script");
    const qr = window.qrcode(0, "M"); // typeNumber 0 = 依內容長度自動選擇版本大小
    try {
        qr.addData(value);
        qr.make();
    } catch (err) {
        throw new BarcodeInputError("內容太長，QR Code 放不下");
    }

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

function drawJsBarcode(value, format, heightDots, moduleWidth, showText) {
    const canvas = document.createElement("canvas");
    window.JsBarcode(canvas, value, {
        format,
        displayValue: showText,
        height: heightDots,
        margin: 0,
        width: moduleWidth,
        fontSize: Math.max(10, Math.round(heightDots * 0.16)),
    });
    return canvas;
}

function renderBarcode1D(el, value, maxWidthDots) {
    if (!window.JsBarcode) throw new Error("尚未載入 JsBarcode，請確認頁面有引入 JsBarcode 的 CDN script");
    const checked = validateBarcodeValue(el.format, value);
    if (!checked.ok) throw new BarcodeInputError(checked.message);

    const heightDots = el.heightDots || 100;
    const format = JSBARCODE_FORMAT[el.format] || "CODE128";
    const showText = el.showText !== false;

    // 線寬一律取整數 dot：先用 1 dot 量出整條碼佔幾個 module，再挑放得下的最大整數線寬（上限 2）
    const modules = drawJsBarcode(checked.value, format, heightDots, 1, false).width;
    let moduleWidth = maxWidthDots ? Math.min(DEFAULT_MODULE_WIDTH, Math.floor(maxWidthDots / modules)) : DEFAULT_MODULE_WIDTH;
    for (; moduleWidth >= 1; moduleWidth--) {
        const canvas = drawJsBarcode(checked.value, format, heightDots, moduleWidth, showText);
        if (!maxWidthDots || canvas.width <= maxWidthDots) return canvas;
    }
    throw new BarcodeInputError(`內容太長，紙寬放不下（至少需要 ${modules} 點，可用 ${Math.floor(maxWidthDots)} 點）`);
}
