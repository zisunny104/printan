import { MAX_ROW_COLUMNS, childArrays, findContainerOf, findElementById, mergeRowColumns, splitRowColumn } from "../core/element-tree.js";
import { splitRowColumns } from "../core/units.js";
import { els, rt, state } from "./context.js";
import { iconButton } from "./inspector-widgets.js";
import { inlineEditor, onModelChange, schedulePreviewLive } from "./editor.js";
import { getSelectedIds, moveElementTo, revealPendingElement, selectElementById } from "./element-actions.js";

// ---- 編輯模式畫布疊層：虛線外框、拖曳排序、拖曳縮放 ----
// 疊層座標直接沿用 renderer.js 排版產出的 items 樹（跟畫面上的 canvas 完全同一份排版結果），
// 只是額外換算成 CSS px 蓋在 canvas 上面；預覽模式只是把這層疊層清空隱藏，canvas 本身不受影響。

export function renderEditOverlay() {
    const overlay = els["edit-overlay"];
    if (!overlay) return;
    overlay.innerHTML = "";
    if (state.viewMode !== "edit" || !rt.lastRenderResult) {
        inlineEditor.close();
        return;
    }

    const { items, widthDots, canvas } = rt.lastRenderResult;
    const scale = canvas.clientWidth / widthDots || 1;
    const handleBuilders = [];

    walkItems(items, 0, 0, (box, item) => {
        overlay.appendChild(buildEditBlock(box, scale));
        if (box.el.type === "spacer" || box.el.type === "image" || box.el.type === "barcode") {
            handleBuilders.push(() => buildHeightResizeHandle(box, scale));
        }
        if ((box.el.type === "image" || box.el.type === "float-block") && item.drawHeight > 0) {
            for (const spec of imageHandleSpecs(box, item)) handleBuilders.push(() => buildImageResizeHandle(box, item, spec, scale));
        }
        if (box.el.type === "row") {
            item.columns.forEach((col, i) => {
                if (i === item.columns.length - 1) return; // 最後一欄後面沒有把手
                const boundaryXDots = box.x + (col.x + col.width + item.columns[i + 1].x) / 2; // 有欄距時把手放在兩欄中間
                handleBuilders.push(() => buildColumnResizeHandle(box.el, i, boundaryXDots, box.y, box.height, box.width, scale));
            });
            if (item.columns.length < MAX_ROW_COLUMNS && getSelectedIds().includes(box.el.id)) { // 只在選取該多欄時顯示，避免每個多欄都冒出＋
                item.columns.forEach((col, i) => {
                    handleBuilders.push(() => buildColumnSplitButton(box.el.id, i, box.x + col.x + col.width / 2, box.y, scale));
                });
            }
        }
    });

    // 把手一律留到最後才加進 DOM，確保疊在所有元素外框之上，滑鼠才抓得到
    handleBuilders.forEach((build) => overlay.appendChild(build()));
    inlineEditor.reposition();
    revealPendingElement();
}

function walkItems(items, offsetX, offsetY, visit) {
    for (const item of items) {
        const box = { el: item.el, x: offsetX, y: offsetY + item.y, width: item.widthDots, height: item.height };
        visit(box, item);
        if (item.el.type === "row") {
            for (const col of item.columns) {
                walkItems(col.items, offsetX + col.x, offsetY + item.y, visit);
            }
        } else if (item.el.type === "group") {
            walkItems(item.children, offsetX, offsetY + item.y, visit);
        }
    }
}

function buildEditBlock(box, scale) {
    const div = document.createElement("div");
    div.className = "edit-block";
    div.dataset.id = box.el.id;
    div.style.left = `${box.x * scale}px`;
    div.style.top = `${box.y * scale}px`;
    div.style.width = `${box.width * scale}px`;
    div.style.height = `${Math.max(box.height, 1) * scale}px`;
    if (getSelectedIds().includes(box.el.id)) div.classList.add("is-selected");
    attachBlockInteractions(div, box.el.id);
    return div;
}

