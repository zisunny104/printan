// Printan .ptan 專案檔格式定義與驗證。
// 這個檔案是 core 的一部分：不得依賴 DOM／window／editor 狀態。

import { normalizeTextElement, walkElements } from "./document-model.js";

export const PTAN_FORMAT = "ptan";
export const PTAN_VERSION = 2;

/**
 * .ptan 檔案結構（version 1）：
 * {
 *   format: "ptan",
 *   version: 1,
 *   meta: { name, createdAt, updatedAt },
 *   printerProfile: { id },
 *   paper: { widthId },
 *   variables: string[],           // 使用者定義的 placeholder 變數名稱
 *   template: { elements: Element[] },
 *   assets: [{ id, type, dataUrl }] // 圖片等二進位資源，內嵌為 data URL
 * }
 *
 * Element（document-model.js 產生）:
 * {
 *   id, type: "text"|"image"|"float-block"|"spacer"|"divider"|"row"|"barcode"|"group",
 *   ...type 專屬欄位,
 *   columns?: Element[][]   // 僅 row 使用：每欄是一個子 element 陣列
 *   ratio?: number[]        // 僅 row 使用：各欄相對比例，例如 [1,1] 或 [2,1]
 *   children?: Element[]    // 僅 group 使用（version 2）
 * 專案層級選用欄位 embeddedFonts?: [{ family, weight, unicodeRange, data }]（version 2；匯出時勾選才有）
 * }
 */

export function createEmptyProject({ name = "未命名版型", printerProfileId, paperWidthId } = {}) {
    const now = new Date().toISOString();
    return {
        format: PTAN_FORMAT,
        version: PTAN_VERSION,
        meta: { name, createdAt: now, updatedAt: now },
        printerProfile: { id: printerProfileId },
        paper: { widthId: paperWidthId },
        variables: [],
        template: { elements: [] },
        assets: [],
    };
}

/**
 * 驗證並視需要 migrate 一份 .ptan 資料到目前版本。
 * 回傳 { ok: true, project } 或 { ok: false, error }。
 */
export function loadProject(raw) {
    let data = raw;
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw);
        } catch (err) {
            return { ok: false, error: "檔案不是有效的 JSON：" + err.message };
        }
    }
    if (!data || typeof data !== "object") {
        return { ok: false, error: "檔案內容格式錯誤" };
    }
    if (data.format !== PTAN_FORMAT) {
        return { ok: false, error: "不是 Printan 專案檔（format 欄位不符）" };
    }
    if (typeof data.version !== "number") {
        return { ok: false, error: "缺少版本號" };
    }
    try {
        const migrated = migrate(data);
        if (!migrated.ok) return migrated;
        return { ok: true, project: migrated.project };
    } catch {
        return { ok: false, error: "檔案內容有誤，無法開啟" };
    }
}

/**
 * schema migration 掛勾：未來新增 version 時，在這裡逐步往上轉換。
 */
function migrate(project) {
    let p = project;
    if (p.version > PTAN_VERSION) {
        return { ok: false, error: `此檔案版本 (${p.version}) 比目前工具支援的版本 (${PTAN_VERSION}) 新，請更新 Printan` };
    }
    // v1 → v2 只新增 group 元素，資料結構無需轉換
    p = {
        ...p,
        variables: Array.isArray(p.variables) ? p.variables : [],
        template: p.template && Array.isArray(p.template.elements) ? p.template : { elements: [] },
        assets: Array.isArray(p.assets) ? p.assets : [],
        meta: p.meta || {},
        printerProfile: p.printerProfile || {},
        paper: p.paper || {},
    };
    p = { ...p, template: { elements: migrateElements(p.template.elements) }, assets: sanitizeAssets(p.assets) };
    return { ok: true, project: p };
}

// 匯入檔的圖片資源上限與格式：只收點陣圖 data URL（不收 svg 等可夾帶腳本的格式），筆數與大小設上限避免撐爆記憶體
export const MAX_ASSETS = 100;
export const MAX_ASSET_CHARS = 40_000_000; // data URL 字元數，約 30MB 圖檔
export const MAX_ASSETS_TOTAL_CHARS = 120_000_000;
export const SAFE_IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/;

export function sanitizeAssets(assets) {
    const out = [];
    let total = 0;
    for (const a of assets) {
        if (out.length >= MAX_ASSETS) break;
        if (!a || typeof a.id !== "string" || typeof a.dataUrl !== "string") continue;
        if (a.dataUrl.length > MAX_ASSET_CHARS || total + a.dataUrl.length > MAX_ASSETS_TOTAL_CHARS) continue;
        if (!SAFE_IMAGE_DATA_URL.test(a.dataUrl)) continue;
        total += a.dataUrl.length;
        out.push({ id: a.id, type: a.dataUrl.slice(5, a.dataUrl.indexOf(";")), dataUrl: a.dataUrl });
    }
    return out;
}

/**
 * 整理元素樹：文字元素舊版扁平 text 欄位 → runs 陣列（見 document-model.js normalizeTextElement）；
 * 壞檔防護：丟掉非物件／沒有 type 的節點，row 的 columns／ratio 與 group 的 children 缺了或型別不對就補預設，
 * 讓後面的排版、walkElements、序列化不會因為壞資料丟例外。
 */
function migrateElements(elements) {
    if (!Array.isArray(elements)) return [];
    return elements
        .filter((el) => el && typeof el === "object" && !Array.isArray(el) && typeof el.type === "string")
        .map((el) => {
            if (el.type === "text") return normalizeTextElement(el);
            if (el.type === "row") return normalizeRow(el);
            if (el.type === "group") return { ...el, children: migrateElements(el.children) };
            return el;
        });
}

function normalizeRow(el) {
    const columns = (Array.isArray(el.columns) ? el.columns : []).map(migrateElements);
    const ratio = Array.isArray(el.ratio) ? el.ratio.map((r) => (Number.isFinite(r) && r > 0 ? r : 1)) : [];
    const count = Math.max(ratio.length, columns.length, 1);
    while (ratio.length < count) ratio.push(1);
    while (columns.length < count) columns.push([]);
    return { ...el, ratio, columns };
}

export function serializeProject(project) {
    // 沒用到群組、圖文段落、直書就仍寫 v1，舊版 Printan 也能開；有群組才寫 v2
    // （內嵌字體 embeddedFonts 同理：有才寫 v2）
    let usesGroup = Array.isArray(project.embeddedFonts) && project.embeddedFonts.length > 0;
    walkElements(project.template?.elements || [], (el) => { if (el.type === "group" || el.type === "float-block" || el.writingMode === "vertical") usesGroup = true; });
    return JSON.stringify({ ...project, version: usesGroup ? PTAN_VERSION : 1, format: PTAN_FORMAT }, null, 2);
}
