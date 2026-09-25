import { getTextContent } from "../core/document-model.js";
import { childArrays, resolveTargetArray, findContainerOf, isSameTarget, containerToTarget as containerToTargetIn } from "../core/element-tree.js";
import { BARCODE_FORMATS } from "../core/barcode.js";
import { currentElements, els, state } from "./context.js";
import { iconButton } from "./inspector-widgets.js";
import { renderInspector } from "./inspector.js";
import { deleteElement, duplicateElement, getSelectedIds, moveElement, moveElementToContainer, openAddMenu, selectElementById } from "./element-actions.js";
import { deletePage, mergePageInto, movePage, renamePage, setCurrentPage, setPageCutAfter } from "./pages.js";

// ---- 版面結構大綱 ----
// 比照 Figma 圖層面板：最上層是頁面（frame），底下是該頁的元素，多欄／群組再往下一層，每一層都可以收合。
// 收合狀態只是檢視偏好，不進 .ptan、不進復原歷史。頁面預設只展開作用中那一頁（切頁時跟著換），
// 使用者手動展開／收合過的頁面就照他的意思，不再自動變動。
// 選取範圍仍限定在作用中頁面：點其他頁的元素會先切到那一頁再選取，拖曳排序與列上的操作鈕也只給作用中頁面。
const pageExpanded = new Map(); // pageId → boolean（使用者手動設定過才有）
const collapsedContainers = new Set(); // 收起來的多欄／群組 element id

function isPageExpanded(page, index) {
    return pageExpanded.get(page.id) ?? index === state.currentPageIndex;
}

export function renderOutline() {
    const root = els["outline-list"];
    // 列被重建時觸發 tooltip 的按鈕會直接消失、收不到 mouseleave，Tocas 掛在 body 的 tooltip 會殘留在左上角
    document.querySelectorAll("body > .ts-tooltip").forEach((tip) => tip.remove());
    const focusKey = root.contains(document.activeElement) ? document.activeElement.closest(".outline-row")?.dataset.rowKey : null;
    root.innerHTML = "";
    const pages = state.project.template.pages;
    pages.forEach((page, index) => {
        const expanded = isPageExpanded(page, index);
        root.appendChild(buildPageRow(page, index, pages.length, expanded));
        if (!expanded) return;
        if (page.elements.length) root.appendChild(buildElementList(page.elements, 1, "root", index));
        else root.appendChild(buildEmptyPageRow());
    });
    const rows = Array.from(root.querySelectorAll(".outline-row"));
    const active = rows.find((r) => r.dataset.rowKey === focusKey) || root.querySelector(".outline-row.is-selected") || rows[0];
    setOutlineRoving(active);
    if (focusKey && active?.dataset.rowKey === focusKey) active.focus({ preventScroll: true });
}

// 大綱是 listbox，列用 roving tabindex（只有一列在 Tab 順序內），方向鍵在列之間移動焦點
function setOutlineRoving(active) {
    els["outline-list"].querySelectorAll(".outline-row").forEach((r) => { r.tabIndex = r === active ? 0 : -1; });
}

export function wireOutlineKeyboard() {
    const root = els["outline-list"];
    root.setAttribute("role", "listbox");
    root.setAttribute("aria-label", "版面結構");
    root.addEventListener("focusin", (e) => {
        const row = e.target.closest(".outline-row");
        if (row && e.target === row) setOutlineRoving(row);
    });
    root.addEventListener("keydown", (e) => {
        const row = e.target;
        if (!row.classList?.contains("outline-row")) return;
        const rows = Array.from(root.querySelectorAll(".outline-row"));
        const i = rows.indexOf(row);
        let next = null;
        if (e.key === "ArrowDown") next = rows[Math.min(i + 1, rows.length - 1)];
        else if (e.key === "ArrowUp") next = rows[Math.max(i - 1, 0)];
        else if (e.key === "Home") next = rows[0];
        else if (e.key === "End") next = rows[rows.length - 1];
        else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            const toggle = row.querySelector(":scope > .outline-toggle");
            if (!toggle || (toggle.getAttribute("aria-expanded") === "true") === (e.key === "ArrowRight")) return;
            e.preventDefault();
            toggle.click();
            return;
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            row.click();
            return;
        } else return;
        // 焦點在大綱時方向鍵只移動焦點，不要讓全域快捷鍵去選取／移動畫布上的元素
        e.preventDefault();
        next?.focus();
    });
}

