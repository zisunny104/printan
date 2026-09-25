import { cloneElementWithNewIds } from "../core/document-model.js";
import { resolveTargetArray, findElementById, findContainerOf, flattenElements } from "../core/element-tree.js";
import { els, state, currentElements } from "./context.js";
import { renderInspector } from "./inspector.js";
import { containerToTarget, renderOutline } from "./outline.js";
import { onModelChange } from "./editor.js";
import { deleteElements, duplicateElements, getSelectedIds, groupElements, highlightSelectedBlock, moveElements, pruneSelection, selectElementById, setSelection, ungroupElements } from "./element-actions.js";
import { renderPageList } from "./pages.js";

// ---- 復原／重做：版面歷史 ----
// 快照對象是整個 project.template.pages，不只是目前頁的 elements——
// 這樣「新增／刪除／合併／分割頁面、頁面排序」這類頁面層級操作也一併進復原堆疊，不會出現
// 「不小心刪掉一整頁卻復原不了」這種資料遺失風險（見需求單）。頁內編輯（拖曳、打字）只是
// 剛好也落在同一份快照裡，行為跟改版前一致。
// 每次 onModelChange 記一份快照；連續變動（拖曳、打字）在 HISTORY_MERGE_MS 內併成同一筆。
// 歷史第 0 筆是載入時的狀態，所以復原不會退到空白以前。

const HISTORY_MERGE_MS = 600;
const HISTORY_MAX = 100;
const history = { stack: [], index: -1, at: 0, restoring: false };

export function resetHistory() {
    history.stack = [];
    history.index = -1;
    history.at = 0;
}

// currentPageIndex 故意不放進快照：只是切換目前檢視的頁面、內容沒有變動時不該產生新的復原點
// （切頁本身不呼叫 recordHistory，見 pages.js setCurrentPage），這裡即使被呼叫到也只比較內容。
function snapshotPages() {
    return JSON.stringify(state.project.template.pages);
}

export function recordHistory() {
    if (history.restoring) return;
    const snapshot = snapshotPages();
    if (snapshot === history.stack[history.index]) return;
    const now = Date.now();
    history.stack.length = history.index + 1;
    if (history.index > 0 && now - history.at < HISTORY_MERGE_MS) {
        history.stack[history.index] = snapshot;
    } else {
        history.stack.push(snapshot);
        if (history.stack.length > HISTORY_MAX) history.stack.shift();
        history.index = history.stack.length - 1;
    }
    history.at = now;
}

function stepHistory(direction) {
    const next = history.index + direction;
    if (next < 0 || next >= history.stack.length) return;
    history.index = next;
    history.at = 0;
    state.project.template.pages = JSON.parse(history.stack[next]);
    state.currentPageIndex = Math.min(state.currentPageIndex, state.project.template.pages.length - 1);
    pruneSelection();
    if (state.insertionTarget && !findElementById(currentElements(), state.insertionTarget.rowId)) state.insertionTarget = null;
    history.restoring = true;
    try {
        renderPageList();
        onModelChange();
    } finally {
        history.restoring = false;
    }
}

// ---- 鍵盤快捷鍵與點空白取消選取 ----
// 焦點在輸入框、文字編輯區或對話框時一律交給瀏覽器（輸入框自己的復原、Delete 刪字）。

let clipboardElements = [];

function deselectElement() {
    if (!getSelectedIds().length) return;
    state.selectedId = null;
    state.multi = [];
    renderOutline();
    renderInspector();
    highlightSelectedBlock();
}

function pasteElements() {
    if (!clipboardElements.length) return;
    const clones = clipboardElements.map((el) => cloneElementWithNewIds(el));
    const ids = getSelectedIds();
    const found = ids.length ? findContainerOf(currentElements(), ids[ids.length - 1]) : null;
    if (found) found.array.splice(found.index + 1, 0, ...clones);
    else resolveTargetArray(currentElements(), state.insertionTarget).push(...clones);
    setSelection(clones.map((c) => c.id));
    onModelChange();
}

