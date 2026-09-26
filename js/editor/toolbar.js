// 懸浮工具列（.canvas-floating-toolbar，partials/canvas.php）：新增元素、螢幕/熱感與
// 預覽模式切換、窄寬度時的收合選單、新增圖片檔案處理。頂部那條（新增/開啟/匯出/列印）
// 是 operations.js，兩者是不同的 UI，不共用「工具列」這個名字。

import { getPaperWidth } from "../core/printer-profiles.js";
import { createImageElement } from "../core/document-model.js";
import { fileToDataUrl } from "../core/ptan-file.js";
import { convertHeicIfNeeded } from "../core/heic.js";
import { els, rt, state } from "./context.js";
import { addElement, insertElement, wireAddMenu } from "./element-actions.js";
import { wireOutlineKeyboard } from "./outline.js";
import { renderEditOverlay } from "./canvas-overlay.js";
import { getEffectiveProfile, schedulePreview } from "./editor.js";

// 通用下拉選單開關：開／關／切換，碰撞感知（下方空間不夠時翻到上面顯示），點擊選單外
// 或按 Esc 都會關閉。{portal:true} 時選單會被搬到 document.body、改用 position:fixed
// 算座標，用來跳脫 .canvas-floating-toolbar 的 overflow-x:auto（同一條規則會把
// overflow-y 一併提升成 auto，選單留在原地會被工具列自己的框裁掉）。
// 同 koilisu/apps/pitrace js/ui/toolbar.js 的 wireDropdownToggle()。
function wireDropdownToggle(trigger, menu, onToggle, opts = {}) {
    const portal = opts.portal;
    function position() {
        const rect = trigger.getBoundingClientRect();
        const shell = trigger.closest(".canvas-floating-toolbar");
        const shellRect = shell ? shell.getBoundingClientRect() : rect;
        const gap = 10;
        menu.style.position = "fixed";
        menu.style.visibility = "hidden";
        menu.style.top = "0px";
        const menuHeight = menu.offsetHeight;
        const menuWidth = menu.offsetWidth;
        const fitsBelow = shellRect.bottom + gap + menuHeight <= window.innerHeight - 8;
        const top = fitsBelow ? shellRect.bottom + gap : Math.max(8, shellRect.top - gap - menuHeight);
        const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.style.visibility = "";
    }
    function close() {
        menu.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        onToggle?.(false);
    }
    function open() {
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
        if (portal) {
            document.body.appendChild(menu);
            position();
        }
        onToggle?.(true);
    }
    function toggle() {
        if (menu.hidden) open();
        else close();
    }
    document.addEventListener("click", (evt) => {
        if (!menu.hidden && evt.target !== trigger && !menu.contains(evt.target) && !trigger.contains(evt.target)) close();
    });
    document.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape" && !menu.hidden) {
            close();
            trigger.focus();
        }
    });
    return { open, close, toggle };
}

