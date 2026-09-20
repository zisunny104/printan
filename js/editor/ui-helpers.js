// 共用的小型 UI 元件。

/**
 * 「ⓘ」說明圖示：把不必常駐的補充說明收進 tooltip，取代標題／欄位旁的灰色說明文字。
 * 動態產生的欄位用這個函式；partials/*.php 的靜態標記直接寫同樣的
 * <span class="info-icon" tabindex="0" data-tooltip="…"> 結構（樣式見 editor.css .info-icon）。
 * 需要放不下一句話的內容時不要塞 tooltip，改寫進「使用說明」（help/help.md）。
 * @param {string} text 一句話內的簡短說明
 */
export function createInfoIcon(text) {
    const icon = document.createElement("span");
    icon.className = "info-icon";
    icon.tabIndex = 0;
    icon.dataset.tooltip = text;
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", text);
    const glyph = document.createElement("span");
    glyph.className = "ts-icon is-circle-info-icon";
    glyph.setAttribute("aria-hidden", "true");
    icon.appendChild(glyph);
    return icon;
}

// 「使用說明」modal 的內文與分頁載入見 js/help/help-dialog.js（內文寫在 help/help.md）
export { wireHelpDialog } from "../help/help-dialog.js";