function handleEditorShortcut(e) {
    if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.target.closest?.("input, textarea, select, [contenteditable], [role=\"tab\"]") && e.key !== "Escape") {
        // 復原／重做例外：數字、下拉等「值由程式設定」欄位（例如樣式工具列的字級 input）
        // 沒有有意義的瀏覽器原生復原可用，讓 Ctrl+Z／Ctrl+Y 照常呼叫 app 自己的 stepHistory()；
        // 純自由文字輸入（textarea、文字框、contenteditable）與分頁鍵盤操作則維持交給瀏覽器／元件本身處理。
        const isFreeText = e.target.closest?.("textarea, input[type=\"text\"], input:not([type]), [contenteditable], [role=\"tab\"]");
        const isUndoShortcut = mod && (key === "z" || key === "y");
        if (isFreeText || !isUndoShortcut) return;
    }
    const ids = getSelectedIds();
    const root = currentElements();

    if (mod && key === "z") {
        stepHistory(e.shiftKey ? 1 : -1);
    } else if (mod && key === "y") {
        stepHistory(1);
    } else if (mod && key === "g" && ids.length) {
        if (e.shiftKey) ungroupElements(ids);
        else groupElements(ids);
    } else if (mod && key === "d" && ids.length) {
        duplicateElements(ids);
    } else if (mod && key === "c" && ids.length && !window.getSelection().toString()) {
        clipboardElements = ids.map((id) => JSON.parse(JSON.stringify(findElementById(root, id))));
        return;
    } else if (mod && key === "v" && clipboardElements.length) {
        pasteElements();
    } else if ((e.key === "Delete" || e.key === "Backspace") && ids.length && !mod) {
        deleteElements(ids);
    } else if (e.key === "Escape") {
        deselectElement();
        return;
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey) {
        const dir = e.key === "ArrowUp" ? -1 : 1;
        if (e.altKey || mod) {
            if (ids.length) moveElements(ids, dir);
        } else {
            const flat = flattenElements(root);
            const anchor = ids.length ? flat.findIndex((el) => el.id === ids[dir < 0 ? 0 : ids.length - 1]) : -1;
            const next = anchor >= 0 ? flat[anchor + dir] : flat[dir < 0 ? flat.length - 1 : 0];
            if (next) selectElementById(next.id);
        }
    } else {
        return;
    }
    e.preventDefault();
}

// 框選：在空白處拖出矩形，選到碰到矩形的元素；一次只選同一層（有最上層元素就以最上層為準）。沒拖動＝取消選取。
function startMarquee(e) {
    const startX = e.clientX;
    const startY = e.clientY;
    let box = null;
    const rectOf = (ev) => ({
        left: Math.min(startX, ev.clientX), top: Math.min(startY, ev.clientY),
        right: Math.max(startX, ev.clientX), bottom: Math.max(startY, ev.clientY),
    });
    const onMove = (ev) => {
        if (!box) {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
            box = document.createElement("div");
            box.className = "marquee-box";
            document.body.appendChild(box);
        }
        const r = rectOf(ev);
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
    };
    const onUp = (ev) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (!box) {
            deselectElement();
            return;
        }
        box.remove();
        const r = rectOf(ev);
        const root = currentElements();
        const hits = [...els["edit-overlay"].querySelectorAll(".edit-block")].filter((n) => {
            const b = n.getBoundingClientRect();
            return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        }).map((n) => n.dataset.id);
        const arrayOf = (id) => findContainerOf(root, id)?.array;
        const base = hits.find((id) => arrayOf(id) === root) ?? hits[0];
        if (!base) {
            deselectElement();
            return;
        }
        setSelection(hits.filter((id) => arrayOf(id) === arrayOf(base)));
        state.insertionTarget = containerToTarget(arrayOf(base));
        renderOutline();
        renderInspector();
        highlightSelectedBlock();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
}

export function bindEditorShortcuts() {
    document.addEventListener("keydown", handleEditorShortcut);
    els["paper-scroll"].addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || state.viewMode !== "edit") return;
        const t = e.target;
        // 非作用中頁面的縮圖是「點一下切過去」，不是框選的起點（見 page-board.js）
        if (t.closest(".page-frame:not(.is-active)")) return;
        const onBoardBackground = t === els["page-board"] || t.classList.contains("page-group") || t.classList.contains("page-frame");
        if (t === els["paper-scroll"] || onBoardBackground || t === els["paper-shadow"] || t === els["canvas-host"] || t.tagName === "CANVAS") startMarquee(e);
    });
}