// 容器變窄放不下整排按鈕時（例如欄寬被拉桿拖窄），依 data-collapse-priority 由小到大
// 把整顆按鈕完整地收進「更多工具」選單，而不是壓縮/裁切它們，可見按鈕永遠維持原始
// 大小，也不需要橫向捲動工具列才找得到——比照 Figma 窄寬度工具列的做法，同
// koilisu/apps/pitrace 的 wireToolbarOverflow()。用 ResizeObserver 量工具列父層的
// 實際寬度（不是 window 寬度），因為可用寬度還受使用者可拖曳的欄寬拉桿影響。
export function wireToolbarOverflow() {
    const bar = document.querySelector(".canvas-floating-toolbar");
    const trigger = document.getElementById("btnToolbarOverflow");
    const wrap = document.getElementById("toolbarOverflowWrap");
    const menu = document.getElementById("toolbarOverflowMenu");
    if (!bar || !trigger || !wrap || !menu) return;

    const units = Array.from(bar.querySelectorAll("[data-collapse-priority]"))
        .sort((a, b) => Number(a.dataset.collapsePriority) - Number(b.dataset.collapsePriority));
    // 優先權 -> 該層對應的選單代理按鈕（多欄那層有 4 個比例選項，收合／露出都一起動作）。
    // 代理按鈕直接呼叫真正控制項的 .click()，沿用它原本的事件邏輯，不用另外複製一份判斷。
    const proxies = {
        1: [
            { menuId: "overflowRatio11", targetId: "row-ratio-1-1" },
            { menuId: "overflowRatio21", targetId: "row-ratio-2-1" },
            { menuId: "overflowRatio12", targetId: "row-ratio-1-2" },
            { menuId: "overflowRatio111", targetId: "row-ratio-1-1-1" },
        ],
        2: [{ menuId: "overflowAddSpacer", targetId: "btn-add-spacer" }],
        3: [{ menuId: "overflowAddBarcode", targetId: "btn-add-barcode" }],
        4: [{ menuId: "overflowAddDivider", targetId: "btn-add-divider" }],
        5: [{ menuId: "overflowAddImage", targetId: "btn-add-image" }],
        6: [{ menuId: "overflowAddText", targetId: "btn-add-text" }],
    };
    const allProxies = Object.values(proxies).flat();

    const { toggle, close } = wireDropdownToggle(trigger, menu, null, { portal: true });
    trigger.addEventListener("click", toggle);

    for (const { menuId, targetId } of allProxies) {
        document.getElementById(menuId).addEventListener("click", () => {
            document.getElementById(targetId).click();
            close();
            trigger.focus();
        });
    }

    // 每次都先全部展開回原始大小再重新量寬度，而不是在既有收合狀態上做增量判斷——
    // 收合層級只有幾層，重算成本很低，換來的是不管容器寬度怎麼變化都能收斂到同一個
    // 穩定結果，不用擔心增量邏輯漏判某個中間狀態。
    function applyCollapse() {
        units.forEach((u) => u.style.removeProperty("display"));
        allProxies.forEach(({ menuId }) => { document.getElementById(menuId).hidden = true; });
        // 先在觸發鈕還藏著的狀態量一次：全部按鈕完整展開、不含「更多工具」鈕本身寬度，
        // 這樣就放得下的話完全不用收合，觸發鈕也不用出現——不然觸發鈕一開始就佔位量
        // 寬度，容器明明夠寬也會被誤判成需要收合。
        wrap.hidden = true;
        if (bar.scrollWidth <= bar.clientWidth) {
            if (!menu.hidden) close();
            return;
        }
        // 展開後真的放不下，才需要收合，這種情況下「更多工具」鈕勢必得跟著露出來，
        // 從這裡開始把它的寬度也算進判斷式，收合迴圈才會收到真正夠用為止。
        wrap.hidden = false;

        // units 已依 data-collapse-priority 由小到大排序，數字愈小代表愈該優先被收合。
        // 量測階段：先把目前的溢出量、每顆候選按鈕的寬度全部讀完（純讀取，中間不穿插
        // 任何 style 寫入），用累加寬度估算要收到第幾顆才夠，避免讀寫交錯逼出同步 reflow。
        let overflow = bar.scrollWidth - bar.clientWidth;
        const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
        let collapseCount = 0;
        for (let i = 0; i < units.length && overflow > 0; i++) {
            overflow -= units[i].getBoundingClientRect().width + gap;
            collapseCount = i + 1;
        }

        // 寫入階段：一次把估算出需要收合的按鈕全部設成 display:none，中間不再穿插寬度讀取。
        for (let i = 0; i < collapseCount; i++) {
            const priority = units[i].dataset.collapsePriority;
            units[i].style.display = "none";
            proxies[priority].forEach(({ menuId }) => { document.getElementById(menuId).hidden = false; });
        }

        // 保險：寬度估算沒算到的邊界效應（subpixel 捨入等）導致還是放不下，才退回逐顆
        // 收合＋重新量測——這是罕見的補漏路徑，一般情況下不會跑到這裡。
        for (let i = collapseCount; i < units.length && bar.scrollWidth > bar.clientWidth; i++) {
            const priority = units[i].dataset.collapsePriority;
            units[i].style.display = "none";
            proxies[priority].forEach(({ menuId }) => { document.getElementById(menuId).hidden = false; });
        }
    }

    // 觀察的不是 bar 自己，是它錨定的父層 #canvasPane：bar 是 width:max-content、
    // max-width 相對父層，收合到只剩內容需要的寬度後，父層之後變寬 bar 也不會再變，
    // 只盯著 bar 會導致容器變寬後收合狀態永遠無法還原。
    new ResizeObserver(applyCollapse).observe(bar.parentElement);
    applyCollapse();
}

