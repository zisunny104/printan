import { getTextContent } from "../core/document-model.js";
import { childArrays, resolveTargetArray, findContainerOf, isSameTarget, containerToTarget as containerToTargetIn } from "../core/element-tree.js";
import { BARCODE_FORMATS } from "../core/barcode.js";
import { els, state } from "./context.js";
import { iconButton } from "./inspector-widgets.js";
import { renderInspector } from "./inspector.js";
import { deleteElement, duplicateElement, getSelectedIds, moveElement, moveElementToContainer, openAddMenu, selectElementById } from "./element-actions.js";

// ---- 版面結構大綱 ----

export function renderOutline() {
    const root = els["outline-list"];
    // 列被重建時觸發 tooltip 的按鈕會直接消失、收不到 mouseleave，Tocas 掛在 body 的 tooltip 會殘留在左上角
    document.querySelectorAll("body > .ts-tooltip").forEach((tip) => tip.remove());
    const focusKey = root.contains(document.activeElement) ? document.activeElement.closest(".outline-row")?.dataset.rowKey : null;
    root.innerHTML = "";
    root.appendChild(buildElementList(state.project.template.elements, 0, "root"));
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
        else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            row.click();
            return;
        } else return;
        // 焦點在大綱時方向鍵只移動焦點，不要讓全域快捷鍵去選取／移動畫布上的元素
        e.preventDefault();
        next?.focus();
    });
}

function buildElementList(elements, depth, parentKey) {
    const frag = document.createDocumentFragment();
    elements.forEach((el) => {
        frag.appendChild(buildElementRow(el, depth, parentKey));
        if (el.type === "row" || el.type === "group") {
            childArrays(el).forEach((col, colIndex) => {
                const target = { rowId: el.id, colIndex };
                frag.appendChild(buildTargetHeader(el.type === "group" ? "群組內" : `第 ${colIndex + 1} 欄`, target, depth + 1));
                frag.appendChild(buildElementList(col, depth + 2, `${el.id}:${colIndex}`));
            });
        }
    });
    return frag;
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
        moveElementToContainer(id, resolveTargetArray(state.project.template.elements, target), 0);
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
        const found = findContainerOf(state.project.template.elements, el.id);
        const id = outlineDragState.id;
        outlineDragState = null;
        if (!found) return;
        moveElementToContainer(id, found.array, before ? found.index : found.index + 1);
    });
}

function buildTargetHeader(label, target, depth) {
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
    row.appendChild(icon);
    row.appendChild(span);
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

function buildElementRow(el, depth, parentKey) {
    const row = document.createElement("div");
    row.className = `outline-row outline-indent-${depth}`;
    row.dataset.elType = el.type;
    row.dataset.rowKey = el.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-level", String(depth + 1));
    const selected = getSelectedIds().includes(el.id);
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

    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(actions);

    row.addEventListener("click", (e) => selectElementById(el.id, { toggle: e.shiftKey || e.ctrlKey || e.metaKey }));
    wireOutlineRowDrag(row, el, parentKey);

    return row;
}

export function containerToTarget(array) {
    return containerToTargetIn(state.project.template.elements, array);
}
