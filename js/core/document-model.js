// Document Model：版型元素的資料結構與工廠函式。
// 尺寸單位一律是「點（dot）」，對應目前 Printer Profile 的 DPI（見 units.js）。
// 欄寬（row 的 ratio）是相對比例，不是絕對點數，才能讓紙寬切換不用重建專案。

import { ptToDots } from "./units.js";

/**
 * 共用的「填色」模型：分隔線色塊、文字反白背景、文字本身墨色都用同一組欄位，交給
 * renderer.js 同一套排序抖色演算法畫（見 renderer.js renderFillCanvas），不用各自維護
 * 一套網點／漸層邏輯。mode "solid" 是純黑，等同還沒套用這個功能之前的舊行為。
 */
export const FILL_MODES = ["solid", "halftone", "gradient"];
export const FILL_PATTERNS = ["dot", "line", "grid"]; // halftone／gradient 共用的網點花紋（見 dithering.js PATTERN_MATRICES）
export const FILL_DIRECTIONS = ["horizontal", "vertical", "radial"]; // gradient 專用，radial＝以中心點放射的同心圓漸層
export function createFill(overrides = {}) {
    return {
        mode: "solid", // solid＝純黑｜halftone＝網點｜gradient＝網點漸層
        pattern: "dot", // halftone／gradient 共用：網點花紋（dot＝圓點｜line＝橫線｜grid＝網格）
        level: 128, // halftone 專用：網點濃度 0-255，數字越大網點越密（越黑）
        direction: "horizontal", // gradient 專用：horizontal | vertical | radial
        reverse: false, // gradient 專用：反轉深淺方向（radial 時無意義，忽略）
        from: 255, // gradient 專用：淺端灰階值 0-255
        to: 0, // gradient 專用：深端灰階值 0-255
        ...overrides,
    };
}
/** 把可能是舊檔／壞值的 fill 欄位收斂成一組合法值，未設定或不認得的值一律當 solid（舊行為）。 */
export function resolveFill(fill) {
    const f = fill && typeof fill === "object" ? fill : {};
    return {
        mode: FILL_MODES.includes(f.mode) ? f.mode : "solid",
        pattern: FILL_PATTERNS.includes(f.pattern) ? f.pattern : "dot",
        level: typeof f.level === "number" ? f.level : 128,
        direction: FILL_DIRECTIONS.includes(f.direction) ? f.direction : "horizontal",
        reverse: !!f.reverse,
        from: typeof f.from === "number" ? f.from : 255,
        to: typeof f.to === "number" ? f.to : 0,
    };
}

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
        inkFill: createFill(), // 文字本身墨色的填色（見 createFill／resolveFill），預設 solid＝純黑，跟舊行為一樣
        bgFill: createFill(), // 整行反白背景（inverse=true 時才會畫出來）的填色，預設 solid＝純黑底，跟舊行為一樣
        align: "left", // left | center | right
        wrap: true,
        writingMode: "horizontal", // horizontal | vertical（直書：由上而下、行由右而左；舊檔沒有此欄位＝horizontal）
        maxLines: 0, // 0 = 不限制；>0 時超出以「…」截斷
        widthMode: "column", // column＝沿用欄寬（舊檔行為）｜fixed＝改用 widthDots 指定絕對寬度（可小於欄寬），見 resolveTextWidthMode
        widthDots: 0, // widthMode==="fixed" 時的框寬（dots），0 或未設時視同 column
        heightMode: "auto", // auto＝高度完全由內容決定（舊檔行為）｜fixed＝改用 heightDots，見 resolveTextHeightMode
        heightDots: 0, // heightMode==="fixed" 時的框高（dots）
        overflow: "grow", // heightMode==="fixed" 時：grow＝heightDots 當最小高度、內容較高則自動變高｜clip＝固定高度、超出內容真的不印出，見 resolveTextOverflow
        vAlign: "top", // 內容在框內的垂直位置：top｜middle｜bottom。框高剛好等於內容時看不出差異，只有 heightMode="fixed" 且框比內容高（或 auto 但沒填滿）時才有作用；換模板套不同長度內容時，靠這個維持版面觀感一致，見 resolveTextVAlign
        ...overrides,
    };
}

