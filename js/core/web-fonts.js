// 隨選載入的網頁字體（等寬）：首頁不預載，文件裡真的用到才載入。
// 預覽、列印、PDF 都經過 renderer.renderElements，所以載入與失敗判斷集中在 ensureWebFonts()，
// 畫布繪製前一定先等字體載好（沒等到只會量成備用字體的寬度，版面就錯了）。
// 載入失敗（沒網路、CDN 被擋、逾時）時，字體堆疊會落到系統等寬字體，並且回報給呼叫端讓畫面明確提示。

const LOAD_TIMEOUT_MS = 10000;
const RETRY_AFTER_MS = 15000;

const SARASA_DIR = new URL("../../fonts/sarasa-mono-tc/", import.meta.url).href;
const JETBRAINS_CDN = "https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.3.0/";

// stack 是寫進文件的 font-family 值：網頁字體在前，字型裡沒有的字（罕用字）與載入失敗時都落到系統的台灣黑體。
// 中間不放 monospace：它會被系統換成細明體或大陸字型，缺字就出現襯線或簡體字形。
export const WEB_FONTS = [
    {
        id: "sarasa-mono-tc",
        family: "Sarasa Mono TC",
        label: "等寬（黑體，中英同格）",
        stack: '"Sarasa Mono TC", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
        sheets: { 400: `${SARASA_DIR}sarasa-mono-tc-400.css`, 700: `${SARASA_DIR}sarasa-mono-tc-700.css` },
    },
    {
        id: "jetbrains-mono",
        family: "JetBrains Mono",
        label: "等寬（JetBrains Mono，僅英數）",
        stack: '"JetBrains Mono", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
        sheets: { 400: `${JETBRAINS_CDN}latin-400.css`, 700: `${JETBRAINS_CDN}latin-700.css` },
    },
];

const embeddedKeys = new Set(); // "family|weight"：來自 .ptan 內嵌字體，不必再連網載入
const state = new Map(); // id → { failedAt: number|null }
const sheetPromises = new Map(); // css 網址 → Promise（同一份只插一次 <link>）
const sheetLinks = new Map(); // css 網址 → <link>，失敗時拔掉，下次重試才會重新建立字體物件
const listeners = new Set();

