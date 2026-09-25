// 專案初始化／還原、切換版型（新增空白版型、開啟最近編輯）、工具列「專案名稱」欄位、自動存草稿。
// 從 editor.js 拆出（見 TODO.md「已知但未處理」），維持原本邏輯與註解不變。

import { createEmptyProject, loadProject } from "../core/schema.js";
import { getDefaultPrinterProfileId, getPrinterProfile } from "../core/printer-profiles.js";
import { deleteDraft, listRecent, loadDraft, safeGetItem, safeSetItem, saveDraft } from "../core/storage.js";
import { LAST_DRAFT_KEY, els, state } from "./context.js";
import { resetHistory } from "./history.js";
import { endBatchPreview } from "./batch-export.js";
import { renderMarginRows, renderPrintableDotsRows } from "./printer-settings.js";
import { renderPageList } from "./pages.js";
import { runAutosave } from "./save-status.js";
import { onModelChange } from "./editor.js";
import { populatePaperWidthTabs, updateFeedLinesHint } from "./toolbar.js";

// ---- 專案初始化 / 還原 ----

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

// ---- 新增空白版型 / 開啟最近編輯（IndexedDB 草稿）----
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

// ---- 工具列「專案名稱」欄位：平時是 ts-button，點擊／Enter 切成 ts-input ----
// 顯示與輸入框共用 state.project.meta.name；儲存草稿／匯出 .ptan／匯出 PDF 檔名
// 已經直接讀這個欄位（見 btn-save-ptan、batch-export.js），這裡不用另外接。
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

// ---- 變更彙整：儲存草稿 ----

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
