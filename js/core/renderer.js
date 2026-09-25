// Printan Renderer Core — 可獨立嵌入其他專案的瀏覽器 ES module。
//
// 使用方式（其他網頁專案可直接引入這個檔案，不需要 Printan 的 Editor）：
//
//   import { renderTemplate } from "./printan/js/core/renderer.js";
//   const result = await renderTemplate(project, data, { mode: "thermal" });
//   document.body.appendChild(result.canvas);
//
// 設計原則：不依賴 Editor 狀態、不依賴任何 UI 框架；只吃 plain data（.ptan 專案物件
// + 一筆或多筆資料），吐出 canvas 與尺寸資訊。canvas 解析度 = 印表機可列印點數，
// 也就是說 1 個 canvas pixel = 1 個實體印字點，所有下游輸出（螢幕預覽／PDF／
// 未來的 ESC/POS 點陣）都源自同一份座標系統。

import { getPrinterProfile, getPaperWidth } from "./printer-profiles.js";
import { applyDataToElements } from "./merge.js";
import { FLOAT_GAP_DOTS, resolveImageFit, resolveTextWidthMode, resolveTextHeightMode, resolveTextOverflow } from "./document-model.js";
import { dotsToMm, splitRowColumns } from "./units.js";
import { applyThermalSimulation, toGrayscale, applyDither } from "./dithering.js";
import { renderBarcodeResult, renderBarcodeErrorCanvas } from "./barcode.js";
import { ensureWebFonts } from "./web-fonts.js";

export const DEFAULT_FONT_FAMILY = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';

/**
 * 對單一 template + 單筆資料做完整渲染，回傳 { canvas, widthDots, heightDots, widthMm, heightMm, dpi }。
 * options: { paperWidthId, profile, mode: "screen"|"thermal", thresholdLevel, fontFamily, assets }
 * profile：選填，有值時用它取代依 project.printerProfile.id 查註冊表的結果，
 * 給呼叫端套用「可列印點數」覆寫過的 profile（見 printer-profiles.js withPrintableDotsOverrides）。
 *
 * 熱感模式下的網點深淺處理是「按元素類型路由」而非整張畫布套用同一種抖色：相片（image）
 * 元素本身用 Floyd–Steinberg 誤差擴散（較接近真實灰階觀感），其餘一律是純黑向量或已經是
 * 純黑白的條碼／QR，套用同一種抖色反而會讓邊緣模糊、字變糊，所以最後對整張畫布只做單純
 * threshold（把 anti-alias 邊緣二值化），已經 dither 過的相片區塊本身就是 0/255，threshold
 * 對它們是 no-op，不會被二次破壞。
 */
export async function renderTemplate(project, data = {}, options = {}) {
    const profile = options.profile || getPrinterProfile(project.printerProfile.id);
    const paper = getPaperWidth(profile, options.paperWidthId || project.paper.widthId);
    const mergedElements = applyDataToElements(project.template.elements, data);
    const assetMap = options.assets instanceof Map ? options.assets : buildAssetMap(project.assets);

    return renderElements(mergedElements, {
        widthDots: paper.printableWidthDots,
        dpi: profile.dpi.x,
        assets: assetMap,
        fontFamily: options.fontFamily || DEFAULT_FONT_FAMILY,
        mode: options.mode || "screen",
        thresholdLevel: options.thresholdLevel,
    });
}

/** Mail merge：同一個 template 套用多筆資料，回傳每筆對應的渲染結果陣列。 */
export async function renderBatch(project, dataArray = [{}], options = {}) {
    const results = [];
    for (const data of dataArray) {
        results.push(await renderTemplate(project, data, options));
    }
    return results;
}

/**
 * 多頁版型（project.template.pages）依序渲染，回傳每一頁對應的渲染結果陣列（順序＝列印順序）。
 * renderTemplate() 是既有的公開單頁 API（其他專案可能直接 import 使用），行為與參數維持不變；
 * 這個函式是給多頁列印流程（見 printer-settings.js printCurrent／printSilently）用的新入口，
 * 呼叫慣例（data／options）比照 renderTemplate，只是改吃 project.template.pages 而不是
 * project.template.elements。舊檔／只有一頁的專案，schema.js migrate() 已經統一補成
 * 單一隱含頁，這裡不需要另外相容處理。
 */
export async function renderPages(project, data = {}, options = {}) {
    const profile = options.profile || getPrinterProfile(project.printerProfile.id);
    const paper = getPaperWidth(profile, options.paperWidthId || project.paper.widthId);
    const assetMap = options.assets instanceof Map ? options.assets : buildAssetMap(project.assets);
    const pages = project.template?.pages || [];

    const results = [];
    for (const page of pages) {
        const mergedElements = applyDataToElements(page.elements, data);
        const result = await renderElements(mergedElements, {
            widthDots: paper.printableWidthDots,
            dpi: profile.dpi.x,
            assets: assetMap,
            fontFamily: options.fontFamily || DEFAULT_FONT_FAMILY,
            mode: options.mode || "screen",
            thresholdLevel: options.thresholdLevel,
        });
        results.push({ ...result, page });
    }
    return results;
}

