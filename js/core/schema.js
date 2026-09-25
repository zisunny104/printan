// Printan .ptan 專案檔格式定義與驗證。
// 這個檔案是 core 的一部分：不得依賴 DOM／window／editor 狀態。

import { normalizeTextElement, walkElements } from "./document-model.js";
import { normalizeRowGap } from "./units.js";

export const PTAN_FORMAT = "ptan";
export const PTAN_VERSION = 3;

/**
 * .ptan 檔案結構（version 3；有真的用到多頁才會寫這個版本，見 serializeProject）：
 * {
 *   format: "ptan",
 *   version: 3,
 *   meta: { name, createdAt, updatedAt },
 *   printerProfile: { id },
 *   paper: { widthId },              // 專案層級共用，不分頁（不同頁不可能換紙寬，同一次列印工作）
 *   variables: string[],             // 使用者定義的 placeholder 變數名稱，跨所有頁彙整
 *   template: { pages: Page[] },
 *   assets: [{ id, type, dataUrl }]  // 圖片等二進位資源，內嵌為 data URL，跨頁共用
 * }
 *
 * Page（多頁／frame，比照 Figma；見需求單「多頁支援」）:
 * {
 *   id, name: string,
 *   elements: Element[],
 *   cutAfter: boolean   // 列印完這一頁要不要送切紙指令。true＝切下來；false＝跟下一頁走同一段連續紙
 *                        // （沒有實體切割，兩頁在同一次列印工作裡首尾相接）。
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
 *
 * 版本沿革：v1 單頁 elements 陣列；v2 新增 group／圖文段落／直書；v3 template.elements → template.pages
 * （多頁），單頁專案沒真的用到多頁功能時仍序列化成 v1/v2 的 template.elements 形狀，
 * 讓舊版 Printan 與只認得單頁 elements 的外部整合方（renderer.js 是公開的 render-core API，
 * 見該檔案開頭說明）都還能開。
 */

let pageIdCounter = 0;
function nextPageId() {
    pageIdCounter += 1;
    return `page_${Date.now().toString(36)}${pageIdCounter.toString(36)}`;
}

export function createPage({ name = "頁 1", elements = [], cutAfter = true } = {}) {
    return { id: nextPageId(), name, elements, cutAfter };
}

/**
 * 依切紙邊界把頁面分段：回傳頁面索引的二維陣列，每一段是「印出來同一張連續紙」的頁面。
 * cutAfter:true 的頁面是該段的最後一頁；最後一頁即使 cutAfter:false 也自成一段的結尾（後面沒有頁可接）。
 * 編輯器 2D 畫布用它決定水平（不同段）／垂直（同段接續）排列，放在 core 是為了讓測試頁不經 DOM 就能驗證。
 */
export function groupPagesByCut(pages) {
    const groups = [];
    let current = [];
    (Array.isArray(pages) ? pages : []).forEach((page, index) => {
        current.push(index);
        if (page?.cutAfter !== false) {
            groups.push(current);
            current = [];
        }
    });
    if (current.length) groups.push(current);
    return groups;
}

// renderer.js renderTemplate() 是公開的單頁 render-core API（見該檔案開頭說明），外部整合方
// 常見用法是直接 renderTemplate(loadProject(file).project)，一路讀 project.template.elements——
// v3 改成 template.pages 之後這個欄位不會自動存在，會讓外部呼叫端整個壞掉。這裡用 getter／setter
// 轉接到 pages[0]（第一頁），讓 template.elements 繼續能讀寫、且永遠跟 pages[0].elements 同步
// （不是複製一份快照，複製會在 pages 之後被改動時跟著失真）。多頁專案的第二頁以後本來就不在
// 這個相容欄位的涵蓋範圍內，外部整合方要處理多頁得改用 renderer.js 的 renderPages()。
function attachElementsCompat(template) {
    Object.defineProperty(template, "elements", {
        get() { return template.pages[0]?.elements ?? []; },
        set(elements) { if (template.pages[0]) template.pages[0].elements = elements; },
        enumerable: false,
        configurable: true,
    });
    return template;
}