/** 點擊選取＋拖曳排序（在同一個容器內，跟大綱面板的上移／下移操作同一個 array）。 */
// 畫布上點到群組裡的元素：先選整個群組（可整體拖曳），群組已選取時再點才選到裡面的元素
function outermostGroupId(id) {
    const root = state.project.template.elements;
    let top = null;
    (function walk(elements, chain) {
        for (const el of elements) {
            if (el.id === id) { top = chain[0] ?? null; return true; }
            for (const col of childArrays(el)) {
                if (walk(col, el.type === "group" ? [...chain, el.id] : chain)) return true;
            }
        }
        return false;
    })(root, []);
    return top;
}

function attachBlockInteractions(div, origId) {
    div.addEventListener("pointerdown", (e) => {
        if (e.target !== div || e.button !== 0) return;
        const groupId = outermostGroupId(origId);
        const inside = groupId && getSelectedIds().some((sid) => sid !== groupId && findElementById([findElementById(state.project.template.elements, groupId)], sid));
        const elId = groupId && !inside ? groupId : origId;
        const startX = e.clientX;
        const startY = e.clientY;
        const scroller = els["paper-scroll"];
        const startScrollTop = scroller.scrollTop;
        const startScrollLeft = scroller.scrollLeft;
        let lastY = startY;
        let dragging = false;
        let siblings = null;
        let scrollFrame = 0;

        // 工作區是內部捲動容器：拖曳中捲動會讓元素框的螢幕位置移動，所以位移要補上捲動量，
        // 同層元素的座標也每次重新量（捲動後 client 座標會變）
        function updateDrag(clientX, clientY) {
            const dx = clientX - startX + (scroller.scrollLeft - startScrollLeft);
            const dy = clientY - startY + (scroller.scrollTop - startScrollTop);
            div.style.transform = `translate(${dx}px, ${dy}px)`;
            siblings = collectSiblingBoxes(elId);
            if (siblings) showInsertionLine(findDropTarget(siblings, clientY).edgeY);
        }
        let lastX = startX;

        // 游標靠近工作區上下緣時自動捲動，才拖得到目前畫面外的位置
        function autoScroll() {
            scrollFrame = 0;
            if (!dragging) return;
            const rect = scroller.getBoundingClientRect();
            const zone = 40;
            let speed = 0;
            if (lastY < rect.top + zone) speed = -Math.ceil(18 * Math.min(1, (rect.top + zone - lastY) / zone));
            else if (lastY > rect.bottom - zone) speed = Math.ceil(18 * Math.min(1, (lastY - (rect.bottom - zone)) / zone));
            if (!speed) return;
            const before = scroller.scrollTop;
            scroller.scrollTop += speed;
            if (scroller.scrollTop !== before) updateDrag(lastX, lastY);
            scrollFrame = requestAnimationFrame(autoScroll);
        }

        function onMove(ev) {
            lastX = ev.clientX;
            lastY = ev.clientY;
            if (!dragging) {
                if (Math.hypot(lastX - startX, lastY - startY) < 4) return;
                dragging = true;
                div.classList.add("is-dragging");
            }
            updateDrag(lastX, lastY);
            if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
        }
        function onUp(ev) {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            cancelAnimationFrame(scrollFrame);
            scrollFrame = 0;
            div.classList.remove("is-dragging");
            div.style.transform = "";
            clearInsertionLine();
            if (dragging && siblings) {
                moveElementTo(elId, findDropTarget(siblings, ev.clientY).index);
            } else if (!dragging) {
                // 已選取的文字元素再點一下＝在預覽區直接編輯，插入點落在點擊位置
                const toggle = ev.shiftKey || ev.ctrlKey || ev.metaKey;
                const editText = !toggle && state.selectedId === elId && !state.multi.length && ["text", "float-block"].includes(findElementById(state.project.template.elements, elId)?.type);
                const enter = elId !== origId && !toggle && getSelectedIds().includes(elId);
                selectElementById(enter ? origId : elId, { toggle });
                if (editText) inlineEditor.open(elId, { x: ev.clientX, y: ev.clientY });
            }
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    });
}

function collectSiblingBoxes(elId) {
    const found = findContainerOf(state.project.template.elements, elId);
    if (!found) return null;
    const overlay = els["edit-overlay"];
    const others = found.array
        .filter((el) => el.id !== elId)
        .map((el) => {
            const node = overlay.querySelector(`.edit-block[data-id="${el.id}"]`);
            return node ? { id: el.id, rect: node.getBoundingClientRect() } : null;
        })
        .filter(Boolean);
    return { array: found.array, others };
}

function findDropTarget(siblings, clientY) {
    const { array, others } = siblings;
    for (const o of others) {
        const mid = o.rect.top + o.rect.height / 2;
        if (clientY < mid) {
            return { index: array.findIndex((el) => el.id === o.id), edgeY: o.rect.top };
        }
    }
    if (others.length) {
        const last = others[others.length - 1];
        return { index: array.length, edgeY: last.rect.bottom };
    }
    return { index: 0, edgeY: 0 };
}

function showInsertionLine(edgeYViewport) {
    const overlay = els["edit-overlay"];
    let line = overlay.querySelector(".edit-insertion-line");
    if (!line) {
        line = document.createElement("div");
        line.className = "edit-insertion-line";
        overlay.appendChild(line);
    }
    const overlayRect = overlay.getBoundingClientRect();
    line.style.top = `${edgeYViewport - overlayRect.top}px`;
}

function clearInsertionLine() {
    els["edit-overlay"]?.querySelector(".edit-insertion-line")?.remove();
}

/** 高度拖曳把手：目前只有 spacer／image 的高度是可以直接調整的數值。
 * box.el 來自 renderer 排版結果，是套用 mail merge 資料時深拷貝出來的節點（見 core/merge.js
 * 的 applyDataToElements），跟 state.project.template.elements 不是同一個物件，
 * 所以要修改的話必須用 id 找回真正的 element，直接改 box.el 不會反映到實際專案資料上。 */
function buildHeightResizeHandle(box, scale) {
    const handle = document.createElement("div");
    handle.className = "edit-resize-handle is-height";
    handle.style.left = `${box.x * scale}px`;
    handle.style.width = `${box.width * scale}px`;
    handle.style.top = `${(box.y + box.height) * scale - 3}px`;
    handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.classList.add("is-dragging");
        const realEl = findElementById(state.project.template.elements, box.el.id);
        if (!realEl) return;
        const startY = e.clientY;
        // 圖片預設是依比例縮放（fit=auto，heightDots 不生效）：從目前畫出的高度起算，並自動切成「拉伸」
        const startHeight = realEl.type === "image" && realEl.fit !== "stretch" ? box.height : realEl.heightDots;
        function onMove(ev) {
            const deltaDots = (ev.clientY - startY) / scale;
            if (realEl.type === "image") realEl.fit = "stretch";
            realEl.heightDots = Math.max(1, Math.round(startHeight + deltaDots));
            schedulePreviewLive();
        }
        function onUp() {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            handle.classList.remove("is-dragging");
            onModelChange();
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    });
    return handle;
}