export function bindToolbar() {
    els["btn-add-text"].addEventListener("click", () => addElement("text"));
    els["btn-add-spacer"].addEventListener("click", () => addElement("spacer"));
    els["btn-add-divider"].addEventListener("click", () => addElement("divider"));
    els["btn-add-barcode"].addEventListener("click", () => addElement("barcode"));
    els["btn-add-image"].addEventListener("click", () => addElement("image"));

    document.querySelectorAll("#row-ratio-dropdown .item[data-ratio]").forEach((item) => {
        item.addEventListener("click", () => addElement("row", { ratio: item.dataset.ratio.split(",").map(Number) }));
    });

    wireAddMenu();
    wireOutlineKeyboard();

    els["btn-toggle-thermal"].addEventListener("click", () => {
        state.mode = state.mode === "screen" ? "thermal" : "screen";
        els["btn-toggle-thermal"].classList.toggle("is-active", state.mode === "thermal");
        schedulePreview();
    });

    els["btn-toggle-preview-mode"].addEventListener("click", () => {
        state.viewMode = state.viewMode === "edit" ? "preview" : "edit";
        const isPreview = state.viewMode === "preview";
        els["btn-toggle-preview-mode"].classList.toggle("is-active", isPreview);
        els["btn-toggle-preview-mode"].setAttribute("aria-pressed", String(isPreview));
        els["paper-viewport"].classList.toggle("is-preview-mode", isPreview);
        renderEditOverlay();
    });
}

// image-file-input 是整個編輯器共用的單一 hidden input（懸浮工具列「新增圖片」與各圖片元素
// inspector 的「更換圖片」都借用同一個），用這個變數帶「這一次選檔要怎麼處理」，避免像過去
// 那樣在同一個 input 上疊加第二個 change 監聽器（會兩邊都觸發，多插入一個重複元素）。

const SAFE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]); // 與匯入 .ptan 的白名單一致

async function handleImageFileSelected(file) {
    let converted;
    try {
        converted = await convertHeicIfNeeded(file);
    } catch (err) {
        alert(`HEIC 轉換失敗：${err.message}`);
        return null;
    }
    if (!SAFE_IMAGE_TYPES.has(converted.type)) {
        alert("只支援 PNG、JPEG、GIF、WebP 圖片");
        return null;
    }
    const dataUrl = await fileToDataUrl(converted);
    const assetId = `asset_${Date.now().toString(36)}`;
    state.project.assets.push({ id: assetId, type: converted.type, dataUrl });
    return assetId;
}

// 新圖片的預設寬度：小圖（logo、圖示）不放大到滿版，照原始像素寬佔可列印寬的比例；大圖一律 100%
async function defaultImageWidthPercent(assetId) {
    const asset = state.project.assets.find((a) => a.id === assetId);
    const img = new Image();
    img.src = asset?.dataUrl || "";
    try { await img.decode(); } catch { return 100; }
    const printable = getPaperWidth(getEffectiveProfile(), state.project.paper.widthId).printableWidthDots;
    return Math.min(100, Math.max(10, Math.round((img.naturalWidth / printable) * 100)));
}

export function bindImageFileInput() {
    els["image-file-input"].addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        const handler = rt.imageFileInputHandler;
        rt.imageFileInputHandler = null;
        if (!file) return;
        const assetId = await handleImageFileSelected(file);
        if (!assetId) return;
        if (handler) handler(assetId);
        else insertElement(createImageElement({ assetId, widthPercent: await defaultImageWidthPercent(assetId) }));
    });
}
