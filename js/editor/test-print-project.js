// 測試列印：內建一份收據風版型，走專案自己的排版管線（renderTemplate），
// 上下再各接一段直接畫在 canvas 上的量測用刻度（未校正原始邊緣、校正後邊緣）。
// 尺規、色塊沒有對應的元素類型，用小 canvas 轉成圖片元素放進版型。

import { createEmptyProject } from "../core/schema.js";
import { renderTemplate, DEFAULT_FONT_FAMILY } from "../core/renderer.js";
import {
    createTextElement, createTextRun, createDividerElement, createSpacerElement,
    createImageElement, createRowElement, createBarcodeElement,
} from "../core/document-model.js";
import { dotsPerMm } from "../core/units.js";

const FONT = DEFAULT_FONT_FAMILY;

function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#000";
    return { canvas, ctx };
}

// 邊緣量尺（測試收據與邊距校正紙共用）：貼齊範圍左右的粗黑條、每 1 mm 刻度、每 5 mm 標數字、中心線。
// 回傳佔用高度。
export const EDGE_GAUGE_HEIGHT = 58;
export function drawEdgeGauge(ctx, x0, y0, widthDots, dpi) {
    const perMm = dotsPerMm(dpi);
    ctx.fillStyle = "#000";
    ctx.fillRect(x0, y0, 8, 30);
    ctx.fillRect(x0 + widthDots - 8, y0, 8, 30);
    ctx.fillRect(x0, y0, widthDots, 2);
    ctx.font = `14px ${FONT}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    for (let mm = 0; mm * perMm < widthDots; mm++) {
        const x = x0 + Math.round(mm * perMm);
        const tall = mm % 10 === 0 ? 22 : mm % 5 === 0 ? 15 : 8;
        ctx.fillRect(x, y0, 1, tall);
        if (mm % 5 === 0 && mm > 0) ctx.fillText(String(mm), x + 2, y0 + 24);
    }
    const cx = x0 + Math.floor(widthDots / 2);
    ctx.fillRect(cx, y0, 2, EDGE_GAUGE_HEIGHT);
    return EDGE_GAUGE_HEIGHT;
}

// 校正後版面的邊緣色條＋尺規＋8 階濃淡（用密度不同的點陣格）
function buildCalibratedStrip(widthDots, dpi) {
    const { canvas, ctx } = makeCanvas(widthDots, 96);
    drawEdgeGauge(ctx, 0, 0, widthDots, dpi);
    const cell = Math.floor(widthDots / 8);
    for (let i = 0; i < 8; i++) {
        const x0 = i * cell;
        for (let y = 0; y < 24; y++) {
            for (let x = 0; x < cell; x++) {
                // 每階多一成黑點，用 4×4 有序點陣決定哪些點黑
                const threshold = BAYER4[(y & 3) * 4 + (x & 3)];
                if (threshold < (i + 1) * 2) ctx.fillRect(x0 + x, 70 + y, 1, 1);
            }
        }
    }
    return canvas.toDataURL("image/png");
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function buildEndBar(widthDots) {
    const { canvas, ctx } = makeCanvas(widthDots, 40);
    ctx.fillRect(0, 0, widthDots, 40);
    return canvas.toDataURL("image/png");
}

const text = (runs, overrides = {}) => createTextElement({
    runs: (Array.isArray(runs) ? runs : [runs]).map((r) => createTextRun(typeof r === "string" ? { text: r } : r)),
    fontSize: 24,
    ...overrides,
});
const line = (left, right, overrides = {}) => {
    const row = createRowElement([1, 1]);
    row.columns[0].push(text(left, overrides));
    row.columns[1].push(text(right, { ...overrides, align: "right" }));
    return row;
};

// 品項表：名稱／數量／金額三欄，金額靠右
function itemRow(name, qty, amount, style) {
    const row = createRowElement([4, 1, 3]);
    row.columns[0].push(text({ text: name, ...style }));
    row.columns[1].push(text({ text: qty, ...style }, { align: "center" }));
    row.columns[2].push(text({ text: amount, ...style }, { align: "right" }));
    return row;
}

// 內容是這個專案自己的「收據」：品項是設計巧思與操作邏輯，金額都無價；
// 底線／刪除線／斜體／粗體各排一列，順便驗證文字樣式。
const PROJECT_NAME = "Printan 單仔";
const PROJECT_URL = "https://toka.dev/koilisu/printan";
const FALLBACK_MODEL = "TM-T82II";

function buildReceiptElements(info, model, stripUrl, endBarUrl) {
    const items = [
        itemRow("復原樹　不丟歷史", "1", "無價", { underline: true }),
        itemRow("Ctrl+滾輪連續縮放", "1", "無價", { italic: true }),
        itemRow("所見即所得", "1", "無價", { bold: true }),
        itemRow("尺規對齊白底", "1", "無價"),
        itemRow("拖曳大綱換層", "1", "無價"),
        itemRow("Claude 的 token", "很多", "算不完"),
        itemRow("Claude 思考時間", "好久", "算不完"),
        itemRow("一次講完的需求", "0", "不存在", { strikethrough: true }),
    ];

    const infoRows = info.map(([k, v]) => {
        const row = createRowElement([1, 2]);
        row.columns[0].push(text(k));
        row.columns[1].push(text(v, { align: "right" }));
        return row;
    });

    return [
        text(PROJECT_NAME, { fontSize: 32, bold: true, align: "center" }),
        text("所見即所印的收據設計工具", { align: "center" }),
        line(new Date().toLocaleString("zh-TW", { hour12: false, dateStyle: "short", timeStyle: "short" }), "#0001"),
        createDividerElement({ style: "dashed" }),
        ...items,
        createDividerElement(),
        line("設計巧思", "無價"),
        line("優惠　一點點……耐心", "無價"),
        line({ text: "合計", bold: true, fontSize: 32 }, { text: "無價", bold: true, fontSize: 32 }),
        createSpacerElement({ heightDots: 8 }),
        text("　已付款 / TEST　", { align: "center", inverse: true }),
        text([{ text: "會員 " }, { text: " ★ VIP ★ ", inverse: true }, { text: " 優惠" }], { align: "center" }),
        text("中文 English ＡＢＣ１２３ 0123456789"),
        createSpacerElement({ heightDots: 8 }),
        createBarcodeElement({ format: "code128", value: model, heightDots: 64, showText: true }),
        createBarcodeElement({ format: "qrcode", value: PROJECT_URL, heightDots: 174 }),
        text("謝謝光臨", { fontSize: 32, align: "center" }),
        createDividerElement({ style: "dotted" }),
        ...infoRows,
        createSpacerElement({ heightDots: 8 }),
        createImageElement({ assetId: stripUrl, fit: "auto", ditherMode: "threshold" }),
        createSpacerElement({ heightDots: 8 }),
        createImageElement({ assetId: endBarUrl, fit: "auto", ditherMode: "threshold" }),
        text("切線在黑條下方", { align: "center" }),
    ];
}

/**
 * 產生測試列印用 canvas（寬度＝列印頭寬度，位置已含邊距校正的補白，送出時 adapter 不會再動它）。
 * ctx：{ baseProfile, profile（已套用校正）, widthId, headWidthDots, pad, prefs, connection, firmware }
 */
export async function renderTestPrint({ baseProfile, profile, widthId, headWidthDots, pad, prefs, connection, firmware }) {
    const dpi = baseProfile.dpi.x;
    const basePaper = baseProfile.paperWidths.find((p) => p.id === widthId);
    const paper = profile.paperWidths.find((p) => p.id === widthId);
    const rawWidth = basePaper.printableWidthDots;
    const margin = prefs.margins?.[widthId];

    const info = [
        ["機型", `${baseProfile.brand} ${baseProfile.model}`],
        ["連接", connection],
        ...(firmware ? [["韌體", firmware]] : []),
        ["紙寬", `${paper.label}　${dpi} dpi`],
        ["可印", `${paper.printableWidthDots} / ${rawWidth} 點`],
        ["邊距", margin ? `左 ${margin.leftMm}　右 ${margin.rightMm} mm` : "未校正"],
        ["補白", `左 ${pad.left}　右 ${pad.right} 點`],
        ["走紙", `${prefs.feedLines} 行　切紙${prefs.cutPaper ? "開" : "關"}`],
        ["時間", new Date().toLocaleString("zh-TW", { hour12: false })],
    ];

    const project = createEmptyProject({ name: "測試列印", printerProfileId: baseProfile.id, paperWidthId: widthId });
    // 條碼放機型（Code128 只收半形可見字元，取不到就用預設機型）
    const model = /^[ -~]+$/.test(baseProfile.model ?? "") ? baseProfile.model : FALLBACK_MODEL;
    project.template.elements = buildReceiptElements(
        info,
        model,
        buildCalibratedStrip(paper.printableWidthDots, dpi),
        buildEndBar(paper.printableWidthDots),
    );
    const body = await renderTemplate(project, {}, { mode: "thermal", profile });

    // 最上面：未校正的原始邊緣＋尺規，用來量實際留白（mm）
    const rawHeight = 96;
    const { canvas, ctx } = makeCanvas(headWidthDots, rawHeight + body.canvas.height);
    const rawX = Math.max(0, Math.floor((headWidthDots - rawWidth) / 2));
    drawEdgeGauge(ctx, rawX, 0, rawWidth, dpi);
    ctx.font = `20px ${FONT}`;
    ctx.textBaseline = "top";
    ctx.fillText("量左右邊距（mm）填入設定", rawX + 4, 64);

    // 校正後的內容：位置比照 adapter 的置中＋左補白
    const bodyX = Math.max(0, Math.floor((headWidthDots - (body.canvas.width + pad.left + pad.right)) / 2)) + pad.left;
    ctx.drawImage(body.canvas, bodyX, rawHeight);
    return { canvas, fontFallbacks: body.fontFallbacks };
}

// 邊距校正紙，由上而下三段：
// ① 寬版（640 點＝80 mm，比可列印區寬）：從影像最左 dot 0 起每 1 mm 一格、每 5 mm 標數字，
//    粗黑線在 0、72 mm（576 點）、80 mm；最右邊印得出來的數字就是機器實際上限，最左邊看得到的第一個數字就是被吃掉的量。
// ② 未校正的可列印範圍　③ 套用目前補白後的範圍：量紙緣到黑條，填進邊距校正。
export const SHEET_WIDTH_DOTS = 640;
export function renderCalibrationSheet({ baseProfile, profile, widthId, headWidthDots, pad }) {
    const dpi = baseProfile.dpi.x;
    const perMm = dotsPerMm(dpi);
    const rawWidth = baseProfile.paperWidths.find((p) => p.id === widthId).printableWidthDots;
    const calWidth = profile.paperWidths.find((p) => p.id === widthId).printableWidthDots;
    const labelH = 32;
    const sectionH = labelH + EDGE_GAUGE_HEIGHT + 24;
    const width = Math.max(SHEET_WIDTH_DOTS, headWidthDots);
    const { canvas, ctx } = makeCanvas(width, sectionH * 3 + 64);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    // ① 寬版
    ctx.font = `24px ${FONT}`;
    ctx.fillText("① 機器寬度", 12, 0);
    const wideY = labelH;
    ctx.font = `14px ${FONT}`;
    ctx.fillRect(0, wideY, width, 2);
    for (let mm = 0; mm * perMm < width; mm++) {
        const x = Math.round(mm * perMm);
        ctx.fillRect(x, wideY, 1, mm % 10 === 0 ? 22 : mm % 5 === 0 ? 15 : 8);
        if (mm % 5 === 0 && mm > 0) ctx.fillText(String(mm), x + 2, wideY + 24);
    }
    ctx.fillRect(0, wideY, 8, 30);
    ctx.fillRect(headWidthDots - 3, wideY, 6, 40);
    ctx.fillRect(width - 8, wideY, 8, 30);
    ctx.fillText(String(headWidthDots), headWidthDots - 30, wideY + 42);

    // ②③ 可列印範圍：位置比照 adapter 的置中＋左補白
    const rawX = Math.max(0, Math.floor((headWidthDots - rawWidth) / 2));
    const calX = Math.max(0, Math.floor((headWidthDots - (calWidth + pad.left + pad.right)) / 2)) + pad.left;
    ctx.font = `24px ${FONT}`;
    let y = sectionH;
    for (const [label, x, w] of [["② 未校正", rawX, rawWidth], ["③ 已校正", calX, calWidth]]) {
        ctx.fillText(label, x + 12, y);
        drawEdgeGauge(ctx, x, y + labelH, w, dpi);
        y += sectionH;
    }
    ctx.fillText("左 ______ mm　右 ______ mm", rawX + 12, y + 8);
    return { canvas };
}