export const MAX_CANVAS_HEIGHT = 65535;

/** 較底層的入口：直接給一段已經套用完資料的 element tree 進行排版與繪製。 */
export async function renderElements(elements, {
    widthDots,
    dpi,
    assets,
    fontFamily = DEFAULT_FONT_FAMILY,
    mode = "screen",
    thresholdLevel = 128,
} = {}) {
    const assetMap = assets instanceof Map ? assets : new Map(Object.entries(assets || {}));
    const fontFallbacks = await ensureWebFonts(elements, fontFamily); // 網頁字體要先載好才量得準；載入失敗的字體名稱一併回報

    const measureCanvas = document.createElement("canvas");
    measureCanvas.width = Math.max(widthDots, 1);
    measureCanvas.height = 10;
    const measureCtx = measureCanvas.getContext("2d");

    const assetCtx = { map: assetMap, failures: new Set() }; // 每次渲染各一份，批次共用同一個 Map 時失敗清單也不會互相累積
    const { items, height } = await layoutColumn(elements, widthDots, measureCtx, fontFamily, assetCtx, mode === "screen");

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(widthDots, 1);
    // 瀏覽器 canvas 超過 65535 點高會整張變空白（熱感模式再被二值化成全黑），也超過 ESC/POS raster 上限，所以截在這裡
    canvas.height = Math.min(Math.max(height, 1), MAX_CANVAS_HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    paint(items, ctx, 0, 0, fontFamily, mode);

    if (mode === "thermal") {
        applyThermalSimulation(ctx, canvas.width, canvas.height, "threshold", thresholdLevel);
    }

    return {
        canvas,
        widthDots: canvas.width,
        heightDots: canvas.height,
        dpi,
        widthMm: dotsToMm(canvas.width, dpi),
        heightMm: dotsToMm(canvas.height, dpi),
        truncated: height > MAX_CANVAS_HEIGHT, // 內容超過最大高度、超出部分被截掉
        imageFailures: [...assetCtx.failures], // 被拒絕（非 https）或載入失敗而略過的圖片網址（已去重）
        fontFallbacks, // 載入失敗、實際改用系統字體的網頁字體名稱（沒有失敗就是空陣列）
        items, // 排版結果樹（每個 item 帶 el/y/height/widthDots，row 另有 columns），供編輯器畫面上疊加可拖曳的元素外框使用
    };
}

function buildAssetMap(assets = []) {
    const map = new Map();
    for (const a of assets) map.set(a.id, a.dataUrl);
    return map;
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeRotation(rotation) {
    const r = ((rotation || 0) % 360 + 360) % 360;
    return r === 90 || r === 180 || r === 270 ? r : 0;
}

// 依旋轉角度與 cropRect 算出「顯示內容」的寬高比例（都是 rotation 之後、crop 之前 naturalWidth/Height
// 的座標系），供 layoutColumn 算 drawHeight（等比縮放）與 paintImage 算裁切窗格共用。
function measureImageContent(el, img) {
    if (!img) return { rotatedWidth: 0, rotatedHeight: 0, contentWidth: 0, contentHeight: 0 };
    const rotation = normalizeRotation(el.rotation);
    const swapped = rotation === 90 || rotation === 270;
    const rotatedWidth = swapped ? img.naturalHeight : img.naturalWidth;
    const rotatedHeight = swapped ? img.naturalWidth : img.naturalHeight;
    const cr = el.cropRect || { x: 0, y: 0, w: 1, h: 1 };
    return {
        rotatedWidth,
        rotatedHeight,
        contentWidth: rotatedWidth * cr.w,
        contentHeight: rotatedHeight * cr.h,
    };
}

// ---- 排版（measure pass）----

async function layoutColumn(elements, widthDots, ctx, fontFamily, assetCtx, showBarcodeErrors) {
    const items = [];
    let y = 0;
    for (const el of elements) {
        if (el.type === "text") {
            // widthMode "fixed"：文字框寬度可小於欄寬（比照圖片 widthPercent／widthDots 覆寫繪製寬度），
            // 換行、置中/靠右錨點都改用這個框寬；align 同時兼作「框在欄內的水平位置」（同圖片 align 的雙重用途）。
            const boxWidth = resolveTextWidthMode(el) === "fixed" ? Math.max(1, Math.min(widthDots, el.widthDots)) : widthDots;
            const { lines, totalHeight, vertical } = layoutText(el, boxWidth, ctx, fontFamily);
            // heightMode "fixed"：grow＝heightDots 當最小高度（內容較高時照樣完整顯示、自動變高）；
            // clip＝固定 heightDots，超出內容在 paintText／paintVerticalText 用 ctx.clip() 真的裁掉，不只是視覺提示。
            const heightMode = resolveTextHeightMode(el);
            const clip = heightMode === "fixed" && resolveTextOverflow(el) === "clip";
            const height = heightMode === "fixed" ? (clip ? el.heightDots : Math.max(el.heightDots, totalHeight)) : totalHeight;
            const clipHeight = clip ? el.heightDots : null;
            const clipped = clip && totalHeight > el.heightDots; // 供編輯疊層畫裁切提示用
            items.push({ el, y, height, widthDots, boxWidth, contentHeight: totalHeight, clipHeight, clipped, lines, vertical });
            y += height;
        } else if (el.type === "float-block") {
            const item = await layoutFloatBlock(el, widthDots, ctx, fontFamily, assetCtx);
            items.push({ el, y, widthDots, ...item });
            y += item.height;
        } else if (el.type === "spacer") {
            items.push({ el, y, height: el.heightDots, widthDots });
            y += el.heightDots;
        } else if (el.type === "divider") {
            const height = el.thicknessDots + el.marginTopDots + el.marginBottomDots;
            items.push({ el, y, height, widthDots });
            y += height;
        } else if (el.type === "image") {
            const img = await resolveImage(el, assetCtx);
            const { contentWidth, contentHeight } = measureImageContent(el, img);
            const fit = resolveImageFit(el);
            const widthPercent = clampNumber(el.widthPercent ?? 100, 1, 100);
            // 原尺寸：內容寬度就是繪製寬度（超過欄寬才縮小），不看 widthPercent
            const drawWidth = fit === "none" ? Math.min(widthDots, Math.max(1, Math.round(contentWidth))) : Math.round((widthDots * widthPercent) / 100);
            const drawHeight = fit === "stretch" && el.heightDots > 0
                ? el.heightDots
                : (contentWidth > 0 ? Math.round((drawWidth * contentHeight) / contentWidth) : 0);
            items.push({ el, y, height: drawHeight, widthDots, img, drawWidth, drawHeight });
            y += drawHeight;
        } else if (el.type === "barcode") {
            const result = renderBarcodeResult(el, widthDots);
            // 產生不出來（內容空白／不合格式／紙寬放不下）時，只有 screen 預覽畫佔位框；thermal（列印、PDF 都是這個模式）維持不佔高度
            const barcodeCanvas = result.canvas || (result.error && showBarcodeErrors ? renderBarcodeErrorCanvas(result.error, widthDots) : null);
            const drawWidth = barcodeCanvas ? barcodeCanvas.width : 0;
            const drawHeight = barcodeCanvas ? barcodeCanvas.height : 0;
            items.push({ el, y, height: drawHeight, widthDots, barcodeCanvas, barcodeError: result.error, drawWidth, drawHeight });
            y += drawHeight;
        } else if (el.type === "row") {
            const { widths: colWidths, gap: colGap } = splitRowColumns(widthDots, el.ratio, el.gap);
            const columns = [];
            let rowHeight = 0;
            let xOffset = 0;
            for (let i = 0; i < el.columns.length; i++) {
                const sub = await layoutColumn(el.columns[i], colWidths[i], ctx, fontFamily, assetCtx, showBarcodeErrors);
                columns.push({ x: xOffset, width: colWidths[i], items: sub.items });
                rowHeight = Math.max(rowHeight, sub.height);
                xOffset += colWidths[i] + colGap;
            }
            items.push({ el, y, height: rowHeight, widthDots, columns });
            y += rowHeight;
        } else if (el.type === "group") {
            const sub = await layoutColumn(el.children, widthDots, ctx, fontFamily, assetCtx, showBarcodeErrors);
            items.push({ el, y, height: sub.height, widthDots, children: sub.items });
            y += sub.height;
        }
    }
    return { items, height: y };
}

// ---- Rich text：一個文字元素的內容是多個 run，各自可覆寫字體／字級／粗體／
// 斜體／底線／刪除線（比照 Figma）。排版時把 runs 展開成「字元＋樣式」的
// glyph 串流，用跟舊版相同的逐字貪婪換行邏輯決定斷行，斷行後再依樣式相同與否
// 合併成 segment 供繪製，同一行內若有不同字級，行高取該行最大字級換算。

function resolveRunStyle(el, run, fallbackFontFamily) {
    return {
        fontFamily: run.fontFamily || el.fontFamily || fallbackFontFamily,
        fontSize: run.fontSize || el.fontSize,
        bold: run.bold ?? el.bold ?? false,
        italic: run.italic ?? false,
        underline: run.underline ?? false,
        strikethrough: run.strikethrough ?? false,
        inverse: run.inverse ?? false,
    };
}

function fontString(style) {
    return `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${style.fontSize}px ${style.fontFamily}`;
}

function stylesEqual(a, b) {
    return a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.bold === b.bold
        && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough
        && a.inverse === b.inverse;
}

/** 把 el.runs 展開成 [[{ch, style}, ...], ...] 段落陣列（在 "\n" 處切段落，run 邊界不影響斷段）。 */
function buildParagraphs(el, fallbackFontFamily) {
    const paragraphs = [[]];
    for (const run of el.runs || []) {
        const style = resolveRunStyle(el, run, fallbackFontFamily);
        for (const ch of String(run.text ?? "")) {
            if (ch === "\n") paragraphs.push([]);
            else paragraphs[paragraphs.length - 1].push({ ch, style });
        }
    }
    return paragraphs;
}

/** 把一串 glyph 依「樣式是否相同」合併成連續文字段落，繪製／量寬都以 segment 為單位。 */
function coalesceSegments(glyphs) {
    const segments = [];
    let i = 0;
    while (i < glyphs.length) {
        let j = i + 1;
        while (j < glyphs.length && stylesEqual(glyphs[j].style, glyphs[i].style)) j++;
        segments.push({ text: glyphs.slice(i, j).map((g) => g.ch).join(""), style: glyphs[i].style });
        i = j;
    }
    return segments;
}

function measureGlyphs(glyphs, ctx) {
    let width = 0;
    for (const seg of coalesceSegments(glyphs)) {
        ctx.font = fontString(seg.style);
        width += ctx.measureText(seg.text).width;
    }
    return width;
}

// 以字元為單位貪婪換行（同時適用中日韓字元與西文，西文長單字可能被截斷）。
function wrapParagraphGlyphs(glyphs, maxWidth, ctx) {
    if (glyphs.length === 0) return [[]];
    const lines = [];
    let current = [];
    for (const g of glyphs) {
        const test = current.concat([g]);
        if (current.length > 0 && measureGlyphs(test, ctx) > maxWidth) {
            lines.push(current);
            current = [g];
        } else {
            current = test;
        }
    }
    if (current.length) lines.push(current);
    return lines;
}

function truncateGlyphLine(glyphs, maxWidth, ctx, fallbackStyle) {
    if (measureGlyphs(glyphs, ctx) <= maxWidth) return glyphs;
    const ellipsisStyle = glyphs.length ? glyphs[glyphs.length - 1].style : fallbackStyle;
    let result = glyphs.slice();
    while (result.length > 0 && measureGlyphs(result.concat([{ ch: "…", style: ellipsisStyle }]), ctx) > maxWidth) {
        result = result.slice(0, -1);
    }
    return result.concat([{ ch: "…", style: ellipsisStyle }]);
}

function layoutText(el, widthDots, ctx, fallbackFontFamily) {
    if (el.writingMode === "vertical") return layoutVerticalText(el, ctx, fallbackFontFamily);
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${el.letterSpacing || 0}px`;

    const paragraphs = buildParagraphs(el, fallbackFontFamily);
    let lineGlyphsList = [];
    for (const para of paragraphs) {
        if (el.wrap) lineGlyphsList.push(...wrapParagraphGlyphs(para, widthDots, ctx));
        else lineGlyphsList.push(para);
    }

    if (el.maxLines > 0 && lineGlyphsList.length > el.maxLines) {
        lineGlyphsList = lineGlyphsList.slice(0, el.maxLines);
        const fallbackStyle = resolveRunStyle(el, {}, fallbackFontFamily);
        const lastIdx = lineGlyphsList.length - 1;
        lineGlyphsList[lastIdx] = truncateGlyphLine(lineGlyphsList[lastIdx], widthDots, ctx, fallbackStyle);
    }

    const lines = lineGlyphsList.map((glyphs) => {
        const segments = coalesceSegments(glyphs);
        let width = 0;
        let maxFontSize = el.fontSize;
        for (const g of glyphs) maxFontSize = Math.max(maxFontSize, g.style.fontSize);
        for (const seg of segments) {
            ctx.font = fontString(seg.style);
            width += ctx.measureText(seg.text).width;
        }
        const lineHeightDots = Math.round(maxFontSize * (el.lineHeight || 1.3));
        return { segments, width, lineHeightDots };
    });

    const totalHeight = lines.reduce((sum, line) => sum + line.lineHeightDots, 0);
    return { lines, totalHeight };
}

// ---- 圖文段落：圖片靠左／右浮動，文字逐行依「該行頂端是否還在圖片高度內」決定可用寬度 ----

/**
 * 圖文段落在垂直位置 y 的一行可用範圍（相對元素左緣）。
 * 行頂端在圖片高度內就扣掉「圖寬＋間距」（圖在左邊時行首右移），過了圖片高度回到整欄寬。
 */
export function floatLineBox({ side, y, imageWidth, imageHeight, columnWidth, gap = FLOAT_GAP_DOTS }) {
    if (imageHeight > 0 && y < imageHeight) {
        const shift = imageWidth + gap;
        return { x: side === "right" ? 0 : shift, width: Math.max(0, columnWidth - shift) };
    }
    return { x: 0, width: columnWidth };
}

async function layoutFloatBlock(el, columnWidth, ctx, fontFamily, assetCtx) {
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${el.letterSpacing || 0}px`;
    const img = await resolveImage(el, assetCtx);
    const { contentWidth, contentHeight } = measureImageContent(el, img);
    const drawWidth = Math.round((columnWidth * clampNumber(el.widthPercent ?? 40, 1, 100)) / 100);
    const drawHeight = contentWidth > 0 ? Math.round((drawWidth * contentHeight) / contentWidth) : 0;
    const side = el.imageSide === "right" ? "right" : "left";
    const boxAt = (y) => {
        const box = floatLineBox({ side, y, imageWidth: drawWidth, imageHeight: drawHeight, columnWidth });
        // 圖片幾乎佔滿整欄，旁邊放不下一個字：這一行改排到圖片下方
        if (box.width < el.fontSize && y < drawHeight) return { x: 0, width: columnWidth, skip: drawHeight - y };
        return { ...box, skip: 0 };
    };

    const paragraphs = buildParagraphs(el, fontFamily);
    let y = 0;
    let lines = [];
    const flush = (glyphs, box) => {
        const segments = coalesceSegments(glyphs);
        let width = 0;
        let maxFontSize = el.fontSize;
        for (const g of glyphs) maxFontSize = Math.max(maxFontSize, g.style.fontSize);
        for (const seg of segments) {
            ctx.font = fontString(seg.style);
            width += ctx.measureText(seg.text).width;
        }
        const lineHeightDots = Math.round(maxFontSize * (el.lineHeight || 1.3));
        lines.push({ segments, width, lineHeightDots, offsetX: box.x, availWidth: box.width, skipBefore: box.skip, glyphs });
        y += box.skip + lineHeightDots;
    };
    for (const para of paragraphs) {
        let box = boxAt(y);
        let current = [];
        for (const g of para) {
            if (el.wrap && current.length > 0 && measureGlyphs(current.concat([g]), ctx) > box.width) {
                flush(current, box);
                box = boxAt(y);
                current = [g];
            } else {
                current.push(g);
            }
        }
        flush(current, box);
    }

    if (el.maxLines > 0 && lines.length > el.maxLines) {
        lines = lines.slice(0, el.maxLines);
        const last = lines[lines.length - 1];
        const fallbackStyle = resolveRunStyle(el, {}, fontFamily);
        const cut = truncateGlyphLine(last.glyphs, last.availWidth, ctx, fallbackStyle);
        const segments = coalesceSegments(cut);
        last.segments = segments;
        last.width = measureGlyphs(cut, ctx);
    }
    const textHeight = lines.reduce((sum, line) => sum + line.skipBefore + line.lineHeightDots, 0);
    return { lines, img, drawWidth, drawHeight, side, height: Math.max(textHeight, drawHeight) };
}

// ---- 直書：字元由上而下、行由右而左 ----
// 每個段落（換行字元分隔）就是一直行，不自動換行（沒有高度上限可以換）。
// 西文／數字：連續 3 個以上的 ASCII 當一整塊順時針轉 90°（單字、網址、金額都維持可讀且不佔太多行高），
// 1–2 個字元則維持正立疊放（避免「5」「A」這類單字被轉倒）。全形標點在台灣直排習慣置中，不另外位移；
// 括號、破折號、刪節號、長音符轉 90° 才會呈現直書字形（不依賴字型有沒有 vert／直排標點碼位）。
const VERTICAL_ROTATED_CHARS = new Set("「」『』（）()｛｝{}［］[]【】《》〈〉〔〕—―─…‥～〜ー");

function isAsciiInk(ch) {
    return ch > " " && ch <= "~";
}

function buildVerticalCells(glyphs, ctx, letterSpacing) {
    const cells = [];
    let i = 0;
    while (i < glyphs.length) {
        const { ch, style } = glyphs[i];
        ctx.font = fontString(style);
        if (isAsciiInk(ch)) {
            let j = i;
            while (j < glyphs.length && isAsciiInk(glyphs[j].ch) && stylesEqual(glyphs[j].style, style)) j++;
            const run = glyphs.slice(i, j);
            if (run.length >= 3) {
                const text = run.map((g) => g.ch).join("");
                cells.push({ text, style, rotated: true, advance: ctx.measureText(text).width + letterSpacing * run.length });
            } else {
                for (const g of run) cells.push({ text: g.ch, style, rotated: false, advance: Math.max(ctx.measureText(g.ch).width, style.fontSize * 0.55) + letterSpacing });
            }
            i = j;
        } else if (ch === " ") {
            cells.push({ text: "", style, rotated: false, advance: style.fontSize * 0.5 + letterSpacing });
            i++;
        } else {
            cells.push({ text: ch, style, rotated: VERTICAL_ROTATED_CHARS.has(ch), advance: style.fontSize + letterSpacing });
            i++;
        }
    }
    return cells;
}

function layoutVerticalText(el, ctx, fallbackFontFamily) {
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    const spacing = el.letterSpacing || 0;
    const columns = buildParagraphs(el, fallbackFontFamily).map((glyphs) => {
        const cells = buildVerticalCells(glyphs, ctx, spacing);
        let maxFontSize = el.fontSize;
        for (const g of glyphs) maxFontSize = Math.max(maxFontSize, g.style.fontSize);
        return {
            cells,
            width: Math.round(maxFontSize * (el.lineHeight || 1.3)),
            height: Math.round(cells.reduce((sum, c) => sum + c.advance, 0)),
        };
    });
    const minHeight = Math.round(el.fontSize * (el.lineHeight || 1.3));
    const totalHeight = Math.max(minHeight, ...columns.map((c) => c.height));
    return { lines: [], totalHeight, vertical: { columns } };
}

function paintVerticalText(ctx, item, x, y, widthOverride) {
    const { el, height, vertical } = item;
    const widthDots = widthOverride ?? item.widthDots; // widthMode "fixed" 時傳入較窄的框寬，只影響對齊錨點（直書換行本來就不吃欄寬）
    const total = vertical.columns.reduce((sum, c) => sum + c.width, 0);
    const right = el.align === "right" ? x + widthDots : el.align === "center" ? x + (widthDots + total) / 2 : x + total;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, widthDots, height);
    ctx.clip();
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    if (el.inverse) {
        ctx.fillStyle = "#000";
        ctx.fillRect(right - total, y, total, height);
    }
    let colRight = right;
    for (const col of vertical.columns) {
        const cx = colRight - col.width / 2;
        let cellY = y;
        for (const cell of col.cells) {
            const { style } = cell;
            const inverse = !!el.inverse !== style.inverse;
            if (style.inverse) {
                ctx.fillStyle = inverse ? "#000" : "#fff";
                ctx.fillRect(cx - col.width / 2, cellY, col.width, cell.advance);
            }
            const ink = inverse ? "#fff" : "#000";
            ctx.fillStyle = ink;
            ctx.font = fontString(style);
            if (cell.text) {
                if (cell.rotated) {
                    ctx.save();
                    ctx.translate(cx + style.fontSize / 2, cellY);
                    ctx.rotate(Math.PI / 2);
                    ctx.fillText(cell.text, 0, 0);
                    ctx.restore();
                } else {
                    ctx.textAlign = "center";
                    ctx.fillText(cell.text, cx, cellY);
                    ctx.textAlign = "left";
                }
            }
            if (style.underline || style.strikethrough) {
                ctx.strokeStyle = ink;
                ctx.lineWidth = Math.max(1, Math.round(style.fontSize / 16));
                ctx.beginPath();
                if (style.underline) {
                    ctx.moveTo(cx + style.fontSize * 0.5, cellY);
                    ctx.lineTo(cx + style.fontSize * 0.5, cellY + cell.advance);
                }
                if (style.strikethrough) {
                    ctx.moveTo(cx, cellY);
                    ctx.lineTo(cx, cellY + cell.advance);
                }
                ctx.stroke();
            }
            cellY += cell.advance;
        }
        colRight -= col.width;
    }
    ctx.restore();
}

const IMAGE_LOAD_TIMEOUT_MS = 10000;

// 批次資料的圖片欄位可以是網址：只收 https（http、javascript:、file: 等一律無效），
// 並以 crossOrigin 載入避免畫布受污染；失敗只略過該張，記進 failures 讓預覽與輸出提示
async function resolveImage(el, assetCtx) {
    const ref = el.assetId;
    if (!ref) return null;
    if (/^data:/i.test(ref)) return loadImage(ref);
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
        const img = /^https:\/\//i.test(ref) ? await loadImage(ref, true) : null;
        if (!img) assetCtx.failures.add(ref);
        return img;
    }
    const src = assetCtx.map.get(ref);
    return src ? loadImage(src) : null;
}

