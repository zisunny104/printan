// kiosk 畫面最上方的一條狀態列：版本、範本名稱、印表機連線與這筆工單的處理狀態。
// 內嵌在別人網頁裡的 iframe 沒有其他地方看得出運作情形，現場人員靠這條確認「有沒有連上、印了沒」。
// 只顯示狀態，不放任何可操作的東西（配對按鈕另見 kiosk.js showKioskConnectButton）。

import { state } from "./context.js";
import { mountStageElement } from "./ui-helpers.js";

const STATUS_BAR_ID = "kiosk-status";

// 工單狀態 → 顯示文字與圓點顏色（tone 對應 css/editor.css .kiosk-status-dot 的 data-tone）
const JOB_LABELS = {
    idle: { text: "待命", tone: "muted" },
    loading: { text: "載入範本中", tone: "warn" },
    printing: { text: "列印中", tone: "warn" },
    printed: { text: "已列印", tone: "ok" },
    failed: { text: "列印失敗", tone: "error" },
    load_failed: { text: "範本載入失敗", tone: "error" },
};

let bar = null;
let fields = null;
let printerChecked = false;

/** 啟動時的印表機檢查做完了：之後印表機欄位才如實顯示連線與否。 */
export function markPrinterChecked() {
    printerChecked = true;
    updateKioskStatus();
}

function createChip(label) {
    const chip = document.createElement("span");
    chip.className = "kiosk-status-chip";
    const dot = document.createElement("span");
    dot.className = "kiosk-status-dot";
    const name = document.createElement("span");
    name.className = "kiosk-status-label";
    name.textContent = label;
    const value = document.createElement("span");
    value.className = "kiosk-status-value";
    chip.append(dot, name, value);
    return { chip, dot, value };
}

function formatClock(date) {
    return date.toLocaleTimeString("zh-TW", { hour12: false });
}

/** 建立狀態列並掛進畫面；重複呼叫只會有一條。 */
export function initKioskStatusBar() {
    if (bar) return;
    bar = document.createElement("div");
    bar.id = STATUS_BAR_ID;
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");

    const title = document.createElement("span");
    title.className = "kiosk-status-title";
    const version = document.querySelector(".app-version")?.textContent.trim() || "";
    title.textContent = `Printan 單仔 ${version}`.trim();

    const template = document.createElement("span");
    template.className = "kiosk-status-template";

    const printer = createChip("印表機");
    const job = createChip("狀態");
    const spacer = document.createElement("span");
    spacer.className = "kiosk-status-spacer";
    const jobId = document.createElement("span");
    jobId.className = "kiosk-status-jobid";

    bar.append(title, template, spacer, jobId, printer.chip, job.chip);
    mountStageElement(bar);
    fields = { template, printer, job, jobId };
    updateKioskStatus({ job: "idle" });
}

/** 範本名稱（多範本就用頓號串起來）；載入完成後由 kiosk.js 呼叫。 */
export function setKioskTemplateNames(names) {
    if (fields) fields.template.textContent = names.filter(Boolean).join("、");
}

/**
 * 更新狀態列。印表機欄位每次都直接讀 state 的連線旗標（不是靠事件推算），
 * 所以失敗後連線被釋放、之後重連成功，下一次更新就會自己修正。
 * job：JOB_LABELS 的 key（省略＝只刷新印表機欄位）；message：接在狀態文字後面的補充（例如失敗原因）；
 * jobId：目前工單識別碼。
 */
export function updateKioskStatus({ job, message = "", jobId } = {}) {
    if (!fields) return;
    const connected = state.usbConnected || state.serialConnected;
    // 啟動時的靜默重連還沒做完之前，「未連線」只是還不知道，不能先亮紅燈
    const label = printerChecked ? (connected ? "已連線" : "未連線") : "檢查中";
    fields.printer.value.textContent = label;
    fields.printer.dot.dataset.tone = !printerChecked ? "warn" : connected ? "ok" : "error";

    if (job) {
        const jobLabel = JOB_LABELS[job] || JOB_LABELS.idle;
        const time = job === "printed" || job === "failed" ? `（${formatClock(new Date())}）` : "";
        fields.job.value.textContent = jobLabel.text + time + (message ? `：${message}` : "");
        fields.job.dot.dataset.tone = jobLabel.tone;
        fields.job.chip.title = message;
    }
    if (jobId !== undefined) fields.jobId.textContent = jobId ? `工單 ${jobId}` : "";
}
