// Printan Editor — 串接 core（Document Model / Renderer / Storage）與畫面互動。
// Editor 本身不做排版運算，排版與繪製一律呼叫 core/renderer.js，
// 確保「編輯器看到的結果」跟「實際輸出結果」用同一套邏輯（見需求單第廿一節）。

import { createEmptyProject, loadProject } from "../core/schema.js";
import {
    getPrinterProfile, listPrinterProfiles, getPaperWidth, getDefaultPrinterProfileId,
} from "../core/printer-profiles.js";
import {
    createTextElement, createImageElement, createSpacerElement, createDividerElement,
    createRowElement, cloneElementWithNewIds, extractPlaceholders, getTextContent,
    getRangeStyle, applyStyleToRange, replaceFullText, MIXED,
} from "../core/document-model.js";
import { renderTemplate, renderBatch } from "../core/renderer.js";
import { splitDotsByRatio } from "../core/units.js";
import { downloadPtan, readPtanFile, fileToDataUrl } from "../core/ptan-file.js";
import { exportToPdf } from "../core/pdf-export.js";
import { saveDraft, loadDraft } from "../core/storage.js";
import { SystemDialogAdapter, WebUsbEscposAdapter, detectBrowserCapabilities } from "../core/printer-adapter.js";
import { wireResizableColumns } from "./resizable-columns.js";

const LAST_DRAFT_KEY = "printan:lastDraftId";
const PX_PER_MM = 3.2;

const state = {
    project: null,
    selectedId: null,
    insertionTarget: null, // null = 根目錄；{ rowId, colIndex } = 某個 row 的某一欄
    previewData: {},
    mode: "screen", // "screen" | "thermal"
    viewMode: "edit", // "edit"（畫布顯示可拖曳的虛線外框）| "preview"（隱藏編輯用外框，接近實際列印畫面）
    previewGeneration: 0,
    batchPreview: { active: false, records: [], index: 0 }, // 逐筆預覽批次資料時取代 previewData
    usbConnected: false, // WebUSB 印表機是否已連接；true 時「列印」按鈕直接送 ESC/POS，不走系統對話框
    printPrefs: { feedLines: 4, cutPaper: false }, // 走紙／切紙偏好，跟印表機連線一樣是本機操作習慣，不進 .ptan 文件
};

const usbAdapter = new WebUsbEscposAdapter(); // 整個編輯器共用同一個連線實例

const BATCH_PANEL_EXPANDED_KEY = "printan-batch-panel-expanded";
const PRINT_PREFS_KEY = "printan:printPrefs";

const els = {}; // 快取常用 DOM 節點
let lastRenderResult = null; // 最近一次渲染結果（含排版 items 樹），供編輯疊層與模式切換重繪使用

async function init() {
    cacheDom();
    state.project = await restoreOrCreateProject();
    loadPrintPrefs();
    populatePrinterProfileSelect();
    populatePaperWidthTabs();
    bindToolbar();
    bindFileInputs();
    bindBatchPanel();
    bindPrinterSettings();
    wireResizableColumns();
    onModelChange({ skipInspector: false });
    await attemptSilentPrinterReconnect();
}

function cacheDom() {
    [
        "save-status", "printer-profile-label", "printer-profile-dropdown", "paper-width-tabs",
        "btn-add-text", "btn-add-image", "btn-add-spacer", "btn-add-divider",
        "btn-toggle-thermal", "btn-toggle-preview-mode", "btn-open-ptan", "btn-save-ptan", "btn-export-pdf",
        "btn-export-batch-pdf", "btn-print", "outline-list", "inspector",
        "variables-panel", "batch-data", "paper-viewport", "paper-shadow", "safe-area-guide",
        "canvas-host", "image-file-input", "ptan-file-input",
        "batch-panel-toggle", "batch-panel-body", "btn-preview-batch", "batch-preview-nav",
        "btn-batch-prev", "btn-batch-next", "batch-preview-counter", "btn-batch-end-preview",
        "btn-printer-settings", "printer-settings-dialog", "printer-webusb-unsupported",
        "printer-connection-status", "btn-printer-connect", "btn-printer-disconnect",
        "pref-feed-lines", "pref-cut-paper", "btn-printer-settings-close",
    ].forEach((id) => (els[id] = document.getElementById(id)));
}

// ---- 專案初始化 / 還原 ----

async function restoreOrCreateProject() {
    const lastId = localStorage.getItem(LAST_DRAFT_KEY);
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

// ---- 頂部工具列 ----

// 型號選單用 Tocas 原生 .ts-dropdown（同 row-ratio-dropdown／pitrace 專案選單慣例），
// 不用原生 <select>：瀏覽器對 <select> 展開後的選項清單無法套用自訂樣式，
// 一定是作業系統原生外觀，跟頁面其他地方的 Tocas 視覺不一致。
function populatePrinterProfileSelect() {
    const dropdown = els["printer-profile-dropdown"];
    dropdown.querySelectorAll(".item[data-profile-id]").forEach((item) => item.remove());
    const currentId = state.project.printerProfile.id;

    for (const profile of listPrinterProfiles()) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "item";
        item.dataset.profileId = profile.id;
        if (profile.id === currentId) {
            const check = document.createElement("span");
            check.className = "ts-icon is-check-icon";
            check.setAttribute("aria-hidden", "true");
            item.appendChild(check);
        }
        item.append(`${profile.brand} ${profile.model}`);
        item.addEventListener("click", () => {
            if (profile.id === state.project.printerProfile.id) return;
            state.project.printerProfile.id = profile.id;
            if (!profile.paperWidths.some((w) => w.id === state.project.paper.widthId)) {
                state.project.paper.widthId = profile.defaultPaperWidthId;
            }
            populatePrinterProfileSelect();
            populatePaperWidthTabs();
            onModelChange();
        });
        dropdown.appendChild(item);
    }

    const current = getPrinterProfile(currentId);
    els["printer-profile-label"].textContent = `${current.brand} ${current.model}`;
}

