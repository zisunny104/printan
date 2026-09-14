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
import { applyThermalSimulation } from "./dithering.js";

const DEFAULT_FONT_FAMILY = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';

/**
 * 對單一 template + 單筆資料做完整渲染，回傳 { canvas, widthDots, heightDots, widthMm, heightMm, dpi }。
 * options: { paperWidthId, mode: "screen"|"thermal", ditherMode: "threshold"|"floyd-steinberg", thresholdLevel, fontFamily, assets }
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
        ditherMode: options.ditherMode || "floyd-steinberg",
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
    ditherMode = "floyd-steinberg",
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
    paint(items, ctx, 0, 0, fontFamily);

    if (mode === "thermal") {
        applyThermalSimulation(ctx, canvas.width, canvas.height, ditherMode, thresholdLevel);
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
            const { lines, lineHeightDots } = layoutText(el, widthDots, ctx, fontFamily);
            const height = lines.length * lineHeightDots;
            items.push({ el, y, height, widthDots, lines, lineHeightDots });
            y += height;
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

function layoutText(el, widthDots, ctx, fontFamily) {
    ctx.font = `${el.bold ? "bold " : ""}${el.fontSize}px ${fontFamily}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${el.letterSpacing || 0}px`;

    const paragraphs = String(el.text ?? "").split("\n");
    let lines = [];
    if (el.wrap) {
        for (const para of paragraphs) lines.push(...wrapParagraph(para, widthDots, ctx));
    } else {
        lines = paragraphs;
    }
    if (el.maxLines > 0 && lines.length > el.maxLines) {
        lines = lines.slice(0, el.maxLines);
        lines[lines.length - 1] = truncateWithEllipsis(lines[lines.length - 1], widthDots, ctx);
    }
    const lineHeightDots = Math.round(el.fontSize * (el.lineHeight || 1.3));
    return { lines, lineHeightDots };
}

// 以字元為單位貪婪換行（同時適用中日韓字元與西文，西文長單字可能被截斷，
// 屬於第一階段的已知限制）。
function wrapParagraph(text, maxWidth, ctx) {
    if (text === "") return [""];
    const lines = [];
    let current = "";
    for (const ch of text) {
        const test = current + ch;
        if (current !== "" && ctx.measureText(test).width > maxWidth) {
            lines.push(current);
            current = ch;
        } else {
            current = test;
        }
    }
    if (current) lines.push(current);
    return lines;
}

function truncateWithEllipsis(line, maxWidth, ctx) {
    const ellipsis = "…";
    if (ctx.measureText(line).width <= maxWidth) return line;
    let result = line;
    while (result.length > 0 && ctx.measureText(result + ellipsis).width > maxWidth) {
        result = result.slice(0, -1);
    }
    return result + ellipsis;
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

function paint(items, ctx, xBase, yBase, fontFamily) {
    for (const item of items) {
        const absY = yBase + item.y;
        const { el } = item;
        if (el.type === "text") paintText(ctx, item, xBase, absY, fontFamily);
        else if (el.type === "divider") paintDivider(ctx, item, xBase, absY);
        else if (el.type === "image") paintImage(ctx, item, xBase, absY);
        else if (el.type === "row") {
            for (const col of item.columns) paint(col.items, ctx, xBase + col.x, absY, fontFamily);
        }
    }
}

function paintText(ctx, item, x, y, fontFamily) {
    const { el, lines, lineHeightDots, widthDots } = item;
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.font = `${el.bold ? "bold " : ""}${el.fontSize}px ${fontFamily}`;
    ctx.textBaseline = "top";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${el.letterSpacing || 0}px`;
    lines.forEach((line, i) => {
        const lineY = y + i * lineHeightDots;
        let lineX = x;
        if (el.align === "center" || el.align === "right") {
            const w = ctx.measureText(line).width;
            lineX = el.align === "center" ? x + (widthDots - w) / 2 : x + (widthDots - w);
        }
        ctx.fillText(line, lineX, lineY);
    });
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

function paintImage(ctx, item, x, y) {
    if (!item.img) return;
    ctx.drawImage(item.img, x, y, item.drawWidth, item.drawHeight);
}
