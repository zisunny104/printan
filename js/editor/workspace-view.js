// 工作區檢視：縮放（−／＋／符合寬度／實際大小 1:1）與 mm 尺規。
// 縮放只改「紙張在螢幕上佔多少 CSS px」（pxPerMm），排版跟渲染結果都不變；
// zoom = 1 是實際大小：96 CSS px = 1 吋，所以 80mm 紙的 576 點（72mm）在螢幕上就是 72mm。
// 畫面上的「紙」就是白底可列印區（printableWidthMm，對應實際 576 點），沒有紙捲邊距。
// 尺規畫在 canvas 上：水平尺規以白底左緣為 0、右緣為終點，垂直尺規以白底上緣為 0；
// 跟著縮放與工作區捲動重畫。

const MM_PX = 96 / 25.4;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];
const RULERS_KEY = "printan:showRulers";
const RULER_STEPS_MM = [1, 2, 5, 10, 20, 50, 100, 200, 500];
const RULER_MINOR_MIN_PX = 4;
const RULER_LABEL_MIN_PX = 36;

function readRulersPref() {
    try {
        return localStorage.getItem(RULERS_KEY) !== "false";
    } catch {
        return true;
    }
}

function saveRulersPref(value) {
    try {
        localStorage.setItem(RULERS_KEY, String(value));
    } catch {
        // 存不進去就只在這次頁面內生效
    }
}

/**
 * @param {object} options
 * @param {() => number} options.getPaperWidthMm 目前可列印寬度的 mm（白底範圍），「符合寬度」用
 * @param {() => void} options.onZoom 縮放比例變了：呼叫端負責更新紙張尺寸、重畫編輯疊層
 */