function populatePaperWidthTabs() {
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

function bindToolbar() {
    els["btn-add-text"].addEventListener("click", () => insertElement(createTextElement()));
    els["btn-add-spacer"].addEventListener("click", () => insertElement(createSpacerElement()));
    els["btn-add-divider"].addEventListener("click", () => insertElement(createDividerElement()));

    els["btn-add-image"].addEventListener("click", () => els["image-file-input"].click());

    document.querySelectorAll("#row-ratio-dropdown .item[data-ratio]").forEach((item) => {
        item.addEventListener("click", () => {
            const ratio = item.dataset.ratio.split(",").map(Number);
            insertElement(createRowElement(ratio));
        });
    });

    els["btn-toggle-thermal"].addEventListener("click", () => {
        state.mode = state.mode === "screen" ? "thermal" : "screen";
        els["btn-toggle-thermal"].classList.toggle("is-active", state.mode === "thermal");
        schedulePreview();
    });

    els["btn-toggle-preview-mode"].addEventListener("click", () => {
        state.viewMode = state.viewMode === "edit" ? "preview" : "edit";
        const isPreview = state.viewMode === "preview";
        els["btn-toggle-preview-mode"].classList.toggle("is-active", isPreview);
        els["btn-toggle-preview-mode"].setAttribute("aria-pressed", String(isPreview));
        els["paper-viewport"].classList.toggle("is-preview-mode", isPreview);
        renderEditOverlay();
    });

    els["btn-open-ptan"].addEventListener("click", () => els["ptan-file-input"].click());
    els["btn-save-ptan"].addEventListener("click", () => {
        downloadPtan(state.project, state.project.meta.name || "printan");
    });

    els["btn-export-pdf"].addEventListener("click", exportSinglePdf);
    els["btn-export-batch-pdf"].addEventListener("click", exportBatchPdf);
    els["btn-print"].addEventListener("click", printCurrent);
}

function bindFileInputs() {
    els["image-file-input"].addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        const dataUrl = await fileToDataUrl(file);
        const assetId = `asset_${Date.now().toString(36)}`;
        state.project.assets.push({ id: assetId, type: file.type, dataUrl });
        insertElement(createImageElement({ assetId }));
    });

    els["ptan-file-input"].addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        const result = await readPtanFile(file);
        if (!result.ok) {
            alert(`開啟失敗：${result.error}`);
            return;
        }
        state.project = result.project;
        state.selectedId = null;
        state.insertionTarget = null;
        state.previewData = {};
        endBatchPreview();
        onModelChange();
    });
}

// ---- Element tree 操作 ----

function insertElement(element) {
    const target = resolveTargetArray(state.project.template.elements, state.insertionTarget);
    target.push(element);
    state.selectedId = element.id;
    onModelChange();
}

function resolveTargetArray(rootElements, target) {
    if (!target) return rootElements;
    const row = findElementById(rootElements, target.rowId);
    if (!row || row.type !== "row") return rootElements;
    return row.columns[target.colIndex] || rootElements;
}

function findElementById(elements, id) {
    for (const el of elements) {
        if (el.id === id) return el;
        if (el.type === "row") {
            for (const col of el.columns) {
                const found = findElementById(col, id);
                if (found) return found;
            }
        }
    }
    return null;
}

function findContainerOf(elements, id) {
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].id === id) return { array: elements, index: i };
        if (elements[i].type === "row") {
            for (const col of elements[i].columns) {
                const found = findContainerOf(col, id);
                if (found) return found;
            }
        }
    }
    return null;
}

function isSameTarget(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.rowId === b.rowId && a.colIndex === b.colIndex;
}

function setRowRatio(rowEl, newRatio) {
    const newColumns = newRatio.map(() => []);
    rowEl.columns.forEach((col, i) => {
        const idx = Math.min(i, newColumns.length - 1);
        newColumns[idx].push(...col);
    });
    rowEl.ratio = newRatio;
    rowEl.columns = newColumns;
}

function deleteElement(id) {
    const found = findContainerOf(state.project.template.elements, id);
    if (!found) return;
    found.array.splice(found.index, 1);
    if (state.selectedId === id) state.selectedId = null;
    if (state.insertionTarget && state.insertionTarget.rowId === id) state.insertionTarget = null;
    onModelChange();
}

function duplicateElement(id) {
    const found = findContainerOf(state.project.template.elements, id);
    if (!found) return;
    const clone = cloneElementWithNewIds(found.array[found.index]);
    found.array.splice(found.index + 1, 0, clone);
    state.selectedId = clone.id;
    onModelChange();
}

function moveElement(id, direction) {
    const found = findContainerOf(state.project.template.elements, id);
    if (!found) return;
    const newIndex = found.index + direction;
    if (newIndex < 0 || newIndex >= found.array.length) return;
    const [item] = found.array.splice(found.index, 1);
    found.array.splice(newIndex, 0, item);
    onModelChange();
}

/** 拖曳排序用：把元素移到「同一個容器內、目前索引為 newIndex 的元素之前」。 */
function moveElementTo(id, newIndex) {
    const found = findContainerOf(state.project.template.elements, id);
    if (!found) return;
    const { array, index } = found;
    let target = newIndex;
    if (target > index) target -= 1;
    target = Math.max(0, Math.min(target, array.length - 1));
    if (target === index) return;
    const [item] = array.splice(index, 1);
    array.splice(target, 0, item);
    onModelChange();
}

