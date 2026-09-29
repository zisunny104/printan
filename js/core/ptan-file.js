// .ptan 專案檔的匯出／匯入（瀏覽器端）。
import { serializeProject, loadProject } from "./schema.js";
import { buildEmbeddedFonts, registerEmbeddedFonts } from "./web-fonts.js";

const MAX_PTAN_BYTES = 128 * 1024 * 1024; // 超過就不讀，避免一次把整個檔案吃進記憶體

/**
 * 觸發瀏覽器下載 .ptan 檔案。檔名會自動補上 .ptan 副檔名。
 * embedFonts：把用到的開源網頁字體（限用到字元的分片）一併寫進檔案；回傳沒能內嵌的字體名稱。
 */
export async function downloadPtan(project, fileName = "untitled", { embedFonts = false, defaultFamily } = {}) {
    const safeName = fileName.replace(/\.ptan$/i, "");
    let failed = [];
    let out = project;
    if (embedFonts) {
        const allElements = (project.template?.pages || []).flatMap((p) => p.elements);
        const built = await buildEmbeddedFonts(allElements, defaultFamily);
        failed = built.failed;
        out = { ...project, embeddedFonts: built.fonts };
    }
    const blob = new Blob([serializeProject(out)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.ptan`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return failed;
}

/** 讀取使用者選擇的 .ptan 檔（File 物件），回傳 { ok, project } 或 { ok:false, error }。 */
export function readPtanFile(file) {
    return new Promise((resolve) => {
        if (file.size > MAX_PTAN_BYTES) return resolve({ ok: false, error: "檔案太大，無法開啟" });
        const reader = new FileReader();
        reader.onload = async () => {
            // 例外若沒接住，這個 Promise 永遠不 resolve，匯入會卡住
            try {
                const result = loadProject(reader.result);
                if (result.ok && result.project.embeddedFonts) {
                    // 字體資料只用來註冊 FontFace，不留在專案裡（避免草稿與下次匯出膨脹）
                    const { embeddedFonts, ...rest } = result.project;
                    await registerEmbeddedFonts(embeddedFonts);
                    result.project = rest;
                }
                resolve(result);
            } catch {
                resolve({ ok: false, error: "檔案內容有誤，無法開啟" });
            }
        };
        reader.onerror = () => resolve({ ok: false, error: "讀取檔案失敗" });
        reader.readAsText(file);
    });
}

/** 把 File（圖片）轉成 data URL，方便直接內嵌進 project.assets。 */
export function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

/** 內嵌素材寬度上限：遠超過印表機可列印點數（最寬約 832 dots）的照片沒有意義，縮小才不會讓 .ptan 與草稿膨脹。 */
export const MAX_ASSET_WIDTH_PX = 1600;

/** 圖片寬度超過 MAX_ASSET_WIDTH_PX 時等比縮小並重新編碼（PNG/GIF→PNG、JPEG→JPEG、WebP→WebP），否則原樣傳回。 */
export async function downscaleImageFile(file) {
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { return file; }
    try {
        if (bitmap.width <= MAX_ASSET_WIDTH_PX) return file;
        const canvas = document.createElement("canvas");
        canvas.width = MAX_ASSET_WIDTH_PX;
        canvas.height = Math.max(1, Math.round((bitmap.height * MAX_ASSET_WIDTH_PX) / bitmap.width));
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const type = file.type === "image/jpeg" || file.type === "image/webp" ? file.type : "image/png";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
        return blob && blob.size < file.size ? new File([blob], file.name, { type }) : file;
    } finally {
        bitmap.close();
    }
}
