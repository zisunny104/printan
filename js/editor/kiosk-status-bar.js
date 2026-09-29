// kiosk 畫面最上方的狀態列，兩行各管一件事：
//   第一行「是什麼、接什麼」：範本名稱、Printan 版本、印表機連線指示燈；
//   第二行「現在在做什麼」：這筆工單的狀態指示燈與文字（失敗原因、被略過的問題都寫在這裡）、工單編號。
// 內嵌在別人網頁裡的 iframe 沒有其他地方看得出運作情形，現場人員靠這條確認「有沒有連上、印了沒」。
// 只顯示狀態，不放任何可操作的東西（配對按鈕另見 kiosk.js showKioskConnectButton）。

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

/** 建立狀態列並掛進畫面；重複呼叫只會有一條。 */
export function initKioskStatusBar() {
    if (bar) return;
    bar = el("div", "");
    bar.id = STATUS_BAR_ID;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");

    const template = el("span", "kiosk-status-template", "範本載入中…");
    const version = document.querySelector(".app-version")?.textContent.trim() || "";
    const app = el("span", "kiosk-status-app", `Printan ${version}`.trim());
    const printerDot = el("span", "kiosk-status-dot");
    const printerText = el("span", "kiosk-status-printer-text");
    const printer = el("span", "kiosk-status-printer");
    printer.append(printerDot, printerText);
    const head = el("div", "kiosk-status-head");
    head.append(template, app, printer);

    const jobDot = el("span", "kiosk-status-dot");
    const jobText = el("span", "kiosk-status-job-text");
    const jobId = el("span", "kiosk-status-jobid");
    const job = el("div", "kiosk-status-job");
    job.append(jobDot, jobText, jobId);

    bar.append(head, job);
    mountStageElement(bar);
    fields = { template, printerDot, printerText, jobDot, jobText, jobId };
    updateKioskStatus({ job: "idle" });
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
 * job：JOB_LABELS 的 key（省略＝只刷新印表機指示燈）；message：接在狀態文字後面的補充（例如失敗原因）；
 * jobId：目前工單識別碼。
 */
export function updateKioskStatus({ job, message = "", jobId } = {}) {
    if (!fields) return;
    const connected = state.usbConnected || state.serialConnected;
    // 啟動時的靜默重連還沒做完之前，「未連線」只是還不知道，不能先亮紅燈
    fields.printerText.textContent = `印表機 ${printerChecked ? (connected ? "已連線" : "未連線") : "檢查中"}`;
    fields.printerDot.dataset.tone = !printerChecked ? "warn" : connected ? "ok" : "error";

    if (job) {
        const jobLabel = JOB_LABELS[job] || JOB_LABELS.idle;
        const time = job === "printed" || job === "printed_issues" || job === "failed" ? ` ${formatClock(new Date())}` : "";
        fields.jobText.textContent = jobLabel.text + time + (message ? `：${message}` : "");
        fields.jobDot.dataset.tone = jobLabel.tone;
    }
    if (jobId !== undefined) fields.jobId.textContent = jobId ? `工單 ${jobId}` : "";
}