/** 選取元素：outline 清單點擊、畫布疊層點擊共用同一套邏輯。 */
function selectElementById(id) {
    state.selectedId = id;
    const el = findElementById(state.project.template.elements, id);
    if (el && el.type !== "row") {
        const found = findContainerOf(state.project.template.elements, id);
        state.insertionTarget = containerToTarget(found?.array);
    }
    renderOutline();
    renderInspector();
    highlightSelectedBlock();
}

function highlightSelectedBlock() {
    const overlay = els["edit-overlay"];
    if (!overlay) return;
    overlay.querySelectorAll(".edit-block.is-selected").forEach((n) => n.classList.remove("is-selected"));
    if (state.selectedId) {
        overlay.querySelector(`.edit-block[data-id="${state.selectedId}"]`)?.classList.add("is-selected");
    }
}

// ---- 版面結構大綱 ----

function renderOutline() {
    const root = els["outline-list"];
    root.innerHTML = "";
    root.appendChild(buildTargetHeader("版面（最上層）", null, 0));
    root.appendChild(buildElementList(state.project.template.elements, 0, "root"));
}

function buildElementList(elements, depth, parentKey) {
    const frag = document.createDocumentFragment();
    elements.forEach((el) => {
        frag.appendChild(buildElementRow(el, depth, parentKey));
        if (el.type === "row") {
            el.columns.forEach((col, colIndex) => {
                const target = { rowId: el.id, colIndex };
                frag.appendChild(buildTargetHeader(`第 ${colIndex + 1} 欄`, target, depth + 1));
                frag.appendChild(buildElementList(col, depth + 2, `${el.id}:${colIndex}`));
            });
        }
    });
    return frag;
}

// ---- 大綱拖曳排序：只允許在同一個容器（同一層陣列）內重新排序，跨容器拖放會被擋掉，
// 因為 moveElementTo() 本身只在元素目前所在的陣列裡搬動位置。----

let outlineDragState = null; // { id, parentKey }

function clearOutlineDropIndicators() {
    els["outline-list"].querySelectorAll(".is-drop-before, .is-drop-after").forEach((n) => {
        n.classList.remove("is-drop-before", "is-drop-after");
    });
}

function wireOutlineRowDrag(row, el, parentKey) {
    row.draggable = true;
    row.addEventListener("dragstart", (evt) => {
        outlineDragState = { id: el.id, parentKey };
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
        if (!outlineDragState || outlineDragState.parentKey !== parentKey || outlineDragState.id === el.id) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        clearOutlineDropIndicators();
        row.classList.add(before ? "is-drop-before" : "is-drop-after");
    });
    row.addEventListener("drop", (evt) => {
        if (!outlineDragState || outlineDragState.parentKey !== parentKey || outlineDragState.id === el.id) return;
        evt.preventDefault();
        const rect = row.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        const found = findContainerOf(state.project.template.elements, el.id);
        if (!found) return;
        const targetIndex = before ? found.index : found.index + 1;
        moveElementTo(outlineDragState.id, targetIndex);
        outlineDragState = null;
    });
}

function buildTargetHeader(label, target, depth) {
    const row = document.createElement("div");
    row.className = `outline-row outline-target-row outline-indent-${depth}`;
    if (isSameTarget(state.insertionTarget, target)) row.classList.add("is-target");
    const icon = document.createElement("span");
    icon.className = "ts-icon is-plus-icon";
    icon.setAttribute("aria-hidden", "true");
    const span = document.createElement("span");
    span.className = "outline-label";
    span.textContent = label;
    row.appendChild(icon);
    row.appendChild(span);
    row.addEventListener("click", () => {
        state.insertionTarget = target;
        state.selectedId = null;
        renderOutline();
        renderInspector();
    });
    return row;
}

const TYPE_ICON = { text: "font", image: "image", spacer: "arrows-up-down", divider: "minus", row: "table-columns" };

function elementLabel(el) {
    switch (el.type) {
        case "text": { const t = getTextContent(el); return t ? t.slice(0, 14) : "（空白文字）"; }
        case "image": return el.assetId ? "圖片" : "圖片（未設定）";
        case "spacer": return `間隔 ${el.heightDots}dot`;
        case "divider": return "分隔線";
        case "row": return `多欄（${el.ratio.join(" : ")}）`;
        default: return el.type;
    }
}

function buildElementRow(el, depth, parentKey) {
    const row = document.createElement("div");
    row.className = `outline-row outline-indent-${depth}`;
    row.dataset.elType = el.type;
    if (state.selectedId === el.id) row.classList.add("is-selected");

    const icon = document.createElement("span");
    icon.className = `ts-icon is-${TYPE_ICON[el.type] || "shapes"}-icon`;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "outline-label";
    label.textContent = elementLabel(el);

    const actions = document.createElement("span");
    actions.className = "outline-actions";
    actions.appendChild(iconButton("arrow-up", "上移", () => moveElement(el.id, -1)));
    actions.appendChild(iconButton("arrow-down", "下移", () => moveElement(el.id, 1)));
    actions.appendChild(iconButton("copy", "複製", () => duplicateElement(el.id)));
    actions.appendChild(iconButton("trash", "刪除", () => deleteElement(el.id)));

    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(actions);

    row.addEventListener("click", () => selectElementById(el.id));
    wireOutlineRowDrag(row, el, parentKey);

    return row;
}

function containerToTarget(array) {
    if (array === state.project.template.elements) return null;
    // 找出這個 array 屬於哪個 row 的哪一欄
    let result = null;
    (function walk(elements) {
        for (const el of elements) {
            if (el.type === "row") {
                el.columns.forEach((col, i) => {
                    if (col === array) result = { rowId: el.id, colIndex: i };
                    walk(col);
                });
            }
        }
    })(state.project.template.elements);
    return result;
}

