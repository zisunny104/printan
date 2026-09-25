// 檢視器（右側面板）共用的小元件：標題、按鈕、欄位、輸入框。

import { createInfoIcon } from "./ui-helpers.js";
import { state } from "./context.js";

// 文字一律走 textContent／文字節點，呼叫端傳進來的字不會被當成 HTML
function iconSpan(icon, extraClass = "") {
    const span = document.createElement("span");
    span.className = `ts-icon is-${icon}-icon${extraClass ? ` ${extraClass}` : ""}`;
    span.setAttribute("aria-hidden", "true");
    return span;
}

export function iconButton(icon, label, onClick) {
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

export function emptyState(icon, title, description) {
    const wrap = document.createElement("div");
    wrap.className = "pane-empty-state-static";
    wrap.append(iconSpan(icon, "is-heading"));
    for (const text of [title, description]) {
        if (!text) continue;
        const line = document.createElement("div");
        line.className = "ts-text is-description";
        line.textContent = text;
        wrap.appendChild(line);
    }
    return wrap;
}

export function sectionHeader(icon, text, info) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced ts-header is-start-icon is-small";
    wrap.append(iconSpan(icon), ` ${text}`);
    if (info) wrap.appendChild(createInfoIcon(info));
    return wrap;
}

export function sectionDivider() {
    const hr = document.createElement("div");
    hr.className = "ts-divider has-vertically-spaced";
    return hr;
}

export function mkButton(text, icon, onClick, { negative = false, outlined = true } = {}) {
    const b = document.createElement("button");
    b.className = `ts-button is-small${outlined ? " is-outlined" : ""}${negative ? " is-negative" : ""}${icon ? " is-start-icon" : ""}`;
    b.type = "button";
    if (icon) b.append(iconSpan(icon), ` ${text}`);
    else b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
}

