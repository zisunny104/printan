import { renderTemplate, renderBatch } from "../core/renderer.js";
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
    return !list.some((r) => r.truncated) || confirm("內容太長，超出部分會被截掉，仍要輸出？");
}

export async function exportSinglePdf() {
    const result = await renderTemplate(state.project, state.previewData, { mode: "thermal", profile: getEffectiveProfile() });
    if (!confirmFontFallbacks(result)) return;
    exportToPdf([result], { fileName: `${state.project.meta.name || "printan"}.pdf` });
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
    const results = await renderBatch(state.project, dataArray, { mode: "thermal", profile: getEffectiveProfile() });
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