function iconButton(icon, label, onClick) {
    const btn = document.createElement("button");
    btn.className = "ts-button is-icon is-ghost is-small";
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    btn.dataset.tooltip = label;
    btn.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span>`;
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

// ---- 元素屬性面板 ----

function renderInspector() {
    const panel = els.inspector;
    panel.innerHTML = "";
    const el = state.selectedId ? findElementById(state.project.template.elements, state.selectedId) : null;
    if (!el) {
        panel.appendChild(emptyState("sliders", "尚未選取元素"));
        return;
    }

    const builders = { text: buildTextInspector, image: buildImageInspector, spacer: buildSpacerInspector, divider: buildDividerInspector, row: buildRowInspector };
    (builders[el.type] || (() => {}))(panel, el);

    panel.appendChild(sectionDivider());
    const actions = document.createElement("div");
    actions.className = "ts-wrap is-compact";
    const dupBtn = mkButton("複製", "copy", () => duplicateElement(el.id));
    const delBtn = mkButton("刪除", "trash", () => deleteElement(el.id), { negative: true });
    actions.append(dupBtn, delBtn);
    panel.appendChild(actions);
}

function emptyState(icon, title, description) {
    const wrap = document.createElement("div");
    wrap.className = "pane-empty-state-static";
    wrap.innerHTML = `
        <span class="ts-icon is-${icon}-icon is-heading" aria-hidden="true"></span>
        <div class="ts-text is-description">${title}</div>
        ${description ? `<div class="ts-text is-description">${description}</div>` : ""}
    `;
    return wrap;
}

function sectionHeader(icon, text) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced ts-header is-start-icon is-small";
    wrap.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span> ${text}`;
    return wrap;
}

function sectionDivider() {
    const hr = document.createElement("div");
    hr.className = "ts-divider has-vertically-spaced";
    return hr;
}

function mkButton(text, icon, onClick, { negative = false, outlined = true } = {}) {
    const b = document.createElement("button");
    b.className = `ts-button is-small${outlined ? " is-outlined" : ""}${negative ? " is-negative" : ""}${icon ? " is-start-icon" : ""}`;
    b.type = "button";
    b.innerHTML = icon ? `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span> ${text}` : text;
    b.addEventListener("click", onClick);
    return b;
}

function field(labelText, inputEl) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced-small";
    if (labelText) {
        const label = document.createElement("label");
        label.className = "ts-text is-label";
        label.textContent = labelText;
        wrap.appendChild(label);
        const inner = document.createElement("div");
        inner.className = "has-top-spaced-small";
        inner.appendChild(inputEl);
        wrap.appendChild(inner);
    } else {
        wrap.appendChild(inputEl);
    }
    return wrap;
}

function fieldRow(fields) {
    const grid = document.createElement("div");
    grid.className = "ts-grid has-top-spaced-small";
    const wide = Math.floor(16 / fields.length);
    for (const [labelText, inputEl] of fields) {
        const col = document.createElement("div");
        col.className = `column is-${wide}-wide`;
        const label = document.createElement("label");
        label.className = "ts-text is-label";
        label.textContent = labelText;
        const inner = document.createElement("div");
        inner.className = "has-top-spaced-small";
        inner.appendChild(inputEl);
        col.appendChild(label);
        col.appendChild(inner);
        grid.appendChild(col);
    }
    return grid;
}

function textInput(value, onInput, type = "text") {
    const wrap = document.createElement("div");
    wrap.className = "ts-input is-small is-fluid";
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.addEventListener("input", () => onInput(type === "number" ? Number(input.value) : input.value));
    wrap.appendChild(input);
    return wrap;
}

