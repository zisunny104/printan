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

// 切割線：左邊向右張開的向量剪刀（不靠字型，不會變成缺字方框）＋一路到右邊的虛線（線寬 2 點）。
// 虛線的空白會微調，讓左右兩端都剛好是完整線段；線畫在圖的上緣附近，圖下方只留一小段，
// 這條線是整份收據最後印出的東西，走紙後刀口落在它的下方。
const CUT_LINE_HEIGHT = 34;
function buildCutLine(widthDots) {
    const { canvas, ctx } = makeCanvas(widthDots, CUT_LINE_HEIGHT);
    const cy = 16;
    // 剪刀：兩個把手圈在左、兩片刀刃交叉於樞軸後向右張開
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(9, cy + dir * 8, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(14, cy + dir * 6);
        ctx.lineTo(40, cy - dir * 8);
        ctx.stroke();
    }
    // 虛線：從剪刀尖端到右緣，線段 14 點、空白約 8 點，兩端都是完整線段
    const start = 46;
    const dash = 14;
    const span = widthDots - start;
    const count = Math.max(1, Math.round((span + 8) / (dash + 8)));
    const step = count > 1 ? (span - dash) / (count - 1) : 0;
    for (let i = 0; i < count; i++) ctx.fillRect(Math.round(start + i * step), cy - 1, dash, 2);
    return canvas.toDataURL("image/png");
}

