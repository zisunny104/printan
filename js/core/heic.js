// HEIC/HEIF 相片轉換：瀏覽器 <img>/canvas 原生不支援解碼 HEIC，改用自行託管的 libheif（wasm，
// vendor/libheif/，LGPL-3.0）在 web worker 內解碼，再由畫布轉成 JPEG。第一次選到 HEIC 才建立 worker
// （wasm 約 1.4MB），不影響平常開編輯器的載入量；不需要 eval，CSP 只多 'wasm-unsafe-eval'。
let worker = null;
let nextJobId = 1;
const pending = new Map();

function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./heic-worker.js", import.meta.url));
    worker.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.error) job.reject(new Error(`無法解碼（${data.error}）`));
        else job.resolve(data);
    };
    worker.onerror = () => {
        // worker 本身起不來（檔案載入失敗等）：全部失敗，下次再選 HEIC 時重建
        for (const job of pending.values()) job.reject(new Error("HEIC 轉換套件載入失敗，請檢查網路連線"));
        pending.clear();
        worker.terminate();
        worker = null;
    };
    return worker;
}

async function decodeHeic(file) {
    const buffer = await file.arrayBuffer();
    const id = nextJobId++;
    const w = getWorker();
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ id, buffer }, [buffer]);
    });
}

export function isHeicFile(file) {
    return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || "");
}

/** 若為 HEIC/HEIF 照片就轉成 JPEG File（其餘格式原樣傳回），讓既有的 fileToDataUrl 流程不用另外處理格式判斷。 */
export async function convertHeicIfNeeded(file) {
    if (!isHeicFile(file)) return file;
    const { width, height, buffer } = await decodeHeic(file);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("無法輸出 JPEG");
    const name = (file.name || "image").replace(/\.hei[cf]$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
}
