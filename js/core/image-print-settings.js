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

// 外部（kiosk 的 submit-job 帶 imagePreset）可以選的照片處理組合。settings 為 null＝不改範本裡各圖片自己的設定。
// 預設組合由 DEFAULT_IMAGE_PRESET 決定：呼叫端沒指定或指定 "default" 時就套這一個，之後換預設只改這個常數。
export const IMAGE_PRESETS = {
    classic: { label: "原始（誤差擴散）", settings: null },
    "detail-blue-noise": { label: "細節階調＋藍噪聲", settings: { toneCurve: "photo-detail", ditherMode: "blue-noise" } },
    "detail-serpentine": { label: "細節階調＋來回掃描", settings: { toneCurve: "photo-detail", ditherMode: "serpentine" } },
};
export const DEFAULT_IMAGE_PRESET = "classic";

/** 把呼叫端給的名稱整理成真正的組合 id："default"、沒給、不認得的值都落到預設組合。 */
export function resolveImagePreset(id) {
    return Object.hasOwn(IMAGE_PRESETS, id) ? id : DEFAULT_IMAGE_PRESET;
}

/** 對所有綁變數的圖片（照片）套用組合；亮度、對比、反相與沒綁變數的圖片（Logo 等）不動。 */
export function applyImagePreset(project, id) {
    const settings = IMAGE_PRESETS[resolveImagePreset(id)].settings;
    if (!settings) return project;
    const byVariable = {};
    function collect(elements) {
        for (const el of elements) {
            const match = el.type === "image" && typeof el.assetId === "string" && /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(el.assetId);
            if (match) byVariable[match[1]] = settings;
            for (const children of childArrays(el)) collect(children);
        }
    }
    for (const page of project.template.pages) collect(page.elements);
    return Object.keys(byVariable).length ? applyImagePrintSettings(project, byVariable) : project;
}
