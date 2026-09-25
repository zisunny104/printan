// 測試列印：內建一份收據風版型，走專案自己的排版管線（renderTemplate），
// 上下再各接一段直接畫在 canvas 上的量測用刻度（未校正原始邊緣、校正後邊緣）。
// 尺規、色塊沒有對應的元素類型，用小 canvas 轉成圖片元素放進版型。

import { createEmptyProject } from "../core/schema.js";
import { renderTemplate, DEFAULT_FONT_FAMILY } from "../core/renderer.js";
import {
    createTextElement, createTextRun, createDividerElement, createSpacerElement,
    createImageElement, createRowElement, createBarcodeElement, applyTextStylePreset,
} from "../core/document-model.js";
import { dotsPerMm } from "../core/units.js";
import { renderBarcodeResult } from "../core/barcode.js";
import { applyDither } from "../core/dithering.js";

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

// 細線／細字辨識：1～4 點粗細的橫線各畫 6 條（間距等於線寬，測試印字頭能否分辨相鄰細線是否糊在一起），
// 下面接兩行字級樣本：第一行由大到小，測試熱感紙在這台印表機上實際能看清的最小字級下限；
// 第二行是本文～標題常用的正常／偏大字級參考。第一行窄紙常常提早遇到防呆 break 停止、右側留白，
// 與其留白不用，乾脆多開一行把正常／較大字級也秀出來。不寫標題文字，線條與字級樣本本身就看得出來在測什麼。
const FINE_DETAIL_BARS_HEIGHT = 4 * 16; // 1～4 點粗細橫線各佔一列 16 高
const FONT_SIZE_TEST_SMALL_PT = [12, 10, 9, 8, 7, 6, 5, 4]; // 由大到小找可讀下限
const FONT_SIZE_TEST_LARGE_PT = [12, 16, 20, 24]; // 本文～標題常用尺寸參考

function ptToDots(pt) {
    // 這個檔案沒有 profile context 可讀，目前也只有單一印表機、固定 203 dpi，直接寫死換算；
    // 跟 inspector.js 輸入框顯示用的 pt↔dots 換算是同一套公式，之後真的有多 DPI 情境再一起抽成共用函式。
    return Math.round((pt * 203) / 72);
}

function drawPtSizeRow(ctx, sizes, y, widthDots) {
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    let x = 0;
    for (const pt of sizes) {
        const dots = ptToDots(pt);
        ctx.font = `${dots}px ${FONT}`;
        const label = `${pt}pt`;
        ctx.fillText(label, x, y);
        x += Math.ceil(ctx.measureText(`${label}　`).width);
        if (x > widthDots - 40) break;
    }
}

function buildFineDetailStrip(widthDots) {
    const barsTop = 4;
    const smallRowTop = barsTop + FINE_DETAIL_BARS_HEIGHT + 2;
    const smallRowMaxDots = ptToDots(Math.max(...FONT_SIZE_TEST_SMALL_PT));
    const largeRowTop = smallRowTop + smallRowMaxDots + 8;
    const largeRowMaxDots = ptToDots(Math.max(...FONT_SIZE_TEST_LARGE_PT));
    const height = largeRowTop + largeRowMaxDots + 6;

    const { canvas, ctx } = makeCanvas(widthDots, height);
    let y = barsTop;
    for (let w = 1; w <= 4; w++) {
        for (let n = 0; n < 8; n++) ctx.fillRect(n * w * 3, y, w, 12);
        y += 16;
    }
    drawPtSizeRow(ctx, FONT_SIZE_TEST_SMALL_PT, smallRowTop, widthDots);
    drawPtSizeRow(ctx, FONT_SIZE_TEST_LARGE_PT, largeRowTop, widthDots);
    return canvas.toDataURL("image/png");
}

