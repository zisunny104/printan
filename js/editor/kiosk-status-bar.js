// kiosk 畫面最上方的狀態區：
//   標題列：只放 Printan 標題與版本；
//   「印表機」卡：連線指示燈（沒連上時配對按鈕也放在這張卡裡）；
//   「範本」：載入的範本名稱（多範本一行一個），平時收起，點開才看；
//   「列印工作」卡：列印佇列的歷史清單，一筆工作一列（時間、編號、狀態、說明），最新的在最上面；
//     失敗原因、被略過的問題都寫在「說明」欄。清單存在 sessionStorage，iframe 重新載入後還看得到。
// 內嵌在別人網頁裡的 iframe 沒有其他地方看得出運作情形，現場人員靠這區確認「有沒有連上、印了沒」。
// 這裡只顯示狀態；唯一可操作的配對按鈕由 kiosk.js 建立，掛進印表機卡（mountPrinterCardAction）。

import { state } from "./context.js";
import { mountStageElement } from "./ui-helpers.js";

const STATUS_BAR_ID = "kiosk-status";

// 列印工作狀態 → 顯示文字與指示燈顏色（tone 對應 css/editor.css .kiosk-status-dot 的 data-tone）
const JOB_LABELS = {
    idle: { text: "就緒", tone: "muted" },
    loading: { text: "載入範本中", tone: "warn" },
    printing: { text: "正在列印", tone: "warn" },
    printed: { text: "已列印", tone: "ok" },
    printed_issues: { text: "已列印，部分內容被略過", tone: "warn" },
    failed: { text: "列印失敗", tone: "error" },
    load_failed: { text: "範本載入失敗", tone: "error" },
};

const HISTORY_KEY = "printan-kiosk-jobs";
const HISTORY_MAX = 50;
// 這些狀態才會在清單裡留下一列；idle／loading 只是過程，不算一筆列印工作
const TERMINAL_JOBS = new Set(["printed", "printed_issues", "failed", "load_failed"]);

let bar = null;
let fields = null;
let printerChecked = false;
let history = loadHistory();

function loadHistory() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(HISTORY_KEY));
        if (!Array.isArray(saved)) return [];
        // 重新載入前還沒結束的工作結果未知，不能一直顯示「正在列印」
        return saved.slice(0, HISTORY_MAX).map((row) => (TERMINAL_JOBS.has(row.job)
            ? row
            : { ...row, job: "failed", message: "頁面重新載入前未完成" }));
    } catch {
        return [];
    }
}