// 收合鈕：有子層的列才有，沒有子層的列放同寬的空位，讓同一層的圖示與名稱對齊
function buildToggle(expanded, label, onToggle) {
    if (!onToggle) {
        const spacer = document.createElement("span");
        spacer.className = "outline-toggle is-spacer";
        spacer.setAttribute("aria-hidden", "true");
        return spacer;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "outline-toggle";
    btn.tabIndex = -1; // 鍵盤用 ←／→ 收合（見 wireOutlineKeyboard），不另外佔 Tab 順序
    btn.setAttribute("aria-expanded", String(expanded));
    btn.setAttribute("aria-label", `${expanded ? "收合" : "展開"}${label}`);
    btn.innerHTML = `<span class="ts-icon is-chevron-${expanded ? "down" : "right"}-icon" aria-hidden="true"></span>`;
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggle();
        renderOutline();
    });
    return btn;
}

function buildElementList(elements, depth, parentKey, pageIndex) {
    const frag = document.createDocumentFragment();
    elements.forEach((el) => {
        const isContainer = el.type === "row" || el.type === "group";
        const expanded = isContainer && !collapsedContainers.has(el.id);
        frag.appendChild(buildElementRow(el, depth, parentKey, pageIndex, isContainer, expanded));
        if (!expanded) return;
        childArrays(el).forEach((col, colIndex) => {
            const target = { rowId: el.id, colIndex };
            frag.appendChild(buildTargetHeader(el.type === "group" ? "群組內" : `第 ${colIndex + 1} 欄`, target, depth + 1, pageIndex));
            frag.appendChild(buildElementList(col, depth + 2, `${el.id}:${colIndex}`, pageIndex));
        });
    });
    return frag;
}

// ---- 頁面列（樹的最上層）----

function buildPageRow(page, index, total, expanded) {
    const isCurrent = index === state.currentPageIndex;
    const row = document.createElement("div");
    row.className = "outline-row outline-page-row" + (isCurrent ? " is-current" : "");
    row.dataset.rowKey = `p:${page.id}`;
    row.dataset.pageId = page.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-level", "1");
    row.setAttribute("aria-selected", String(isCurrent));
    row.setAttribute("aria-expanded", String(expanded));

    const toggle = buildToggle(expanded, page.name, () => pageExpanded.set(page.id, !expanded));

    const number = document.createElement("span");
    number.className = "outline-page-number";
    number.textContent = String(index + 1);
    number.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "outline-label outline-page-name";
    label.textContent = page.name;
    label.title = page.name;
    label.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        startPageRename(page.id);
    });

    // 切紙狀態常駐顯示（不是 hover 才出現的操作）：亮＝印完切紙，暗＝跟下一頁接續同一張紙，
    // 跟畫布上段落之間的剪刀標記同一個圖示
    const cut = iconButton("scissors", `印完切紙（第 ${index + 1} 頁）`, () => setPageCutAfter(page.id, !page.cutAfter));
    cut.classList.add("outline-page-cut");
    cut.classList.toggle("is-off", !page.cutAfter);
    cut.setAttribute("aria-pressed", String(page.cutAfter));

    const actions = document.createElement("span");
    actions.className = "outline-actions";
    const up = iconButton("arrow-up", `上移頁面 ${page.name}`, () => movePage(page.id, -1));
    up.disabled = index === 0;
    const down = iconButton("arrow-down", `下移頁面 ${page.name}`, () => movePage(page.id, 1));
    down.disabled = index === total - 1;
    actions.append(up, down);
    if (!isCurrent) {
        const target = state.project.template.pages[state.currentPageIndex];
        actions.appendChild(iconButton("object-ungroup", `把「${page.name}」合併到「${target.name}」後面`, () => mergePageInto(page.id)));
    }
    const del = iconButton("trash", `刪除頁面 ${page.name}`, () => {
        if (confirm(`確定要刪除「${page.name}」嗎？可以用復原（Ctrl+Z）救回來。`)) deletePage(page.id);
    });
    del.disabled = total <= 1;
    actions.appendChild(del);

    row.append(toggle, number, label, cut, actions);
    row.addEventListener("click", () => setCurrentPage(index));
    // 作用中頁面列可以當成「放到這頁最上面」的放置目標，跟多欄的欄位標題列一樣
    if (isCurrent) wireOutlineTargetDrop(row, null);
    return row;
}