export function createEmptyProject({ name = "未命名版型", printerProfileId, paperWidthId } = {}) {
    const now = new Date().toISOString();
    return {
        format: PTAN_FORMAT,
        version: PTAN_VERSION,
        meta: { name, createdAt: now, updatedAt: now },
        printerProfile: { id: printerProfileId },
        paper: { widthId: paperWidthId },
        variables: [],
        template: attachElementsCompat({ pages: [createPage({ name: "頁 1" })] }),
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
    p = {
        ...p,
        variables: Array.isArray(p.variables) ? p.variables : [],
        assets: Array.isArray(p.assets) ? p.assets : [],
        meta: p.meta || {},
        printerProfile: p.printerProfile || {},
        paper: p.paper || {},
    };
    p = { ...p, template: migrateTemplate(p.template), assets: sanitizeAssets(p.assets) };
    return { ok: true, project: p };
}

// v1/v2 沒有 pages 欄位：整份 template.elements 當成單一隱含頁，cutAfter 預設 true——
// 對使用者來說行為完全不變（原本就是列印完直接切紙），開啟舊檔不需要任何手動操作。
// pageId／pageName：serializeProject 寫單頁 legacy 格式時額外夾帶的頁面 id／名稱（舊版 Printan
// 只認得 elements，會忽略這兩個不認識的欄位，向下相容不受影響），讀回來能接上原本的頁面，
// 而不是每次都生一個新 id——這樣「.ptan 存檔再打開」在單頁專案上也是逐位元組一致的來回。
function migrateTemplate(template) {
    const t = template && typeof template === "object" && !Array.isArray(template) ? template : {};
    if (Array.isArray(t.pages)) return attachElementsCompat({ pages: migratePages(t.pages) });
    const elements = migrateElements(Array.isArray(t.elements) ? t.elements : []);
    const name = typeof t.pageName === "string" && t.pageName ? t.pageName : "頁 1";
    const page = createPage({ name, elements });
    if (typeof t.pageId === "string" && t.pageId) page.id = t.pageId;
    return attachElementsCompat({ pages: [page] });
}

// 壞檔防護：不是物件的頁面丟掉，缺 id／name／elements／cutAfter 一律補預設值；
// 全部頁面都壞掉的極端情況，退回一頁空白頁，讓後面的畫布／渲染不會因為 pages 是空陣列而整個空白當機。
function migratePages(pages) {
    const valid = pages.filter((p) => p && typeof p === "object" && !Array.isArray(p));
    const list = valid.map((p, i) => ({
        id: typeof p.id === "string" && p.id ? p.id : nextPageId(),
        name: typeof p.name === "string" && p.name ? p.name : `頁 ${i + 1}`,
        elements: migrateElements(Array.isArray(p.elements) ? p.elements : []),
        cutAfter: p.cutAfter !== false,
    }));
    return list.length ? list : [createPage({ name: "頁 1" })];
}

// 匯入檔的圖片資源上限與格式：只收點陣圖 data URL（不收 svg 等可夾帶腳本的格式），筆數與大小設上限避免撐爆記憶體
export const MAX_ASSETS = 100;
const MAX_ASSET_NAME_CHARS = 200;
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
        const entry = { id: a.id };
        if (typeof a.name === "string") entry.name = a.name.slice(0, MAX_ASSET_NAME_CHARS);
        out.push({ ...entry, type: a.dataUrl.slice(5, a.dataUrl.indexOf(";")), dataUrl: a.dataUrl });
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
    const { gap, ...rest } = el;
    const normalized = { ...rest, ratio, columns };
    const g = normalizeRowGap(gap);
    if (g > 0) normalized.gap = g; // 0 或壞值不留欄位，跟舊檔一致
    return normalized;
}

export function serializeProject(project) {
    const pages = (project.template && Array.isArray(project.template.pages)) ? project.template.pages : [];
    // 沒用到群組、圖文段落、直書就仍寫 v1，舊版 Printan 也能開；有群組才寫 v2（內嵌字體同理）
    let usesGroup = Array.isArray(project.embeddedFonts) && project.embeddedFonts.length > 0;
    for (const page of pages) {
        walkElements(page.elements || [], (el) => { if (el.type === "group" || el.type === "float-block" || el.writingMode === "vertical") usesGroup = true; });
    }
    // 多欄 gap 為 0（或沒設）就不寫進檔案
    const dropZeroGap = function (key, value) { return key === "gap" && value === 0 && this.type === "row" ? undefined : value; };
    // 只有一頁、且那一頁維持預設 cutAfter（沒有真的用到多頁功能）就照舊寫回 template.elements（v1/v2 形狀）：
    // 舊版 Printan、以及只認單頁 elements 的外部整合方（renderer.js 公開 API）都還能直接開；
    // 真的新增了第二頁或改過 cutAfter，才升版寫 template.pages（v3），這時候舊版工具開不了是預期行為
    // （檔案結構本質上不一樣了，寫成假的單頁形狀反而會讓外部整合方以為只有一頁、漏印）。
    const isSingleImplicitPage = pages.length <= 1 && (pages.length === 0 || pages[0].cutAfter !== false);
    if (isSingleImplicitPage) {
        const template = { elements: pages[0]?.elements || [] };
        if (pages[0]) {
            template.pageId = pages[0].id; // 舊版 Printan 不認得這兩個欄位、會直接忽略，見 migrateTemplate
            template.pageName = pages[0].name;
        }
        const legacy = { ...project, template, version: usesGroup ? 2 : 1, format: PTAN_FORMAT };
        return JSON.stringify(legacy, dropZeroGap, 2);
    }
    return JSON.stringify({ ...project, version: PTAN_VERSION, format: PTAN_FORMAT }, dropZeroGap, 2);
}