// 抖色模式比較：把同一段由白到黑的漸層分別餵給三種抖色演算法（誤差擴散／網點／閾值），
// 並排比較密度過渡的效果與網點紋理差異（熱感紙沒有真正的灰階，看的就是這個）。
const DITHER_SWATCH_H = { grad: 56, label: 18 };
function buildDitherSwatch(widthDots) {
    const modes = [["floyd-steinberg", "誤差擴散"], ["ordered", "網點"], ["threshold", "閾值"]];
    const { grad: gradH, label: labelH } = DITHER_SWATCH_H;
    const { canvas, ctx } = makeCanvas(widthDots, gradH + labelH);
    const cellW = Math.floor(widthDots / modes.length);
    modes.forEach(([mode, label], i) => {
        const x0 = i * cellW;
        const w = i === modes.length - 1 ? widthDots - x0 : cellW;
        const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0);
        grad.addColorStop(0, "#fff");
        grad.addColorStop(1, "#000");
        ctx.fillStyle = grad;
        ctx.fillRect(x0, 0, w, gradH);
        const imageData = ctx.getImageData(x0, 0, w, gradH);
        applyDither(imageData, mode, 128);
        ctx.putImageData(imageData, x0, 0);
        ctx.fillStyle = "#000";
        ctx.font = `13px ${FONT}`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText(label, x0, gradH + 2);
    });
    return canvas.toDataURL("image/png");
}