// 語意化文字樣式：套用時一次展開成底下的具體欄位（fontSize/bold/letterSpacing/lineHeight），
// 欄位本身才是渲染依據，renderer.js 完全不需要認得 stylePreset，只吃展開後的具體欄位，
// 公開 API 維持單純（見 schema.js 開頭關於 renderer.js 是 render-core 公開 API 的說明）。
// stylePreset 欄位是選用的：沒有這個欄位就代表自訂（手動設定），不需要另外處理沒有這個欄位的
// 情況，本來就是合法狀態。
//
// 標籤直接對應 Markdown 的 H1-H5／P（本文），方便之後 MD 轉換功能直接查表；H6 因為在 203dpi
// 熱感紙上印中文字太小容易糊掉，先不開放。字級存 pt（跟 inspector.js 的字級輸入介面同一個單位），
// 套用時才依當下 profile 的 dpi 換算成 dots，避免未來加入不同 DPI 的機型時整批數字要重算。
// pt 數字是「標準字級階梯」（8/9/10/11/12/14/16/18/20…，Word／Docs 這類軟體字級選單的慣例值），
// 不是直接套 HTML 標題比例（2/1.5/1.17/1/0.83/0.67 倍）算出來的小數，理由同上——比例只用來決定
// 相對大小關係，實際數字要落在使用者眼熟的階梯上。
export const TEXT_STYLE_PRESETS = {
    H1: { fontSizePt: 20, bold: true, letterSpacing: 0, lineHeight: 1.2 },
    H2: { fontSizePt: 16, bold: true, letterSpacing: 0, lineHeight: 1.2 },
    H3: { fontSizePt: 12, bold: true, letterSpacing: 0, lineHeight: 1.2 },
    H4: { fontSizePt: 10, bold: true, letterSpacing: 0, lineHeight: 1.2 },
    P: { fontSizePt: 10, bold: false, letterSpacing: 0, lineHeight: 1.3 },
    H5: { fontSizePt: 8, bold: true, letterSpacing: 0, lineHeight: 1.2 },
};

/** 套用樣式預設：展開成具體欄位並記錄 stylePreset 供 UI 顯示目前選的是哪個。
 * dpiX 是套用當下 profile 的 DPI（見 printer-profiles.js），只在展開這一刻用來把 pt 換算成 dots，
 * 換算後的 dots 才是實際存進元素、渲染時讀取的值——跟其餘所有字級欄位存法一致。
 * preset 傳 null／不認得的值＝自訂，只清掉標記、不動現有欄位值，讓使用者能繼續拿目前這組
 * 數值手動調整，不會被覆寫掉。 */
export function applyTextStylePreset(el, preset, dpiX) {
    const spec = preset && Object.hasOwn(TEXT_STYLE_PRESETS, preset) ? TEXT_STYLE_PRESETS[preset] : null;
    if (spec) {
        const { fontSizePt, ...rest } = spec;
        Object.assign(el, rest, { fontSize: ptToDots(fontSizePt, dpiX) });
        el.stylePreset = preset;
    } else {
        delete el.stylePreset;
    }
}

/** 把文字元素的所有 run 接成單一字串（大綱標籤預覽、變數掃描等用途）。 */
export function getTextContent(el) {
    if (!Array.isArray(el.runs)) return "";
    return el.runs.map((r) => r.text || "").join("");
}

/** 把舊版（v1 之前）扁平 text 欄位的文字元素轉成 runs 陣列，供 schema migrate() 呼叫。
 * 順便清掉不認得的 stylePreset 值（壞檔／未來版本新增的預設名稱）——留著會讓 UI 選字樣式時
 * 查不到對應的具體欄位組合，這裡當它沒設，退回「自訂」，不影響其餘既有欄位。 */
export function normalizeTextElement(el) {
    const preset = el.stylePreset;
    const badPreset = preset !== undefined && !Object.hasOwn(TEXT_STYLE_PRESETS, preset);
    if (Array.isArray(el.runs)) {
        if (!badPreset) return el;
        const { stylePreset, ...rest } = el;
        return rest;
    }
    const { text, stylePreset, ...rest } = el;
    if (!badPreset && stylePreset !== undefined) rest.stylePreset = stylePreset;
    return { ...rest, runs: [createTextRun({ text: text || "" })] };
}

// ---- Run 編輯（比照 Figma：單一文字框 + 選取範圍套用樣式） ----
// 以下函式把「字元偏移範圍」對應到 runs 陣列的切分/合併，供 editor.js 的富文字編輯器使用。

// inverse＝局部反白（黑底白字）；元素本身也是整行反白時，兩者疊加＝維持黑底白字（見 renderer.js paintText）。
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

