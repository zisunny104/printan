// Document Model：版型元素的資料結構與工廠函式。
// 尺寸單位一律是「點（dot）」，對應目前 Printer Profile 的 DPI（見 units.js）。
// 欄寬（row 的 ratio）是相對比例，不是絕對點數，才能讓紙寬切換不用重建專案。

let idCounter = 0;
function nextId(prefix) {
    idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/**
 * 一個文字元素的內容由多個 run 組成（比照 Figma：同一段文字裡不同片段可以各自
 * 覆寫字體／字級／粗體／斜體／底線／刪除線／反白）。run 沒指定的樣式欄位會繼承所屬
 * 文字元素的預設值（fontFamily/fontSize/bold），斜體／底線／刪除線／反白沒有元素層級
 * 預設值（元素的 inverse 是整行反白，另一回事），未指定一律視為 false。align／wrap／maxLines／lineHeight／letterSpacing
 * 是「段落」層級設定，仍然掛在元素上，不隨 run 變化。
 */
export function createTextRun(overrides = {}) {
    return {
        text: "",
        ...overrides,
    };
}

export function createTextElement(overrides = {}) {
    return {
        id: nextId("text"),
        type: "text",
        runs: [createTextRun({ text: "" })],
        fontFamily: null, // null = 使用渲染時的全域預設字體
        fontSize: 32, // dots，run 沒指定字級時的預設值
        lineHeight: 1.3,
        letterSpacing: 0, // dots
        bold: false, // run 沒指定粗體時的預設值
        inverse: false, // 整行反白：每一行從左到右鋪滿黑底、文字改白字（舊檔沒有此欄位＝false）
        align: "left", // left | center | right
        wrap: true,
        writingMode: "horizontal", // horizontal | vertical（直書：由上而下、行由右而左；舊檔沒有此欄位＝horizontal）
        maxLines: 0, // 0 = 不限制；>0 時超出以「…」截斷
        ...overrides,
    };
}

/** 把文字元素的所有 run 接成單一字串（大綱標籤預覽、變數掃描等用途）。 */
export function getTextContent(el) {
    if (!Array.isArray(el.runs)) return "";
    return el.runs.map((r) => r.text || "").join("");
}

/** 把舊版（v1 之前）扁平 text 欄位的文字元素轉成 runs 陣列，供 schema migrate() 呼叫。 */
export function normalizeTextElement(el) {
    if (Array.isArray(el.runs)) return el;
    const { text, ...rest } = el;
    return { ...rest, runs: [createTextRun({ text: text || "" })] };
}

// ---- Run 編輯（比照 Figma：單一文字框 + 選取範圍套用樣式） ----
// 以下函式把「字元偏移範圍」對應到 runs 陣列的切分/合併，供 editor.js 的富文字編輯器使用。

// inverse＝局部反白（黑底白字）；元素本身也是整行反白時，兩者相抵＝該段變回白底黑字。
export const RUN_STYLE_FIELDS = ["fontFamily", "fontSize", "bold", "italic", "underline", "strikethrough", "inverse"];

/** 選取範圍內各 run 的某欄位值不一致時的標記值（不會被序列化保存，僅供 UI 顯示「混合」）。 */
export const MIXED = Symbol("mixed");

function runFieldValue(el, run, field) {
    if (field === "bold") return run.bold ?? el.bold ?? false;
    if (field === "italic" || field === "underline" || field === "strikethrough" || field === "inverse") return !!run[field];
    return run[field] ?? null; // fontFamily / fontSize：null 表示跟隨段落預設
}

/** 在 offset 這個字元位置切開 runs（如果剛好落在 run 邊界則不動作）。 */
function splitRunsAtOffset(runs, offset) {
    if (offset <= 0) return;
    let pos = 0;
    for (let i = 0; i < runs.length; i++) {
        const text = runs[i].text || "";
        if (offset === pos) return;
        if (offset < pos + text.length) {
            const run = runs[i];
            const cut = offset - pos;
            runs.splice(i, 1, { ...run, text: text.slice(0, cut) }, { ...run, text: text.slice(cut) });
            return;
        }
        pos += text.length;
    }
}

/** 找出涵蓋 offset 這個字元位置的 run 索引（offset 等於總長度時回傳最後一個 run）。 */
function runIndexAtOffset(runs, offset) {
    let pos = 0;
    for (let i = 0; i < runs.length; i++) {
        const len = (runs[i].text || "").length;
        if (offset < pos + len || i === runs.length - 1) return i;
        pos += len;
    }
    return Math.max(0, runs.length - 1);
}

/** 假設 runs 已經在 start/end 切好邊界，回傳完全落在 [start, end) 內的 run 索引。 */
function runIndicesInRange(runs, start, end) {
    const indices = [];
    let pos = 0;
    for (let i = 0; i < runs.length; i++) {
        const len = (runs[i].text || "").length;
        if (pos >= start && pos + len <= end && len > 0) indices.push(i);
        pos += len;
    }
    return indices;
}

function stylesMatch(a, b) {
    return RUN_STYLE_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));
}

