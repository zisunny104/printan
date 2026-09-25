// 多頁（frame）管理：頁面清單 UI ＋ 新增／刪除／改名／排序／合併／分割。
// 「目前編輯中的頁面」是唯一的間接層（見 context.js currentPage／currentElements）：
// 這個檔案只負責改動 state.project.template.pages 這個陣列本身跟 state.currentPageIndex，
// 版面元素的 CRUD 邏輯完全不需要知道專案有幾頁。

import { createPage } from "../core/schema.js";
import { els, state } from "./context.js";
import { iconButton } from "./inspector-widgets.js";
import { findContainerOf } from "../core/element-tree.js";
import { onModelChange, schedulePreview } from "./editor.js";
import { getSelectedIds } from "./element-actions.js";
import { renderOutline } from "./outline.js";
import { renderInspector } from "./inspector.js";

/**
 * 切換目前檢視／編輯的頁面：純畫面切換，不是內容變動——不記錄復原歷史（history.js 的
 * currentPageIndex 本來就故意不放進快照），也不能走 onModelChange()，那條路徑是給實際
 * 內容變動用的，會連帶重設 autosave 的 500ms debounce（scheduleSave），切頁點快一點
 * 就會讓草稿一直存不進去。只重繪頁面清單／大綱／檢視器／預覽這幾個跟目前頁面相關的畫面。
 */
export function setCurrentPage(index) {
    const pages = state.project.template.pages;
    const clamped = Math.max(0, Math.min(index, pages.length - 1));
    if (clamped === state.currentPageIndex) return;
    state.currentPageIndex = clamped;
    state.selectedId = null;
    state.multi = [];
    state.insertionTarget = null;
    renderPageList();
    renderOutline();
    renderInspector();
    schedulePreview();
}

export function addPage() {
    const pages = state.project.template.pages;
    const page = createPage({ name: `頁 ${pages.length + 1}` });
    pages.splice(state.currentPageIndex + 1, 0, page);
    state.currentPageIndex += 1;
    state.selectedId = null;
    state.multi = [];
    state.insertionTarget = null;
    renderPageList();
    onModelChange();
}

/** 刪掉指定頁面；至少留一頁，刪最後一頁時直接擋下（畫面上按鈕本來就會停用，這裡是保險）。 */
export function deletePage(id) {
    const pages = state.project.template.pages;
    if (pages.length <= 1) return;
    const index = pages.findIndex((p) => p.id === id);
    if (index === -1) return;
    pages.splice(index, 1);
    if (state.currentPageIndex >= pages.length) state.currentPageIndex = pages.length - 1;
    else if (index < state.currentPageIndex) state.currentPageIndex -= 1;
    state.selectedId = null;
    state.multi = [];
    state.insertionTarget = null;
    renderPageList();
    onModelChange();
}

export function renamePage(id, name) {
    const page = state.project.template.pages.find((p) => p.id === id);
    if (!page) return;
    const trimmed = name.trim().slice(0, 60);
    const next = trimmed || page.name;
    if (next === page.name) return;
    page.name = next;
    onModelChange({ skipInspector: true });
}

export function setPageCutAfter(id, cutAfter) {
    const page = state.project.template.pages.find((p) => p.id === id);
    if (!page || page.cutAfter === cutAfter) return;
    page.cutAfter = cutAfter;
    onModelChange({ skipInspector: true });
}

export function movePage(id, direction) {
    const pages = state.project.template.pages;
    const index = pages.findIndex((p) => p.id === id);
    const newIndex = index + direction;
    if (index === -1 || newIndex < 0 || newIndex >= pages.length) return;
    const [page] = pages.splice(index, 1);
    pages.splice(newIndex, 0, page);
    if (state.currentPageIndex === index) state.currentPageIndex = newIndex;
    else if (state.currentPageIndex === newIndex) state.currentPageIndex = index;
    renderPageList();
    onModelChange();
}

/**
 * 合併：把 sourceId 這一頁的所有元素併進「目前這一頁」（頁尾），再刪掉來源頁。
 * 版面是由上而下的流動排版（見 renderer.js layoutColumn），元素陣列本身沒有存 y 座標，
 * 「接在目前頁尾端」這件事單純把陣列接起來就自動達成「往下偏移目前頁高度」的視覺效果，
 * 不需要另外算高度、搬動座標。
 * cutAfter 沿用來源頁（source）的，不是目前頁（target）原本的：合併後內容變成
 * 「target 的內容接著 source 的內容」，決定要不要切紙的是合併後這一頁「印到最後」的狀態，
 * 也就是原本 source 尾端的切紙設定；target 原本自己的 cutAfter 對應的邊界（target 結束的地方）
 * 合併後已經不存在了，跟 splitAtSelection() 分割時前半段固定改成 cutAfter:false 是同一個道理
 * （分割與合併互為逆操作，邊界消失的那一段固定不留原本的切紙語意）。
 */
export function mergePageInto(sourceId) {
    const pages = state.project.template.pages;
    const target = pages[state.currentPageIndex];
    const sourceIndex = pages.findIndex((p) => p.id === sourceId);
    if (sourceIndex === -1 || pages[sourceIndex] === target) return;
    const [source] = pages.splice(sourceIndex, 1);
    target.elements.push(...source.elements);
    target.cutAfter = source.cutAfter;
    if (sourceIndex < state.currentPageIndex) state.currentPageIndex -= 1;
    state.selectedId = null;
    state.multi = [];
    renderPageList();
    onModelChange();
}

