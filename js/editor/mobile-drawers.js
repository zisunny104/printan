// 小螢幕（<768px）的抽屜：版面結構＝<dialog>（modal），元素設定＝#inspectorDock 底部面板（非 modal）。
// ≥768px 兩者是一般側欄，這裡完全不動作。抽屜容器本身不會被重繪取代（只換內部節點）。

import { state } from "./context.js";

const mobileQuery = window.matchMedia("(width < 768px)");
const $ = (id) => document.getElementById(id);

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
    outline.addEventListener("close", () => outlineBtn.setAttribute("aria-expanded", "false"));
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