export function createWorkspaceView({ getPaperWidthMm, onZoom }) {
    let zoom = 1;
    let zoomEditing = false; // 百分比欄位正在輸入：先不要用縮放值蓋掉使用者打的字
    let fitLocked = false; // 「符合寬度」啟用中：視窗大小改變時要跟著重算
    let showRulers = readRulersPref();
    let dom = null;
    let rafId = 0;

    const pxPerMm = () => MM_PX * zoom;

    function mount() {
        const byId = (id) => document.getElementById(id);
        dom = {
            scroll: byId("paper-scroll"),
            shadow: byId("paper-shadow"),
            rulerH: byId("ruler-h"),
            rulerV: byId("ruler-v"),
            corner: byId("ruler-corner"),
            value: byId("zoom-value"),
            btnOut: byId("btn-zoom-out"),
            btnIn: byId("btn-zoom-in"),
            btnFit: byId("btn-zoom-fit"),
            btnActual: byId("btn-zoom-actual"),
            btnRulers: byId("btn-toggle-rulers"),
        };

        wireZoomInput();
        dom.btnOut.addEventListener("click", () => setZoom(nextStep(-1)));
        dom.btnIn.addEventListener("click", () => setZoom(nextStep(1)));
        dom.btnFit.addEventListener("click", () => setZoom(fitZoom(), true));
        dom.btnActual.addEventListener("click", () => setZoom(1));
        dom.btnRulers.addEventListener("click", () => {
            showRulers = !showRulers;
            saveRulersPref(showRulers);
            syncUi();
            scheduleRedraw();
        });

        // Ctrl／⌘＋滾輪與觸控板雙指捏合（瀏覽器以 wheel＋ctrlKey 送出）：以游標為錨點縮放，只在工作區內攔截
        dom.scroll.addEventListener("wheel", (e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
            const sr = dom.scroll.getBoundingClientRect();
            setZoom(zoom * Math.exp(-Math.max(-60, Math.min(60, delta)) * 0.01), false, { x: e.clientX - sr.left, y: e.clientY - sr.top });
        }, { passive: false });
        dom.scroll.addEventListener("scroll", scheduleRedraw, { passive: true });
        const resizeObserver = new ResizeObserver(() => {
            if (fitLocked) setZoom(fitZoom(), true);
            else syncUi();
            scheduleRedraw();
        });
        resizeObserver.observe(dom.scroll);
        resizeObserver.observe(dom.shadow);
        // 主題切換是改 <body class>（見 partials/theme-script.php setTheme）；系統主題變更則靠 media query
        new MutationObserver(scheduleRedraw).observe(document.body, { attributes: true, attributeFilter: ["class"] });
        matchMedia("(prefers-color-scheme: dark)").addEventListener("change", scheduleRedraw);
        // devicePixelRatio 變了（瀏覽器縮放、拖到另一個螢幕）尺規要用新的倍率重畫；
        // resolution 的 media query 只在「離開目前 dpr」時觸發一次，所以每次都重新掛。
        const watchDpr = () => {
            matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener("change", () => {
                scheduleRedraw();
                watchDpr();
            }, { once: true });
        };
        watchDpr();

        // 起始縮放：能放得下就用實際大小，欄位太窄就縮到符合寬度，不要一開始就出現橫向捲軸
        zoom = Math.min(1, fitZoom());
        fitLocked = zoom < 1;
        syncUi();
    }

    // 百分比欄位：Enter／失焦套用（超出範圍夾到邊界、不是數字就還原），Esc 還原；↑↓ ±1%，Shift ±10%。
    // 鍵盤事件不往外傳，避免 ↑↓ 被當成移動畫布元素。
    function wireZoomInput() {
        const input = dom.value;
        const percent = () => Math.round(zoom * 100);
        const commit = () => {
            const n = parseFloat(input.value.replace(/[^\d.]/g, ""));
            zoomEditing = false;
            if (Number.isFinite(n)) setZoom(n / 100);
            syncUi();
        };
        input.addEventListener("focus", () => input.select());
        input.addEventListener("input", () => { zoomEditing = true; });
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                commit();
                input.select();
            } else if (e.key === "Escape") {
                zoomEditing = false;
                syncUi();
                input.blur();
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                const step = (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
                setZoom((percent() + step) / 100);
                input.select();
            }
        });
    }

    function fitZoom() {
        const style = getComputedStyle(dom.scroll);
        const inner = dom.scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const widthMm = getPaperWidthMm();
        if (!(inner > 0) || !(widthMm > 0)) return 1;
        return inner / (widthMm * MM_PX);
    }

    function nextStep(direction) {
        // 容許浮點誤差，避免 0.9999 被當成「比 1 小」而卡在同一格
        const eps = 0.005;
        if (direction > 0) return ZOOM_STEPS.find((z) => z > zoom + eps) ?? ZOOM_MAX;
        return [...ZOOM_STEPS].reverse().find((z) => z < zoom - eps) ?? ZOOM_MIN;
    }

    // 縮放時讓錨點（預設是工作區畫面中心；滾輪縮放是游標位置）下的紙面位置不動，不會一縮放就跳到別處
    function setZoom(next, fit = false, focus = null) {
        next = Math.min(Math.max(next, ZOOM_MIN), ZOOM_MAX);
        fitLocked = fit;
        if (Math.abs(next - zoom) < 0.0005) return;
        const { scroll, shadow } = dom;
        const fx = focus ? focus.x : scroll.clientWidth / 2;
        const fy = focus ? focus.y : scroll.clientHeight / 2;
        const anchorBefore = readAnchor(scroll, shadow, fx, fy);
        zoom = next;
        onZoom();
        const anchorAfter = readAnchor(scroll, shadow, fx, fy);
        scroll.scrollTop = anchorAfter.originY + anchorBefore.mmY * pxPerMm() - fy;
        scroll.scrollLeft = anchorAfter.originX + anchorBefore.mmX * pxPerMm() - fx;
        syncUi();
        redraw();
    }

    // 紙張左上角在捲動內容座標系裡的位置（originX/Y），以及視窗內 (fx, fy) 那一點對應紙上的 mm
    function readAnchor(scroll, shadow, fx, fy) {
        const sr = scroll.getBoundingClientRect();
        const pr = shadow.getBoundingClientRect();
        const originX = pr.left - sr.left + scroll.scrollLeft;
        const originY = pr.top - sr.top + scroll.scrollTop;
        return {
            originX,
            originY,
            mmX: (scroll.scrollLeft + fx - originX) / pxPerMm(),
            mmY: (scroll.scrollTop + fy - originY) / pxPerMm(),
        };
    }

    function syncUi() {
        if (!zoomEditing) dom.value.value = `${Math.round(zoom * 100)}%`;
        const fitZoomNow = Math.min(Math.max(fitZoom(), ZOOM_MIN), ZOOM_MAX);
        dom.btnFit.setAttribute("aria-pressed", String(Math.abs(zoom - fitZoomNow) < 0.005));
        dom.btnActual.setAttribute("aria-pressed", String(Math.abs(zoom - 1) < 0.0005));
        dom.btnOut.disabled = zoom <= ZOOM_MIN + 0.0005;
        dom.btnIn.disabled = zoom >= ZOOM_MAX - 0.0005;
        dom.btnRulers.classList.toggle("is-active", showRulers);
        dom.btnRulers.setAttribute("aria-pressed", String(showRulers));
        dom.rulerH.hidden = !showRulers;
        dom.rulerV.hidden = !showRulers;
        dom.corner.hidden = !showRulers;
    }

    function scheduleRedraw() {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            redraw();
        });
    }

    function redraw() {
        if (!dom || !showRulers) return;
        const sr = dom.shadow.getBoundingClientRect();
        drawRuler(dom.rulerH, "h", sr.left - dom.rulerH.getBoundingClientRect().left, sr.width);
        drawRuler(dom.rulerV, "v", sr.top - dom.rulerV.getBoundingClientRect().top, sr.height);
    }

    // originPx：白底 0mm 在尺規座標系裡的位置；extentPx：白底在這個方向上的長度（只在白底上畫刻度）
    function drawRuler(box, orientation, originPx, extentPx) {
        const canvas = box.firstElementChild;
        const w = box.clientWidth;
        const h = box.clientHeight;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext("2d");
        // 以 canvas 實際像素／CSS 尺寸換算，避免四捨五入後的落差造成拉伸
        const sx = canvas.width / w;
        const sy = canvas.height / h;
        ctx.setTransform(sx, 0, 0, sy, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const ppm = pxPerMm();
        const minorStep = RULER_STEPS_MM.find((s) => s * ppm >= RULER_MINOR_MIN_PX) ?? RULER_STEPS_MM.at(-1);
        const labelStep = RULER_STEPS_MM.find((s) => s % minorStep === 0 && s * ppm >= RULER_LABEL_MIN_PX) ?? RULER_STEPS_MM.at(-1);
        const length = orientation === "h" ? w : h;
        const thickness = orientation === "h" ? h : w;
        const extentMm = extentPx / ppm;
        const firstIndex = Math.max(0, Math.floor((0 - originPx) / ppm / minorStep));
        const lastIndex = Math.min(Math.floor((extentMm + 0.001) / minorStep), Math.ceil((length - originPx) / ppm / minorStep));

        ctx.strokeStyle = ctx.fillStyle = getComputedStyle(box).color;
        ctx.lineWidth = 1 / dpr;
        ctx.font = "10px system-ui, sans-serif";
        ctx.textBaseline = "top";
        ctx.beginPath();
        const labels = [];
        for (let i = firstIndex; i <= lastIndex; i++) {
            const mm = i * minorStep;
            // 刻度線對齊裝置像素，dpr 非整數時才不會糊
            const pos = (Math.round((originPx + mm * ppm) * dpr) + 0.5) / dpr;
            const isLabel = mm % labelStep === 0;
            const isMid = !isLabel && (mm * 2) % labelStep === 0;
            const tick = isLabel ? thickness * 0.4 : isMid ? thickness * 0.28 : thickness * 0.18;
            if (orientation === "h") {
                ctx.moveTo(pos, thickness);
                ctx.lineTo(pos, thickness - tick);
            } else {
                ctx.moveTo(thickness, pos);
                ctx.lineTo(thickness - tick, pos);
            }
            if (isLabel) labels.push({ mm, pos });
        }
        // 水平尺規終點對齊白底右緣：終點不是刻度間距的整數倍時（例如 72mm、間距 20mm）補一條終點刻度
        if (orientation === "h" && extentMm % minorStep > 0.001 && originPx + extentPx <= length) {
            const pos = (Math.round((originPx + extentPx) * dpr) + 0.5) / dpr;
            ctx.moveTo(pos, thickness);
            ctx.lineTo(pos, thickness - thickness * 0.4);
        }
        ctx.stroke();

        for (const { mm, pos } of labels) {
            const text = String(mm);
            const textW = ctx.measureText(text).width;
            if (orientation === "h") {
                // 靠近右緣放不下時改靠刻度左側
                const flip = pos + 2 + textW > w;
                ctx.textAlign = flip ? "right" : "left";
                ctx.fillText(text, flip ? pos - 2 : pos + 2, 2);
            } else {
                // 文字旋轉後朝上排；靠近上緣放不下時改朝下排
                const flip = pos - 2 - textW < 0;
                ctx.save();
                ctx.translate(2, flip ? pos + 2 : pos - 2);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = flip ? "right" : "left";
                ctx.fillText(text, 0, 0);
                ctx.restore();
            }
        }
    }

    return { mount, pxPerMm, redraw: scheduleRedraw };
}