// 品牌 icon：頁首用的是 Tocas 的收據圖示，這裡用畫布畫同樣意象（鋸齒下緣的收據紙＋幾行字），
// 避免依賴圖示字型；正方形，貼在標題左邊。
const BRAND_ICON_DRAW = 72; // 下面的座標都以 72 點方格設計，實際大小依標題字級縮放
const brandIconSize = (brandSize) => brandSize + 10; // 圖形本體約占方格 8 成，視覺高度約與標題字高相當
const BRAND_ICON_GAP = 10; // icon 與標題文字的間距（點）
const brandRuns = (size) => [{ text: "Printan ", fontSize: size + 6 }, { text: "單仔", fontSize: size + 4 }];
function measureBrand(size) {
    const { ctx } = makeCanvas(1, 1);
    return brandRuns(size).reduce((sum, r) => {
        ctx.font = `bold ${r.fontSize}px ${FONT}`;
        return sum + Math.ceil(ctx.measureText(r.text).width);
    }, 0);
}
function buildBrandIcon(size) {
    const s = BRAND_ICON_DRAW;
    const { canvas, ctx } = makeCanvas(size, size);
    ctx.scale(size / s, size / s);
    const x0 = 14;
    const x1 = s - 14;
    const top = 6;
    const bottom = s - 8;
    const teeth = 5;
    const tw = (x1 - x0) / teeth;
    ctx.beginPath();
    ctx.moveTo(x0, top);
    ctx.lineTo(x1, top);
    ctx.lineTo(x1, bottom);
    for (let i = teeth - 1; i >= 0; i--) {
        ctx.lineTo(x0 + i * tw + tw / 2, bottom - 7);
        ctx.lineTo(x0 + i * tw, bottom);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    for (const [y, w] of [[19, 1], [30, 1], [41, 0.6]]) ctx.fillRect(x0 + 6, y, (x1 - x0 - 12) * w, 4);
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

// 內容是這個專案自己的「收據」：標題（icon＋名稱）＋副標＋網址 → 品項（含縮排備註行）→ 小計／優惠／合計 →
// 條碼與 QR → 感謝語與頁尾小字 → 技術資訊（小字級）。
// 品項是專案的功能與開發過程，金額由程式加總；彩蛋藏在數字與小字裡，純屬玩笑。
const PROJECT_URL = "https://toka.dev/koilisu/printan";
const TEAPOT_URL = "https://http.cat/418"; // 418 I'm a teapot 的貓圖
const FALLBACK_MODEL = "TM-T82II";

// 彩蛋數字的來源，要換數字只改這裡
const EASTER_EGG = {
    tokens: "999+", // token 消耗量：實際數不明，玩笑梗
    monthlyFeeUsd: 20, // Claude Pro 月費（美元）
};

const money = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US")}`;

// [名稱, 數量, 單價, 備註]；數量可放字串（如 "999+"），計價時當 0。金額照實填，合計由程式加總。
// 名稱盡量一看就懂（功能名或明顯的玩笑）；42＝宇宙的答案、95＝一杯美式咖啡平均咖啡因量(mg)。
// 三份數量（份數）跟著當下時間變：輪班不加班助手＝現在幾月、預覽＝今天幾號、咖啡＝現在幾點（0 點算 24 杯），讓每次列印金額不同。
const menuItems = () => {
    const now = new Date();
    const monthCount = now.getMonth() + 1;
    const previewCount = now.getDate();
    const coffeeCount = now.getHours() || 24;
    return [
        ["輪班不加班助手", monthCount, EASTER_EGG.monthlyFeeUsd, "Claude Pro，自掏腰包"],
        ["所見即所得預覽", previewCount, 42, "42：生命、宇宙與一切的答案"],
        ["續命美式咖啡", coffeeCount, 95, "喝茶請洽 HTTP 418"],
        ["Token 一籮筐", EASTER_EGG.tokens, 0, "用量沒算過，反正很多"],
        ["Hello World", 1, 1, "第一行輸出，成功了"],
    ];
};

const DISCOUNT = ["優惠　一點點……耐心", -15];

function buildReceiptElements(info, model, iconUrl, stripUrl, cutLineUrl, fineDetailUrl, ditherUrl, widthDots, dpi) {
    // 字級依紙寬取值：80mm 特大，58mm（約 420 點）退一級才放得下。
    // 副標、合計改套用 H3／H2 樣式預設（見 document-model.js TEXT_STYLE_PRESETS）：固定 pt、
    // 不隨紙寬縮放，用來示範預設系統本身，跟其餘仍依紙寬取值的字級是兩種不同的設計考量。
    const wide = widthDots >= 500;
    const brandSize = wide ? 56 : 40;
    const noteSize = wide ? 22 : 20;
    const smallSize = wide ? 22 : 20;
    // 縮小 20%（PROJECT_URL 29 模組／TEAPOT_URL 25 模組，見下方統一縮放註解）：
    // 58mm 最差情況 96px÷29 模組 ≈ 3.31px/模組，仍在「≥3px/模組」的可靠掃描門檻之上
    const qrSize = wide ? 112 : 96;
    bodySize = wide ? 28 : 24;

    const menu = menuItems();
    const subtotal = menu.reduce((sum, [, qty, price]) => sum + (Number(qty) || 0) * price, 0);
    const total = subtotal + DISCOUNT[1];
    const center = (runs, overrides = {}) => text(runs, { align: "center", ...overrides });
    const gap = () => createSpacerElement({ heightDots: 8 });
    const space = () => createSpacerElement({ heightDots: 12 });
    const menuRows = menu.flatMap(([name, qty, price, remark]) => [
        itemRow(name, String(qty), money((Number(qty) || 0) * price), {}),
        text(`　└ ${remark}`, { fontSize: noteSize }),
    ]);
    // 標題列：icon＋名稱貼在一起整組置中。欄寬用「點」當比例：兩側留白 | icon | 間距 | 名稱（量出實際字寬）| 兩側留白
    const nameWidth = measureBrand(brandSize) + 16;
    const side = Math.max(0, (widthDots - brandIconSize(brandSize) - BRAND_ICON_GAP - nameWidth) / 2);
    const brandRow = createRowElement([side || 1, brandIconSize(brandSize), BRAND_ICON_GAP, nameWidth, side || 1]);
    brandRow.columns[1].push(createImageElement({ assetId: iconUrl, fit: "auto", ditherMode: "threshold" }));
    brandRow.columns[3].push(center(brandRuns(brandSize), { bold: true }));
    // 優惠字樣較長，名稱欄放寬，58mm 才不會折行
    const discountRow = createRowElement([2, 1]);
    discountRow.columns[0].push(text(DISCOUNT[0]));
    discountRow.columns[1].push(text(money(DISCOUNT[1]), { align: "right" }));
    // 兩個 QR 左右並列；內容長度不同、QR 格數也不同，說明另開一列，兩行字才會對齊在同一條線上
    const qrs = [[PROJECT_URL, "專案網站"], [TEAPOT_URL, "418 茶壺"]];
    const qrRow = createRowElement([1, 1]);
    const captionRow = createRowElement([1, 1]);
    // 兩顆 QR 內容長度不同、模組數也不同：renderBarcodeResult 內部用「模組像素大小」取整數點，就算兩顆都要求同一個
    // heightDots，模組數不同時取整後的實際外框邊長還是可能不一樣大（例如 29×29 跟 25×25 模組取同樣的整數格寬，
    // 兩者外框相差可到一成多）——使用者反映的「看起來一大一小」就是這個。改成畫好各自原生大小後，
    // 用 drawImage 明確縮放成同一個邊長（qrSize）＋關掉平滑（保持方塊邊緣銳利，避免縮放糊成灰階影響二值化辨識）。
    const qrCanvases = qrs.map(([value]) => renderBarcodeResult({ format: "qrcode", value, heightDots: qrSize }, widthDots / 2).canvas);
    const frame = qrSize;
    qrs.forEach(([, caption], i) => {
        const { canvas, ctx } = makeCanvas(frame, frame);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(qrCanvases[i], 0, 0, frame, frame);
        // fit 用 "none"：renderer.js 的 "auto" 一律撐滿欄寬（widthPercent 預設 100%，不看來源畫布實際大小），
        // qrSize 只會改到來源畫布解析度、印不出真正縮小的效果；"none" 才會照內容原始寬度（qrSize）畫，
        // 欄寬夠寬時就是 qrSize 本身。align 用預設值 "center"，欄寬 > qrSize 時置中對齊下方 captionRow 文字。
        qrRow.columns[i].push(createImageElement({ assetId: canvas.toDataURL("image/png"), fit: "none", ditherMode: "threshold" }));
        captionRow.columns[i].push(center(caption, { fontSize: smallSize }));
    });
    const infoRows = info.map(([k, v]) => {
        const row = createRowElement([1, 2]);
        row.columns[0].push(text(k, { fontSize: smallSize }));
        row.columns[1].push(text(v, { fontSize: smallSize, align: "right" }));
        return row;
    });

    const subtitleEl = center("小小一張紙，所見即所印", { italic: true });
    applyTextStylePreset(subtitleEl, "H3", dpi);
    const totalRow = createRowElement([1, 1]);
    const totalLeftEl = text("合計", { inverse: true });
    const totalRightEl = text(money(total), { inverse: true, align: "right" });
    applyTextStylePreset(totalLeftEl, "H2", dpi);
    applyTextStylePreset(totalRightEl, "H2", dpi);
    totalRow.columns[0].push(totalLeftEl);
    totalRow.columns[1].push(totalRightEl);

    return [
        // 標題：icon 與名稱並排
        brandRow,
        subtitleEl,
        center("toka.dev/koilisu/printan", { fontSize: smallSize }),
        gap(),
        // 品項：上方一條反白窄帶當區段標頭
        center("ORDER　本次開發明細", { fontSize: noteSize + 4, bold: true, inverse: true }),
        createSpacerElement({ heightDots: 4 }),
        ...menuRows,
        createDividerElement(),
        // 小計／折扣／合計
        line("小計", money(subtotal)),
        discountRow,
        gap(),
        totalRow,
        gap(),
        // 條碼與 QR
        // 明碼另用一般文字元素，字級與內文同大（條碼內建明碼太小，熱感應二值化後糊成一團）
        createBarcodeElement({ format: "code128", value: model, heightDots: 64, showText: false }),
        center(model),
        gap(),
        qrRow,
        captionRow,
        // 撕線：其下的技術資訊像可撕下的存根（視覺撕線本身已表達「沿此撕開」，不再多一行說明；自動切刀仍在整張最後）
        space(),
        createImageElement({ assetId: stripUrl, fit: "auto", ditherMode: "threshold" }),
        createImageElement({ assetId: cutLineUrl, fit: "auto", ditherMode: "threshold" }),
        // 細線／細字辨識：測印字頭能分辨的最細線寬、最小可讀字級
        createImageElement({ assetId: fineDetailUrl, fit: "auto", ditherMode: "threshold" }),
        gap(),
        // 抖色模式比較：同一段漸層分別跑三種演算法（誤差擴散／網點／閾值，各欄下方已有文字標籤），比較密度過渡與網點紋理
        createImageElement({ assetId: ditherUrl, fit: "auto", ditherMode: "threshold" }),
        gap(),
        // 技術資訊（小字級）
        ...infoRows,
        gap(),
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
        buildBrandIcon(brandIconSize(paper.printableWidthDots >= 500 ? 56 : 40)),
        buildCalibratedStrip(paper.printableWidthDots, dpi),
        buildCutLine(paper.printableWidthDots),
        buildFineDetailStrip(paper.printableWidthDots),
        buildDitherSwatch(paper.printableWidthDots),
        paper.printableWidthDots,
        dpi,
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
