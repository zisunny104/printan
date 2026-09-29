// kiosk 畫面最上方的狀態區，用兩張卡片各管一件事：
//   標題列：範本名稱與 Printan 版本；
//   「印表機」卡：連線指示燈（沒連上時配對按鈕也放在這張卡裡）；
//   「工單」卡：這筆工單的狀態指示燈與文字（失敗原因、被略過的問題都寫在這裡）、工單編號。
// 內嵌在別人網頁裡的 iframe 沒有其他地方看得出運作情形，現場人員靠這區確認「有沒有連上、印了沒」。
// 這裡只顯示狀態；唯一可操作的配對按鈕由 kiosk.js 建立，掛進印表機卡（mountPrinterCardAction）。

import { state } from "./context.js";
import { mountStageElement } from "./ui-helpers.js";

const STATUS_BAR_ID = "kiosk-status";

// 工單狀態 → 顯示文字與指示燈顏色（tone 對應 css/editor.css .kiosk-status-dot 的 data-tone）
const JOB_LABELS = {
    idle: { text: "待命，等待工單", tone: "muted" },
    loading: { text: "載入範本中", tone: "warn" },
    printing: { text: "列印中", tone: "warn" },
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
    bar = el("div", "");
    bar.id = STATUS_BAR_ID;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");

    const template = el("span", "kiosk-status-template", "範本載入中…");
    const version = document.querySelector(".app-version")?.textContent.trim() || "";
    const app = el("span", "kiosk-status-app", `Printan ${version}`.trim());
    const title = el("div", "kiosk-status-title");
    title.append(template, app);

    const card = (name) => {
        const box = el("div", "kiosk-status-card ts-box is-rounded");
        const label = el("div", "kiosk-status-card-label");
        label.append(el("span", "", name));
        const value = el("div", "kiosk-status-value");
        const dot = el("span", "kiosk-status-dot");
        const text = el("span", "kiosk-status-text");
        value.append(dot, text);
        const detail = el("div", "kiosk-status-detail");
        box.append(label, value, detail);
        return { box, label, dot, text, detail };
    };
    const printer = card("印表機");
    printer.box.classList.add("is-printer");
    const job = card("工單");
    const jobId = el("span", "kiosk-status-jobid");
    job.label.append(jobId);
    const cards = el("div", "kiosk-status-cards");
    cards.append(printer.box, job.box);

    bar.append(title, cards);
    mountStageElement(bar);
    fields = { template, printerCard: printer.box, printerDot: printer.dot, printerText: printer.text, jobDot: job.dot, jobText: job.text, jobDetail: job.detail, jobId };
    updateKioskStatus({ job: "idle" });
}

/** 把配對按鈕放進印表機卡；狀態區還沒建立（不是 kiosk）時退回一般的舞台上方位置。 */
export function mountPrinterCardAction(element) {
    if (fields) fields.printerCard.appendChild(element);
    else mountStageElement(element);
}

/** 範本名稱（多範本顯示個數與名稱）；載入完成或失敗後由 kiosk.js 呼叫，empty 是沒有名稱時顯示的字。 */
export function setKioskTemplateNames(names, empty = "未命名範本") {
    if (!fields) return;
    const list = names.filter(Boolean);
    fields.template.textContent = list.length > 1 ? `${list.length} 個範本：${list.join("、")}` : (list[0] || empty);
    fields.template.title = list.join("\n");
}

/**
 * 更新狀態列。印表機欄位每次都直接讀 state 的連線旗標（不是靠事件推算），
 * 所以失敗後連線被釋放、之後重連成功，下一次更新就會自己修正。
 * job：JOB_LABELS 的 key（省略＝只刷新印表機指示燈）；message：狀態文字下方的補充說明（例如失敗原因）；
 * jobId：目前工單識別碼。
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