/**
 * 分割：選取的元素（必須是目前頁「根層」的元素，v1 版本不支援分割巢狀在多欄／群組裡的元素，
 * 沒辦法切在元素中間，只能切在元素邊界）連同它後面所有元素搬到新頁，插在目前頁之後。
 * 新頁沿用原本的 cutAfter（原本頁尾是否切紙的語意接手過去），目前頁（保留的前半段）
 * 改成 cutAfter:false——分割前這個邊界本來就不存在、印出來是連續的，分割後預設維持
 * 這個「看起來還是連續一張」的行為，使用者要另外切開再自己去頁面清單切換切紙開關。
 */
export function splitAtSelection() {
    const page = state.project.template.pages[state.currentPageIndex];
    const id = state.selectedId;
    if (!id) return;
    const found = findContainerOf(page.elements, id);
    if (!found || found.array !== page.elements) return; // 不在根層，v1 不支援
    if (found.index === 0) return; // 從第一個元素分割等於沒分割
    const moved = page.elements.splice(found.index);
    const newPage = createPage({ name: `${page.name}（分割）`, elements: moved, cutAfter: page.cutAfter });
    page.cutAfter = false;
    state.project.template.pages.splice(state.currentPageIndex + 1, 0, newPage);
    state.selectedId = null;
    state.multi = [];
    renderPageList();
    onModelChange();
}

function canSplitAtCurrentSelection() {
    const ids = getSelectedIds();
    if (ids.length !== 1) return false;
    const page = state.project.template.pages[state.currentPageIndex];
    const found = findContainerOf(page.elements, ids[0]);
    return !!found && found.array === page.elements && found.index > 0;
}

export function renderPageList() {
    const list = els["page-list"];
    if (!list) return;
    list.innerHTML = "";
    const pages = state.project.template.pages;
    pages.forEach((page, index) => {
        list.appendChild(buildPageRow(page, index, pages.length));
    });
    if (els["btn-page-split"]) els["btn-page-split"].disabled = !canSplitAtCurrentSelection();
}

function buildPageRow(page, index, total) {
    const row = document.createElement("div");
    row.className = "page-row" + (index === state.currentPageIndex ? " is-selected" : "");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === state.currentPageIndex));

    const main = document.createElement("div");
    main.className = "page-row-main";
    main.addEventListener("click", (e) => {
        if (e.target.closest("input, button")) return;
        setCurrentPage(index);
    });

    const badge = document.createElement("span");
    badge.className = "ts-badge is-small is-outlined page-row-index";
    badge.textContent = String(index + 1);

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "page-row-name";
    nameInput.value = page.name;
    nameInput.setAttribute("aria-label", `頁面 ${index + 1} 名稱`);
    nameInput.addEventListener("click", () => setCurrentPage(index));
    nameInput.addEventListener("change", () => renamePage(page.id, nameInput.value));
    nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") nameInput.blur();
    });

    main.append(badge, nameInput);

    const cutLabel = document.createElement("label");
    cutLabel.className = "page-row-cut";
    cutLabel.dataset.tooltip = "列印完這一頁要不要切紙；關閉＝跟下一頁接續印在同一段連續紙上";
    const cutInput = document.createElement("input");
    cutInput.type = "checkbox";
    cutInput.checked = page.cutAfter;
    cutInput.setAttribute("aria-label", `頁面 ${index + 1} 列印後切紙`);
    cutInput.addEventListener("change", () => setPageCutAfter(page.id, cutInput.checked));
    const cutText = document.createElement("span");
    cutText.className = "ts-text is-description is-small";
    cutText.textContent = "切紙";
    cutLabel.append(cutInput, cutText);

    const actions = document.createElement("span");
    actions.className = "page-row-actions";
    actions.appendChild(iconButton("arrow-up", `上移頁面 ${page.name}`, () => movePage(page.id, -1)));
    actions.appendChild(iconButton("arrow-down", `下移頁面 ${page.name}`, () => movePage(page.id, 1)));
    if (index !== state.currentPageIndex) {
        actions.appendChild(iconButton("object-ungroup", `把「${page.name}」合併到目前頁`, () => mergePageInto(page.id)));
    }
    const delBtn = iconButton("trash", `刪除頁面 ${page.name}`, () => {
        if (total <= 1) return;
        if (confirm(`確定要刪除「${page.name}」嗎？此動作可以用復原（Ctrl+Z）復原。`)) deletePage(page.id);
    });
    delBtn.disabled = total <= 1;
    actions.appendChild(delBtn);

    row.append(main, cutLabel, actions);
    return row;
}

export function bindPageList() {
    els["btn-page-add"]?.addEventListener("click", addPage);
    els["btn-page-split"]?.addEventListener("click", splitAtSelection);
    document.addEventListener("printan:selectionchange", () => {
        if (els["btn-page-split"]) els["btn-page-split"].disabled = !canSplitAtCurrentSelection();
    });
}
