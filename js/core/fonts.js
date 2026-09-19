// 字體：本機字體（Local Font Access API，Chrome／Edge，需使用者授權）與字體名稱解析。
// .ptan 只記 font-family 字串、不含字體檔，所以本機字體一律接在預設字體堆疊前面：
// 沒有安裝該字體的電腦會自動落到預設字體，而不是變成瀏覽器隨便挑的字。

import { DEFAULT_FONT_FAMILY } from "./renderer.js";

let localFamilies = []; // 授權後查到的本機字體家族名（去重、已排序）

export function isLocalFontAccessSupported() {
    return typeof window.queryLocalFonts === "function";
}

export function getLocalFontFamilies() {
    return localFamilies;
}

/** 向瀏覽器要求本機字體清單（第一次會跳出權限提示，須在使用者點擊等手勢中呼叫）；使用者拒絕時丟出例外。 */
export async function loadLocalFonts() {
    const fonts = await window.queryLocalFonts();
    localFamilies = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    return localFamilies;
}

/** 之前已授權過就直接載入清單，不再打擾使用者；沒授權或不支援時什麼都不做。 */
export async function restoreLocalFontsIfGranted() {
    if (!isLocalFontAccessSupported()) return false;
    try {
        const status = await navigator.permissions.query({ name: "local-fonts" });
        if (status.state !== "granted") return false;
        await loadLocalFonts();
        return true;
    } catch (err) {
        return false;
    }
}

/** 本機字體寫進文件的 font-family 值：該字體在前，預設字體堆疊墊底。 */
export function localFontStack(family) {
    return `"${family.replace(/["\\]/g, "")}", ${DEFAULT_FONT_FAMILY}`;
}

/** 取 font-family 字串裡第一個字體名稱（去掉引號），給選單顯示用。 */
export function primaryFamilyName(stack) {
    const first = String(stack || "").split(",")[0].trim();
    return first.replace(/^["']|["']$/g, "");
}

let probeCtx = null;

/** 用 canvas 量字寬判斷這台電腦有沒有該字體（與三種基準字體都量得出差異才算有）；只能確認「有」，不保證「沒有」。 */
export function isFontInstalled(family) {
    probeCtx ||= document.createElement("canvas").getContext("2d");
    const sample = "mmmmmmmmmmlli中文測試字體0123";
    return ["monospace", "serif", "sans-serif"].some((base) => {
        probeCtx.font = `72px ${base}`;
        const baseWidth = probeCtx.measureText(sample).width;
        probeCtx.font = `72px "${family}", ${base}`;
        return probeCtx.measureText(sample).width !== baseWidth;
    });
}
