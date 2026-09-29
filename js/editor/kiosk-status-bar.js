// kiosk 畫面最上方的狀態區，標題列加三張卡片各管一件事：
//   標題列：只放 Printan 標題與版本；
//   「印表機」卡：連線指示燈（沒連上時配對按鈕也放在這張卡裡）；
//   「列印工作」卡：這筆列印工作的狀態指示燈與文字（失敗原因、被略過的問題都寫在這裡）、編號；
//   「範本」卡：載入的範本名稱（多範本一行一個）。
// 內嵌在別人網頁裡的 iframe 沒有其他地方看得出運作情形，現場人員靠這區確認「有沒有連上、印了沒」。
// 這裡只顯示狀態；唯一可操作的配對按鈕由 kiosk.js 建立，掛進印表機卡（mountPrinterCardAction）。

import { state } from "./context.js";
import { mountStageElement } from "./ui-helpers.js";

const STATUS_BAR_ID = "kiosk-status";

// 列印工作狀態 → 顯示文字與指示燈顏色（tone 對應 css/editor.css .kiosk-status-dot 的 data-tone）
const JOB_LABELS = {
    idle: { text: "就緒，等待列印工作", tone: "muted" },
    loading: { text: "載入範本中", tone: "warn" },
    printing: { text: "正在列印", tone: "warn" },
    printed: { text: "已列印", tone: "ok" },
    printed_issues: { text: "已列印，部分內容被略過", tone: "warn" },
    failed: { text: "列印失敗", tone: "error" },
    load_failed: { text: "範本載入失敗", tone: "error" },
};

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
        const value = el("div", "kiosk-status-value");
        const dot = el("span", "kiosk-status-dot ts-icon is-circle-icon");
        const text = el("span", "ts-text is-bold");
        value.append(dot, text);
        const detail = el("div", "kiosk-status-detail ts-text is-description");
        body.append(value, detail);
        box.append(header, body);
        return { box, header, body, dot, text, detail };
    };
    const printer = card("印表機", "print");
    const job = card("列印工作", "receipt");
    const jobId = el("span", "ts-text is-description is-small");
    job.header.append(jobId);

    // 範本卡：內文是名稱清單（setKioskTemplateNames 填入），不放指示燈
    const templates = card("範本", "list");
    templates.body.replaceChildren();
    const templateList = el("div", "kiosk-status-templates");
    templates.body.append(templateList);
    templateList.append(el("div", "ts-text", "範本載入中…"));

    const cards = el("div", "ts-grid is-relaxed has-top-spaced-small");
    for (const [c, size] of [[printer, "is-6-wide"], [job, "is-fluid"], [templates, "is-16-wide"]]) {
        const col = el("div", `column ${size} mobile:is-16-wide`);
        col.append(c.box);
        cards.append(col);
    }

    bar.append(titleRow, cards);
    mountStageElement(bar);
    fields = { templateList, printerBody: printer.body, printerDot: printer.dot, printerText: printer.text, jobDot: job.dot, jobText: job.text, jobDetail: job.detail, jobId };
    updateKioskStatus({ job: "idle" });
}

/** 把配對按鈕放進印表機卡；狀態區還沒建立（不是 kiosk）時退回一般的舞台上方位置。 */
export function mountPrinterCardAction(element) {
    if (fields) fields.printerBody.appendChild(element);
    else mountStageElement(element);
}

/** 範本卡的名稱清單（一行一個）；載入完成或失敗後由 kiosk.js 呼叫，empty 是沒有名稱時顯示的字。 */
export function setKioskTemplateNames(names, empty = "未命名範本") {
    if (!fields) return;
    const list = names.filter(Boolean);
    fields.templateList.replaceChildren(...(list.length ? list : [empty]).map((name) => {
        const row = el("div", "ts-text", name);
        row.title = name; // 過長被截斷時滑過可看完整名稱
        return row;
    }));
}

/**
 * 更新狀態列。印表機欄位每次都直接讀 state 的連線旗標（不是靠事件推算），
 * 所以失敗後連線被釋放、之後重連成功，下一次更新就會自己修正。
 * job：JOB_LABELS 的 key（省略＝只刷新印表機指示燈）；message：狀態文字下方的補充說明（例如失敗原因）；
 * jobId：目前列印工作的識別碼。
 */
export function updateKioskStatus({ job, message = "", jobId } = {}) {
    if (!fields) return;
    const connected = state.usbConnected || state.serialConnected;
    // 啟動時的靜默重連還沒做完之前，「未連線」只是還不知道，不能先亮紅燈
    fields.printerText.textContent = printerChecked ? (connected ? "已連線" : "未連線") : "檢查中";
    fields.printerDot.dataset.tone = !printerChecked ? "warn" : connected ? "ok" : "error";

    if (job) {
        const jobLabel = JOB_LABELS[job] || JOB_LABELS.idle;
        const time = job === "printed" || job === "printed_issues" || job === "failed" ? ` ${formatClock(new Date())}` : "";
        fields.jobText.textContent = jobLabel.text + time;
        fields.jobDetail.textContent = message;
        fields.jobDot.dataset.tone = jobLabel.tone;
    }
    if (jobId !== undefined) fields.jobId.textContent = jobId ? `編號 ${jobId}` : "";
}
