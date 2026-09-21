// HEIC 解碼 worker：libheif（wasm）在這裡跑，不卡編輯器主執行緒。
// 解碼器放在 vendor/libheif/（LGPL-3.0，見該資料夾說明），不使用 eval／new Function，CSP 只需要 'wasm-unsafe-eval'。
importScripts("../../vendor/libheif/libheif.js");

let libPromise = null;
function getLib() {
    if (!libPromise) {
        libPromise = fetch(new URL("../../vendor/libheif/libheif.wasm", self.location.href))
            .then((res) => {
                if (!res.ok) throw new Error(`wasm ${res.status}`);
                return res.arrayBuffer();
            })
            .then((wasmBinary) => libheif({ wasmBinary }));
    }
    return libPromise;
}

self.onmessage = async ({ data: { id, buffer } }) => {
    try {
        const lib = await getLib();
        const images = new lib.HeifDecoder().decode(new Uint8Array(buffer));
        if (!images.length) throw new Error("no image");
        const image = images[0];
        const width = image.get_width();
        const height = image.get_height();
        const rgba = new Uint8ClampedArray(width * height * 4);
        await new Promise((resolve, reject) => {
            image.display({ data: rgba, width, height }, (out) => (out ? resolve() : reject(new Error("display failed"))));
        });
        self.postMessage({ id, width, height, buffer: rgba.buffer }, [rgba.buffer]);
    } catch (err) {
        self.postMessage({ id, error: String(err?.message || err) });
    }
};