function buildEmptyPageRow() {
    const row = document.createElement("div");
    row.className = "outline-empty-page outline-indent-1 ts-text is-description is-small";
    row.textContent = "空白頁";
    return row;
}

/** 頁名改成輸入框（雙擊名稱，同 Figma；剛新增頁面時也直接進入）；Enter／失焦確認，Esc 取消。 */
export function startPageRename(pageId) {
    const label = els["outline-list"].querySelector(`.outline-page-row[data-page-id="${CSS.escape(pageId)}"] .outline-page-name`);
    const page = state.project.template.pages.find((p) => p.id === pageId);
    if (!label || !page) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "outline-page-name-input";
    input.value = page.name;
    input.setAttribute("aria-label", "頁面名稱");
    let cancelled = false;
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") input.blur();
        else if (e.key === "Escape") { cancelled = true; input.blur(); }
    });
    input.addEventListener("blur", () => {
        if (!input.isConnected) return; // 樹被別的更新重畫掉了，輸入框已經不在
        if (!cancelled && input.value.trim() && input.value.trim() !== page.name) renamePage(pageId, input.value);
        else renderOutline();
    });
    label.replaceWith(input);
    input.focus();
    input.select();
}

// ---- 大綱拖曳排序：可在同一層重新排序，也可拖到其他欄或最上層（放在元素列上＝插在它前／後，
// 放在容器列上＝放到該容器最前面）；不能把多欄元素拖進自己的欄位。----

let outlineDragState = null; // { id }

function clearOutlineDropIndicators() {
    els["outline-list"].querySelectorAll(".is-drop-before, .is-drop-after").forEach((n) => {
        n.classList.remove("is-drop-before", "is-drop-after");
    });
}

function wireOutlineTargetDrop(row, target) {
    row.addEventListener("dragover", (evt) => {
        if (!outlineDragState) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = "move";
        clearOutlineDropIndicators();
        row.classList.add("is-drop-after");
    });
    row.addEventListener("drop", (evt) => {
        if (!outlineDragState) return;
        evt.preventDefault();
        const id = outlineDragState.id;
        outlineDragState = null;
        moveElementToContainer(id, resolveTargetArray(currentElements(), target), 0);
    });
}

function wireOutlineRowDrag(row, el) {
    row.draggable = true;
    row.addEventListener("dragstart", (evt) => {
        outlineDragState = { id: el.id };
        evt.dataTransfer.effectAllowed = "move";
        evt.dataTransfer.setData("text/plain", el.id);
        row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        clearOutlineDropIndicators();
        outlineDragState = null;
    });
    row.addEventListener("dragover", (evt) => {
        if (!outlineDragState || outlineDragState.id === el.id) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        clearOutlineDropIndicators();
        row.classList.add(before ? "is-drop-before" : "is-drop-after");
    });
    row.addEventListener("drop", (evt) => {
        if (!outlineDragState || outlineDragState.id === el.id) return;
        evt.preventDefault();
        const rect = row.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        const found = findContainerOf(currentElements(), el.id);
        const id = outlineDragState.id;
        outlineDragState = null;
        if (!found) return;
        moveElementToContainer(id, found.array, before ? found.index : found.index + 1);
    });
}