function selectInput(options, value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "ts-select is-small is-fluid";
    const select = document.createElement("select");
    for (const [v, label] of options) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = label;
        if (v === value) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener("change", () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
}

function checkboxInput(checked, onChange, labelText) {
    const label = document.createElement("label");
    label.className = "ts-checkbox is-small";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = labelText;
    label.appendChild(input);
    label.appendChild(text);
    return label;
}

// 可選字體（比照 Figma 對齊等段落屬性維持在元素層級，這裡列的字體/字級/粗體/
// 斜體/底線/刪除線則是「片段（run）」層級，同一個文字元素裡的每個片段可以各自
// 覆寫；片段沒指定時繼承這份清單第一項以外的元素預設值（見 renderer.js resolveRunStyle）。
const FONT_CHOICES = [
    ['"Noto Sans TC", "Microsoft JhengHei", sans-serif', "思源黑體（無襯線）"],
    ['"Noto Serif TC", PMingLiU, serif', "思源宋體（襯線）"],
    ['DFKai-SB, BiauKai, "Kaiti TC", serif', "標楷體"],
    ["ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", "等寬（數字／條碼文字）"],
];

function fontFamilySelect(value, onChange, inheritLabel) {
    return selectInput([["", inheritLabel], ...FONT_CHOICES], value || "", (v) => onChange(v || null));
}

/** 選取範圍樣式工具列上的單一切換按鈕；value 為 MIXED 時顯示「混合」視覺狀態，沒有選取範圍時停用。 */
function rangeToggleButton(icon, label, value, hasRange, onToggle) {
    const isMixed = value === MIXED;
    const active = value === true;
    const btn = document.createElement("button");
    btn.className = "ts-button is-icon is-outlined is-small";
    btn.classList.toggle("is-active", active);
    btn.classList.toggle("is-mixed", isMixed);
    btn.type = "button";
    btn.disabled = !hasRange;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", String(active));
    btn.dataset.tooltip = label;
    btn.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span>`;
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggle(isMixed ? true : !active);
    });
    return btn;
}

function rangeFontFamilySelect(value, hasRange, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "ts-select is-small is-fluid";
    const select = document.createElement("select");
    select.disabled = !hasRange;
    const options = [["", "跟隨段落預設"], ...FONT_CHOICES];
    if (value === MIXED) options.unshift(["__mixed__", "混合"]);
    for (const [v, label] of options) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = label;
        opt.selected = value === MIXED ? v === "__mixed__" : v === (value || "");
        select.appendChild(opt);
    }
    select.addEventListener("change", () => onChange(select.value || null));
    wrap.appendChild(select);
    return wrap;
}

function rangeFontSizeInput(value, hasRange, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "ts-input is-small is-fluid";
    const input = document.createElement("input");
    input.type = "number";
    input.disabled = !hasRange;
    if (value === MIXED) {
        input.value = "";
        input.placeholder = "混合";
    } else {
        input.value = value || "";
    }
    input.addEventListener("input", () => onChange(input.value ? Number(input.value) : null));
    wrap.appendChild(input);
    return wrap;
}

function buildTextInspector(panel, el) {
    panel.appendChild(sectionHeader("align-left", "內容（可用 {{變數}}）"));

    const sel = { start: 0, end: 0 };
    const toolbar = document.createElement("div");
    toolbar.className = "pane-toolbar has-top-spaced-small";
    panel.appendChild(toolbar);
    const styleRow = document.createElement("div");
    panel.appendChild(styleRow);

    const textareaWrap = document.createElement("div");
    textareaWrap.className = "ts-input is-small is-fluid has-top-spaced-small";
    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.value = getTextContent(el);
    textareaWrap.appendChild(textarea);
    panel.appendChild(textareaWrap);

    function renderStyleControls() {
        const hasRange = sel.start !== sel.end;
        const style = getRangeStyle(el, sel.start, sel.end);
        toolbar.innerHTML = "";
        toolbar.appendChild(rangeToggleButton("bold", "粗體", style.bold, hasRange, (v) => applyRangeStyle("bold", v)));
        toolbar.appendChild(rangeToggleButton("italic", "斜體", style.italic, hasRange, (v) => applyRangeStyle("italic", v)));
        toolbar.appendChild(rangeToggleButton("underline", "底線", style.underline, hasRange, (v) => applyRangeStyle("underline", v)));
        toolbar.appendChild(rangeToggleButton("strikethrough", "刪除線", style.strikethrough, hasRange, (v) => applyRangeStyle("strikethrough", v)));

        styleRow.innerHTML = "";
        styleRow.appendChild(fieldRow([
            ["字體", rangeFontFamilySelect(style.fontFamily, hasRange, (v) => applyRangeStyle("fontFamily", v))],
            ["字級 (dot)", rangeFontSizeInput(style.fontSize, hasRange, (v) => applyRangeStyle("fontSize", v))],
        ]));
    }

    function applyRangeStyle(field, value) {
        applyStyleToRange(el, sel.start, sel.end, field, value);
        onModelChange({ skipInspector: true });
        renderStyleControls();
    }

    function trackSelection() {
        sel.start = textarea.selectionStart;
        sel.end = textarea.selectionEnd;
        renderStyleControls();
    }
    ["select", "keyup", "mouseup", "click", "focus"].forEach((evt) => textarea.addEventListener(evt, trackSelection));
    textarea.addEventListener("input", () => {
        replaceFullText(el, textarea.value);
        onModelChange({ skipInspector: true });
        trackSelection();
    });

    renderStyleControls();

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("font", "段落樣式"));
    panel.appendChild(fieldRow([
        ["預設字體", fontFamilySelect(el.fontFamily, (v) => { el.fontFamily = v; onModelChange({ skipInspector: true }); }, "跟隨全域預設")],
        ["預設字級 (dot)", textInput(el.fontSize, (v) => { el.fontSize = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
    panel.appendChild(fieldRow([
        ["行高倍數", textInput(el.lineHeight, (v) => { el.lineHeight = v; onModelChange({ skipInspector: true }); }, "number")],
        ["字距 (dot)", textInput(el.letterSpacing, (v) => { el.letterSpacing = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
    panel.appendChild(fieldRow([
        ["對齊", selectInput([["left", "靠左"], ["center", "置中"], ["right", "靠右"]], el.align, (v) => { el.align = v; onModelChange({ skipInspector: true }); })],
        ["最多行數（0＝不限制）", textInput(el.maxLines, (v) => { el.maxLines = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
    panel.appendChild(field(null, checkboxInput(el.bold, (v) => { el.bold = v; onModelChange({ skipInspector: true }); }, "預設粗體")));
    panel.appendChild(field(null, checkboxInput(el.wrap, (v) => { el.wrap = v; onModelChange({ skipInspector: true }); }, "自動換行")));
}

function buildImageInspector(panel, el) {
    panel.appendChild(sectionHeader("image", "圖片來源"));
    const pickBtn = mkButton(el.assetId ? "更換圖片" : "選擇圖片", "upload", () => {
        els["image-file-input"].onchange = null;
        const handler = async (e) => {
            const file = e.target.files[0];
            e.target.value = "";
            els["image-file-input"].removeEventListener("change", handler);
            if (!file) return;
            const dataUrl = await fileToDataUrl(file);
            const assetId = `asset_${Date.now().toString(36)}`;
            state.project.assets.push({ id: assetId, type: file.type, dataUrl });
            el.assetId = assetId;
            onModelChange();
        };
        els["image-file-input"].addEventListener("change", handler);
        els["image-file-input"].click();
    }, { outlined: true });
    panel.appendChild(field(null, pickBtn));
    panel.appendChild(field("或指定變數（例如 {{image}}）", textInput(el.assetId || "", (v) => { el.assetId = v; onModelChange({ skipInspector: true }); })));

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("ruler", "尺寸"));
    panel.appendChild(field("固定高度 (dot，0＝依欄寬等比縮放)", textInput(el.heightDots, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
}

function buildSpacerInspector(panel, el) {
    panel.appendChild(sectionHeader("arrows-up-down", "間隔"));
    panel.appendChild(field("高度 (dot)", textInput(el.heightDots, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
}

function buildDividerInspector(panel, el) {
    panel.appendChild(sectionHeader("minus", "分隔線"));
    panel.appendChild(field("樣式", selectInput([["solid", "實線"], ["dashed", "虛線"], ["dotted", "點線"]], el.style, (v) => { el.style = v; onModelChange({ skipInspector: true }); })));
    panel.appendChild(field("粗細 (dot)", textInput(el.thicknessDots, (v) => { el.thicknessDots = v; onModelChange({ skipInspector: true }); }, "number")));
    panel.appendChild(fieldRow([
        ["上邊距 (dot)", textInput(el.marginTopDots, (v) => { el.marginTopDots = v; onModelChange({ skipInspector: true }); }, "number")],
        ["下邊距 (dot)", textInput(el.marginBottomDots, (v) => { el.marginBottomDots = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
}

function buildRowInspector(panel, el) {
    panel.appendChild(sectionHeader("table-columns", "多欄"));
    const label = document.createElement("label");
    label.className = "ts-text is-label has-top-spaced-small";
    label.textContent = "欄位比例";
    panel.appendChild(label);

    const presets = [[1, 1], [2, 1], [1, 2], [1, 1, 1]];
    const wrap = document.createElement("div");
    wrap.className = "ts-wrap is-compact has-top-spaced-small";
    for (const ratio of presets) {
        const active = el.ratio.length === ratio.length && el.ratio.every((v, i) => v === ratio[i]);
        wrap.appendChild(mkButton(ratio.join(" : "), null, () => { setRowRatio(el, ratio); onModelChange(); }, { outlined: !active }));
    }
    panel.appendChild(wrap);
}

// ---- 變數 / 預覽資料 ----

function renderVariables() {
    const names = extractPlaceholders(state.project.template.elements);
    state.project.variables = names;
    const panel = els["variables-panel"];
    panel.innerHTML = "";
    if (!names.length) {
        panel.appendChild(emptyState("list-check", "尚未使用變數", "在文字或圖片來源中輸入 {{變數名稱}} 即可建立變數"));
        return;
    }
    names.forEach((name, i) => {
        const row = document.createElement("div");
        row.className = i > 0 ? "ts-grid is-middle-aligned has-top-spaced-small" : "ts-grid is-middle-aligned";

        const labelCol = document.createElement("div");
        labelCol.className = "column is-6-wide";
        const label = document.createElement("span");
        label.className = "ts-text is-label";
        label.textContent = name;
        label.title = name;
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";
        label.style.whiteSpace = "nowrap";
        label.style.display = "block";
        labelCol.appendChild(label);

        const inputCol = document.createElement("div");
        inputCol.className = "column is-fluid";
        inputCol.appendChild(textInput(state.previewData[name] ?? "", (v) => {
            state.previewData[name] = v;
            schedulePreview();
        }));

        row.appendChild(labelCol);
        row.appendChild(inputCol);
        panel.appendChild(row);
    });
}

// ---- 紙張預覽 ----

function updatePaperFrame() {
    const profile = getPrinterProfile(state.project.printerProfile.id);
    const paper = getPaperWidth(profile, state.project.paper.widthId);
    const marginMm = Math.max((paper.rollWidthMm - paper.printableWidthMm) / 2, 0);
    // 連續紙沒有實體「上邊界」，安全區上緣純粹是視覺留白；下緣則是切刀刀片跟列印頭的
    // 實際距離（bladeOffsetMm）——太靠下緣的內容，切紙時有被裁到的風險。
    const bladeOffsetMm = profile.autocutter?.bladeOffsetMm ?? 0;
    els["paper-shadow"].style.setProperty("--paper-margin", `${marginMm * PX_PER_MM}px`);
    els["paper-shadow"].style.setProperty("--paper-safe-bottom", `${bladeOffsetMm * PX_PER_MM}px`);
    els["canvas-host"].style.width = `${paper.printableWidthMm * PX_PER_MM}px`;
}

async function updatePreview() {
    updatePaperFrame();
    const generation = ++state.previewGeneration;
    let result;
    try {
        const data = state.batchPreview.active
            ? (state.batchPreview.records[state.batchPreview.index] ?? {})
            : state.previewData;
        result = await renderTemplate(state.project, data, { mode: state.mode });
    } catch (err) {
        console.error(err);
        return;
    }
    if (generation !== state.previewGeneration) return; // 過期的渲染結果，丟棄
    lastRenderResult = result;
    els["canvas-host"].innerHTML = "";
    els["canvas-host"].appendChild(result.canvas);
    if (!els["edit-overlay"]) {
        els["edit-overlay"] = document.createElement("div");
        els["edit-overlay"].className = "edit-overlay";
    }
    els["canvas-host"].appendChild(els["edit-overlay"]);
    renderEditOverlay();
}

// ---- 編輯模式畫布疊層：虛線外框、拖曳排序、拖曳縮放 ----
// 疊層座標直接沿用 renderer.js 排版產出的 items 樹（跟畫面上的 canvas 完全同一份排版結果），
// 只是額外換算成 CSS px 蓋在 canvas 上面；預覽模式只是把這層疊層清空隱藏，canvas 本身不受影響。

function renderEditOverlay() {
    const overlay = els["edit-overlay"];
    if (!overlay) return;
    overlay.innerHTML = "";
    if (state.viewMode !== "edit" || !lastRenderResult) return;

    const { items, widthDots, canvas } = lastRenderResult;
    const scale = canvas.clientWidth / widthDots || 1;
    const handleBuilders = [];

    walkItems(items, 0, 0, (box, item) => {
        overlay.appendChild(buildEditBlock(box, scale));
        if (box.el.type === "spacer" || box.el.type === "image") {
            handleBuilders.push(() => buildHeightResizeHandle(box, scale));
        }
        if (box.el.type === "row") {
            let cumulative = 0;
            item.columns.forEach((col, i) => {
                cumulative += col.width;
                if (i === item.columns.length - 1) return; // 最後一欄後面沒有把手
                const boundaryXDots = box.x + cumulative;
                handleBuilders.push(() => buildColumnResizeHandle(box.el, i, boundaryXDots, box.y, box.height, box.width, scale));
            });
        }
    });

    // 把手一律留到最後才加進 DOM，確保疊在所有元素外框之上，滑鼠才抓得到
    handleBuilders.forEach((build) => overlay.appendChild(build()));
}

function walkItems(items, offsetX, offsetY, visit) {
    for (const item of items) {
        const box = { el: item.el, x: offsetX, y: offsetY + item.y, width: item.widthDots, height: item.height };
        visit(box, item);
        if (item.el.type === "row") {
            for (const col of item.columns) {
                walkItems(col.items, offsetX + col.x, offsetY + item.y, visit);
            }
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
    if (state.selectedId === box.el.id) div.classList.add("is-selected");
    attachBlockInteractions(div, box.el.id);
    return div;
}

/** 點擊選取＋拖曳排序（在同一個容器內，跟大綱面板的上移／下移操作同一個 array）。 */
function attachBlockInteractions(div, elId) {
    div.addEventListener("pointerdown", (e) => {
        if (e.target !== div || e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        let siblings = null;

        function onMove(ev) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!dragging) {
                if (Math.hypot(dx, dy) < 4) return;
                dragging = true;
                div.classList.add("is-dragging");
                siblings = collectSiblingBoxes(elId);
            }
            div.style.transform = `translate(${dx}px, ${dy}px)`;
            if (siblings) showInsertionLine(findDropTarget(siblings, ev.clientY).edgeY);
        }
        function onUp(ev) {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            div.classList.remove("is-dragging");
            div.style.transform = "";
            clearInsertionLine();
            if (dragging && siblings) {
                moveElementTo(elId, findDropTarget(siblings, ev.clientY).index);
            } else if (!dragging) {
                selectElementById(elId);
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
        const startHeight = realEl.heightDots;
        function onMove(ev) {
            const deltaDots = (ev.clientY - startY) / scale;
            realEl.heightDots = Math.max(1, Math.round(startHeight + deltaDots));
            schedulePreview();
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
        const startWidths = splitDotsByRatio(rowWidthDots, realRow.ratio);
        const minWidth = 10;
        function onMove(ev) {
            let deltaDots = (ev.clientX - startX) / scale;
            deltaDots = Math.max(deltaDots, minWidth - startWidths[colIndex]);
            deltaDots = Math.min(deltaDots, startWidths[colIndex + 1] - minWidth);
            const widths = startWidths.slice();
            widths[colIndex] = Math.round(widths[colIndex] + deltaDots);
            widths[colIndex + 1] = Math.round(widths[colIndex + 1] - deltaDots);
            realRow.ratio = widths;
            schedulePreview();
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

// ---- 匯出 / 列印 ----

async function exportSinglePdf() {
    const result = await renderTemplate(state.project, state.previewData, { mode: "thermal" });
    exportToPdf([result], { fileName: `${state.project.meta.name || "printan"}.pdf` });
}

// 匯出跟預覽都要吃同一份批次資料，剖析／驗證邏輯只寫這一處，避免兩邊行為兜不起來
function parseBatchData() {
    try {
        const dataArray = JSON.parse(els["batch-data"].value || "[]");
        if (!Array.isArray(dataArray) || dataArray.length === 0) throw new Error("請提供至少一筆資料的 JSON 陣列");
        return dataArray;
    } catch (err) {
        alert(`批次資料格式錯誤：${err.message}`);
        return null;
    }
}

async function exportBatchPdf() {
    const dataArray = parseBatchData();
    if (!dataArray) return;
    const results = await renderBatch(state.project, dataArray, { mode: "thermal" });
    exportToPdf(results, { fileName: `${state.project.meta.name || "printan"}-batch.pdf` });
}

// ---- 批次資料面板：收合、逐筆預覽 ----

function updateBatchPreviewNav() {
    const { active, records, index } = state.batchPreview;
    els["batch-preview-nav"].hidden = !active;
    if (!active) return;
    els["batch-preview-counter"].textContent = `第 ${index + 1} / ${records.length} 筆`;
    els["btn-batch-prev"].disabled = index <= 0;
    els["btn-batch-next"].disabled = index >= records.length - 1;
}

function startBatchPreview() {
    const dataArray = parseBatchData();
    if (!dataArray) return;
    state.batchPreview = { active: true, records: dataArray, index: 0 };
    updateBatchPreviewNav();
    schedulePreview();
}

function stepBatchPreview(delta) {
    if (!state.batchPreview.active) return;
    const next = state.batchPreview.index + delta;
    if (next < 0 || next >= state.batchPreview.records.length) return;
    state.batchPreview.index = next;
    updateBatchPreviewNav();
    schedulePreview();
}

function endBatchPreview() {
    if (!state.batchPreview.active) return;
    state.batchPreview = { active: false, records: [], index: 0 };
    updateBatchPreviewNav();
    schedulePreview();
}

function setBatchPanelExpanded(expanded) {
    els["batch-panel-body"].hidden = !expanded;
    els["batch-panel-toggle"].setAttribute("aria-expanded", String(expanded));
    localStorage.setItem(BATCH_PANEL_EXPANDED_KEY, String(expanded));
}

function bindBatchPanel() {
    setBatchPanelExpanded(localStorage.getItem(BATCH_PANEL_EXPANDED_KEY) === "true");

    els["batch-panel-toggle"].addEventListener("click", () => {
        const expanded = els["batch-panel-toggle"].getAttribute("aria-expanded") === "true";
        setBatchPanelExpanded(!expanded);
    });

    els["btn-preview-batch"].addEventListener("click", startBatchPreview);
    els["btn-batch-prev"].addEventListener("click", () => stepBatchPreview(-1));
    els["btn-batch-next"].addEventListener("click", () => stepBatchPreview(1));
    els["btn-batch-end-preview"].addEventListener("click", endBatchPreview);
}

async function printCurrent() {
    const result = await renderTemplate(state.project, state.previewData, { mode: "thermal" });

    if (state.usbConnected) {
        try {
            await usbAdapter.print(result, state.printPrefs);
            return;
        } catch (err) {
            state.usbConnected = false;
            updatePrinterConnectionUi();
            alert(`印表機列印失敗，已改用系統列印對話框：${err.message}`);
        }
    }

    const adapter = new SystemDialogAdapter();
    await adapter.connect();
    await adapter.print(result);
}

// ---- 印表機設定（WebUSB 直連 + 走紙／切紙偏好） ----
// 連線狀態、走紙／切紙偏好都是「這台瀏覽器、這台印表機」的本機操作習慣，不寫進 .ptan，
// 同一份版型換人、換印表機開啟時不應該被綁死。

function loadPrintPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(PRINT_PREFS_KEY) || "{}");
        state.printPrefs = { ...state.printPrefs, ...saved };
    } catch {
        // 格式壞掉就用預設值，不擋流程
    }
}

function savePrintPrefs() {
    localStorage.setItem(PRINT_PREFS_KEY, JSON.stringify(state.printPrefs));
}

function currentWebUsbVendorId() {
    return getPrinterProfile(state.project.printerProfile.id).webUsb?.vendorId;
}

async function attemptSilentPrinterReconnect() {
    if (!usbAdapter.isSupported()) return;
    try {
        state.usbConnected = await usbAdapter.reconnectIfAuthorized(currentWebUsbVendorId());
    } catch {
        state.usbConnected = false;
    }
    updatePrinterConnectionUi();
}

function updatePrinterConnectionUi() {
    const supported = usbAdapter.isSupported();
    els["printer-webusb-unsupported"].hidden = supported;
    els["btn-printer-connect"].hidden = !supported || state.usbConnected;
    els["btn-printer-disconnect"].hidden = !supported || !state.usbConnected;
    els["printer-connection-status"].textContent = !supported
        ? "此瀏覽器不支援 WebUSB，列印會走系統列印對話框"
        : state.usbConnected
            ? `已連接：${usbAdapter.deviceLabel}`
            : "尚未連接，列印會走系統列印對話框";
}

function bindPrinterSettings() {
    els["pref-feed-lines"].value = state.printPrefs.feedLines;
    els["pref-cut-paper"].checked = state.printPrefs.cutPaper;
    updatePrinterConnectionUi();

    els["btn-printer-settings"].addEventListener("click", () => {
        els["printer-settings-dialog"].showModal();
    });
    els["btn-printer-settings-close"].addEventListener("click", () => {
        els["printer-settings-dialog"].close();
    });

    els["btn-printer-connect"].addEventListener("click", async () => {
        try {
            await usbAdapter.connect({ vendorId: currentWebUsbVendorId() });
            state.usbConnected = true;
        } catch (err) {
            state.usbConnected = false;
            alert(`連接印表機失敗：${err.message}`);
        }
        updatePrinterConnectionUi();
    });

    els["btn-printer-disconnect"].addEventListener("click", async () => {
        await usbAdapter.disconnect();
        state.usbConnected = false;
        updatePrinterConnectionUi();
    });

    els["pref-feed-lines"].addEventListener("change", () => {
        const n = Math.max(0, Math.round(Number(els["pref-feed-lines"].value) || 0));
        state.printPrefs.feedLines = n;
        els["pref-feed-lines"].value = n;
        savePrintPrefs();
    });

    els["pref-cut-paper"].addEventListener("change", () => {
        state.printPrefs.cutPaper = els["pref-cut-paper"].checked;
        savePrintPrefs();
    });

    if (usbAdapter.isSupported()) {
        navigator.usb.addEventListener("disconnect", (e) => {
            if (e.device === usbAdapter.device) {
                state.usbConnected = false;
                updatePrinterConnectionUi();
            }
        });
    }
}

// ---- 變更彙整：儲存草稿 + 重新渲染 ----

let saveTimer = null;
function onModelChange({ skipInspector = false } = {}) {
    renderOutline();
    if (!skipInspector) renderInspector();
    renderVariables();
    schedulePreview();
    scheduleSave();
}

let previewTimer = null;
function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        const id = await saveDraft(state.project);
        localStorage.setItem(LAST_DRAFT_KEY, id);
        const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
        els["save-status"].textContent = `已自動儲存 ${time}`;
    }, 500);
}

init();