function loadImage(src, crossOrigin = false) {
    return new Promise((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => finish(null), IMAGE_LOAD_TIMEOUT_MS);
        function finish(result) {
            clearTimeout(timer);
            img.onload = img.onerror = null;
            if (!result) img.src = ""; // 失敗或逾時就中止載入
            resolve(result); // 單張圖片載入失敗不應讓整份輸出失敗
        }
        img.onload = () => finish(img);
        img.onerror = () => finish(null);
        if (crossOrigin) img.crossOrigin = "anonymous";
        img.src = src;
    });
}

// ---- 繪製（paint pass）----

function paint(items, ctx, xBase, yBase, fontFamily, mode) {
    for (const item of items) {
        const absY = yBase + item.y;
        const { el } = item;
        if (el.type === "text") paintText(ctx, item, xBase, absY);
        else if (el.type === "divider") paintDivider(ctx, item, xBase, absY);
        else if (el.type === "float-block") paintFloatBlock(ctx, item, xBase, absY, mode);
        else if (el.type === "image") paintImage(ctx, item, xBase, absY, mode);
        else if (el.type === "barcode") paintBarcode(ctx, item, xBase, absY);
        else if (el.type === "row") {
            for (const col of item.columns) paint(col.items, ctx, xBase + col.x, absY, fontFamily, mode);
        } else if (el.type === "group") paint(item.children, ctx, xBase, absY, fontFamily, mode);
    }
}