/** 合併相鄰且樣式完全相同的 run，並移除空字串 run（避免編輯後 run 數量無限增生）。 */
export function mergeAdjacentRuns(el) {
    const kept = el.runs.filter((r) => r.text !== "");
    const merged = [];
    for (const run of kept) {
        const last = merged[merged.length - 1];
        if (last && stylesMatch(last, run)) {
            last.text += run.text;
        } else {
            merged.push({ ...run });
        }
    }
    el.runs = merged.length ? merged : [createTextRun()];
}

/**
 * 取得選取範圍 [start, end) 目前的樣式；range 有多個 run 且欄位值不一致時回傳 MIXED。
 * start === end（游標，沒有選取範圍）時，回傳游標前一個字元所在 run 的樣式（下一個字會沿用）。
 */
export function getRangeStyle(el, start, end) {
    const runs = el.runs;
    let indices;
    if (start === end) {
        indices = [runIndexAtOffset(runs, start > 0 ? start - 1 : 0)];
    } else {
        indices = runIndicesInRange(runs, start, end);
        if (!indices.length) indices = [runIndexAtOffset(runs, start)];
    }
    const result = {};
    for (const field of RUN_STYLE_FIELDS) {
        const values = indices.map((i) => runFieldValue(el, runs[i], field));
        result[field] = values.every((v) => v === values[0]) ? values[0] : MIXED;
    }
    return result;
}

/** 把某個樣式欄位套用到選取範圍 [start, end)；start === end（沒有範圍）時不動作。 */
export function applyStyleToRange(el, start, end, field, value) {
    if (start === end) return;
    const runs = el.runs;
    splitRunsAtOffset(runs, start);
    splitRunsAtOffset(runs, end);
    for (const i of runIndicesInRange(runs, start, end)) runs[i][field] = value;
    mergeAdjacentRuns(el);
}

/** 把 [start, end) 這段字元換成 newText，新文字沿用選取起點前一個字元的樣式。 */
export function replaceTextRange(el, start, end, newText) {
    const runs = el.runs;
    splitRunsAtOffset(runs, start);
    splitRunsAtOffset(runs, end);
    const indices = runIndicesInRange(runs, start, end);
    const styleSourceIdx = runs.length ? runIndexAtOffset(runs, start > 0 ? start - 1 : 0) : -1;
    const styleSource = styleSourceIdx >= 0 ? runs[styleSourceIdx] : null;
    let newRun = null;
    if (newText) {
        const overrides = { text: newText };
        if (styleSource) {
            for (const f of RUN_STYLE_FIELDS) if (styleSource[f] !== undefined) overrides[f] = styleSource[f];
        }
        newRun = createTextRun(overrides);
    }
    if (indices.length) {
        runs.splice(indices[0], indices.length, ...(newRun ? [newRun] : []));
    } else if (newRun) {
        runs.splice(styleSourceIdx >= 0 ? styleSourceIdx + 1 : 0, 0, newRun);
    }
    mergeAdjacentRuns(el);
}