/** 字體堆疊的第一個字體若是這裡的網頁字體就回傳它，否則 null。 */
export function findWebFont(stack) {
    const first = String(stack || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
    return WEB_FONTS.find((f) => f.family === first) || null;
}

export function isWebFontFailed(id) {
    return state.get(id)?.failedAt != null;
}

/** 字體載入狀態改變（成功／失敗）時通知，回傳取消訂閱函式。 */
export function onWebFontStatusChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function setFailed(id, failed) {
    const was = isWebFontFailed(id);
    state.set(id, { failedAt: failed ? Date.now() : null });
    if (was !== failed) listeners.forEach((fn) => fn(id, failed));
}

function withTimeout(promise, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 逾時`)), LOAD_TIMEOUT_MS)),
    ]);
}

function loadSheet(url) {
    if (sheetPromises.has(url)) return sheetPromises.get(url);
    const promise = new Promise((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = url;
        link.onload = resolve;
        link.onerror = () => reject(new Error("樣式表載入失敗"));
        sheetLinks.set(url, link);
        document.head.appendChild(link);
    });
    sheetPromises.set(url, promise);
    return promise;
}

function resetSheets(font) {
    for (const url of Object.values(font.sheets)) {
        sheetLinks.get(url)?.remove();
        sheetLinks.delete(url);
        sheetPromises.delete(url);
    }
}

// 走訪 element tree，收集每款網頁字體用到的 { 字重 → 字元集合 }
function collectUsage(elements, defaultFamily) {
    const usage = new Map();
    const add = (stack, bold, text) => {
        const font = findWebFont(stack);
        if (!font || !text) return;
        const byWeight = usage.get(font) || usage.set(font, new Map()).get(font);
        const weight = bold ? 700 : 400;
        byWeight.set(weight, (byWeight.get(weight) || "") + text);
    };
    const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== "object") return;
        if (node.type === "text" || node.type === "float-block") {
            for (const run of node.runs || []) {
                add(run.fontFamily || node.fontFamily || defaultFamily, run.bold ?? node.bold, run.text);
            }
        }
        for (const value of Object.values(node)) if (value && typeof value === "object") visit(value);
    };
    visit(elements);
    return usage;
}

async function loadFont(font, byWeight) {
    for (const [weight, text] of byWeight) {
        await withTimeout(loadSheet(font.sheets[weight]), font.label);
        const chars = [...new Set(text)].join("");
        await withTimeout(document.fonts.load(`${weight} 20px "${font.family}"`, chars), font.label);
    }
}

/**
 * 排版／繪製前呼叫：把 elements 用到的網頁字體載好。回傳這次載入失敗、實際落到備用字體的字體清單（label）。
 * 失敗後 RETRY_AFTER_MS 內不重試（避免每次重繪都卡逾時），之後的重繪會自動再試。
 */
export async function ensureWebFonts(elements, defaultFamily) {
    const failedLabels = [];
    await Promise.all([...collectUsage(elements, defaultFamily)].map(async ([font, byWeight]) => {
        for (const weight of [...byWeight.keys()]) if (embeddedKeys.has(`${font.family}|${weight}`)) byWeight.delete(weight);
        if (!byWeight.size) return;
        const failedAt = state.get(font.id)?.failedAt;
        if (failedAt != null && Date.now() - failedAt < RETRY_AFTER_MS) {
            failedLabels.push(font.label);
            return;
        }
        try {
            await loadFont(font, byWeight);
            setFailed(font.id, false);
        } catch (err) {
            console.warn(`網頁字體載入失敗：${font.label}`, err);
            resetSheets(font);
            setFailed(font.id, true);
            failedLabels.push(font.label);
        }
    }));
    return failedLabels;
}

// ---- .ptan 內嵌字體：只帶「用到字元」所在的 woff2 分片（Sarasa 本來就依字元切片；JetBrains 只有 Latin 一片），不做另外的 subset ----

const SAFE_ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(""); // {{變數}} 的英數內容預留

function parseUnicodeRange(text) {
    return String(text || "").split(",").map((t) => {
        const m = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(t.trim());
        return m ? [parseInt(m[1], 16), parseInt(m[2] || m[1], 16)] : null;
    }).filter(Boolean);
}

function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

/**
 * 匯出用：回傳 { fonts: [{ family, weight, unicodeRange, data(base64 woff2) }], failed: [label] }。
 * 只處理專案內自帶的開源網頁字體；本機字體不在 WEB_FONTS 裡，自然不會被帶入。
 */
export async function buildEmbeddedFonts(elements, defaultFamily) {
    const fonts = [];
    const failed = [];
    for (const [font, byWeight] of collectUsage(elements, defaultFamily)) {
        try {
            for (const [weight, text] of byWeight) {
                const sheetUrl = new URL(font.sheets[weight], location.href).href;
                const css = await (await fetch(sheetUrl)).text();
                const codes = [...new Set(text + SAFE_ASCII)].map((c) => c.codePointAt(0));
                for (const block of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
                    const url = /url\(([^)]+)\)/.exec(block)?.[1].replace(/^["']|["']$/g, "");
                    const rangeText = /unicode-range:\s*([^;}]+)/.exec(block)?.[1];
                    if (!url || !rangeText) continue;
                    const ranges = parseUnicodeRange(rangeText);
                    if (!codes.some((c) => ranges.some(([a, b]) => c >= a && c <= b))) continue;
                    const res = await fetch(new URL(url, sheetUrl).href);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    fonts.push({ family: font.family, weight, unicodeRange: rangeText.trim(), data: bytesToBase64(new Uint8Array(await res.arrayBuffer())) });
                }
            }
        } catch (err) {
            console.warn(`內嵌字體失敗：${font.label}`, err);
            failed.push(font.label);
        }
    }
    return { fonts, failed };
}

// 匯入檔內嵌字體的上限（分片字體一片通常不到 200KB）
const MAX_EMBEDDED_FONTS = 64;
const MAX_EMBEDDED_FONT_CHARS = 6_000_000;

/** 匯入用：把 .ptan 內嵌的字體註冊成 FontFace。只接受已知的網頁字體家族，回傳成功註冊的片數。 */
export async function registerEmbeddedFonts(list) {
    if (!Array.isArray(list)) return 0;
    let count = 0;
    for (const item of list.slice(0, MAX_EMBEDDED_FONTS)) {
        if (!item || typeof item.data !== "string" || item.data.length > MAX_EMBEDDED_FONT_CHARS || !WEB_FONTS.some((f) => f.family === item.family)) continue;
        const weight = item.weight === 700 ? 700 : 400;
        try {
            const bytes = Uint8Array.from(atob(item.data), (c) => c.charCodeAt(0));
            const face = new FontFace(item.family, bytes, { weight: String(weight), unicodeRange: String(item.unicodeRange || "U+0-10FFFF") });
            await face.load();
            document.fonts.add(face);
            embeddedKeys.add(`${item.family}|${weight}`);
            count += 1;
        } catch (err) {
            console.warn("內嵌字體載入失敗", err);
        }
    }
    return count;
}
