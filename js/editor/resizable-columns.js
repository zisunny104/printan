// 三欄可拖曳調整寬度（VS Code 風格）：拖曳兩條分隔線改變 --printan-list-width /
// --printan-dock-width，寬度存進 localStorage 跨重整記住（純 UI 偏好，不寫進 .ptan 專案檔）。
// 移植自 koilisu/apps/pitrace 的 js/ui/resizable-columns.js，同一套邏輯。
// 只在桌面版三欄並排（≥1024px）時看得到；手機/平板堆疊版面分隔線本身是 display:none，
// 拖曳/鍵盤事件掛著也不會被觸發。

import { safeGetItem, safeSetItem } from "../core/storage.js";

const STORAGE_KEY_LIST = "printan-list-width";
const STORAGE_KEY_DOCK = "printan-dock-width";
const DEFAULT_LIST = 290;
const DEFAULT_DOCK = 340;
const MIN_LIST = 200;
const MAX_LIST = 420;
const MIN_DOCK = 260;
const MAX_DOCK = 520;
const MIN_CANVAS = 320; // 中央畫布至少保留的寬度，避免兩側分隔線同時拉到最大把畫布擠不見

function readStoredWidth(key, fallback, min, max) {
    const raw = Number(safeGetItem(key));
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.min(max, Math.max(min, raw));
}

function currentWidth(varName, fallback) {
    const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName));
    return Number.isFinite(raw) ? raw : fallback;
}

function applyWidth(varName, px) {
    document.documentElement.style.setProperty(varName, `${px}px`);
}

export function wireResizableColumns() {
    const shell = document.getElementById("editorShell");
    const resizerLeft = document.getElementById("colResizerLeft");
    const resizerRight = document.getElementById("colResizerRight");
    if (!shell || !resizerLeft || !resizerRight) return;

    applyWidth("--printan-list-width", readStoredWidth(STORAGE_KEY_LIST, DEFAULT_LIST, MIN_LIST, MAX_LIST));
    applyWidth("--printan-dock-width", readStoredWidth(STORAGE_KEY_DOCK, DEFAULT_DOCK, MIN_DOCK, MAX_DOCK));

    // 扣掉另一欄目前寬度、兩條分隔線本身寬度、中央畫布最小寬度後，這一欄還能長到多寬
    function maxAllowed(otherWidth) {
        const resizerTotal = resizerLeft.getBoundingClientRect().width + resizerRight.getBoundingClientRect().width;
        return shell.getBoundingClientRect().width - otherWidth - resizerTotal - MIN_CANVAS;
    }

    function setupResizer(resizer, { varName, storageKey, min, max, defaultPx, getOtherWidth, sign }) {
        function updateAria(px) {
            resizer.setAttribute("aria-valuemin", String(min));
            resizer.setAttribute("aria-valuemax", String(max));
            resizer.setAttribute("aria-valuenow", String(Math.round(px)));
        }
        updateAria(currentWidth(varName, defaultPx));

        function clamp(px) {
            const cap = Math.min(max, maxAllowed(getOtherWidth()));
            return Math.min(cap, Math.max(min, px));
        }

        function commit(px) {
            safeSetItem(storageKey, String(px));
        }

        resizer.addEventListener("mousedown", (evt) => {
            if (evt.button !== 0) return;
            evt.preventDefault();
            const startX = evt.clientX;
            const startWidth = currentWidth(varName, defaultPx);
            resizer.classList.add("is-dragging");
            document.body.style.userSelect = "none";

            // mousemove 頻率可能高於螢幕更新率，這裡用 rAF 節流成每畫格最多套用一次，
            // 避免每個原生事件都各自觸發一次 layout。
            let rafId = null;
            let pendingClientX = startX;

            function apply() {
                rafId = null;
                const next = clamp(startWidth + (pendingClientX - startX) * sign);
                applyWidth(varName, next);
                updateAria(next);
            }
            function onMove(moveEvt) {
                pendingClientX = moveEvt.clientX;
                if (rafId === null) rafId = requestAnimationFrame(apply);
            }
            function onUp() {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                if (rafId !== null) {
                    cancelAnimationFrame(rafId);
                    apply();
                }
                resizer.classList.remove("is-dragging");
                document.body.style.userSelect = "";
                commit(currentWidth(varName, defaultPx));
            }
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });

        resizer.addEventListener("dblclick", () => {
            applyWidth(varName, defaultPx);
            updateAria(defaultPx);
            commit(defaultPx);
        });

        resizer.addEventListener("keydown", (evt) => {
            if (evt.key !== "ArrowLeft" && evt.key !== "ArrowRight") return;
            evt.preventDefault();
            const step = evt.shiftKey ? 50 : 10;
            const dir = evt.key === "ArrowRight" ? 1 : -1;
            const next = clamp(currentWidth(varName, defaultPx) + dir * sign * step);
            applyWidth(varName, next);
            updateAria(next);
            commit(next);
        });
    }

    setupResizer(resizerLeft, {
        varName: "--printan-list-width",
        storageKey: STORAGE_KEY_LIST,
        min: MIN_LIST,
        max: MAX_LIST,
        defaultPx: DEFAULT_LIST,
        getOtherWidth: () => currentWidth("--printan-dock-width", DEFAULT_DOCK),
        sign: 1,
    });

    setupResizer(resizerRight, {
        varName: "--printan-dock-width",
        storageKey: STORAGE_KEY_DOCK,
        min: MIN_DOCK,
        max: MAX_DOCK,
        defaultPx: DEFAULT_DOCK,
        getOtherWidth: () => currentWidth("--printan-list-width", DEFAULT_LIST),
        sign: -1,
    });
}
