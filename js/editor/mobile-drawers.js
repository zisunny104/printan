// 小螢幕（<768px）的抽屜：版面結構＝<dialog>（modal），元素設定＝#inspectorDock 底部面板（非 modal）。
// ≥768px 兩者是一般側欄，這裡完全不動作。抽屜容器本身不會被重繪取代（只換內部節點）。

import { state } from "./context.js";

const mobileQuery = window.matchMedia("(width < 768px)");
const $ = (id) => document.getElementById(id);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const DRAG_START_PX = 6;
const CLOSE_RATIO = 0.25; // 拖過抽屜高度的 25% 就算數
const FLICK_PX_PER_MS = 0.5; // 或速度夠快
const EXPANDED_MAX = "calc(100dvh - 3.5rem)";

/**
 * 抽屜手勢：拖把手區（橫條與標題列）往下收合、往上拉高，未過門檻回彈；
 * 內容區只有在捲到頂端又往下拖時才轉成收合（touch 事件，才能 preventDefault 擋掉捲動）。
 * 拖曳中只動 transform；放開才做短動畫，prefers-reduced-motion 時直接切換。
 * 狀態：預設（CSS 的高度）／expanded（拉高）／關閉。onClose 負責真正關掉並還原焦點。
 */
function attachSheetGesture({ sheet, handle, scroller, sizeEl, isActive, onClose }) {
    if (!handle) return { reset() {} };
    const zone = [handle, sheet.querySelector(".pane-card-header")].filter(Boolean);
    let expanded = false;
    let suppressClick = false;
    let drag = null; // { startY, lastY, lastT, velocity, dy, id }

    for (const el of zone) el.style.touchAction = "none"; // 把手區的觸控一律交給我們
    handle.setAttribute("aria-expanded", "false");
    const syncLabel = () => {
        handle.setAttribute("aria-expanded", String(expanded));
        handle.setAttribute("aria-label", expanded ? "縮小面板（拖曳或按下鍵可收合）" : "拉高面板（拖曳或按上鍵可展開）");
    };
    syncLabel();

    const inZone = (t) => zone.some((z) => z.contains(t)) && (t.closest("button") === null || t.closest("button") === handle);
    const setDy = (dy) => { sheet.style.transform = dy ? `translateY(${dy}px)` : ""; };
    const animate = (to, done) => {
        if (reducedMotion.matches) { setDy(to); done?.(); return; }
        sheet.style.transition = "transform .2s ease-out";
        setDy(to);
        const end = () => { sheet.style.transition = ""; done?.(); };
        sheet.addEventListener("transitionend", end, { once: true });
        setTimeout(() => sheet.removeEventListener("transitionend", end) || end(), 260);
    };

    function setExpanded(value) {
        expanded = value;
        sizeEl.style.maxHeight = value ? EXPANDED_MAX : "";
        syncLabel();
    }
    function reset() {
        drag = null;
        sheet.style.transition = "";
        setDy(0);
        setExpanded(false);
    }
    function collapseOrClose() {
        if (expanded) setExpanded(false);
        else onClose();
    }

    function begin(y, id = null) {
        drag = { startY: y, lastY: y, lastT: performance.now(), velocity: 0, dy: 0, id, moving: false };
    }
    function move(y) {
        const now = performance.now();
        const dt = now - drag.lastT;
        if (dt > 0) drag.velocity = (y - drag.lastY) / dt;
        drag.lastY = y;
        drag.lastT = now;
        drag.dy = y - drag.startY;
        // 往上只給一點橡皮筋位移，真正拉高在放開時才改高度
        setDy(drag.dy > 0 ? drag.dy : Math.max(drag.dy / 3, -24));
    }
    function release() {
        const d = drag;
        drag = null;
        if (!d?.moving) return;
        const height = sheet.getBoundingClientRect().height;
        const far = Math.abs(d.dy) > height * CLOSE_RATIO;
        const fast = Math.abs(d.velocity) > FLICK_PX_PER_MS;
        if (d.dy > 0 && (far || fast)) {
            if (expanded) { setExpanded(false); animate(0); } // 拉高狀態先縮回預設
            else animate(height, () => { sheet.style.transition = ""; setDy(0); onClose(); });
        } else if (d.dy < 0 && (far || fast) && !expanded) {
            setExpanded(true);
            animate(0);
        } else {
            animate(0); // 回彈
        }
    }

    // 把手區：pointer events，一律可拖
    sheet.addEventListener("pointerdown", (e) => {
        if (!isActive() || !inZone(e.target) || (e.pointerType === "mouse" && e.button !== 0)) return;
        begin(e.clientY, e.pointerId);
        try { sheet.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    });
    sheet.addEventListener("pointermove", (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        if (!drag.moving && Math.abs(e.clientY - drag.startY) < DRAG_START_PX) return;
        drag.moving = true;
        move(e.clientY);
    });
    const end = (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        if (drag.moving) {
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
        }
        release();
    };
    sheet.addEventListener("pointerup", end);
    sheet.addEventListener("pointercancel", end);

    // 內容區：捲到頂端往下拖才轉成收合，其他一律讓它正常捲動
    let touch = null; // { startY, ok }
    scroller.addEventListener("touchstart", (e) => {
        if (!isActive() || inZone(e.target) || e.touches.length !== 1) { touch = null; return; }
        touch = { startY: e.touches[0].clientY, ok: scroller.scrollTop <= 0 };
    }, { passive: true });
    scroller.addEventListener("touchmove", (e) => {
        if (!touch || e.touches.length !== 1) return;
        const y = e.touches[0].clientY;
        if (!drag) {
            if (!touch.ok || y - touch.startY < DRAG_START_PX) { if (y < touch.startY) touch.ok = false; return; }
            begin(touch.startY);
            drag.moving = true;
        }
        if (e.cancelable) e.preventDefault();
        move(y);
    }, { passive: false });
    const touchEnd = () => { if (touch && drag) release(); touch = null; };
    scroller.addEventListener("touchend", touchEnd);
    scroller.addEventListener("touchcancel", touchEnd);

    // 鍵盤：Enter／Space（button 本來就會觸發 click）切換，上下鍵展開／收合
    handle.addEventListener("click", () => {
        if (suppressClick) return;
        if (expanded) setExpanded(false);
        else setExpanded(true);
    });
    handle.addEventListener("keydown", (e) => {
        if (e.key === "ArrowUp") { e.preventDefault(); setExpanded(true); }
        else if (e.key === "ArrowDown") { e.preventDefault(); collapseOrClose(); }
    });

    return { reset };
}

export function initMobileDrawers() {
    const outline = $("outlineSidebar");
    const dock = $("inspectorDock");
    const outlineBtn = $("btn-outline-drawer");
    const inspectorBtn = $("btn-inspector-drawer");
    if (!outline || !dock || !outlineBtn || !inspectorBtn) return;

    const isMobile = () => mobileQuery.matches;
    const isDockOpen = () => dock.classList.contains("is-open");

    function syncSheetHeight() {
        const height = isMobile() && isDockOpen() ? Math.ceil(dock.getBoundingClientRect().height) : 0;
        if (height) document.documentElement.style.setProperty("--printan-sheet-height", `${height}px`);
        else document.documentElement.style.removeProperty("--printan-sheet-height");
    }
    // 面板內容變動（換元素、展開收合區塊）高度會變，跟著更新
    const resizeObserver = new ResizeObserver(syncSheetHeight);
    resizeObserver.observe(dock);

    function scrollSelectedIntoView() {
        if (!state.selectedId) return;
        requestAnimationFrame(() => {
            document.querySelector(`#edit-overlay .edit-block[data-id="${state.selectedId}"]`)
                ?.scrollIntoView({ block: "center", inline: "nearest" });
        });
    }

    function setDock(open, { focus = false } = {}) {
        dock.classList.toggle("is-open", open);
        if (!open) dockGesture.reset();
        inspectorBtn.setAttribute("aria-expanded", String(open));
        syncSheetHeight();
        if (!open) return;
        scrollSelectedIntoView();
        if (focus) {
            const title = dock.querySelector(".pane-card-header-title");
            if (title) {
                title.tabIndex = -1;
                title.focus();
            }
        }
    }

    function setOutline(open) {
        if (open && !outline.open) outline.showModal();
        else if (!open && outline.open) outline.close();
        outlineBtn.setAttribute("aria-expanded", String(outline.open));
    }

    const dockGesture = attachSheetGesture({
        sheet: dock,
        handle: dock.querySelector(".sheet-handle"),
        scroller: dock,
        sizeEl: dock,
        isActive: () => isMobile() && isDockOpen(),
        onClose: () => { setDock(false); inspectorBtn.focus(); },
    });
    const outlineContent = outline.querySelector(".content");
    const outlineGesture = attachSheetGesture({
        sheet: outline,
        handle: outline.querySelector(".sheet-handle"),
        scroller: outlineContent,
        sizeEl: outlineContent,
        isActive: () => isMobile() && outline.open,
        onClose: () => outline.close(),
    });

    // 兩個抽屜不同時開
    outlineBtn.addEventListener("click", () => {
        if (!isMobile()) return;
        if (outline.open) return setOutline(false);
        setDock(false);
        setOutline(true);
    });
    inspectorBtn.addEventListener("click", () => {
        if (!isMobile()) return;
        if (isDockOpen()) return setDock(false);
        setOutline(false);
        setDock(true, { focus: true });
    });
    // 版面結構會被 Esc、點遮罩關掉，所以用 close 事件同步，不靠按鈕自己記狀態
    outline.addEventListener("close", () => {
        outlineBtn.setAttribute("aria-expanded", "false");
        outlineGesture.reset();
    });
    $("btn-outline-close")?.addEventListener("click", () => outline.close());
    $("btn-inspector-close")?.addEventListener("click", () => {
        setDock(false);
        inspectorBtn.focus();
    });
    dock.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !isMobile() || !isDockOpen() || e.defaultPrevented) return;
        e.preventDefault();
        setDock(false);
        inspectorBtn.focus();
    });

    // 在版面結構點選元素：收起抽屜回到畫布並打開元素設定
    $("outline-list")?.addEventListener("click", () => {
        if (!isMobile() || !outline.open) return;
        setTimeout(() => {
            if (!state.selectedId) return; // 點到的是新增目標之類，沒選到元素就留著抽屜
            setOutline(false);
            setDock(true);
        }, 0);
    });

    // 畫布上選到元素就打開面板（不搶焦點）；取消選取不強制關，避免點畫布空白就收掉正在編輯的面板
    document.addEventListener("printan:selectionchange", (e) => {
        if (!isMobile() || !e.detail.id) return;
        setOutline(false);
        setDock(true);
    });

    // 旋轉或拉寬到 ≥768px：抽屜狀態全部還原
    mobileQuery.addEventListener("change", () => {
        if (isMobile()) return;
        setOutline(false);
        setDock(false);
        outlineBtn.setAttribute("aria-expanded", "false");
    });
}
