// Placeholder 套用資料（Mail Merge）。
// Template + 單筆資料 → 套用後的 element tree。

import { walkElements } from "./document-model.js";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function substitute(text, data) {
    if (typeof text !== "string") return text;
    return text.replace(PLACEHOLDER_RE, (whole, name) => {
        const v = data ? data[name] : undefined;
        return v === undefined || v === null ? "" : String(v);
    });
}

/**
 * 把 data（單筆物件）套進 template.elements，回傳新的 element tree（不修改原本 template）。
 * image 元素的 assetId 若本身是 "{{var}}" 形式，會替換成 data[var]（預期是 asset id 或圖片 URL）。
 * barcode 元素的 value 同樣支援 "{{var}}"。
 */
export function applyDataToElements(elements, data = {}) {
    const cloned = JSON.parse(JSON.stringify(elements));
    walkElements(cloned, (el) => {
        if (el.type === "text" && Array.isArray(el.runs)) {
            for (const run of el.runs) run.text = substitute(run.text, data);
        }
        if (el.type === "image" && typeof el.assetId === "string") {
            el.assetId = substitute(el.assetId, data);
        }
        if (el.type === "barcode" && typeof el.value === "string") {
            el.value = substitute(el.value, data);
        }
    });
    return cloned;
}
