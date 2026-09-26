// IndexedDB 草稿存取：還原上次編輯、切換／新增版型、「最近編輯」清單、自動存檔。

import { createEmptyProject, loadProject } from "../core/schema.js";
import { getDefaultPrinterProfileId, getPrinterProfile } from "../core/printer-profiles.js";
import { deleteDraft, listRecent, loadDraft, safeGetItem, safeSetItem, saveDraft } from "../core/storage.js";
import { LAST_DRAFT_KEY, els, state } from "./context.js";
import { resetHistory } from "./history.js";
import { endBatchPreview } from "./batch-export.js";
import { renderMarginRows, renderPrintableDotsRows, updateFeedLinesHint } from "./printer-settings.js";
import { renderPageList } from "./pages.js";
import { runAutosave } from "./save-status.js";
import { onModelChange } from "./editor.js";
import { populatePaperWidthTabs, renderProjectName } from "./operations.js";

export async function restoreOrCreateProject() {
    const lastId = safeGetItem(LAST_DRAFT_KEY);
    if (lastId) {
        try {
            const draft = await loadDraft(lastId);
            if (draft) {
                const result = loadProject(draft);
                if (result.ok) return result.project;
            }
        } catch {
            // IndexedDB 讀取失敗就當作沒有草稿，往下建立新專案
        }
    }
    return createEmptyProject({
        printerProfileId: getDefaultPrinterProfileId(),
        paperWidthId: getPrinterProfile(getDefaultPrinterProfileId()).defaultPaperWidthId,
    });
}

// 「新增」不會刪除目前版型：目前版型早就被 scheduleSave 自動存進 IndexedDB 了，
// 換成空白版型後舊的還在，可以從「開啟」下拉選單的「最近編輯」清單找回來。
export function loadProjectIntoEditor(project) {
    state.project = project;
    state.currentPageIndex = 0;
    state.selectedId = null;
    state.multi = [];
    state.insertionTarget = null;
    state.previewData = {};
    resetHistory();
    endBatchPreview();
    updateFeedLinesHint();
    renderPrintableDotsRows();
    renderMarginRows();
    populatePaperWidthTabs();
    populateRecentDrafts();
    renderProjectName();
    renderPageList();
    onModelChange();
}

export function startNewProject() {
    loadProjectIntoEditor(createEmptyProject({
        printerProfileId: state.project.printerProfile.id,
        paperWidthId: state.project.paper.widthId,
    }));
}

export function populateRecentDrafts() {
    const list = els["recent-drafts-list"];
    list.innerHTML = "";
    const recent = listRecent().filter((r) => r.id !== state.project.id);
    if (recent.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ts-text is-description is-small recent-draft-empty";
        empty.textContent = "尚無其他最近編輯的版型";
        list.appendChild(empty);
        return;
    }
    for (const r of recent) {
        const row = document.createElement("div");
        row.className = "item recent-draft-item";

        const info = document.createElement("span");
        info.className = "recent-draft-info";
        const name = document.createElement("span");
        name.className = "recent-draft-name";
        name.textContent = r.name || "未命名版型";
        const time = document.createElement("span");
        time.className = "ts-text is-description is-small recent-draft-time";
        time.textContent = new Date(r.updatedAt).toLocaleString("zh-TW", { hour12: false });
        info.append(name, time);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "ts-button is-icon is-tiny recent-draft-delete";
        del.dataset.tooltip = "刪除這份草稿";
        del.setAttribute("aria-label", "刪除這份草稿");
        del.innerHTML = '<span class="ts-icon is-trash-icon" aria-hidden="true"></span>';
        del.addEventListener("click", async (e) => {
            e.stopPropagation();
            await deleteDraft(r.id);
            populateRecentDrafts();
        });

        row.append(info, del);
        row.addEventListener("click", async () => {
            const draft = await loadDraft(r.id);
            if (!draft) {
                populateRecentDrafts();
                return;
            }
            const result = loadProject(draft);
            if (!result.ok) {
                alert(`開啟失敗：${result.error}`);
                return;
            }
            safeSetItem(LAST_DRAFT_KEY, r.id);
            loadProjectIntoEditor(result.project);
        });
        list.appendChild(row);
    }
}

let saveTimer = null;
export function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        const id = await runAutosave(els["save-status"], () => saveDraft(state.project));
        if (!id) return;
        safeSetItem(LAST_DRAFT_KEY, id);
        populateRecentDrafts();
    }, 500);
}
