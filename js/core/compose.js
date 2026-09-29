// 多份輸出合併：把多個專案（或同一專案的多筆資料）的渲染結果由上而下接成一張長單。
// 給嵌入的呼叫端用，編輯器本身不走這裡；輸出仍是單一 canvas，可直接餵給 buildEscposJob／PDF。

import { renderPages, renderTemplate, MAX_CANVAS_HEIGHT } from "./renderer.js";
import { dotsToMm } from "./units.js";

/**
 * results：renderTemplate／renderBatch 的結果陣列。寬度不同時以最寬者為準、較窄的置中。
 * gapDots：相鄰兩份之間的空白（白底）點數。
 */
export function composeResults(results, { gapDots = 0 } = {}) {
    const list = [].concat(results).filter(Boolean);
    if (!list.length) throw new Error("沒有可合併的內容");
    const width = Math.max(...list.map((r) => r.canvas.width));
    const gap = Math.max(0, Math.round(gapDots));
    const total = list.reduce((sum, r) => sum + r.canvas.height, 0) + gap * (list.length - 1);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.min(Math.max(total, 1), MAX_CANVAS_HEIGHT);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = 0;
    for (const r of list) {
        if (y >= canvas.height) break;
        ctx.drawImage(r.canvas, Math.floor((width - r.canvas.width) / 2), y);
        y += r.canvas.height + gap;
    }

    const dpi = list[0].dpi;
    return {
        canvas,
        widthDots: canvas.width,
        heightDots: canvas.height,
        dpi,
        widthMm: dotsToMm(canvas.width, dpi),
        heightMm: dotsToMm(canvas.height, dpi),
        truncated: total > MAX_CANVAS_HEIGHT || list.some((r) => r.truncated),
        fontFallbacks: [...new Set(list.flatMap((r) => r.fontFallbacks || []))],
        imageFailures: [...new Set(list.flatMap((r) => r.imageFailures || []))],
        items: [],
    };
}

/**
 * jobs：[{ project, data?, options? }]，依序渲染後合併。單一專案多筆資料請直接用 renderBatch＋composeResults。
 */
export async function renderProjects(jobs, { gapDots = 0, options = {} } = {}) {
    const results = [];
    for (const job of jobs) {
        const jobOptions = { ...options, ...job.options };
        // 每個專案的所有頁面都要接進來：renderTemplate 只讀第一頁，多頁專案會少印第 2 頁以後。
        // 合成後是單一 canvas、只有結尾一次切紙，各頁自己的 cutAfter 在這裡沒有作用。
        // 沒有 pages 的舊格式專案（外部呼叫端直接傳進來）退回單頁的 renderTemplate。
        if (Array.isArray(job.project?.template?.pages)) {
            results.push(...await renderPages(job.project, job.data || {}, jobOptions));
        } else {
            results.push(await renderTemplate(job.project, job.data || {}, jobOptions));
        }
    }
    return composeResults(results, { gapDots });
}
