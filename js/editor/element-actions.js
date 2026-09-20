import { createTextElement, createSpacerElement, createDividerElement, createRowElement, createBarcodeElement } from "../core/document-model.js";
import { resolveTargetArray, findElementById, findContainerOf, removeElements, groupElementsIn, ungroupElementsIn, duplicateElementsIn, moveElementBy, moveElementsBy, moveElementToIndex, moveElementToContainerIn, selectionToIds, idsToSelection, pruneSelectionIn } from "../core/element-tree.js";
import { els, rt, state } from "./context.js";
import { renderInspector } from "./inspector.js";
import { containerToTarget, renderOutline } from "./outline.js";
import { inlineEditor, onModelChange } from "./editor.js";

// ---- Element tree 操作 ----

// 新增元素的種類清單：工具列、左側「＋」選單共用，避免兩處各寫一份。
const ADD_KINDS = [
    { kind: "text", label: "文字", icon: "font" },
    { kind: "image", label: "圖片", icon: "image" },
    { kind: "spacer", label: "間隔", icon: "arrows-up-down" },
    { kind: "divider", label: "分隔線", icon: "minus" },
    { kind: "barcode", label: "條碼", icon: "qrcode" },
];
const ROW_RATIOS = [[1, 1], [2, 1], [1, 2], [1, 1, 1]];

/** 新增一個元素。target 有給就插進那個容器（undefined＝目前的插入目標）。 */
export function addElement(kind, { ratio, target } = {}) {
    if (target !== undefined) state.insertionTarget = target;
    switch (kind) {
        case "text": return insertElement(createTextElement());
        case "spacer": return insertElement(createSpacerElement());
        case "divider": return insertElement(createDividerElement());
        case "barcode": return insertElement(createBarcodeElement());
        case "row": return insertElement(createRowElement(ratio));
        case "image":
            rt.imageFileInputHandler = null;
            els["image-file-input"].click();
    }
}

// 新增後要把畫布捲到新元素、文字元素直接進入行內編輯；預覽是延後才畫好的，
// 所以先記下來，等 renderEditOverlay() 畫完疊層再處理。

export function insertElement(element) {
    const target = resolveTargetArray(state.project.template.elements, state.insertionTarget);
    target.push(element);
    state.selectedId = element.id;
    state.multi = [];
    rt.pendingReveal = { id: element.id, edit: element.type === "text" };
    onModelChange();
    els["outline-list"].querySelector(".outline-row.is-selected")?.scrollIntoView({ block: "nearest" });
}

export function revealPendingElement() {
    if (!rt.pendingReveal) return;
    const { id, edit } = rt.pendingReveal;
    rt.pendingReveal = null;
    const block = els["edit-overlay"].querySelector(`.edit-block[data-id="${id}"]`);
    if (!block) return;
    block.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (edit) inlineEditor.open(id);
}

// 「＋」新增選單：版面結構標題與每個容器列共用同一個浮出選單，開啟時記下要插入的容器。
// 多欄比例收在子選單裡（addMenu.sub），主選單保持短。
const addMenu = { el: null, sub: null, subTrigger: null, target: null, anchor: null };

function menuItems(menu) {
    return Array.from(menu.querySelectorAll(':scope > [role="menuitem"]'));
}

function closeAddSubmenu() {
    if (!addMenu.sub || addMenu.sub.hidden) return;
    addMenu.sub.hidden = true;
    addMenu.subTrigger.setAttribute("aria-expanded", "false");
}

function closeAddMenu() {
    if (!addMenu.el || addMenu.el.hidden) return;
    closeAddSubmenu();
    addMenu.el.hidden = true;
    addMenu.anchor?.setAttribute("aria-expanded", "false");
}

/** 把固定定位的選單放到 (left, top) 附近，超出視窗就往內收。 */
function placeMenu(menu, left, top, flipTop = top) {
    menu.hidden = false;
    menu.style.visibility = "hidden";
    const fitsBelow = top + menu.offsetHeight <= window.innerHeight - 8;
    menu.style.top = `${fitsBelow ? top : Math.max(8, flipTop - menu.offsetHeight)}px`;
    menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.visibility = "";
}

