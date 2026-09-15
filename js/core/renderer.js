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
import { dotsToMm, splitDotsByRatio } from "./units.js";
import { applyThermalSimulation, toGrayscale, applyDither } from "./dithering.js";
import { renderBarcodeCanvas } from "./barcode.js";

const DEFAULT_FONT_FAMILY = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';

/**
 * 對單一 template + 單筆資料做完整渲染，回傳 { canvas, widthDots, heightDots, widthMm, heightMm, dpi }。
 * options: { paperWidthId, mode: "screen"|"thermal", thresholdLevel, fontFamily, assets }
 *
 * 熱感模式下的網點深淺處理是「按元素類型路由」而非整張畫布套用同一種抖色：相片（image）
 * 元素本身用 Floyd–Steinberg 誤差擴散（較接近真實灰階觀感），其餘一律是純黑向量或已經是
 * 純黑白的條碼／QR，套用同一種抖色反而會讓邊緣模糊、字變糊，所以最後對整張畫布只做單純
 * threshold（把 anti-alias 邊緣二值化），已經 dither 過的相片區塊本身就是 0/255，threshold
 * 對它們是 no-op，不會被二次破壞。
 */
export async function renderTemplate(project, data = {}, options = {}) {
    const profile = getPrinterProfile(project.printerProfile.id);
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

    const measureCanvas = document.createElement("canvas");
    measureCanvas.width = Math.max(widthDots, 1);
    measureCanvas.height = 10;
    const measureCtx = measureCanvas.getContext("2d");

    const { items, height } = await layoutColumn(elements, widthDots, measureCtx, fontFamily, assetMap);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(widthDots, 1);
    canvas.height = Math.max(height, 1);
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
        items, // 排版結果樹（每個 item 帶 el/y/height/widthDots，row 另有 columns），供編輯器畫面上疊加可拖曳的元素外框使用
    };
}

function buildAssetMap(assets = []) {
    const map = new Map();
    for (const a of assets) map.set(a.id, a.dataUrl);
    return map;
}

// ---- 排版（measure pass）----

async function layoutColumn(elements, widthDots, ctx, fontFamily, assetMap) {
    const items = [];
    let y = 0;
    for (const el of elements) {
        if (el.type === "text") {
            const { lines, totalHeight } = layoutText(el, widthDots, ctx, fontFamily);
            items.push({ el, y, height: totalHeight, widthDots, lines });
            y += totalHeight;
        } else if (el.type === "spacer") {
            items.push({ el, y, height: el.heightDots, widthDots });
            y += el.heightDots;
        } else if (el.type === "divider") {
            const height = el.thicknessDots + el.marginTopDots + el.marginBottomDots;
            items.push({ el, y, height, widthDots });
            y += height;
        } else if (el.type === "image") {
            const img = await resolveImage(el, assetMap);
            const drawWidth = widthDots;
            const drawHeight = el.heightDots > 0
                ? el.heightDots
                : (img ? Math.round(widthDots * (img.naturalHeight / img.naturalWidth)) : 0);
            items.push({ el, y, height: drawHeight, widthDots, img, drawWidth, drawHeight });
            y += drawHeight;
        } else if (el.type === "barcode") {
            const barcodeCanvas = renderBarcodeCanvas(el, widthDots);
            const drawWidth = barcodeCanvas ? barcodeCanvas.width : 0;
            const drawHeight = barcodeCanvas ? barcodeCanvas.height : 0;
            items.push({ el, y, height: drawHeight, widthDots, barcodeCanvas, drawWidth, drawHeight });
            y += drawHeight;
        } else if (el.type === "row") {
            const colWidths = splitDotsByRatio(widthDots, el.ratio);
            const columns = [];
            let rowHeight = 0;
            let xOffset = 0;
            for (let i = 0; i < el.columns.length; i++) {
                const sub = await layoutColumn(el.columns[i], colWidths[i], ctx, fontFamily, assetMap);
                columns.push({ x: xOffset, width: colWidths[i], items: sub.items });
                rowHeight = Math.max(rowHeight, sub.height);
                xOffset += colWidths[i];
            }
            items.push({ el, y, height: rowHeight, widthDots, columns });
            y += rowHeight;
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
    };
}

function fontString(style) {
    return `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${style.fontSize}px ${style.fontFamily}`;
}

function stylesEqual(a, b) {
    return a.fontFamily === b.fontFamily && a.fontSize === b.fontSize && a.bold === b.bold
        && a.italic === b.italic && a.underline === b.underline && a.strikethrough === b.strikethrough;
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

// 以字元為單位貪婪換行（同時適用中日韓字元與西文，西文長單字可能被截斷，
// 屬於第一階段的已知限制），沿用舊版邏輯，改成量測 glyph（含樣式）而非純文字。
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

async function resolveImage(el, assetMap) {
    const ref = el.assetId;
    if (!ref) return null;
    const src = /^(data:|https?:)/.test(ref) ? ref : assetMap.get(ref);
    if (!src) return null;
    return loadImage(src);
}

function loadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null); // 單張圖片載入失敗不應讓整份輸出失敗
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
        else if (el.type === "image") paintImage(ctx, item, xBase, absY, mode);
        else if (el.type === "barcode") paintBarcode(ctx, item, xBase, absY);
        else if (el.type === "row") {
            for (const col of item.columns) paint(col.items, ctx, xBase + col.x, absY, fontFamily, mode);
        }
    }
}

function paintText(ctx, item, x, y) {
    const { el, lines, widthDots } = item;
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.textBaseline = "top";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${el.letterSpacing || 0}px`;
    let lineY = y;
    for (const line of lines) {
        let cursorX = x;
        if (el.align === "center" || el.align === "right") {
            cursorX = el.align === "center" ? x + (widthDots - line.width) / 2 : x + (widthDots - line.width);
        }
        for (const seg of line.segments) {
            ctx.font = fontString(seg.style);
            const segWidth = ctx.measureText(seg.text).width;
            ctx.fillStyle = "#000";
            ctx.fillText(seg.text, cursorX, lineY);
            if (seg.style.underline || seg.style.strikethrough) {
                ctx.save();
                ctx.strokeStyle = "#000";
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
    const { drawWidth, drawHeight, el } = item;
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
    tctx.drawImage(item.img, 0, 0, w, h);
    tctx.filter = "none";

    if (mode === "thermal") {
        const imageData = tctx.getImageData(0, 0, w, h);
        toGrayscale(imageData);
        applyDither(imageData, el.ditherMode || "floyd-steinberg", el.thresholdLevel ?? 128);
        tctx.putImageData(imageData, 0, 0);
    }
    ctx.drawImage(temp, x, y, drawWidth, drawHeight);
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
    if (el.align === "center") drawX = x + (widthDots - drawWidth) / 2;
    else if (el.align === "right") drawX = x + (widthDots - drawWidth);
    ctx.drawImage(item.barcodeCanvas, drawX, y, drawWidth, drawHeight);
}