function saveHistory() {
    try {
        sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch { /* 讀不到或寫不進去只是不保留歷史 */ }
}

/** 同一筆列印工作（編號相同且還沒結束）更新同一列，否則新增一列放最上面。 */
function recordJob(job, message, jobId) {
    if (job !== "printing" && !TERMINAL_JOBS.has(job)) return;
    const id = jobId || null;
    const latest = history[0];
    const entry = { id, job, message, time: Date.now() };
    if (latest && !TERMINAL_JOBS.has(latest.job) && latest.id === id) history[0] = entry;
    else history.unshift(entry);
    history.length = Math.min(history.length, HISTORY_MAX);
    saveHistory();
}

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

function formatClock(date) {
    return date.toLocaleTimeString("zh-TW", { hour12: false });
}

/** 建立狀態區並掛進畫面；重複呼叫只會有一份。 */
export function initKioskStatusBar() {
    if (bar) return;
    bar = el("div", "ts-content is-dense");
    bar.id = STATUS_BAR_ID;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");

    // 標題列：只有標題與版本
    const version = document.querySelector(".app-version")?.textContent.trim() || "";
    const titleRow = el("div", "ts-grid is-middle-aligned is-relaxed");
    const titleCol = el("div", "column is-fluid");
    titleCol.append(el("span", "ts-header is-heavy", "Printan 單仔"));
    const versionCol = el("div", "column");
    versionCol.append(el("span", "ts-text is-description is-small", version));
    titleRow.append(titleCol, versionCol);

    // 卡片沿用編輯器其他面板的結構：ts-box＋標題列（.pane-card-header）＋ts-content 內文
    const card = (name, icon) => {
        const box = el("div", "ts-box is-rounded");
        const header = el("div", "pane-card-header");
        const title = el("span", "pane-card-header-title");
        title.append(el("span", `ts-icon is-${icon}-icon`), el("span", "", name));
        header.append(title);
        const body = el("div", "ts-content is-padded");
        box.append(header, body);
        return { box, header, body };
    };

    const printer = card("印表機", "print");
    const printerValue = el("div", "kiosk-status-value");
    const printerDot = el("span", "kiosk-status-dot ts-icon is-circle-icon");
    const printerText = el("span", "ts-text is-bold");
    printerValue.append(printerDot, printerText);
    printer.body.append(printerValue);

    // 範本：平時收起，用原生 details 展開；內文是名稱清單（setKioskTemplateNames 填入）
    const templates = el("details", "ts-box is-rounded kiosk-status-templates-box");
    const templatesSummary = el("summary", "pane-card-header kiosk-status-summary");
    const templatesTitle = el("span", "pane-card-header-title");
    templatesTitle.append(el("span", "ts-icon is-list-icon"), el("span", "", "範本"));
    const templateCount = el("span", "ts-text is-description is-small", "點開查看");
    templatesSummary.append(templatesTitle, templateCount);
    const templatesBody = el("div", "ts-content is-padded");
    const templateList = el("div", "kiosk-status-templates");
    templateList.append(el("div", "ts-text", "範本載入中…"));
    templatesBody.append(templateList);
    templates.append(templatesSummary, templatesBody);

    // 列印工作：一筆工作一列的清單
    const jobs = card("列印工作", "receipt");
    jobs.body.classList.add("kiosk-status-jobs");
    const jobEmpty = el("div", "ts-text is-description", "尚無列印工作");
    const table = el("table", "ts-table is-basic is-dense is-striped");
    const headRow = el("tr", "");
    for (const label of ["時間", "編號", "狀態", "說明"]) headRow.append(el("th", "", label));
    const thead = el("thead", "");
    thead.append(headRow);
    const jobRows = el("tbody", "");
    table.append(thead, jobRows);
    jobs.body.append(jobEmpty, table);

    const top = el("div", "ts-grid is-relaxed has-top-spaced-small");
    for (const [node, size] of [[printer.box, "is-6-wide"], [templates, "is-fluid"]]) {
        const col = el("div", `column ${size} mobile:is-16-wide`);
        col.append(node);
        top.append(col);
    }
    const jobsWrap = el("div", "has-top-spaced-small");
    jobsWrap.append(jobs.box);

    bar.append(titleRow, top, jobsWrap);
    mountStageElement(bar);
    fields = { templateList, templateCount, printerBody: printer.body, printerDot, printerText, jobEmpty, table, jobRows };
    renderJobRows();
    updateKioskStatus();
}

function renderJobRows() {
    fields.jobEmpty.hidden = history.length > 0;
    fields.table.hidden = history.length === 0;
    fields.jobRows.replaceChildren(...history.map((row) => {
        const tr = el("tr", "");
        const label = JOB_LABELS[row.job] || JOB_LABELS.idle;
        const status = el("td", "");
        const value = el("span", "kiosk-status-value");
        const dot = el("span", "kiosk-status-dot ts-icon is-circle-icon");
        dot.dataset.tone = label.tone;
        value.append(dot, el("span", "", label.text));
        status.append(value);
        tr.append(el("td", "", formatClock(new Date(row.time))), el("td", "", row.id || "—"), status, el("td", "", row.message || ""));
        return tr;
    }));
}

/** 把配對按鈕放進印表機卡；狀態區還沒建立（不是 kiosk）時退回一般的舞台上方位置。 */
export function mountPrinterCardAction(element) {
    if (fields) fields.printerBody.appendChild(element);
    else mountStageElement(element);
}

/** 範本區塊的名稱清單（一行一個）；載入完成或失敗後由 kiosk.js 呼叫，empty 是沒有名稱時顯示的字。 */
export function setKioskTemplateNames(names, empty = "未命名範本") {
    if (!fields) return;
    const list = names.filter(Boolean);
    fields.templateCount.textContent = list.length > 1 ? `${list.length} 個，點開查看` : "點開查看";
    fields.templateList.replaceChildren(...(list.length ? list : [empty]).map((name) => {
        const row = el("div", "ts-text", name);
        row.title = name; // 過長被截斷時滑過可看完整名稱
        return row;
    }));
}

/**
 * 更新狀態區。印表機欄位每次都直接讀 state 的連線旗標（不是靠事件推算），
 * 所以失敗後連線被釋放、之後重連成功，下一次更新就會自己修正。
 * job：JOB_LABELS 的 key，printing 與各種結束狀態會寫進列印工作清單（省略＝只更新印表機指示燈）；
 * message：該筆工作的說明（例如失敗原因）；jobId：該筆列印工作的識別碼。
 */
export function updateKioskStatus({ job, message = "", jobId } = {}) {
    if (!fields) return;
    const connected = state.usbConnected || state.serialConnected;
    // 啟動時的靜默重連還沒做完之前，「未連線」只是還不知道，不能先亮紅燈
    fields.printerText.textContent = printerChecked ? (connected ? "已連線" : "未連線") : "檢查中";
    fields.printerDot.dataset.tone = !printerChecked ? "warn" : connected ? "ok" : "error";

    if (job) {
        recordJob(job, message, jobId);
        renderJobRows();
    }
}
