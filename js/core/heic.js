// HEIC/HEIF 相片轉換：printan 沒有建置工具，瀏覽器 <img>/canvas 原生也不支援解碼 HEIC，
// 改用 heic2any（單一 UMD 檔案，內含 wasm 解碼器）。只在使用者第一次選到 HEIC 檔案時才動態
// 插入 <script> 載入（~1.3MB），避免每次開編輯器都多讀這個大多數人用不到的套件。
const HEIC2ANY_SRC = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";

let loadPromise = null;

function loadHeic2Any() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (!loadPromise) {
        loadPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = HEIC2ANY_SRC;
            script.onload = () => (window.heic2any ? resolve(window.heic2any) : reject(new Error("heic2any 載入後未掛載到全域")));
            script.onerror = () => {
                loadPromise = null; // 載入失敗（例如離線）時允許下次再選 HEIC 檔案時重試
                reject(new Error("HEIC 轉換套件載入失敗，請檢查網路連線"));
            };
            document.head.appendChild(script);
        });
    }
    return loadPromise;
}

export function isHeicFile(file) {
    return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || "");
}

/** 若為 HEIC/HEIF 照片就轉成 JPEG File（其餘格式原樣傳回），讓既有的 fileToDataUrl 流程不用另外處理格式判斷。 */
export async function convertHeicIfNeeded(file) {
    if (!isHeicFile(file)) return file;
    const heic2any = await loadHeic2Any();
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const name = (file.name || "image").replace(/\.hei[cf]$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
}
