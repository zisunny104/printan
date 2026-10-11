// Placeholder 套用資料（Mail Merge）。
// Template + 單筆資料 → 套用後的 element tree。

import { walkElements } from "./document-model.js";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const RUN_STYLE_KEYS = ["bold", "italic", "strikethrough"];
const SINGLE_PLACEHOLDER_RE = /^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/;

/** 資料值是否為合法的「run 陣列」：每項都是 { text: string, bold?/italic?/strikethrough?: boolean }，其餘欄位不收。 */
export function isRunArray(value) {
    return Array.isArray(value) && value.every((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.text !== "string") return false;
        return Object.keys(item).every((k) => k === "text" || (RUN_STYLE_KEYS.includes(k) && (item[k] === undefined || typeof item[k] === "boolean")));
    });
}

function stringifyValue(v) {
    if (v === undefined || v === null) return "";
    if (isRunArray(v)) return v.map((item) => item.text).join("");
    return String(v);
}

function substitute(text, data) {
    if (typeof text !== "string") return text;
    return text.replace(PLACEHOLDER_RE, (whole, name) => stringifyValue(data ? data[name] : undefined));
}

/** run 的 text 剛好是單一 {{var}} 且 data[var] 是 run 陣列時，展開成每個項目一個 run；否則回傳 null。 */
function expandRun(run, data) {
    if (typeof run.text !== "string" || !data) return null;
    const m = SINGLE_PLACEHOLDER_RE.exec(run.text.trim());
    if (!m || !isRunArray(data[m[1]])) return null;
    const out = [];
    for (const item of data[m[1]]) {
        if (item.text === "") continue;
        const next = { ...run, text: item.text };
        for (const key of RUN_STYLE_KEYS) {
            // 原 run 沒設該屬性時，只有項目為 true 才寫入，否則維持 undefined 讓元素層預設生效。
            if (item[key] || run[key]) next[key] = true;
            else if (run[key] !== undefined) next[key] = run[key];
        }
        out.push(next);
    }
    return out;
}

/**
 * 把 data（單筆物件）套進 template.elements，回傳新的 element tree（不修改原本 template）。
 * image 元素的 assetId 若本身是 "{{var}}" 形式，會替換成 data[var]（預期是 asset id 或圖片 URL）。
 * barcode 元素的 value 同樣支援 "{{var}}"。
 * 文字 run 的 text 剛好是單一 "{{var}}" 且 data[var] 是 run 陣列（見 isRunArray）時，該 run 會原地展開成多個 run，
 * 沿用原 run 的其他屬性；bold／italic／strikethrough 取項目值或原值。夾雜其他文字時，陣列只取各項 text 串接。
 */
export function applyDataToElements(elements, data = {}) {
    const cloned = JSON.parse(JSON.stringify(elements));
    walkElements(cloned, (el) => {
        if ((el.type === "text" || el.type === "float-block") && Array.isArray(el.runs)) {
            const runs = [];
            for (const run of el.runs) {
                const expanded = expandRun(run, data);
                if (expanded) runs.push(...expanded);
                else {
                    run.text = substitute(run.text, data);
                    runs.push(run);
                }
            }
            el.runs = runs;
        }
        if ((el.type === "image" || el.type === "float-block") && typeof el.assetId === "string") {
            el.assetId = substitute(el.assetId, data);
        }
        if (el.type === "barcode" && typeof el.value === "string") {
            el.value = substitute(el.value, data);
        }
    });
    return cloned;
}
