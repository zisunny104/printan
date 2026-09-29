// 共用的小型 UI 元件。

import { els } from "./context.js";

/**
 * 把提示列／按鈕掛進畫面。一般編輯器插在尺規＋紙張那一格（stage）正上方：以 #paper-scroll 找 stage，
 * 不用 paper-shadow 往上數層——2D 多頁畫布會把 paper-shadow 搬進作用中頁面的欄位裡，它的祖先層數不固定。
 * kiosk 沒有工作區（範本載入前整個藏起來，載入後只剩列印預覽），提示不屬於工作區，
 * 改掛在頁面最上層（#operations 前面，kiosk 下它本身是隱藏的），不會跟著工作區一起被藏。
 */
export function mountStageElement(element) {
    if (document.documentElement.classList.contains("is-kiosk")) {
        const operations = document.getElementById("operations");
        operations.parentElement.insertBefore(element, operations);
        return;
    }
    const stage = els["paper-scroll"].parentElement;
    stage.parentElement.insertBefore(element, stage);
}

/**
 * 工作區上方一行不擋畫面的提示列（ts-notice），同一個 key 只會有一條、重複呼叫只更新文字。
 * 掛載位置見 mountStageElement。
 * dismissible：加一顆關閉鈕，給「使用者看完就可以收掉」的訊息（例如列印失敗）；
 * 會隨預覽自動消失的狀態提示（字體、圖片）不需要。
 */
export function showStageNotice(key, message, { title = "", dismissible = false } = {}) {
    let notice = els[key];
    if (!notice) {
        notice = document.createElement("div");
        notice.className = "ts-notice is-negative stage-notice";
        notice.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
        if (dismissible) {
            const close = document.createElement("button");
            close.type = "button";
            close.className = "ts-button is-icon is-ghost is-small stage-notice-close";
            close.setAttribute("aria-label", "關閉提示");
            close.innerHTML = '<span class="ts-icon is-xmark-icon" aria-hidden="true"></span>';
            close.addEventListener("click", () => { notice.hidden = true; });
            notice.appendChild(close);
        }
        mountStageElement(notice);
        els[key] = notice;
    }
    notice.hidden = false;
    notice.firstChild.textContent = message;
    notice.title = title;
}

/**
 * 短暫通知（Tocas ts-snackbar）：操作結果、錯誤這類「看過就好」的即時訊息，取代會擋住畫面的 alert()。
 * 同時只顯示少數幾則、由下往上堆疊，時間到自動消失；錯誤訊息停留較久並可手動關閉。
 * 需要一直留在畫面上的狀態（字體沒載入、圖片載入失敗）仍用 showStageNotice。
 * 容器用 popover="manual" 放進 top layer：列印設定等 <dialog> 開著時通知才不會被蓋在下面。
 * @param {string} message 純文字（用 textContent 放入，不解析 HTML）
 * @param {{ error?: boolean, duration?: number }} options duration 毫秒，0＝不自動消失
 */
const SNACKBAR_MAX = 3;
export function showSnackbar(message, { error = false, duration = error ? 8000 : 4000 } = {}) {
    let region = document.getElementById("snackbar-region");
    if (!region) {
        region = document.createElement("div");
        region.id = "snackbar-region";
        region.setAttribute("popover", "manual");
        document.body.appendChild(region);
    }
    if (region.showPopover && !region.matches(":popover-open")) region.showPopover();

    const snackbar = document.createElement("div");
    snackbar.className = "ts-snackbar";
    snackbar.setAttribute("role", error ? "alert" : "status");
    snackbar.appendChild(Object.assign(document.createElement("div"), { className: "content", textContent: message }));
    const remove = () => {
        snackbar.remove();
        if (!region.children.length && region.hidePopover && region.matches(":popover-open")) region.hidePopover();
    };
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.setAttribute("aria-label", "關閉通知");
    close.addEventListener("click", remove);
    snackbar.appendChild(close);
    region.appendChild(snackbar);
    while (region.children.length > SNACKBAR_MAX) region.firstElementChild.remove();
    if (duration > 0) setTimeout(remove, duration);
    return remove;
}

export function hideStageNotice(key) {
    if (els[key]) els[key].hidden = true;
}

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
    // Tocas 的 tooltip 預設只認 hover，且在觸控裝置（pointer: coarse）直接跳過 hover 觸發；
    // 點觸控圖示雖然會讓它拿到 focus，但沒加 "focus" 這個 trigger，tooltip 一樣不會顯示——
    // 觸控裝置上這顆圖示點了完全沒反應，加上 focus trigger 讓點擊聚焦也能顯示。
    icon.dataset.trigger = "hover focus";
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