/** 把整份文字框的內容換成 newText（textarea 編輯用），用最長共同前後綴找出實際變動範圍，其餘文字保留原本樣式。 */
export function replaceFullText(el, newText) {
    const oldText = getTextContent(el);
    if (newText === oldText) return;
    const maxPrefix = Math.min(oldText.length, newText.length);
    let prefix = 0;
    while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;
    const maxSuffix = Math.min(oldText.length, newText.length) - prefix;
    let suffix = 0;
    while (suffix < maxSuffix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
    replaceTextRange(el, prefix, oldText.length - suffix, newText.slice(prefix, newText.length - suffix));
}

export function createImageElement(overrides = {}) {
    return {
        id: nextId("image"),
        type: "image",
        assetId: null, // 對應 .ptan assets[].id，或 "{{placeholder}}" 由資料提供
        heightDots: 0, // 0 = 依欄寬等比縮放；fit === "stretch" 時作為指定高度
        align: "center", // left | center | right，drawWidth < 欄寬時（widthPercent < 100）決定圖片框水平位置
        widthPercent: 100, // 1-100，圖片框寬度 = 欄寬 × widthPercent/100
        fit: "auto", // "auto"：依裁切後內容比例縮放高度｜"stretch"：改用 heightDots 指定高度（可能變形）
        rotation: 0, // 0 | 90 | 180 | 270，順時針
        cropRect: null, // null 或 { x, y, w, h }（0-1 正規化座標，相對「旋轉後」的圖片）
        brightness: 0, // -100..100
        contrast: 0, // -100..100
        invert: false,
        ditherMode: "floyd-steinberg", // floyd-steinberg | ordered | threshold，決定熱感模式下怎麼轉成網點
        thresholdLevel: 128, // 僅 ditherMode === "threshold" 時使用，0-255
        ...overrides,
    };
}

/**
 * 圖文段落：一張浮動圖片（靠左或靠右）加一段文字，文字繞著圖片排。
 * 文字欄位同 text，圖片欄位同 image（只支援自動高度）；圖片與文字的間距固定 FLOAT_GAP_DOTS。
 */
export const FLOAT_GAP_DOTS = 8;

export function createFloatBlockElement(overrides = {}) {
    return {
        ...createTextElement(),
        ...createImageElement({ align: "left" }),
        id: nextId("float"),
        type: "float-block",
        imageSide: "left", // left | right
        widthPercent: 40, // 圖片寬度佔欄寬 %，1-100
        heightDots: 0,
        fit: "auto",
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

export const DEFAULT_ROW_GAP = 8; // 新建多欄的預設欄距（點）；舊檔沒有 gap 欄位＝0，輸出維持不變

export function createRowElement(ratio = [1], overrides = {}) {
    return {
        id: nextId("row"),
        type: "row",
        ratio,
        columns: ratio.map(() => []),
        ...overrides,
    };
}

/** 群組：把多個元素當成一個單位（直向流動，寬度同所在欄）。 */
export function createGroupElement(children = [], overrides = {}) {
    return { id: nextId("group"), type: "group", children, ...overrides };
}

/**
 * 條碼／QR Code 元素。format: "qrcode" | "code128" | "ean13" | "ean8" | "upca" | "code39" | "itf"（見 barcode.js BARCODE_FORMATS）。
 * showText（明碼：條碼下方的人類可讀數字）只對一維條碼有意義，QR 無此欄位可調。
 */
export function createBarcodeElement(overrides = {}) {
    return {
        id: nextId("barcode"),
        type: "barcode",
        format: "qrcode",
        value: "{{code}}",
        heightDots: 160, // 條碼本身高度；QR 為正方形邊長
        showText: true,
        align: "center",
        ...overrides,
    };
}

export function createElement(type, ...args) {
    switch (type) {
        case "text": return createTextElement(...args);
        case "image": return createImageElement(...args);
        case "float-block": return createFloatBlockElement(...args);
        case "spacer": return createSpacerElement(...args);
        case "divider": return createDividerElement(...args);
        case "row": return createRowElement(...args);
        case "barcode": return createBarcodeElement(...args);
        case "group": return createGroupElement(...args);
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
    if (element.type === "group" && Array.isArray(element.children)) {
        for (const child of element.children) reassignIds(child);
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
        if (el.type === "text" || el.type === "float-block") {
            for (const n of extractPlaceholdersFromText(getTextContent(el))) names.add(n);
        }
        if ((el.type === "image" || el.type === "float-block") && typeof el.assetId === "string") {
            for (const n of extractPlaceholdersFromText(el.assetId)) names.add(n);
        }
        if (el.type === "barcode" && typeof el.value === "string") {
            for (const n of extractPlaceholdersFromText(el.value)) names.add(n);
        }
    });
    return [...names];
}

export function walkElements(elements, visitor) {
    for (const el of elements) {
        visitor(el);
        if (el.type === "row" && Array.isArray(el.columns)) {
            for (const col of el.columns) walkElements(Array.isArray(col) ? col : [], visitor);
        }
        if (el.type === "group" && Array.isArray(el.children)) walkElements(el.children, visitor);
    }
}
