// 熱感紙預覽的共用元件：紙張外觀（80 mm 紙、可印寬度 72 mm、切紙線）與固定尺寸的顯示。
// 顯示尺寸只由列印解析度決定：96 CSS px ＝ 1 吋，100% 時 576 點寬的內容在螢幕上就是 72 mm，
// 不隨視窗大小、頁面版面或裝置解析度改變（高解析螢幕用更多實體像素呈現，不改變 CSS 尺寸）。
// 寫真之村後台與 Kiosk 預覽、Printan 編輯器的實際大小共用同一份定義。

export const DPI = 203;
export const MM_PER_INCH = 25.4;
export const MM_PX = 96 / MM_PER_INCH;                       // 1 mm 佔幾個 CSS px
export const CSS_PX_PER_DOT = (96 / DPI);                    // 100% 時 1 個列印點佔幾個 CSS px
export const PAPER = { width: 640, margin: 32, top: 56, bottom: 120 }; // 80 mm 紙：640 點，可印寬度 576 點
export const ZOOM_STEPS = [1, 1.5, 2, 3];

/** 內容 canvas 放在紙上的外觀：偏暖的白、上下留白、印完後的切紙線。回傳新的 canvas。 */
export function paperCanvas(content) {
    const canvas = document.createElement("canvas");
    canvas.width = PAPER.width;
    canvas.height = content.height + PAPER.top + PAPER.bottom;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fbfaf5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(content, PAPER.margin, PAPER.top);
    const y = PAPER.top + content.height + 44;
    ctx.strokeStyle = "#999"; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(PAPER.margin, y); ctx.lineTo(PAPER.width - PAPER.margin, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#999"; ctx.font = "20px sans-serif"; ctx.textAlign = "center"; ctx.fillText("✂ 切紙", PAPER.width / 2, y + 30);
    return canvas;
}

/** 某個倍率下，canvas 的顯示寬度（CSS px）。 */
export function displayWidth(canvasWidth, zoom = 1) {
    return canvasWidth * CSS_PX_PER_DOT * zoom;
}

/**
 * 在 stage 裡顯示預覽。stage 是可捲動的容器，圖片大小固定、放不下就捲動。
 * @returns {{ setContent(canvas), setPaper(on), setZoom(z), download(withPaper, name), content, paper }}
 */
export function createPaperView(stage, { paper = true, zoom = 1 } = {}) {
    const img = document.createElement("img");
    img.alt = "列印預覽";
    img.style.maxWidth = "none";
    img.style.flex = "none";
    img.style.display = "block";
    img.style.margin = "auto";
    stage.style.overflow = "auto";
    stage.replaceChildren(img);
    const state = { content: null, paper, zoom, paperCanvas: null };

    function draw() {
        if (!state.content) return;
        const canvas = state.paper ? state.paperCanvas : state.content;
        img.src = canvas.toDataURL("image/png");
        img.style.width = displayWidth(canvas.width, state.zoom) + "px";
        stage.classList.toggle("is-paper", state.paper);
    }
    return {
        img,
        get content() { return state.content; },
        get paper() { return state.paperCanvas; },
        setContent(canvas) { state.content = canvas; state.paperCanvas = canvas ? paperCanvas(canvas) : null; draw(); },
        setPaper(on) { state.paper = !!on; draw(); },
        setZoom(z) { state.zoom = z; draw(); },
        download(withPaper, name = "preview") {
            const canvas = withPaper ? state.paperCanvas : state.content;
            if (!canvas) return;
            canvas.toBlob((blob) => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${name}-${withPaper ? "paper" : "content"}.png`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }, "image/png");
        },
    };
}