/** 圖片縮放把手的位置：靠左的圖只有右側（左緣是錨點）、靠右的只有左側、置中則兩側都有；每側一個邊中點＋一個下角。 */
// 圖文段落的 align 是文字對齊，圖片位置看 imageSide
const imageAlign = (el) => (el.type === "float-block" ? el.imageSide || "left" : el.align || "center");

function imageHandleSpecs(box, item) {
    const align = imageAlign(item.el);
    const sides = align === "left" ? ["r"] : align === "right" ? ["l"] : ["l", "r"];
    const imgX = box.x + (align === "left" ? 0 : align === "right" ? box.width - item.drawWidth : (box.width - item.drawWidth) / 2);
    return sides.flatMap((side) => {
        const x = imgX + (side === "r" ? item.drawWidth : 0);
        const imgHeight = Math.min(box.height, item.drawHeight);
        return [{ side, corner: false, x, y: box.y + imgHeight / 2 }, { side, corner: true, x, y: box.y + imgHeight }];
    });
}

/** 圖片拖曳縮放：側邊＝只改寬度；下角＝等比縮放，按住 Shift 改為自由拉伸（fit 切成 stretch、高度跟著游標）。
 * 寬度存成 widthPercent；置中時兩側同時外擴，所以游標位移要乘 2 才會讓被拖的那條邊跟手。 */
