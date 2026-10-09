import { childArrays } from "./element-tree.js";
import { loadProject } from "./schema.js";

// 只覆寫指定圖片變數的轉換設定，不更動原專案及版面。
export function applyImagePrintSettings(project, byVariable = {}) {
    const copy = structuredClone(project);
    function apply(elements) {
        for (const el of elements) {
            const match = typeof el.assetId === "string" && /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(el.assetId);
            const settings = match && byVariable[match[1]];
            if (el.type === "image" && settings) {
                for (const key of ["brightness", "contrast", "thresholdLevel"]) {
                    const min = key === "thresholdLevel" ? 0 : -100, max = key === "thresholdLevel" ? 255 : 100;
                    if (Number.isInteger(settings[key]) && settings[key] >= min && settings[key] <= max) el[key] = settings[key];
                }
                if (["none", "photo-readable", "photo-detail"].includes(settings.toneCurve)) el.toneCurve = settings.toneCurve;
                if (["floyd-steinberg", "serpentine", "blue-noise", "ordered", "threshold"].includes(settings.ditherMode)) el.ditherMode = settings.ditherMode;
            }
            for (const children of childArrays(el)) apply(children);
        }
    }
    for (const page of copy.template.pages) apply(page.elements);
    return loadProject(copy).project;
}
