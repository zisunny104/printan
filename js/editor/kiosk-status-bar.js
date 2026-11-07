// kiosk 畫面最上方的狀態區：標題與版本，加一張「印表機」卡（連線指示燈，沒連上時配對按鈕也放在卡裡）。
// 列印工作的紀錄與失敗原因由父視窗負責（printan 只透過 postMessage 回報，見 docs/kiosk-integration.md）。
// 唯一可操作的配對按鈕由 kiosk.js 建立，掛進印表機卡（mountPrinterCardAction）。

import { state } from "./context.js";
import { mountStageElement } from "./ui-helpers.js";

const STATUS_BAR_ID = "kiosk-status";

let bar = null;
let fields = null;
let printerChecked = false;

/** 啟動時的印表機檢查做完了：之後印表機指示燈才如實顯示連線與否。 */
export function markPrinterChecked() {
    printerChecked = true;
    updateKioskStatus();
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** 建立狀態區並掛進畫面；重複呼叫只會有一份。 */
export function initKioskStatusBar() {
    if (bar) return;
    bar = el("div", "ts-content is-dense");
    bar.id = STATUS_BAR_ID;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");

    const version = document.querySelector(".app-version")?.textContent.trim() || "";
    const titleRow = el("div", "ts-grid is-middle-aligned is-relaxed");
    const titleCol = el("div", "column is-fluid");
    titleCol.append(el("span", "ts-header is-heavy", "Printan 單仔"));
    const versionCol = el("div", "column");
    versionCol.append(el("span", "ts-text is-description is-small", version));
    titleRow.append(titleCol, versionCol);

    // 卡片沿用編輯器其他面板的結構：ts-box＋標題列（.pane-card-header）＋ts-content 內文
    const box = el("div", "ts-box is-rounded");
    const header = el("div", "pane-card-header");
    const title = el("span", "pane-card-header-title");
    title.append(el("span", "ts-icon is-print-icon"), el("span", "", "印表機"));
    header.append(title);
    const body = el("div", "ts-content is-padded");
    box.append(header, body);

    const value = el("div", "kiosk-status-value");
    const dot = el("span", "kiosk-status-dot ts-icon is-circle-icon");
    const text = el("span", "ts-text is-bold");
    value.append(dot, text);
    body.append(value);

    const cardWrap = el("div", "has-top-spaced-small");
    cardWrap.append(box);

    bar.append(titleRow, cardWrap);
    mountStageElement(bar);
    fields = { printerBody: body, printerDot: dot, printerText: text };
    updateKioskStatus();
}

/** 把配對按鈕放進印表機卡；狀態區還沒建立（不是 kiosk）時退回一般的舞台上方位置。 */
export function mountPrinterCardAction(element) {
    if (fields) fields.printerBody.appendChild(element);
    else mountStageElement(element);
}

/**
 * 更新印表機指示燈。每次都直接讀 state 的連線旗標（不是靠事件推算），
 * 所以失敗後連線被釋放、之後重連成功，下一次更新就會自己修正。
 */
export function updateKioskStatus() {
    if (!fields) return;
    const connected = state.usbConnected || state.serialConnected;
    // 啟動時的靜默重連還沒做完之前，「未連線」只是還不知道，不能先亮紅燈
    fields.printerText.textContent = printerChecked ? (connected ? "已連線" : "未連線") : "檢查中";
    fields.printerDot.dataset.tone = !printerChecked ? "warn" : connected ? "ok" : "error";
}
