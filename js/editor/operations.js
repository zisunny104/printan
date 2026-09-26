// 頂部工具列（#operations，partials/operations.php）：新增／開啟版型、專案名稱、
// 匯出 .ptan／PDF、列印、紙寬分頁。跟 toolbar.js（懸浮的 .canvas-floating-toolbar，
// 畫布上的新增元素工具）是兩個不同的 UI，各自對齊自己的 DOM id／class。

import { getPrinterProfile } from "../core/printer-profiles.js";
import { downloadPtan, readPtanFile } from "../core/ptan-file.js";
import { els, state } from "./context.js";
import { exportBatchPdf, exportSinglePdf } from "./batch-export.js";
import { printCurrent } from "./printer-settings.js";
import { onModelChange } from "./editor.js";
import { loadProjectIntoEditor, startNewProject } from "./drafts.js";

export function populatePaperWidthTabs() {
    const profile = getPrinterProfile(state.project.printerProfile.id);
    const wrap = els["paper-width-tabs"];
    wrap.innerHTML = "";
    for (const paper of profile.paperWidths) {
        const label = document.createElement("label");
        label.className = "item";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "paper-width";
        input.value = paper.id;
        input.checked = paper.id === state.project.paper.widthId;
        input.addEventListener("change", () => {
            state.project.paper.widthId = paper.id;
            onModelChange();
        });
        const text = document.createElement("div");
        text.className = "text";
        text.textContent = paper.label;
        label.appendChild(input);
        label.appendChild(text);
        wrap.appendChild(label);
    }
}

export function bindOperations() {
    els["btn-new-ptan"].addEventListener("click", startNewProject);
    els["open-project-from-file"].addEventListener("click", () => els["ptan-file-input"].click());
    els["export-embed-fonts-row"].addEventListener("click", (e) => e.stopPropagation()); // 勾選時不收起匯出選單
    els["btn-save-ptan"].addEventListener("click", async () => {
        const failed = await downloadPtan(state.project, state.project.meta.name || "printan", { embedFonts: els["export-embed-fonts"].checked });
        if (failed.length) alert(`已匯出，但這些字體沒能內嵌（可能離線）：${failed.join("、")}`);
    });

    els["btn-export-pdf"].addEventListener("click", exportSinglePdf);
    els["btn-export-batch-pdf"].addEventListener("click", exportBatchPdf);
    els["btn-print"].addEventListener("click", printCurrent);
}

export function bindPtanFileInput() {
    els["ptan-file-input"].addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        const result = await readPtanFile(file);
        if (!result.ok) {
            alert(`開啟失敗：${result.error}`);
            return;
        }
        loadProjectIntoEditor(result.project);
    });
}

// 平時是 ts-button，點擊／Enter 切成 ts-input；顯示與輸入框共用 state.project.meta.name
export function renderProjectName() {
    const name = state.project.meta.name || "未命名專案";
    els["project-name-text"].textContent = name;
    els["project-name-text"].title = name; // 名稱太長被裁切時，滑鼠停留看得到完整名稱
}

export function bindProjectName() {
    const btn = els["btn-project-name"];
    const input = els["project-name-input"];
    const inputWrap = els["project-name-input-wrap"]; // Tocas ts-input 外層，顯示／隱藏切換的是它
    let cancelling = false;

    function enterEdit() {
        input.value = state.project.meta.name || "";
        btn.hidden = true;
        inputWrap.hidden = false;
        input.focus();
        input.select();
    }
    function exitEdit() {
        inputWrap.hidden = true;
        btn.hidden = false;
    }
    // Enter／blur（含點別處、Tab 走焦點）都算確認；Esc 用 cancelling 旗標跳過這裡的寫入，只還原顯示
    function commit() {
        if (cancelling) {
            cancelling = false;
            exitEdit();
            return;
        }
        const next = input.value.trim().slice(0, 60) || "未命名專案";
        if (next !== state.project.meta.name) {
            state.project.meta.name = next;
            renderProjectName();
            onModelChange();
        }
        exitEdit();
    }

    btn.addEventListener("click", enterEdit);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            input.blur(); // 交給 blur 監聽器統一處理，避免兩套 commit 邏輯
        } else if (e.key === "Escape") {
            e.preventDefault();
            cancelling = true;
            input.blur();
        }
    });
    input.addEventListener("blur", commit);
}