export function iconToggleButton(icon, label, active, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ts-button is-small is-icon is-outlined";
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-label", label);
    b.dataset.tooltip = label;
    b.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span>`;
    b.addEventListener("click", onClick);
    return b;
}

// 欄位標籤是視覺上的 <label>、沒有 for/id 連到輸入元件，螢幕閱讀器讀不到名稱；直接把標籤文字掛成 aria-label。
const CONTROL_SELECTOR = "input, select, textarea, .dropdown-select-trigger";
function nameControl(container, text) {
    const control = container.matches?.(CONTROL_SELECTOR) ? container : container.querySelector?.(CONTROL_SELECTOR);
    if (control && !control.hasAttribute("aria-label")) control.setAttribute("aria-label", text);
}

export function field(labelText, inputEl, info) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced-small";
    if (labelText) {
        const label = document.createElement("label");
        label.className = "ts-text is-label";
        label.textContent = labelText;
        if (info) label.appendChild(createInfoIcon(info));
        nameControl(inputEl, labelText);
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

export function fieldRow(fields) {
    const grid = document.createElement("div");
    grid.className = "ts-grid has-top-spaced-small";
    const wide = Math.floor(16 / fields.length);
    for (const [labelText, inputEl] of fields) {
        const col = document.createElement("div");
        col.className = `column is-${wide}-wide`;
        const label = document.createElement("label");
        label.className = "ts-text is-label";
        label.textContent = labelText;
        nameControl(inputEl, labelText);
        const inner = document.createElement("div");
        inner.className = "has-top-spaced-small";
        inner.appendChild(inputEl);
        col.appendChild(label);
        col.appendChild(inner);
        grid.appendChild(col);
    }
    return grid;
}

export function textInput(value, onInput, type = "text", placeholder = "") {
    const wrap = document.createElement("div");
    wrap.className = "ts-input is-small is-fluid";
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener("input", () => onInput(type === "number" ? Number(input.value) : input.value));
    wrap.appendChild(input);
    return wrap;
}

// 下拉選單：跳出 Tocas 自訂樣式清單（同 open-project-dropdown／export-dropdown／row-ratio-dropdown
// 那組 data-dropdown 觸發機制），不用原生 <select>（開啟時是瀏覽器原生清單方框，樣式蓋不掉）。
// groups：[[群組標題或 null, [[value, label], ...]], ...]，標題為 null 時不畫 .header 分隔。
let dropdownSeq = 0;
export function dropdownField(groups, value, onChange, { disabled = false, mixedLabel } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "dropdown-select";
    const menuId = `dropdown-select-${++dropdownSeq}`;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ts-button is-small is-outlined is-fluid dropdown-select-trigger";
    trigger.dataset.dropdown = menuId;
    trigger.disabled = disabled;
    trigger.setAttribute("aria-haspopup", "listbox");

    const labelSpan = document.createElement("span");
    labelSpan.className = "dropdown-select-label";
    trigger.append(labelSpan, iconSpan("chevron-down", "dropdown-select-caret"));

    const menu = document.createElement("div");
    menu.id = menuId;
    menu.className = "ts-dropdown dropdown-select-menu";
    menu.setAttribute("role", "listbox");

    const items = [];
    const addItem = (parent, v, text) => {
        const item = document.createElement("a");
        item.className = "item";
        item.textContent = text;
        item.dataset.value = v;
        item.setAttribute("role", "option");
        item.addEventListener("click", () => setValue(v, true));
        parent.appendChild(item);
        items.push(item);
    };
    const buildGroups = (groupList) => {
        menu.innerHTML = "";
        items.length = 0;
        for (const [groupLabel, options] of groupList) {
            if (groupLabel) {
                const header = document.createElement("div");
                header.className = "header";
                header.textContent = groupLabel;
                menu.appendChild(header);
            }
            for (const [v, text] of options) addItem(menu, v, text);
        }
    };
    buildGroups(groups);

    function setValue(v, fire) {
        const match = items.find((it) => it.dataset.value === v);
        labelSpan.textContent = match ? match.textContent : (mixedLabel ?? "");
        items.forEach((it) => it.classList.toggle("is-active", it === match));
        if (fire) onChange(v);
    }
    setValue(value, false);

    wrap.append(trigger, menu);
    return { el: wrap, setValue, setGroups: (g) => buildGroups(g), setDisabled: (d) => { trigger.disabled = d; } };
}

export function selectInput(options, value, onChange) {
    return dropdownField([[null, options]], value, onChange).el;
}

export function sliderField(labelText, value, min, max, onInput) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced-small";
    const label = document.createElement("label");
    label.className = "ts-text is-label field-label-row";
    const valueTag = document.createElement("span");
    valueTag.className = "ts-text is-description";
    valueTag.textContent = value;
    label.append(labelText, valueTag);

    const sliderWrap = document.createElement("div");
    sliderWrap.className = "ts-slider is-small is-fluid has-top-spaced-small";
    const input = document.createElement("input");
    input.type = "range";
    input.setAttribute("aria-label", labelText);
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener("input", () => {
        valueTag.textContent = input.value;
        onInput(Number(input.value));
    });
    sliderWrap.appendChild(input);

    wrap.appendChild(label);
    wrap.appendChild(sliderWrap);
    return wrap;
}

export function checkboxInput(checked, onChange, labelText) {
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

// 可收合的進階區塊：收合狀態依「元素類型＋區塊」各自記在 localStorage（純 UI 偏好，讀寫失敗就用預設值）。
const FOLD_KEY = "printan.inspectorFolds";
function readFolds() {
    try { return JSON.parse(localStorage.getItem(FOLD_KEY)) || {}; } catch { return {}; }
}
function writeFold(id, open) {
    try { localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFolds(), [id]: open })); } catch { /* 無痕視窗等：不記就好 */ }
}

/** 收合區塊：標題列（chevron 圖示＋文字）點開才顯示 build(body) 填進去的內容。id 例：`text.layout`。 */
export function foldSection(id, title, build, defaultOpen = false) {
    const details = document.createElement("details");
    details.className = "inspector-fold";
    details.open = readFolds()[id] ?? defaultOpen;
    const summary = document.createElement("summary");
    summary.className = "has-top-spaced ts-header is-small";
    const mark = document.createElement("span");
    mark.setAttribute("aria-hidden", "true");
    const setMark = () => { mark.className = `ts-icon is-small is-chevron-${details.open ? "down" : "right"}-icon`; };
    setMark();
    summary.append(mark, " ", title);
    const body = document.createElement("div");
    // 收合時先不建內容（如裁切工具要量尺寸、載入圖片），第一次展開才建
    let built = false;
    const ensureBuilt = () => { if (!built) { built = true; build(body); } };
    if (details.open) ensureBuilt();
    details.append(summary, body);
    details.addEventListener("toggle", () => {
        if (details.open) ensureBuilt();
        setMark();
        writeFold(id, details.open);
    });
    return details;
}

const ALIGN_OPTIONS = [["left", "靠左", "align-left"], ["center", "置中", "align-center"], ["right", "靠右", "align-right"]];

const svgIcon = (body) => `<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** 圖片縮放：原尺寸（小方塊在框內）／符合寬度（等寬、高度依比例）／填滿（整個框填滿） */
export const IMAGE_FIT_OPTIONS = [
    ["none", "原尺寸", svgIcon('<rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke-dasharray="2 2"/><rect x="5.5" y="5.5" width="5" height="5" fill="currentColor"/>')],
    ["auto", "符合寬度", svgIcon('<rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke-dasharray="2 2"/><rect x="1.5" y="4.5" width="13" height="7" fill="currentColor"/>')],
    ["stretch", "填滿", svgIcon('<rect x="1.5" y="1.5" width="13" height="13" rx="1.5" fill="currentColor"/>')],
];

/** 圖文段落的圖片位置：左（左邊方塊＋右側文字行）／右（相反） */
export const IMAGE_SIDE_OPTIONS = [
    ["left", "圖在左", svgIcon('<rect x="1.5" y="2.5" width="5" height="6" rx="1" fill="currentColor"/><path d="M9 3.5h5.5M9 6.5h5.5M1.5 11.5h13M1.5 14h9"/>')],
    ["right", "圖在右", svgIcon('<rect x="9.5" y="2.5" width="5" height="6" rx="1" fill="currentColor"/><path d="M1.5 3.5H7M1.5 6.5H7M1.5 11.5h13M5.5 14h9"/>')],
];

/** 對齊按鈕組（靠左／置中／靠右）：單選 radiogroup，左右方向鍵切換；current 為 null 表示混合（都不選）。 */
export function alignGroup(current, onChange, label = "對齊", options = ALIGN_OPTIONS) {
    const group = document.createElement("div");
    // 用 Tocas 的 .ts-buttons（合併邊框成一個膠囊、中間夾分隔線）取代原本各自獨立外框的 .ts-wrap，
    // 讓這組選項看起來是「一組」而不是幾顆分開的按鈕（比照 Figma 的 segmented control），
    // 選中狀態則交給 editor.css 的 .ts-buttons .ts-button.is-icon.is-active 填色。
    group.className = "ts-buttons has-top-spaced-small";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", label);
    const buttons = options.map(([value, text, icon]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ts-button is-small is-icon is-outlined";
        b.setAttribute("role", "radio");
        b.setAttribute("aria-label", text);
        b.dataset.tooltip = text;
        b.dataset.value = value;
        // icon 是 "<svg" 開頭就直接用（自製的版面示意圖），否則當 Tocas 圖示名稱
        b.innerHTML = icon.startsWith("<svg") ? icon : `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span>`;
        return b;
    });
    const select = (value, focus) => {
        buttons.forEach((b) => {
            const on = b.dataset.value === value;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-checked", String(on));
            b.tabIndex = on || (value == null && b === buttons[0]) ? 0 : -1;
            if (on && focus) b.focus();
        });
    };
    select(current ?? null);
    buttons.forEach((b, i) => {
        b.addEventListener("click", () => { select(b.dataset.value); onChange(b.dataset.value); });
        b.addEventListener("keydown", (e) => {
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (!step) return;
            e.preventDefault();
            const next = buttons[(i + step + buttons.length) % buttons.length];
            select(next.dataset.value, true);
            onChange(next.dataset.value);
        });
    });
    group.append(...buttons);
    return group;
}
