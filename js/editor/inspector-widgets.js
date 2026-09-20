// 檢視器（右側面板）共用的小元件：標題、按鈕、欄位、輸入框。

import { createInfoIcon } from "./ui-helpers.js";
import { state } from "./context.js";

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
    wrap.innerHTML = `
        <span class="ts-icon is-${icon}-icon is-heading" aria-hidden="true"></span>
        <div class="ts-text is-description">${title}</div>
        ${description ? `<div class="ts-text is-description">${description}</div>` : ""}
    `;
    return wrap;
}

export function sectionHeader(icon, text, info) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced ts-header is-start-icon is-small";
    wrap.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span> ${text}`;
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
    b.innerHTML = icon ? `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span> ${text}` : text;
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

export function field(labelText, inputEl, info) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced-small";
    if (labelText) {
        const label = document.createElement("label");
        label.className = "ts-text is-label";
        label.textContent = labelText;
        if (info) label.appendChild(createInfoIcon(info));
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
        const inner = document.createElement("div");
        inner.className = "has-top-spaced-small";
        inner.appendChild(inputEl);
        col.appendChild(label);
        col.appendChild(inner);
        grid.appendChild(col);
    }
    return grid;
}

export function textInput(value, onInput, type = "text") {
    const wrap = document.createElement("div");
    wrap.className = "ts-input is-small is-fluid";
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.addEventListener("input", () => onInput(type === "number" ? Number(input.value) : input.value));
    wrap.appendChild(input);
    return wrap;
}

export function selectInput(options, value, onChange) {
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