export function openAddMenu(anchor, target) {
    if (!addMenu.el.hidden && addMenu.anchor === anchor) return closeAddMenu();
    closeAddMenu();
    addMenu.target = target;
    addMenu.anchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    const rect = anchor.getBoundingClientRect();
    placeMenu(addMenu.el, rect.left, rect.bottom + 6, rect.top - 6);
    menuItems(addMenu.el)[0]?.focus();
}

function openAddSubmenu() {
    const trigger = addMenu.subTrigger;
    const rect = trigger.getBoundingClientRect();
    const sub = addMenu.sub;
    sub.hidden = false;
    // 右側放不下就開到主選單左邊
    const left = rect.right + sub.offsetWidth + 8 <= window.innerWidth ? rect.right + 2 : rect.left - sub.offsetWidth - 2;
    placeMenu(sub, left, rect.top - 4, rect.bottom + 4);
    trigger.setAttribute("aria-expanded", "true");
    menuItems(sub)[0]?.focus();
}

export function wireAddMenu() {
    const buildMenu = (label) => {
        const menu = document.createElement("div");
        menu.className = "ts-menu is-dense is-small is-separated pane-dropdown-menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", label);
        menu.hidden = true;
        menu.style.position = "fixed";
        document.body.appendChild(menu);
        return menu;
    };
    const menu = buildMenu("新增元素");
    const sub = buildMenu("新增多欄");
    sub.style.zIndex = "1";

    const addItem = (parent, icon, label, onPick) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "item";
        item.setAttribute("role", "menuitem");
        item.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span><span></span>`;
        item.lastChild.textContent = label;
        item.addEventListener("click", () => {
            const target = addMenu.target;
            closeAddMenu();
            onPick(target);
        });
        parent.appendChild(item);
        return item;
    };
    for (const { kind, label, icon } of ADD_KINDS) addItem(menu, icon, `新增${label}`, (target) => addElement(kind, { target }));

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "item";
    trigger.setAttribute("role", "menuitem");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = '<span class="ts-icon is-table-columns-icon" aria-hidden="true"></span><span>新增多欄</span><span class="ts-icon is-chevron-right-icon add-menu-more" aria-hidden="true"></span>';
    trigger.addEventListener("click", () => (sub.hidden ? openAddSubmenu() : closeAddSubmenu()));
    menu.appendChild(trigger);
    for (const ratio of ROW_RATIOS) addItem(sub, "table-columns", ratio.join(" / "), (target) => addElement("row", { ratio, target }));

    addMenu.el = menu;
    addMenu.sub = sub;
    addMenu.subTrigger = trigger;

    document.addEventListener("click", (evt) => {
        if (menu.hidden || menu.contains(evt.target) || sub.contains(evt.target) || addMenu.anchor?.contains(evt.target)) return;
        closeAddMenu();
    });
    document.addEventListener("keydown", (evt) => {
        if (menu.hidden) return;
        const inSub = sub.contains(document.activeElement);
        if (!inSub && !menu.contains(document.activeElement)) {
            if (evt.key === "Escape") closeAddMenu();
            return;
        }
        const list = menuItems(inSub ? sub : menu);
        const index = list.indexOf(document.activeElement);
        let handled = true;
        if (evt.key === "ArrowDown") list[(index + 1) % list.length].focus();
        else if (evt.key === "ArrowUp") list[(index - 1 + list.length) % list.length].focus();
        else if (evt.key === "Home") list[0].focus();
        else if (evt.key === "End") list[list.length - 1].focus();
        else if (evt.key === "ArrowRight" && document.activeElement === trigger) openAddSubmenu();
        else if (evt.key === "ArrowLeft" && inSub) {
            closeAddSubmenu();
            trigger.focus();
        } else if (evt.key === "Escape") {
            if (inSub) {
                closeAddSubmenu();
                trigger.focus();
            } else {
                const anchor = addMenu.anchor;
                closeAddMenu();
                anchor?.focus();
            }
        } else handled = false;
        if (handled) {
            evt.preventDefault();
            evt.stopPropagation();
        }
    });

    const header = els["btn-outline-add"];
    header.addEventListener("click", () => openAddMenu(header, state.insertionTarget));
    const toolbarAdd = els["btn-toolbar-add"];
    toolbarAdd.addEventListener("click", () => openAddMenu(toolbarAdd, state.insertionTarget));
}

export function deleteElement(id) {
    deleteElements([id]);
}

export function deleteElements(ids) {
    for (const id of removeElements(state.project.template.elements, ids)) {
        if (state.insertionTarget && state.insertionTarget.rowId === id) state.insertionTarget = null;
    }
    pruneSelection();
    onModelChange();
}

// 建立群組：把同一層的選取元素收進一個新群組（放在最前面那個的位置）；解散則把子元素放回原位
export function groupElements(ids) {
    const group = groupElementsIn(state.project.template.elements, ids);
    if (!group) return;
    setSelection([group.id]);
    onModelChange();
}

export function ungroupElements(ids) {
    const freed = ungroupElementsIn(state.project.template.elements, ids);
    if (!freed.length) return;
    setSelection(freed);
    onModelChange();
}

export function duplicateElement(id) {
    duplicateElements([id]);
}

export function duplicateElements(ids) {
    const clones = duplicateElementsIn(state.project.template.elements, ids);
    if (!clones.length) return;
    setSelection(clones);
    onModelChange();
}

// 元素被刪掉（刪除、復原）之後，把選取範圍裡已經不存在的 id 拿掉
export function pruneSelection() {
    Object.assign(state, pruneSelectionIn(state.project.template.elements, state));
}

export function getSelectedIds() {
    return selectionToIds(state);
}

export function setSelection(ids) {
    Object.assign(state, idsToSelection(ids));
}

export function moveElement(id, direction) {
    if (moveElementBy(state.project.template.elements, id, direction)) onModelChange();
}

/** 多選整批上移／下移：同一層內，遇到邊界或前一個也是選取中的就不動，其餘保持相對順序。 */
export function moveElements(ids, direction) {
    if (moveElementsBy(state.project.template.elements, ids, direction)) onModelChange();
}

/** 拖曳排序用：把元素移到「同一個容器內、目前索引為 newIndex 的元素之前」。 */
export function moveElementTo(id, newIndex) {
    if (moveElementToIndex(state.project.template.elements, id, newIndex)) onModelChange();
}

/** 跨容器拖曳：把元素搬到另一個容器陣列的 index 位置（同容器時等同 moveElementTo）。
 *  不能把多欄元素搬進自己底下的欄位（會形成迴圈）。 */
export function moveElementToContainer(id, targetArray, index) {
    const { moved, crossed } = moveElementToContainerIn(state.project.template.elements, id, targetArray, index);
    if (!moved) return;
    if (crossed) state.insertionTarget = containerToTarget(targetArray);
    onModelChange();
}

/** 選取元素：outline 清單點擊、畫布疊層點擊共用同一套邏輯。 */
export function selectElementById(id, { toggle = false } = {}) {
    if (toggle) {
        // Shift／Ctrl 點選：在同一層內加入或移出選取，跨層就改成單選
        const current = getSelectedIds();
        const arrayOf = (x) => findContainerOf(state.project.template.elements, x)?.array;
        if (current.length && arrayOf(current[0]) === arrayOf(id)) {
            setSelection(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
            renderOutline();
            renderInspector();
            highlightSelectedBlock();
            return;
        }
    }
    setSelection([id]);
    const el = findElementById(state.project.template.elements, id);
    if (el && el.type !== "row" && el.type !== "group") {
        const found = findContainerOf(state.project.template.elements, id);
        state.insertionTarget = containerToTarget(found?.array);
    }
    renderOutline();
    renderInspector();
    highlightSelectedBlock();
}

export function highlightSelectedBlock() {
    const overlay = els["edit-overlay"];
    if (!overlay) return;
    overlay.querySelectorAll(".edit-block.is-selected").forEach((n) => n.classList.remove("is-selected"));
    for (const id of getSelectedIds()) {
        overlay.querySelector(`.edit-block[data-id="${id}"]`)?.classList.add("is-selected");
    }
}
