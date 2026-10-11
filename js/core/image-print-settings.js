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

// 圖片的「照片效果」：把階調（toneCurve）與取樣方式（ditherMode）合成使用者看得懂的幾個選項，
// 編輯器的下拉選單、新增圖片的預設值、外部（kiosk 的 submit-job 帶 imagePreset）的組合都從這裡來。
export const PHOTO_EFFECTS = [
    { id: "clear", label: "清晰", toneCurve: "photo-detail", ditherMode: "blue-noise" },
    { id: "soft", label: "柔和", toneCurve: "none", ditherMode: "floyd-steinberg" },
    { id: "halftone", label: "網點", toneCurve: "none", ditherMode: "ordered" },
    { id: "mono", label: "黑白", toneCurve: "none", ditherMode: "threshold" },
];

/** 圖片目前的設定對應哪個照片效果；舊檔的其他組合（例如易辨識、來回掃描）回傳 null。 */
export function photoEffectOf(el) {
    const tone = el.toneCurve || "none";
    const dither = el.ditherMode || "floyd-steinberg";
    return PHOTO_EFFECTS.find((effect) => effect.toneCurve === tone && effect.ditherMode === dither)?.id ?? null;
}

/** 新增圖片時的預設效果。只用在使用者新增圖片的地方；資料模型本身的預設值不變。 */
export const NEW_IMAGE_EFFECT_ID = "clear";
export function newImageEffectSettings() {
    const { toneCurve, ditherMode } = PHOTO_EFFECTS.find((effect) => effect.id === NEW_IMAGE_EFFECT_ID);
    return { toneCurve, ditherMode };
}

// 外部可選的組合：clear／soft 就是上面的照片效果；soft 不改範本裡各圖片自己的設定（settings 為 null）。
// 舊名稱（classic、detail-blue-noise）仍接受，對應到新名稱；detail-serpentine 只留給舊呼叫端，不列在清單裡。
export const IMAGE_PRESETS = {
    clear: { label: "清晰", settings: { toneCurve: "photo-detail", ditherMode: "blue-noise" } },
    soft: { label: "柔和", settings: null },
    "detail-serpentine": { label: "細節階調＋來回掃描", settings: { toneCurve: "photo-detail", ditherMode: "serpentine" }, hidden: true },
};
const IMAGE_PRESET_ALIASES = { classic: "soft", "detail-blue-noise": "clear" };
// 呼叫端沒指定或指定 "default" 時就套這一個，之後換預設只改這個常數。
export const DEFAULT_IMAGE_PRESET = "clear";

/** 把呼叫端給的名稱整理成真正的組合 id："default"、沒給、不認得的值都落到預設組合。 */
export function resolveImagePreset(id) {
    const name = Object.hasOwn(IMAGE_PRESET_ALIASES, id) ? IMAGE_PRESET_ALIASES[id] : id;
    return Object.hasOwn(IMAGE_PRESETS, name) ? name : DEFAULT_IMAGE_PRESET;
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
