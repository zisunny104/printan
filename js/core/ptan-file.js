// .ptan 專案檔的匯出／匯入（瀏覽器端）。
import { serializeProject, loadProject } from "./schema.js";
import { buildEmbeddedFonts, registerEmbeddedFonts } from "./web-fonts.js";

/**
 * 觸發瀏覽器下載 .ptan 檔案。檔名會自動補上 .ptan 副檔名。
 * embedFonts：把用到的開源網頁字體（限用到字元的分片）一併寫進檔案；回傳沒能內嵌的字體名稱。
 */
export async function downloadPtan(project, fileName = "untitled", { embedFonts = false, defaultFamily } = {}) {
    const safeName = fileName.replace(/\.ptan$/i, "");
    let failed = [];
    let out = project;
    if (embedFonts) {
        const built = await buildEmbeddedFonts(project.template.elements, defaultFamily);
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
        const reader = new FileReader();
        reader.onload = async () => {
            const result = loadProject(reader.result);
            if (result.ok && result.project.embeddedFonts) {
                // 字體資料只用來註冊 FontFace，不留在專案裡（避免草稿與下次匯出膨脹）
                const { embeddedFonts, ...rest } = result.project;
                await registerEmbeddedFonts(embeddedFonts);
                result.project = rest;
            }
            resolve(result);
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
