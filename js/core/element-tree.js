// 版面元素樹的純資料操作：尋找、群組、搬移、複製、選取整理、復原快照。
// 不依賴 DOM／editor 狀態；editor.js 呼叫這裡再自己負責重繪與存檔。

import { createGroupElement, cloneElementWithNewIds } from "./document-model.js";

// 有子元素的容器：多欄的每一欄、群組的 children（容器目標 { rowId, colIndex } 對群組固定 colIndex 0）
export function childArrays(el) {
    if (el.type === "row") return el.columns;
    if (el.type === "group") return [el.children];
    return [];
}

export function resolveTargetArray(rootElements, target) {
    if (!target) return rootElements;
    const row = findElementById(rootElements, target.rowId);
    if (!row) return rootElements;
    return childArrays(row)[target.colIndex] || rootElements;
}

export function findElementById(elements, id) {
    for (const el of elements) {
        if (el.id === id) return el;
        for (const col of childArrays(el)) {
            const found = findElementById(col, id);
            if (found) return found;
        }
    }
    return null;
}

export function findContainerOf(elements, id) {
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].id === id) return { array: elements, index: i };
        for (const col of childArrays(elements[i])) {
            const found = findContainerOf(col, id);
            if (found) return found;
        }
    }
    return null;
}

export function containsArray(elements, array) {
    return elements.some((el) => childArrays(el).some((col) => col === array || containsArray(col, array)));
}

export function isSameTarget(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.rowId === b.rowId && a.colIndex === b.colIndex;
}

/** 容器陣列 → 插入目標 { rowId, colIndex }；根層回傳 null。 */
export function containerToTarget(rootElements, array) {
    if (array === rootElements) return null;
    let result = null;
    (function walk(elements) {
        for (const el of elements) {
            childArrays(el).forEach((col, i) => {
                if (col === array) result = { rowId: el.id, colIndex: i };
                walk(col);
            });
        }
    })(rootElements);
    return result;
}

export function flattenElements(elements, out = []) {
    for (const el of elements) {
        out.push(el);
        childArrays(el).forEach((col) => flattenElements(col, out));
    }
    return out;
}

export function setRowRatio(rowEl, newRatio) {
    const newColumns = newRatio.map(() => []);
    rowEl.columns.forEach((col, i) => {
        const idx = Math.min(i, newColumns.length - 1);
        newColumns[idx].push(...col);
    });
    rowEl.ratio = newRatio;
    rowEl.columns = newColumns;
}

export const MAX_ROW_COLUMNS = 6;

/** 把第 colIndex 欄對半切成兩欄（新欄在右、空的）；達欄數上限回傳 false。 */
export function splitRowColumn(rowEl, colIndex) {
    if (rowEl.columns.length >= MAX_ROW_COLUMNS || !rowEl.columns[colIndex]) return false;
    const half = rowEl.ratio[colIndex] / 2;
    rowEl.ratio.splice(colIndex, 1, half, half);
    rowEl.columns.splice(colIndex + 1, 0, []);
    return true;
}

/** 拿掉第 boundary 欄與下一欄之間的分割：右欄內容併入左欄，比例相加；只剩一欄時回傳 false。 */
export function mergeRowColumns(rowEl, boundary) {
    if (rowEl.columns.length < 2 || !rowEl.columns[boundary + 1]) return false;
    rowEl.columns[boundary].push(...rowEl.columns[boundary + 1]);
    rowEl.columns.splice(boundary + 1, 1);
    rowEl.ratio.splice(boundary, 2, rowEl.ratio[boundary] + rowEl.ratio[boundary + 1]);
    return true;
}

/** 刪除元素，回傳實際刪掉的 id。 */
export function removeElements(root, ids) {
    const removed = [];
    for (const id of ids) {
        const found = findContainerOf(root, id);
        if (!found) continue;
        found.array.splice(found.index, 1);
        removed.push(id);
    }
    return removed;
}

/** 把同一層的元素收進一個新群組（放在最前面那個的位置）；不在同一層或找不到就回傳 null。 */
export function groupElementsIn(root, ids) {
    const found = ids.map((id) => findContainerOf(root, id)).filter(Boolean);
    if (!found.length || found.some((f) => f.array !== found[0].array)) return null;
    const array = found[0].array;
    const members = found.sort((a, b) => a.index - b.index).map((f) => f.array[f.index]);
    const at = found[0].index;
    const group = createGroupElement(members);
    for (const m of members) array.splice(array.indexOf(m), 1);
    array.splice(at, 0, group);
    return group;
}