function buildTargetHeader(label, target, depth, pageIndex) {
    const isCurrentPage = pageIndex === state.currentPageIndex;
    const row = document.createElement("div");
    row.className = `outline-row outline-target-row outline-indent-${depth}`;
    const isTarget = isSameTarget(state.insertionTarget, target);
    if (isTarget) row.classList.add("is-target");
    row.dataset.rowKey = target ? `t:${target.rowId}:${target.colIndex}` : "t:root";
    row.setAttribute("role", "option");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-selected", String(isTarget));
    const icon = document.createElement("span");
    icon.className = `ts-icon is-${row.classList.contains("is-target") ? "folder-open" : "folder"}-icon`;
    icon.setAttribute("aria-hidden", "true");
    const span = document.createElement("span");
    span.className = "outline-label";
    span.textContent = label;
    span.title = label;
    row.appendChild(buildToggle(false, label, null));
    row.appendChild(icon);
    row.appendChild(span);
    if (!isCurrentPage) {
        row.addEventListener("click", () => setCurrentPage(pageIndex));
        return row;
    }
    const add = iconButton("plus", `新增到「${label}」`, () => openAddMenu(add, target));
    add.setAttribute("aria-haspopup", "menu");
    add.setAttribute("aria-expanded", "false");
    row.appendChild(add);
    wireOutlineTargetDrop(row, target);
    row.addEventListener("click", () => {
        state.insertionTarget = target;
        state.selectedId = null;
        state.multi = [];
        renderOutline();
        renderInspector();
    });
    return row;
}

const TYPE_ICON = { text: "font", image: "image", spacer: "arrows-up-down", divider: "minus", row: "table-columns", barcode: "qrcode", group: "object-group", "float-block": "newspaper" };

const BARCODE_FORMAT_LABEL = Object.fromEntries(BARCODE_FORMATS);

function elementLabel(el) {
    switch (el.type) {
        case "text": { const t = getTextContent(el); return t ? t.slice(0, 14) : "文字"; }
        case "float-block": { const t = getTextContent(el); return t ? `圖文：${t.slice(0, 10)}` : "圖文"; }
        case "image": return el.assetId ? "圖片" : "圖片（未設定）";
        case "spacer": return `間隔 ${el.heightDots}dot`;
        case "divider": return "分隔線";
        case "row": return `多欄（${el.ratio.join(" : ")}）`;
        case "barcode": return BARCODE_FORMAT_LABEL[el.format] || "條碼";
        case "group": return `群組（${el.children.length}）`;
        default: return el.type;
    }
}

function buildElementRow(el, depth, parentKey, pageIndex, isContainer, expanded) {
    const isCurrentPage = pageIndex === state.currentPageIndex;
    const row = document.createElement("div");
    row.className = `outline-row outline-indent-${depth}`;
    row.dataset.elType = el.type;
    row.dataset.rowKey = el.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-level", String(depth + 1));
    const selected = isCurrentPage && getSelectedIds().includes(el.id);
    row.setAttribute("aria-selected", String(selected));
    if (selected) row.classList.add("is-selected");

    const icon = document.createElement("span");
    icon.className = `ts-icon is-${TYPE_ICON[el.type] || "shapes"}-icon`;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "outline-label";
    label.textContent = elementLabel(el);
    label.title = label.textContent;

    const actions = document.createElement("span");
    actions.className = "outline-actions";
    actions.appendChild(iconButton("arrow-up", `上移 ${label.textContent}`, () => moveElement(el.id, -1)));
    actions.appendChild(iconButton("arrow-down", `下移 ${label.textContent}`, () => moveElement(el.id, 1)));
    actions.appendChild(iconButton("copy", `複製 ${label.textContent}`, () => duplicateElement(el.id)));
    actions.appendChild(iconButton("trash", `刪除 ${label.textContent}`, () => deleteElement(el.id)));

    const toggle = buildToggle(expanded, label.textContent, isContainer ? () => {
        if (expanded) collapsedContainers.add(el.id); else collapsedContainers.delete(el.id);
    } : null);
    row.appendChild(toggle);
    row.appendChild(icon);
    row.appendChild(label);

    // 其他頁的元素：點一下切到那一頁並選取它；列上的操作與拖曳只給作用中頁面（都作用在 currentElements 上）
    if (!isCurrentPage) {
        row.addEventListener("click", () => {
            setCurrentPage(pageIndex);
            selectElementById(el.id);
        });
        return row;
    }
    row.appendChild(actions);
    row.addEventListener("click", (e) => selectElementById(el.id, { toggle: e.shiftKey || e.ctrlKey || e.metaKey }));
    wireOutlineRowDrag(row, el, parentKey);

    return row;
}

export function containerToTarget(array) {
    return containerToTargetIn(currentElements(), array);
}