function paintFloatBlock(ctx, item, x, y, mode) {
    const { el, widthDots, drawWidth } = item;
    const imageX = item.side === "right" ? x + widthDots - drawWidth : x;
    paintImage(ctx, { ...item, el: { ...el, align: "left" } }, imageX, y, mode);
    paintText(ctx, item, x, y);
}

function paintText(ctx, item, x, y) {
    const { el, widthDots, boxWidth, clipHeight } = item;
    // widthMode "fixed" 時 boxWidth < widthDots（欄寬）：align 兼作框在欄內的水平位置（同圖片 align 雙重用途），
    // "left" 框貼欄左緣、"right" 貼欄右緣、"center" 置中；boxWidth 未設（一般 text／float-block 內文）退回整欄寬、boxX=0，行為不變。
    const effWidth = boxWidth ?? widthDots;
    const boxX = el.align === "center" ? (widthDots - effWidth) / 2 : el.align === "right" ? (widthDots - effWidth) : 0;
    if (item.vertical) return paintVerticalText(ctx, item, x + boxX, y, effWidth);
    const { lines } = item;
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.textBaseline = "top";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${el.letterSpacing || 0}px`;
    // heightMode "fixed" + overflow "clip"：真的裁掉框外內容（不是畫面提示），比照 paintVerticalText 既有的 ctx.clip() 手法
    if (clipHeight != null) {
        ctx.beginPath();
        ctx.rect(x + boxX, y, effWidth, clipHeight);
        ctx.clip();
    }
    let lineY = y;
    for (const line of lines) {
        // 圖文段落的行帶有 offsetX／availWidth／skipBefore，純文字沒有這些欄位、行為不變
        lineY += line.skipBefore || 0;
        const lineX = x + boxX + (line.offsetX || 0);
        const lineW = line.availWidth ?? effWidth;
        if (el.inverse) {
            ctx.fillStyle = "#000";
            ctx.fillRect(lineX, lineY, lineW, line.lineHeightDots);
        }
        let cursorX = lineX;
        if (el.align === "center" || el.align === "right") {
            cursorX = el.align === "center" ? lineX + (lineW - line.width) / 2 : lineX + (lineW - line.width);
        }
        for (const seg of line.segments) {
            ctx.font = fontString(seg.style);
            const segWidth = ctx.measureText(seg.text).width;
            // 局部反白與整行反白相抵：整行黑底上的反白段變回白底黑字
            const segInverse = !!el.inverse !== seg.style.inverse;
            const inkColor = segInverse ? "#fff" : "#000";
            if (seg.style.inverse) {
                ctx.fillStyle = segInverse ? "#000" : "#fff";
                ctx.fillRect(cursorX, lineY, segWidth, line.lineHeightDots);
            }
            ctx.fillStyle = inkColor;
            ctx.fillText(seg.text, cursorX, lineY);
            if (seg.style.underline || seg.style.strikethrough) {
                ctx.save();
                ctx.strokeStyle = inkColor;
                ctx.lineWidth = Math.max(1, Math.round(seg.style.fontSize / 16));
                ctx.beginPath();
                if (seg.style.underline) {
                    const underlineY = lineY + seg.style.fontSize * 0.92;
                    ctx.moveTo(cursorX, underlineY);
                    ctx.lineTo(cursorX + segWidth, underlineY);
                }
                if (seg.style.strikethrough) {
                    const strikeY = lineY + seg.style.fontSize * 0.55;
                    ctx.moveTo(cursorX, strikeY);
                    ctx.lineTo(cursorX + segWidth, strikeY);
                }
                ctx.stroke();
                ctx.restore();
            }
            cursorX += segWidth;
        }
        lineY += line.lineHeightDots;
    }
    ctx.restore();
}

function paintDivider(ctx, item, x, y) {
    const { el, widthDots } = item;
    const lineY = y + el.marginTopDots + el.thicknessDots / 2;
    ctx.save();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = el.thicknessDots;
    if (el.style === "dashed") ctx.setLineDash([el.thicknessDots * 3, el.thicknessDots * 2]);
    else if (el.style === "dotted") ctx.setLineDash([el.thicknessDots, el.thicknessDots * 2]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, lineY);
    ctx.lineTo(x + widthDots, lineY);
    ctx.stroke();
    ctx.restore();
}

function paintImage(ctx, item, x, y, mode) {
    if (!item.img) return;
    const { drawWidth, drawHeight, el, widthDots } = item;
    const w = Math.max(1, Math.round(drawWidth));
    const h = Math.max(1, Math.round(drawHeight));

    // 亮度／對比／反相一律先在離屏 canvas 用 filter 套用（螢幕、熱感模式都看得到同樣的
    // 色調調整），熱感模式再多一步灰階＋依 ditherMode 轉成 1-bit 網點；不縮放、原尺寸
    // 貼回主畫布，避免合成時 resample 又產生灰階邊緣。
    const temp = document.createElement("canvas");
    temp.width = w;
    temp.height = h;
    const tctx = temp.getContext("2d");
    tctx.filter = buildImageFilter(el);
    drawCroppedRotatedImage(tctx, item.img, el, w, h);
    tctx.filter = "none";

    if (mode === "thermal") {
        const imageData = tctx.getImageData(0, 0, w, h);
        toGrayscale(imageData);
        applyDither(imageData, el.ditherMode || "floyd-steinberg", el.thresholdLevel ?? 128);
        tctx.putImageData(imageData, 0, 0);
    }
    let drawX = x;
    if (el.align === "center") drawX = x + (widthDots - drawWidth) / 2;
    else if (el.align === "right") drawX = x + (widthDots - drawWidth);
    ctx.drawImage(temp, drawX, y, drawWidth, drawHeight);
}

// 把來源圖片依 rotation 旋轉、依 cropRect（旋轉後座標系，0-1 正規化）取窗格，縮放畫進
// 目的地 tctx 的 (0,0,w,h)。cropRect 為 null 時視為整張旋轉後的圖片（不裁切）。
function drawCroppedRotatedImage(tctx, img, el, w, h) {
    const rotation = normalizeRotation(el.rotation);
    const { rotatedWidth, rotatedHeight } = measureImageContent(el, img);
    if (rotatedWidth <= 0 || rotatedHeight <= 0) return;
    const cr = el.cropRect || { x: 0, y: 0, w: 1, h: 1 };
    const cropX = cr.x * rotatedWidth;
    const cropY = cr.y * rotatedHeight;
    const cropW = Math.max(1e-6, cr.w * rotatedWidth);
    const cropH = Math.max(1e-6, cr.h * rotatedHeight);
    const scaleX = w / cropW;
    const scaleY = h / cropH;

    tctx.save();
    tctx.translate(-cropX * scaleX, -cropY * scaleY);
    tctx.scale(scaleX, scaleY);
    tctx.translate(rotatedWidth / 2, rotatedHeight / 2);
    tctx.rotate((rotation * Math.PI) / 180);
    tctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2, img.naturalWidth, img.naturalHeight);
    tctx.restore();
}

function buildImageFilter(el) {
    const brightness = 100 + (el.brightness || 0);
    const contrast = 100 + (el.contrast || 0);
    const invert = el.invert ? 1 : 0;
    return `brightness(${brightness}%) contrast(${contrast}%) invert(${invert})`;
}

function paintBarcode(ctx, item, x, y) {
    if (!item.barcodeCanvas) return;
    const { el, widthDots, drawWidth, drawHeight } = item;
    let drawX = x;
    if (el.align === "center") drawX = x + Math.round((widthDots - drawWidth) / 2); // 整數 dot 對齊，條碼線寬才不會被抗鋸齒吃掉
    else if (el.align === "right") drawX = x + (widthDots - drawWidth);
    ctx.drawImage(item.barcodeCanvas, drawX, y, drawWidth, drawHeight);
}