/** 圖片縮放方式：none＝原尺寸（1 像素＝1 點，超過欄寬才縮小）｜auto＝符合寬度（依 widthPercent、高度等比）｜stretch＝填滿（指定高度，可能變形）。
 * 舊檔沒有 fit：heightDots > 0 視為 stretch，否則 auto；不認得的值一律當 auto（與新增 none 之前的行為相同）。 */
export const IMAGE_FITS = ["none", "auto", "stretch"];
export function resolveImageFit(el) {
    const fit = el.fit || (el.heightDots > 0 ? "stretch" : "auto");
    return IMAGE_FITS.includes(fit) ? fit : "auto";
}

/** 文字框寬度模式：column＝沿用欄寬（舊檔沒有 widthMode 一律視為 column）｜fixed＝改用 widthDots（需 >0 才生效，否則退回 column）。 */
export const TEXT_WIDTH_MODES = ["column", "fixed"];
export function resolveTextWidthMode(el) {
    const mode = el.widthMode || "column";
    if (!TEXT_WIDTH_MODES.includes(mode)) return "column";
    if (mode === "fixed" && !(el.widthDots > 0)) return "column"; // 沒有有效寬度就退回欄寬，避免 0 寬
    return mode;
}

/** 文字框高度模式：auto＝內容決定高度（舊檔沒有 heightMode 一律視為 auto）｜fixed＝改用 heightDots（需 >0 才生效，否則退回 auto）。 */
export const TEXT_HEIGHT_MODES = ["auto", "fixed"];
export function resolveTextHeightMode(el) {
    const mode = el.heightMode || "auto";
    if (!TEXT_HEIGHT_MODES.includes(mode)) return "auto";
    if (mode === "fixed" && !(el.heightDots > 0)) return "auto";
    return mode;
}

/** heightMode==="fixed" 時的溢出處理：grow＝當最小高度、內容較高則自動變高｜clip＝固定高度、真的裁掉超出內容。舊檔沒有 overflow 預設 grow（貼近舊行為，不會無預警少印）。 */
export const TEXT_OVERFLOWS = ["grow", "clip"];
export function resolveTextOverflow(el) {
    const overflow = el.overflow || "grow";
    return TEXT_OVERFLOWS.includes(overflow) ? overflow : "grow";
}

/** 內容在框內的垂直位置（舊檔沒有 vAlign 一律視為 top，貼近舊行為）。見 createTextElement 的 vAlign 說明。 */
export const TEXT_VALIGNS = ["top", "middle", "bottom"];
export function resolveTextVAlign(el) {
    const vAlign = el.vAlign || "top";
    return TEXT_VALIGNS.includes(vAlign) ? vAlign : "top";
}

export function createImageElement(overrides = {}) {
    return {
        id: nextId("image"),
        type: "image",
        assetId: null, // 對應 .ptan assets[].id，或 "{{placeholder}}" 由資料提供
        heightDots: 0, // 0 = 依欄寬等比縮放；fit === "stretch" 時作為指定高度
        align: "center", // left | center | right，drawWidth < 欄寬時（widthPercent < 100）決定圖片框水平位置
        widthPercent: 100, // 1-100，圖片框寬度 = 欄寬 × widthPercent/100
        fit: "auto", // "none" 原尺寸｜"auto" 符合寬度（依裁切後內容比例縮放高度）｜"stretch" 填滿（改用 heightDots 指定高度，可能變形），見 resolveImageFit
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

/** 分隔線畫法：line＝細線（用 style/thicknessDots 畫實線／虛線／點線，舊檔沒有此欄位＝line）｜
 * fill＝色塊（佔滿欄寬、高度為 thicknessDots，用 fill 欄位決定純黑／網點／漸層，見 createFill／resolveFill）。
 * 不認得的值一律當 line，維持舊行為。 */
export const DIVIDER_DRAW_MODES = ["line", "fill"];
export function resolveDividerDrawMode(el) {
    const mode = el.drawMode || "line";
    return DIVIDER_DRAW_MODES.includes(mode) ? mode : "line";
}

export function createDividerElement(overrides = {}) {
    return {
        id: nextId("divider"),
        type: "divider",
        style: "solid", // solid | dashed | dotted（drawMode==="line" 時使用）
        thicknessDots: 2,
        marginTopDots: 8,
        marginBottomDots: 8,
        drawMode: "line", // line | fill，見 resolveDividerDrawMode
        fill: createFill(), // drawMode==="fill" 時的填色，見 createFill／resolveFill
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
 * textSize（明碼字級，dot）不在預設值裡：沒有這個欄位＝自動（高度的 16%），要放大時才寫入，舊檔輸出不變。
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
