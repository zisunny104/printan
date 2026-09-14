// .ptan 專案檔的匯出／匯入（瀏覽器端）。
import { serializeProject, loadProject } from "./schema.js";

/** 觸發瀏覽器下載 .ptan 檔案。檔名會自動補上 .ptan 副檔名。 */
export function downloadPtan(project, fileName = "untitled") {
    const safeName = fileName.replace(/\.ptan$/i, "");
    const blob = new Blob([serializeProject(project)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.ptan`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** 讀取使用者選擇的 .ptan 檔（File 物件），回傳 { ok, project } 或 { ok:false, error }。 */
export function readPtanFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(loadProject(reader.result));
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
