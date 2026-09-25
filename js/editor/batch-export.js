import { renderPages } from "../core/renderer.js";
import { csvToRecords } from "../core/csv.js";
import { exportToPdf } from "../core/pdf-export.js";
import { safeGetItem, safeSetItem } from "../core/storage.js";
import { BATCH_PANEL_EXPANDED_KEY, els, state } from "./context.js";
import { getEffectiveProfile, schedulePreview } from "./editor.js";

// ---- 匯出 / 列印 ----

// 輸出前的確認：網頁字體沒載入成功會改用系統字體、版面跟預覽不同；內容超過最大高度會被截掉
export function confirmFontFallbacks(results) {
    const list = [].concat(results);
    if (list.some((r) => r.fontFallbacks?.length) && !confirm("字體未載入，仍要列印？")) return false;
    if (list.some((r) => r.truncated) && !confirm("內容太長，超出部分會被截掉，仍要輸出？")) return false;
    const failedImages = new Set(list.flatMap((r) => r.imageFailures || []));
    return !failedImages.size || confirm(`有 ${failedImages.size} 張圖片無法載入，已略過，仍要輸出？`);
}

// confirmFontFallbacks 檢查的同三件事，但只回傳文字清單、不彈 confirm()——給 kiosk.js 自動列印用，
// 沒有人在旁邊可以點確認，問題改用畫面上的提示列顯示，不擋著不印。
export function describeFontFallbackIssues(results) {
    const list = [].concat(results);
    const issues = [];
    if (list.some((r) => r.fontFallbacks?.length)) issues.push("字體未載入，改用系統字體");
    if (list.some((r) => r.truncated)) issues.push("內容太長，超出部分被截掉");
    const failedImages = new Set(list.flatMap((r) => r.imageFailures || []));
    if (failedImages.size) issues.push(`有 ${failedImages.size} 張圖片無法載入`);
    return issues;
}

export async function exportSinglePdf() {
    // 匯出單份 PDF＝把整份專案的每一頁依序輸出，跟「列印」是同一份內容（見 printer-settings.js printCurrent）。
    const results = await renderPages(state.project, state.previewData, { mode: "thermal", profile: getEffectiveProfile() });
    if (!confirmFontFallbacks(results)) return;
    exportToPdf(results, { fileName: `${state.project.meta.name || "printan"}.pdf` });
}

// 匯出跟預覽都要吃同一份批次資料，剖析／驗證邏輯只寫這一處，避免兩邊行為兜不起來
function parseBatchData() {
    try {
        const text = els["batch-data"].value.trim();
        // 不是 JSON（不以 [ 或 { 開頭）就當 CSV：第一列欄位名稱、之後每列一筆
        const dataArray = /^[[{]/.test(text) || !text ? JSON.parse(text || "[]") : csvToRecords(text);
        if (!Array.isArray(dataArray) || dataArray.length === 0) throw new Error("請提供至少一筆資料（JSON 陣列或 CSV）");
        return dataArray;
    } catch (err) {
        alert(`批次資料格式錯誤：${err.message}`);
        return null;
    }
}

export async function exportBatchPdf() {
    const dataArray = parseBatchData();
    if (!dataArray) return;
    // 每筆批次資料都要印出整份專案（全部頁面），依「這筆資料的全部頁面」排在一起，
    // 跟印表機實際列印順序一致（同一筆資料的各頁本來就該接續印出）。
    const results = [];
    for (const data of dataArray) {
        results.push(...await renderPages(state.project, data, { mode: "thermal", profile: getEffectiveProfile() }));
    }
    if (!confirmFontFallbacks(results)) return;
    exportToPdf(results, { fileName: `${state.project.meta.name || "printan"}-batch.pdf` });
}

// ---- 批次資料面板：收合、逐筆預覽 ----

function updateBatchPreviewNav() {
    const { active, records, index } = state.batchPreview;
    els["batch-preview-nav"].hidden = !active;
    if (!active) return;
    els["batch-preview-counter"].textContent = `第 ${index + 1} / ${records.length} 筆`;
    els["btn-batch-prev"].disabled = index <= 0;
    els["btn-batch-next"].disabled = index >= records.length - 1;
}

function startBatchPreview() {
    const dataArray = parseBatchData();
    if (!dataArray) return;
    state.batchPreview = { active: true, records: dataArray, index: 0 };
    updateBatchPreviewNav();
    schedulePreview();
}

function stepBatchPreview(delta) {
    if (!state.batchPreview.active) return;
    const next = state.batchPreview.index + delta;
    if (next < 0 || next >= state.batchPreview.records.length) return;
    state.batchPreview.index = next;
    updateBatchPreviewNav();
    schedulePreview();
}

export function endBatchPreview() {
    if (!state.batchPreview.active) return;
    state.batchPreview = { active: false, records: [], index: 0 };
    updateBatchPreviewNav();
    schedulePreview();
}

function setBatchPanelExpanded(expanded) {
    els["batch-panel-body"].hidden = !expanded;
    els["batch-panel-toggle"].setAttribute("aria-expanded", String(expanded));
    safeSetItem(BATCH_PANEL_EXPANDED_KEY, String(expanded));
}

export function bindBatchPanel() {
    setBatchPanelExpanded(safeGetItem(BATCH_PANEL_EXPANDED_KEY) === "true");

    els["batch-panel-toggle"].addEventListener("click", () => {
        const expanded = els["batch-panel-toggle"].getAttribute("aria-expanded") === "true";
        setBatchPanelExpanded(!expanded);
    });

    els["btn-preview-batch"].addEventListener("click", startBatchPreview);
    els["btn-batch-prev"].addEventListener("click", () => stepBatchPreview(-1));
    els["btn-batch-next"].addEventListener("click", () => stepBatchPreview(1));
    els["btn-batch-end-preview"].addEventListener("click", endBatchPreview);
}
