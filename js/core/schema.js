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
    const migrated = migrate(data);
    if (!migrated.ok) return migrated;
    return { ok: true, project: migrated.project };
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
    p = { ...p, template: { elements: migrateElements(p.template.elements) } };
    return { ok: true, project: p };
}

/** 文字元素舊版扁平 text 欄位 → runs 陣列（見 document-model.js normalizeTextElement）。 */
function migrateElements(elements) {
    return elements.map((el) => {
        if (el.type === "text") return normalizeTextElement(el);
        if (el.type === "row" && Array.isArray(el.columns)) {
            return { ...el, columns: el.columns.map(migrateElements) };
        }
        if (el.type === "group") return { ...el, children: migrateElements(Array.isArray(el.children) ? el.children : []) };
        return el;
    });
}

export function serializeProject(project) {
    // 沒用到群組、圖文段落、直書就仍寫 v1，舊版 Printan 也能開；有群組才寫 v2
    // （內嵌字體 embeddedFonts 同理：有才寫 v2）
    let usesGroup = Array.isArray(project.embeddedFonts) && project.embeddedFonts.length > 0;
    walkElements(project.template?.elements || [], (el) => { if (el.type === "group" || el.type === "float-block" || el.writingMode === "vertical") usesGroup = true; });
    return JSON.stringify({ ...project, version: usesGroup ? PTAN_VERSION : 1, format: PTAN_FORMAT }, null, 2);
}