/** 解散群組，子元素放回原位；回傳被放出來的子元素 id。 */
export function ungroupElementsIn(root, ids) {
    const freed = [];
    for (const id of ids) {
        const found = findContainerOf(root, id);
        const group = found?.array[found.index];
        if (!group || group.type !== "group") continue;
        found.array.splice(found.index, 1, ...group.children);
        freed.push(...group.children.map((c) => c.id));
    }
    return freed;
}

/** 複製元素（緊接在原本之後），回傳新元素 id。 */
export function duplicateElementsIn(root, ids) {
    const clones = [];
    for (const id of ids) {
        const found = findContainerOf(root, id);
        if (!found) continue;
        const clone = cloneElementWithNewIds(found.array[found.index]);
        found.array.splice(found.index + 1, 0, clone);
        clones.push(clone.id);
    }
    return clones;
}

/** 上移／下移一格；到邊界就不動，回傳是否有移動。 */
export function moveElementBy(root, id, direction) {
    const found = findContainerOf(root, id);
    if (!found) return false;
    const newIndex = found.index + direction;
    if (newIndex < 0 || newIndex >= found.array.length) return false;
    const [item] = found.array.splice(found.index, 1);
    found.array.splice(newIndex, 0, item);
    return true;
}

/** 多選整批上移／下移：同一層內，遇到邊界或前一個也是選取中的就不動，其餘保持相對順序。 */
export function moveElementsBy(root, ids, direction) {
    const found = findContainerOf(root, ids[0]);
    if (!found) return false;
    const arr = found.array;
    const set = new Set(ids);
    const swap = (i, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
    if (direction < 0) {
        for (let i = 1; i < arr.length; i++) if (set.has(arr[i].id) && !set.has(arr[i - 1].id)) swap(i, i - 1);
    } else {
        for (let i = arr.length - 2; i >= 0; i--) if (set.has(arr[i].id) && !set.has(arr[i + 1].id)) swap(i, i + 1);
    }
    return true;
}

/** 拖曳排序用：把元素移到「同一個容器內、目前索引為 newIndex 的元素之前」；回傳是否有移動。 */
export function moveElementToIndex(root, id, newIndex) {
    const found = findContainerOf(root, id);
    if (!found) return false;
    const { array, index } = found;
    let target = newIndex;
    if (target > index) target -= 1;
    target = Math.max(0, Math.min(target, array.length - 1));
    if (target === index) return false;
    const [item] = array.splice(index, 1);
    array.splice(target, 0, item);
    return true;
}

/** 跨容器搬移到 targetArray 的 index 位置（同容器時等同 moveElementToIndex）；
 *  不能把容器搬進自己底下（會形成迴圈）。回傳 { moved, crossed }。 */
export function moveElementToContainerIn(root, id, targetArray, index) {
    const found = findContainerOf(root, id);
    if (!found) return { moved: false, crossed: false };
    if (found.array === targetArray) return { moved: moveElementToIndex(root, id, index), crossed: false };
    const item = found.array[found.index];
    if (childArrays(item).some((col) => col === targetArray || containsArray(col, targetArray))) return { moved: false, crossed: false };
    found.array.splice(found.index, 1);
    targetArray.splice(Math.max(0, Math.min(index, targetArray.length)), 0, item);
    return { moved: true, crossed: true };
}

// ---- 選取 ----

/** 選取範圍：單選是 selectedId，多選另外記 multi（同一層內，含 selectedId）。 */
export function selectionToIds({ selectedId, multi }) {
    if (multi.length > 1) return multi;
    return selectedId ? [selectedId] : [];
}

export function idsToSelection(ids) {
    return { selectedId: ids[ids.length - 1] ?? null, multi: ids.length > 1 ? ids : [] };
}

/** 元素被刪掉（刪除、復原）之後，把選取範圍裡已經不存在的 id 拿掉。 */
export function pruneSelectionIn(root, { selectedId, multi }) {
    const exists = (id) => findElementById(root, id);
    multi = multi.filter(exists);
    if (multi.length < 2) {
        if (multi.length === 1) selectedId = multi[0];
        multi = [];
    } else if (!multi.includes(selectedId)) {
        selectedId = multi[multi.length - 1];
    }
    if (selectedId && !exists(selectedId)) selectedId = null;
    return { selectedId, multi };
}

/** 多選批次編輯：對每個元素寫入同一欄位；runField 的欄位要一併清掉文字片段自己的覆寫。 */
export function applyFieldToElements(elements, key, value, { runField = false } = {}) {
    for (const el of elements) {
        el[key] = value;
        if (runField) for (const run of el.runs || []) delete run[key];
    }
}

// ---- 復原快照 ----

export function snapshotElements(elements) {
    return JSON.stringify(elements);
}

export function restoreElements(snapshot) {
    return JSON.parse(snapshot);
}
