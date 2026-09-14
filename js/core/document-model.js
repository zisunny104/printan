// Document Model：版型元素的資料結構與工廠函式。
// 尺寸單位一律是「點（dot）」，對應目前 Printer Profile 的 DPI（見 units.js）。
// 欄寬（row 的 ratio）是相對比例，不是絕對點數，才能讓紙寬切換不用重建專案。

let idCounter = 0;
function nextId(prefix) {
    idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export const ELEMENT_TYPES = ["text", "image", "spacer", "divider", "row"];

export function createTextElement(overrides = {}) {
    return {
        id: nextId("text"),
        type: "text",
        text: "文字內容",
        fontSize: 32, // dots
        lineHeight: 1.3,
        letterSpacing: 0, // dots
        bold: false,
        align: "left", // left | center | right
        wrap: true,
        maxLines: 0, // 0 = 不限制；>0 時超出以「…」截斷
        ...overrides,
    };
}

export function createImageElement(overrides = {}) {
    return {
        id: nextId("image"),
        type: "image",
        assetId: null, // 對應 .ptan assets[].id，或 "{{placeholder}}" 由資料提供
        heightDots: 0, // 0 = 依欄寬等比縮放
        align: "center",
        ...overrides,
    };
}

export function createSpacerElement(overrides = {}) {
    return {
        id: nextId("spacer"),
        type: "spacer",
        heightDots: 16,
        ...overrides,
    };
}

export function createDividerElement(overrides = {}) {
    return {
        id: nextId("divider"),
        type: "divider",
        style: "solid", // solid | dashed | dotted
        thicknessDots: 2,
        marginTopDots: 8,
        marginBottomDots: 8,
        ...overrides,
    };
}

export function createRowElement(ratio = [1], overrides = {}) {
    return {
        id: nextId("row"),
        type: "row",
        ratio,
        columns: ratio.map(() => []),
        ...overrides,
    };
}

export function createElement(type, ...args) {
    switch (type) {
        case "text": return createTextElement(...args);
        case "image": return createImageElement(...args);
        case "spacer": return createSpacerElement(...args);
        case "divider": return createDividerElement(...args);
        case "row": return createRowElement(...args);
        default: throw new Error(`未知的元素類型: ${type}`);
    }
}

/** 深拷貝並套用新 id（用於複製元素、或把 row 內的 columns 一併處理）。 */
export function cloneElementWithNewIds(element) {
    const clone = JSON.parse(JSON.stringify(element));
    reassignIds(clone);
    return clone;
}

function reassignIds(element) {
    element.id = nextId(element.type);
    if (element.type === "row" && Array.isArray(element.columns)) {
        for (const col of element.columns) {
            for (const child of col) reassignIds(child);
        }
    }
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** 掃描單一字串裡的 {{var}} placeholder，回傳變數名稱陣列（去重）。 */
export function extractPlaceholdersFromText(text) {
    if (!text) return [];
    const names = new Set();
    let m;
    PLACEHOLDER_RE.lastIndex = 0;
    while ((m = PLACEHOLDER_RE.exec(text))) names.add(m[1]);
    return [...names];
}

/** 遞迴掃描整份 template.elements，收集所有用到的 placeholder 變數名稱。 */
export function extractPlaceholders(elements) {
    const names = new Set();
    walkElements(elements, (el) => {
        if (el.type === "text") {
            for (const n of extractPlaceholdersFromText(el.text)) names.add(n);
        }
        if (el.type === "image" && typeof el.assetId === "string") {
            for (const n of extractPlaceholdersFromText(el.assetId)) names.add(n);
        }
    });
    return [...names];
}

export function walkElements(elements, visitor) {
    for (const el of elements) {
        visitor(el);
        if (el.type === "row") {
            for (const col of el.columns) walkElements(col, visitor);
        }
    }
}