// 內文字級：buildReceiptElements 依紙寬設定（58mm 用小一級，品項名稱才不會折行）
let bodySize = 28;
const text = (runs, overrides = {}) => createTextElement({
    runs: (Array.isArray(runs) ? runs : [runs]).map((r) => createTextRun(typeof r === "string" ? { text: r } : r)),
    fontSize: bodySize,
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
    const row = createRowElement([3, 1, 2]);
    row.columns[0].push(text({ text: name, ...style }));
    row.columns[1].push(text({ text: qty, ...style }, { align: "center" }));
    row.columns[2].push(text({ text: amount, ...style }, { align: "right" }));
    return row;
}

// 內容是這個專案自己的「收據」，結構參考台灣常見單據：店名區（主標＋副標＋本店／統編／網址）→
// 電子發票證明聯抬頭（期別、字軌號碼、時間、隨機碼／總計）→ 品項（含縮排備註行）→ 小計／折扣／合計 →
// 付款／找零 → 條碼與 QR → 感謝語與頁尾小字 → 技術資訊（小字級）。
// 品項是專案的功能與開發過程，金額由程式加總；彩蛋藏在數字與小字裡，純屬玩笑。
const PROJECT_URL = "https://toka.dev/koilisu/printan";
const FALLBACK_MODEL = "TM-T82II";

// 彩蛋數字的來源，要換數字只改這裡
const EASTER_EGG = {
    birthday: "20260914", // 第一個 commit 的日期（2026-09-14）
    commits: 165, // 專案 commit 數（164 個＋這一個）
    tokens: "999+", // token 消耗量：實際數不明，玩笑梗
    monthlyFeeUsd: 20, // Claude Pro 月費（美元）
};

const money = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;

// [名稱, 數量, 單價, 備註]；數量可放字串（如 "999+"），計價時當 0。加總剛好 1,337（leet）：
// 42（宇宙的答案）＋914（誕生日）＋3×65（ASCII 的 A）＋165（commit 數）＋20（月費）＋1（Hello World）
const MENU = [
    ["所見即所得預覽", 1, 42, "宇宙、生命與一切的答案"],
    ["直書排版", 1, Number(EASTER_EGG.birthday.slice(4)), `誕生日紀念款 ${EASTER_EGG.birthday.slice(4)}`],
    ["續命美式咖啡", 3, 65, "喝茶請洽 HTTP 418"],
    ["修改次數", EASTER_EGG.commits, 1, `第 ${EASTER_EGG.commits} 次 commit（含這一次）`],
    ["Token 一籮筐", EASTER_EGG.tokens, 0, "實際數不明，大概"],
    ["月費方案", 1, EASTER_EGG.monthlyFeeUsd, "Claude Pro，本月贊助"],
    ["Hello World", 1, 1, "第一行輸出，成功了"],
];
const DISCOUNT = ["後悔折扣（無）", 0];
const CHANGE = 0;

function buildReceiptElements(info, model, stripUrl, cutLineUrl, widthDots) {
    // 字級依紙寬取值：80mm 特大，58mm（約 420 點）退一級才放得下
    const wide = widthDots >= 500;
    const brandSize = wide ? 68 : 48;
    const titleSize = wide ? 36 : 28;
    const totalSize = wide ? 40 : 32;
    const noteSize = wide ? 22 : 20;
    const smallSize = wide ? 22 : 20;
    bodySize = wide ? 28 : 24;

    const subtotal = MENU.reduce((sum, [, qty, price]) => sum + (Number(qty) || 0) * price, 0);
    const total = subtotal + DISCOUNT[1];
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const dateTime = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const evenMonth = Math.ceil((now.getMonth() + 1) / 2) * 2; // 發票期別：兩個月一期
    const period = `${now.getFullYear() - 1911}年${pad2(evenMonth - 1)}-${pad2(evenMonth)}月`;

    const center = (runs, overrides = {}) => text(runs, { align: "center", ...overrides });
    const gap = () => createSpacerElement({ heightDots: 8 });
    const menuRows = MENU.flatMap(([name, qty, price, remark]) => [
        itemRow(name, String(qty), money((Number(qty) || 0) * price), {}),
        text(`　└ ${remark}`, { fontSize: noteSize }),
    ]);
    const infoRows = info.map(([k, v]) => {
        const row = createRowElement([1, 2]);
        row.columns[0].push(text(k, { fontSize: smallSize }));
        row.columns[1].push(text(v, { fontSize: smallSize, align: "right" }));
        return row;
    });

    return [
        // 店名區
        center([{ text: "Printan ", fontSize: brandSize }, { text: "單仔", fontSize: brandSize + 12 }], { bold: true }),
        center("小小一張紙，所見即所印", { fontSize: titleSize, italic: true }),
        center(`KoiLiSu 本店　統編 ${EASTER_EGG.birthday}`, { fontSize: smallSize }),
        center("toka.dev/koilisu/printan", { fontSize: smallSize }),
        createDividerElement({ style: "dashed" }),
        // 電子發票證明聯抬頭
        center("電子發票證明聯", { fontSize: titleSize, bold: true }),
        center(period, { fontSize: totalSize, bold: true }),
        center(`PT-${EASTER_EGG.birthday}`, { fontSize: totalSize, bold: true }),
        line(dateTime, `序號 #${String(EASTER_EGG.commits).padStart(4, "0")}`, { fontSize: smallSize }),
        line("隨機碼 0404", `總計 ${total}`, { fontSize: smallSize }),
        createDividerElement({ style: "dashed" }),
        // 品項
        ...menuRows,
        createDividerElement(),
        // 小計／折扣／合計
        line("小計", money(subtotal)),
        line(DISCOUNT[0], money(DISCOUNT[1])),
        gap(),
        line({ text: "合計", bold: true, fontSize: totalSize }, { text: money(total), bold: true, fontSize: totalSize }),
        gap(),
        line("信用卡", "4242 4242 4242 4242", { fontSize: smallSize }),
        line("找零", money(CHANGE), { fontSize: smallSize }),
        gap(),
        // 條碼與 QR
        createBarcodeElement({ format: "code128", value: model, heightDots: 64, showText: true }),
        createBarcodeElement({ format: "qrcode", value: PROJECT_URL, heightDots: 140 }),
        // 感謝語與頁尾小字
        center("謝謝光臨", { fontSize: titleSize + 8, bold: true }),
        center("歡迎再次 404", { fontSize: titleSize }),
        center("本收據沒有法律效力，但誠意十足", { fontSize: smallSize }),
        center(`Claude 協助開發，token ${EASTER_EGG.tokens}（大概）`, { fontSize: smallSize }),
        // 技術資訊（小字級）
        createDividerElement({ style: "dotted" }),
        ...infoRows,
        gap(),
        createImageElement({ assetId: stripUrl, fit: "auto", ditherMode: "threshold" }),
        center("沿此線撕開", { fontSize: smallSize }),
        createImageElement({ assetId: cutLineUrl, fit: "auto", ditherMode: "threshold" }),
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
        ["連線", connection],
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
        buildCutLine(paper.printableWidthDots),
        paper.printableWidthDots,
    );
    const body = await renderTemplate(project, {}, { mode: "thermal", profile });

    // 校正後的內容：位置比照 adapter 的置中＋左補白
    const { canvas, ctx } = makeCanvas(headWidthDots, body.canvas.height);
    const bodyX = Math.max(0, Math.floor((headWidthDots - (body.canvas.width + pad.left + pad.right)) / 2)) + pad.left;
    ctx.drawImage(body.canvas, bodyX, 0);
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