function buildImageResizeHandle(box, item, { side, corner, x, y }, scale) {
    const handle = document.createElement("div");
    handle.className = "edit-resize-handle is-img";
    const size = 10;
    handle.style.cssText = `left:${x * scale - size / 2}px;top:${y * scale - size / 2}px;width:${size}px;height:${size}px;`
        + `background:#fff;border:1.5px solid currentColor;border-radius:2px;color:var(--ts-primary-500,#2b7de9);`
        + `cursor:${corner ? (side === "r" ? "nwse-resize" : "nesw-resize") : "ew-resize"}`;
    handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const realEl = findElementById(state.project.template.elements, box.el.id);
        if (!realEl) return;
        handle.classList.add("is-dragging");
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = item.drawWidth;
        const startHeight = item.drawHeight;
        const startStretchHeight = realEl.heightDots;
        const factor = imageAlign(realEl) === "center" ? 2 : 1;
        let moved = false;
        function onMove(ev) {
            moved = true;
            const dx = ((ev.clientX - startX) / scale) * (side === "r" ? 1 : -1) * factor;
            const width = Math.min(box.width, Math.max(box.width * 0.01, startWidth + dx));
            realEl.widthPercent = Math.round((width / box.width) * 1000) / 10;
            if (realEl.fit === "none") realEl.fit = "auto"; // 原尺寸不看寬度百分比，拖寬度就切回符合寬度
            if (corner && ev.shiftKey && realEl.type === "image") {
                realEl.fit = "stretch";
                realEl.heightDots = Math.max(1, Math.round(startHeight + (ev.clientY - startY) / scale));
            } else if (realEl.fit === "stretch" && startStretchHeight > 0) {
                realEl.heightDots = Math.max(1, Math.round((startStretchHeight * width) / startWidth));
            }
            schedulePreviewLive();
        }
        function onUp() {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            handle.classList.remove("is-dragging");
            if (moved) onModelChange();
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    });
    return handle;
}

/** 欄寬拖曳把手：把兩欄的目前點寬直接當比例使用，拖曳時即時換算成新的 ratio。
 * rowEl 同樣是排版結果裡的深拷貝節點（理由同 buildHeightResizeHandle 的註解），
 * 要修改 ratio 必須用 id 找回 state.project.template.elements 裡真正的 row。 */
function buildColumnResizeHandle(rowEl, colIndex, boundaryXDots, rowYDots, rowHeightDots, rowWidthDots, scale) {
    const handle = document.createElement("div");
    handle.className = "edit-resize-handle is-col";
    handle.style.left = `${boundaryXDots * scale - 3}px`;
    handle.style.top = `${rowYDots * scale}px`;
    handle.style.height = `${Math.max(rowHeightDots, 1) * scale}px`;
    handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.classList.add("is-dragging");
        const realRow = findElementById(state.project.template.elements, rowEl.id);
        if (!realRow) return;
        const startX = e.clientX;
        const startWidths = splitRowColumns(rowWidthDots, realRow.ratio, realRow.gap).widths;
        const minWidth = 10;
        let moved = false;
        function onMove(ev) {
            moved = true;
            let deltaDots = (ev.clientX - startX) / scale;
            deltaDots = Math.max(deltaDots, minWidth - startWidths[colIndex]);
            deltaDots = Math.min(deltaDots, startWidths[colIndex + 1] - minWidth);
            const widths = startWidths.slice();
            widths[colIndex] = Math.round(widths[colIndex] + deltaDots);
            widths[colIndex + 1] = Math.round(widths[colIndex + 1] - deltaDots);
            realRow.ratio = widths;
            schedulePreviewLive();
        }
        function onUp() {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            handle.classList.remove("is-dragging");
            if (moved) onModelChange(); // 沒動就不重繪，否則雙擊的第二下會落在被換掉的把手上
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    });
    // 雙擊分隔線：拿掉這條分割，右欄內容併入左欄
    handle.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const realRow = findElementById(state.project.template.elements, rowEl.id);
        if (realRow && mergeRowColumns(realRow, colIndex)) onModelChange();
    });
    return handle;
}

/** 欄位上方的「＋」：把這一欄對半分成兩欄。 */
function buildColumnSplitButton(rowId, colIndex, centerXDots, rowYDots, scale) {
    const btn = iconButton("plus", "分割欄位", () => {
        const realRow = findElementById(state.project.template.elements, rowId);
        if (realRow && splitRowColumn(realRow, colIndex)) onModelChange();
    });
    btn.classList.add("edit-col-split");
    btn.style.cssText = `position:absolute;pointer-events:auto;transform:translateX(-50%);left:${centerXDots * scale}px;top:${rowYDots * scale}px`;
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    return btn;
}
