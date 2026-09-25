// Printan Editor — 串接 core（Document Model / Renderer / Storage）與畫面互動。
// Editor 本身不做排版運算，排版與繪製一律呼叫 core/renderer.js，
// 確保「編輯器看到的結果」跟「實際輸出結果」用同一套邏輯（見需求單第廿一節）。

import { createEmptyProject, loadProject } from "../core/schema.js";
import {
    getPrinterProfile, getPaperWidth, getDefaultPrinterProfileId, withPrintableDotsOverrides,
    withMarginCalibration,
} from "../core/printer-profiles.js";
import { createImageElement, extractPlaceholders } from "../core/document-model.js";
import { findElementById } from "../core/element-tree.js";
import { renderTemplate } from "../core/renderer.js";

import { restoreLocalFontsIfGranted } from "../core/fonts.js";
import { onWebFontStatusChange } from "../core/web-fonts.js";
import { downloadPtan, readPtanFile, fileToDataUrl } from "../core/ptan-file.js";
import { convertHeicIfNeeded } from "../core/heic.js";

import { saveDraft, loadDraft, deleteDraft, listRecent, safeGetItem, safeSetItem } from "../core/storage.js";
import { wireResizableColumns } from "./resizable-columns.js";
import { createInlineTextEditor } from "./inline-text-editor.js";
import { createWorkspaceView } from "./workspace-view.js";
import { createInfoIcon, hideStageNotice, showStageNotice, wireHelpDialog } from "./ui-helpers.js";
import { LAST_DRAFT_KEY, currentElements, currentPage, els, rt, state } from "./context.js";
import {
    attemptSilentPrinterReconnect, bindPrinterSettings, loadPrintPrefs, printCurrent, renderMarginRows,
    renderPrintableDotsRows,
} from "./printer-settings.js";
import { textInput } from "./inspector-widgets.js";
import { renderInspector } from "./inspector.js";
import { initMobileDrawers } from "./mobile-drawers.js";
import { runAutosave } from "./save-status.js";
import { renderEditOverlay } from "./canvas-overlay.js";
import { renderOutline, wireOutlineKeyboard } from "./outline.js";
import { bindBatchPanel, endBatchPreview, exportBatchPdf, exportSinglePdf } from "./batch-export.js";
import { bindEditorShortcuts, recordHistory, resetHistory } from "./history.js";
import { addElement, insertElement, wireAddMenu } from "./element-actions.js";
import { bootKioskFromQuery } from "./kiosk.js";
import { bindPageList, renderPageList } from "./pages.js";
import { bindPagePager, invalidatePageThumbs, renderPageThumbs, revealActivePage, syncPageBoard } from "./page-board.js";

async function init() {
    cacheDom();
    state.project = await restoreOrCreateProject();
    loadPrintPrefs();
    updateFeedLinesHint();
    populatePaperWidthTabs();
    populateRecentDrafts();
    bindToolbar();
    bindFileInputs();
    bindBatchPanel();
    bindPrinterSettings();
    bindEditorShortcuts();
    bindProjectName();
    renderProjectName();
    bindPageList();
    bindPagePager();
    renderPageList();
    wireResizableColumns();
    wireToolbarOverflow();
    workspace.mount();
    wireZoomRevealsActivePage();
    wireHelpDialog();
    initMobileDrawers();
    onModelChange({ skipInspector: false });
    // 到這裡大綱／畫布／檢視器都已經是真的內容，骨架畫面可以淡出了；下面印表機重連、
    // kiosk 版型套用都跟畫面初次可見無關，不用等它們（也可能因裝置環境卡住，會拖著骨架不放）。
    hideEditorSkeleton();
    onWebFontStatusChange(() => { // 字體載入失敗／恢復時，選單上的標示要跟著更新；非作用中頁面的縮圖可能是用替代字體畫的
        renderInspector();
        invalidatePageThumbs();
        schedulePreview();
    });
    restoreLocalFontsIfGranted().then((restored) => { if (restored) renderInspector(); });
    await attemptSilentPrinterReconnect();
    // kiosk.js：網址帶 tpl= 才會動作，一般開啟編輯器（沒有這個參數）完全不受影響
    await bootKioskFromQuery(loadProjectIntoEditor, schedulePreview);
}

// 載入骨架畫面（partials/editor-skeleton.php）蓋在三欄上面，init() 到這裡才算「畫面已經是真的」
// （草稿已還原、印表機重連跑完、kiosk 版型也套用完畢），先淡出再整個移除，避免擋住底下互動。
function hideEditorSkeleton() {
    const skeleton = document.getElementById("editorSkeleton");
    if (!skeleton) return;
    skeleton.classList.add("is-hiding");
    skeleton.addEventListener("transitionend", () => skeleton.remove(), { once: true });
}

function cacheDom() {
    [
        "save-status", "paper-width-tabs",
        "btn-outline-add", "btn-toolbar-add", "btn-add-text", "btn-add-image", "btn-add-spacer", "btn-add-divider", "btn-add-barcode",
        "btn-toggle-thermal", "btn-toggle-preview-mode",
        "btn-new-ptan", "btn-open-ptan", "open-project-from-file", "recent-drafts-list",
        "btn-save-ptan", "btn-export-pdf",
        "btn-export-batch-pdf", "btn-print", "outline-list", "inspector",
        "variables-panel", "variables-card", "variables-card-spacer", "batch-data", "paper-viewport", "paper-scroll", "paper-shadow", "safe-area-guide",
        "canvas-host", "image-file-input", "ptan-file-input",
        "batch-card", "batch-card-spacer", "batch-panel-toggle", "batch-panel-body", "btn-preview-batch", "batch-preview-nav",
        "btn-batch-prev", "btn-batch-next", "batch-preview-counter", "btn-batch-end-preview",
        "btn-printer-settings", "printer-settings-dialog", "printer-toolbar-dot",
        "printer-conn-badge", "printer-conn-badge-text", "printer-connect-method",
        "printer-connection-unsupported", "printer-connection-status", "printer-serial-options",
        "btn-printer-connect", "btn-printer-disconnect", "pref-serial-baud-rate",
        "pref-feed-lines", "pref-feed-lines-hint", "pref-cut-paper", "btn-printer-settings-close",
        "btn-printer-test-print", "btn-printer-query-status", "printer-status-result",
        "btn-printer-forget", "printer-dots-list", "btn-printer-dots-reset", "printer-margin-list", "btn-printer-margin-reset", "btn-printer-margin-sheet",
        "printer-info-device", "printer-info-firmware", "printer-info-spec", "printer-info-dpi",
        "printer-info-paper", "printer-info-printable", "printer-info-blade", "export-embed-fonts", "export-embed-fonts-row",
        "btn-project-name", "project-name-input", "project-name-input-wrap", "project-name-text",
        "btn-page-add", "btn-page-split",
        "page-board", "page-pager", "page-pager-label", "page-pager-cut", "btn-page-prev", "btn-page-next",
    ].forEach((id) => (els[id] = document.getElementById(id)));
}

// ---- 專案初始化 / 還原 ----

async function restoreOrCreateProject() {
    const lastId = safeGetItem(LAST_DRAFT_KEY);
    if (lastId) {
        try {
            const draft = await loadDraft(lastId);
            if (draft) {
                const result = loadProject(draft);
                if (result.ok) return result.project;
            }
        } catch {
            // IndexedDB 讀取失敗就當作沒有草稿，往下建立新專案
        }
    }
    return createEmptyProject({
        printerProfileId: getDefaultPrinterProfileId(),
        paperWidthId: getPrinterProfile(getDefaultPrinterProfileId()).defaultPaperWidthId,
    });
}

// ---- 頂部工具列 ----

// 目前實際採用的印表機規格：註冊表裡專案指定的 profile，再套上使用者手動覆寫的「可列印點數」。
// 渲染（renderTemplate 的 options.profile）、預覽紙張框、列印頭寬度、測試列印都要吃這一份，
// 不然畫面預覽跟實際送出的 raster 寬度會不一致。
export function getBaseProfile() {
    return withPrintableDotsOverrides(getPrinterProfile(state.project.printerProfile.id), state.printPrefs.printableDots);
}

// 再套上左右邊距校正（可列印寬度扣掉補白）；列印頭寬度、印表機資訊要用校正前的 getBaseProfile()
export function getEffectiveProfile() {
    return withMarginCalibration(getBaseProfile(), state.printPrefs.margins);
}

// 「切紙前走紙行數」走不夠，切刀會切在剛印完、還沒通過切刀位置的內容上：
// bladeOffsetMm 是切刀跟列印頭之間固定的實體距離，需要應用程式自己走紙走過這段距離，
// 印表機不會自動幫忙走（見 state.printPrefs 那邊的說明，2026-09 已用實機驗證）。
// 提示文字依專案內的印表機規格動態產生，開啟不同專案時要重新更新，見 init／loadProjectIntoEditor。
function updateFeedLinesHint() {
    const profile = getPrinterProfile(state.project.printerProfile.id);
    const bladeOffsetMm = profile.autocutter?.bladeOffsetMm;
    const label = document.querySelector('label[for="pref-feed-lines"]');
    label.querySelector(".info-icon")?.remove();
    label.appendChild(createInfoIcon(bladeOffsetMm
        ? `${profile.brand} ${profile.model} 切刀距列印頭約 ${bladeOffsetMm}mm，切到內容請調高行數`
        : "切到內容請調高行數"));
    els["pref-feed-lines-hint"].hidden = true;
}

function populatePaperWidthTabs() {
    const profile = getPrinterProfile(state.project.printerProfile.id);
    const wrap = els["paper-width-tabs"];
    wrap.innerHTML = "";
    for (const paper of profile.paperWidths) {
        const label = document.createElement("label");
        label.className = "item";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "paper-width";
        input.value = paper.id;
        input.checked = paper.id === state.project.paper.widthId;
        input.addEventListener("change", () => {
            state.project.paper.widthId = paper.id;
            onModelChange();
        });
        const text = document.createElement("div");
        text.className = "text";
        text.textContent = paper.label;
        label.appendChild(input);
        label.appendChild(text);
        wrap.appendChild(label);
    }
}

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
function wireToolbarOverflow() {
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

function bindToolbar() {
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

    els["btn-new-ptan"].addEventListener("click", startNewProject);
    els["open-project-from-file"].addEventListener("click", () => els["ptan-file-input"].click());
    els["export-embed-fonts-row"].addEventListener("click", (e) => e.stopPropagation()); // 勾選時不收起匯出選單
    els["btn-save-ptan"].addEventListener("click", async () => {
        const failed = await downloadPtan(state.project, state.project.meta.name || "printan", { embedFonts: els["export-embed-fonts"].checked });
        if (failed.length) alert(`已匯出，但這些字體沒能內嵌（可能離線）：${failed.join("、")}`);
    });

    els["btn-export-pdf"].addEventListener("click", exportSinglePdf);
    els["btn-export-batch-pdf"].addEventListener("click", exportBatchPdf);
    els["btn-print"].addEventListener("click", printCurrent);
}

// image-file-input 是整個編輯器共用的單一 hidden input（工具列「新增圖片」與各圖片元素
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

function bindFileInputs() {
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

    els["ptan-file-input"].addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        const result = await readPtanFile(file);
        if (!result.ok) {
            alert(`開啟失敗：${result.error}`);
            return;
        }
        loadProjectIntoEditor(result.project);
    });
}

// ---- 新增空白版型 / 開啟最近編輯（IndexedDB 草稿）----
// 「新增」不會刪除目前版型：目前版型早就被 scheduleSave 自動存進 IndexedDB 了，
// 換成空白版型後舊的還在，可以從「開啟」下拉選單的「最近編輯」清單找回來。

export function loadProjectIntoEditor(project) {
    state.project = project;
    state.currentPageIndex = 0;
    state.selectedId = null;
    state.multi = [];
    state.insertionTarget = null;
    state.previewData = {};
    resetHistory();
    endBatchPreview();
    updateFeedLinesHint();
    renderPrintableDotsRows();
    renderMarginRows();
    populatePaperWidthTabs();
    populateRecentDrafts();
    renderProjectName();
    renderPageList();
    onModelChange();
}

function startNewProject() {
    loadProjectIntoEditor(createEmptyProject({
        printerProfileId: state.project.printerProfile.id,
        paperWidthId: state.project.paper.widthId,
    }));
}

// ---- 工具列「專案名稱」欄位：平時是 ts-button，點擊／Enter 切成 ts-input ----
// 顯示與輸入框共用 state.project.meta.name；儲存草稿／匯出 .ptan／匯出 PDF 檔名
// 已經直接讀這個欄位（見 btn-save-ptan、batch-export.js），這裡不用另外接。
function renderProjectName() {
    const name = state.project.meta.name || "未命名專案";
    els["project-name-text"].textContent = name;
    els["project-name-text"].title = name; // 名稱太長被裁切時，滑鼠停留看得到完整名稱
}

function bindProjectName() {
    const btn = els["btn-project-name"];
    const input = els["project-name-input"];
    const inputWrap = els["project-name-input-wrap"]; // Tocas ts-input 外層，顯示／隱藏切換的是它
    let cancelling = false;

    function enterEdit() {
        input.value = state.project.meta.name || "";
        btn.hidden = true;
        inputWrap.hidden = false;
        input.focus();
        input.select();
    }
    function exitEdit() {
        inputWrap.hidden = true;
        btn.hidden = false;
    }
    // Enter／blur（含點別處、Tab 走焦點）都算確認；Esc 用 cancelling 旗標跳過這裡的寫入，只還原顯示
    function commit() {
        if (cancelling) {
            cancelling = false;
            exitEdit();
            return;
        }
        const next = input.value.trim().slice(0, 60) || "未命名專案";
        if (next !== state.project.meta.name) {
            state.project.meta.name = next;
            renderProjectName();
            onModelChange();
        }
        exitEdit();
    }

    btn.addEventListener("click", enterEdit);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            input.blur(); // 交給 blur 監聽器統一處理，避免兩套 commit 邏輯
        } else if (e.key === "Escape") {
            e.preventDefault();
            cancelling = true;
            input.blur();
        }
    });
    input.addEventListener("blur", commit);
}

function populateRecentDrafts() {
    const list = els["recent-drafts-list"];
    list.innerHTML = "";
    const recent = listRecent().filter((r) => r.id !== state.project.id);
    if (recent.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ts-text is-description is-small recent-draft-empty";
        empty.textContent = "尚無其他最近編輯的版型";
        list.appendChild(empty);
        return;
    }
    for (const r of recent) {
        const row = document.createElement("div");
        row.className = "item recent-draft-item";

        const info = document.createElement("span");
        info.className = "recent-draft-info";
        const name = document.createElement("span");
        name.className = "recent-draft-name";
        name.textContent = r.name || "未命名版型";
        const time = document.createElement("span");
        time.className = "ts-text is-description is-small recent-draft-time";
        time.textContent = new Date(r.updatedAt).toLocaleString("zh-TW", { hour12: false });
        info.append(name, time);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "ts-button is-icon is-tiny recent-draft-delete";
        del.dataset.tooltip = "刪除這份草稿";
        del.setAttribute("aria-label", "刪除這份草稿");
        del.innerHTML = '<span class="ts-icon is-trash-icon" aria-hidden="true"></span>';
        del.addEventListener("click", async (e) => {
            e.stopPropagation();
            await deleteDraft(r.id);
            populateRecentDrafts();
        });

        row.append(info, del);
        row.addEventListener("click", async () => {
            const draft = await loadDraft(r.id);
            if (!draft) {
                populateRecentDrafts();
                return;
            }
            const result = loadProject(draft);
            if (!result.ok) {
                alert(`開啟失敗：${result.error}`);
                return;
            }
            safeSetItem(LAST_DRAFT_KEY, r.id);
            loadProjectIntoEditor(result.project);
        });
        list.appendChild(row);
    }
}

// ---- 元素屬性面板 ----

// ---- 變數 / 預覽資料 ----

function renderVariables() {
    // 變數清單彙整全部頁面（不只目前編輯中的這頁），因為批次資料／kiosk query string 的填值
    // 要涵蓋整份專案會印出來的所有內容，不能因為使用者剛好切到沒用該變數的頁就漏列。
    const names = extractPlaceholders(state.project.template.pages.flatMap((p) => p.elements));
    state.project.variables = names;

    const hasVariables = names.length > 0;
    els["variables-card"].hidden = !hasVariables;
    els["variables-card-spacer"].hidden = !hasVariables;
    els["batch-card"].hidden = !hasVariables;
    els["batch-card-spacer"].hidden = !hasVariables;

    const panel = els["variables-panel"];
    panel.innerHTML = "";
    if (!hasVariables) return;
    names.forEach((name, i) => {
        const row = document.createElement("div");
        row.className = i > 0 ? "ts-grid is-middle-aligned has-top-spaced-small" : "ts-grid is-middle-aligned";

        const labelCol = document.createElement("div");
        labelCol.className = "column is-6-wide";
        const label = document.createElement("span");
        label.className = "ts-text is-label";
        label.textContent = name;
        label.title = name;
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";
        label.style.whiteSpace = "nowrap";
        label.style.display = "block";
        labelCol.appendChild(label);

        const inputCol = document.createElement("div");
        inputCol.className = "column is-fluid";
        const previewInput = textInput(state.previewData[name] ?? "", (v) => {
            state.previewData[name] = v;
            schedulePreview();
        });
        previewInput.querySelector("input").setAttribute("aria-label", `變數 ${name}`);
        inputCol.appendChild(previewInput);

        row.appendChild(labelCol);
        row.appendChild(inputCol);
        panel.appendChild(row);
    });
}

// ---- 紙張預覽 ----

// 縮放與尺規（見 workspace-view.js）；縮放後紙張的 CSS 寬度變了，編輯疊層座標跟著重算
const workspace = createWorkspaceView({
    // 「符合寬度」把左右不可印區也算進去，整張紙才看得到
    getPaperWidthMm: () => getPaperWidth(getEffectiveProfile(), state.project.paper.widthId).printableWidthMm + 2 * unprintableMm(),
    getUnprintableMm: () => unprintableMm(),
    onZoom: () => {
        updatePaperFrame();
        renderEditOverlay();
    },
});

// 「符合寬度」／1:1 的語意是對作用中頁面那一欄：縮放本身只算一張紙的寬度（getPaperWidthMm），
// 縮完再把作用中頁面置中，不然 2D 佈局裡它可能被推到畫面外。排在 workspace 自己的監聽器之後執行。
function wireZoomRevealsActivePage() {
    for (const id of ["btn-zoom-fit", "btn-zoom-actual"]) {
        document.getElementById(id).addEventListener("click", () => requestAnimationFrame(() => revealActivePage({ center: true })));
    }
}

// 紙寬與可列印寬度之差的一半＝左右各印不到的寬度（左右對稱，用標準值；可列印點數含使用者覆寫，不含邊距校正）
function unprintableMm() {
    const paper = getPaperWidth(getBaseProfile(), state.project.paper.widthId);
    return Math.max(0, ((paper.rollWidthMm ?? paper.printableWidthMm) - paper.printableWidthMm) / 2);
}

// 白底左右兩側的「不可印區」：純畫面提示（DOM，不在 canvas 內），匯出與列印不含
// 作用中頁面的 #paper-shadow 會在 2D 佈局裡搬來搬去，不可印區只在它身上補一次；縮圖頁面自己帶（見 page-board.js）
function ensureUnprintableZones() {
    const shadow = els["paper-shadow"];
    if (shadow.querySelector(".unprintable-zone")) return;
    for (const side of ["left", "right"]) {
        const zone = document.createElement("div");
        zone.className = `unprintable-zone is-${side}`;
        zone.setAttribute("role", "img");
        zone.setAttribute("aria-label", "此區印表機印不到");
        zone.dataset.tooltip = "此區印表機印不到";
        shadow.appendChild(zone);
    }
}

function updatePaperFrame() {
    ensureUnprintableZones();
    const profile = getEffectiveProfile();
    const paper = getPaperWidth(profile, state.project.paper.widthId);
    // 連續紙沒有實體「上邊界」；下緣的切刀安全線是切刀刀片跟列印頭的實際距離（bladeOffsetMm）——
    // 太靠下緣的內容，切紙時有被裁到的風險。
    const bladeOffsetMm = profile.autocutter?.bladeOffsetMm ?? 0;
    const pxPerMm = workspace.pxPerMm();
    // 畫面上的紙＝可列印區：白底寬度＝printableWidthMm × pxPerMm（對應實際列印的 576 點）。
    // 寫在 2D 佈局的外層：作用中頁面與其餘縮圖頁面都繼承同一組尺寸（紙寬是專案層級共用，不分頁）
    const board = els["page-board"];
    board.style.setProperty("--paper-width", `${paper.printableWidthMm * pxPerMm}px`);
    board.style.setProperty("--paper-unprintable", `${unprintableMm() * pxPerMm}px`);
    board.style.setProperty("--paper-safe-bottom", `${bladeOffsetMm * pxPerMm}px`);
    // 空白版型的白底＝最短可切下的一張紙（列印頭到切刀的距離），隨縮放與 profile 變動
    board.style.setProperty("--paper-min-height", `${bladeOffsetMm * pxPerMm}px`);
    // 版面完全沒有元素時，切刀安全線只是誤導（看起來像渲染壞掉），故不顯示；
    // 這一頁印完不切紙（接續下一頁）時切刀安全線同樣沒有意義，一併隱藏
    const isEmpty = currentElements().length === 0;
    els["paper-viewport"].classList.toggle("is-empty", isEmpty);
    els["paper-viewport"].classList.toggle("is-no-cut", !currentPage().cutAfter);
}

async function updatePreview({ live = false } = {}) {
    const rebuilt = syncPageBoard();
    updatePaperFrame();
    const generation = ++state.previewGeneration;
    let result;
    let data;
    try {
        data = state.batchPreview.active
            ? (state.batchPreview.records[state.batchPreview.index] ?? {})
            : state.previewData;
        // 畫布一次只編輯／預覽目前這一頁：renderTemplate() 是不能更動的公開單頁 API（見 renderer.js
        // 開頭說明），這裡用一個「借用 template.elements」的殼物件呼叫它，不需要另外複製一份渲染邏輯；
        // 多頁一次全部列印／匯出改呼叫 renderPages()（見 printer-settings.js／batch-export.js）。
        const pageProject = { ...state.project, template: { elements: currentElements() } };
        result = await renderTemplate(pageProject, data, { mode: state.mode, profile: getEffectiveProfile() });
    } catch (err) {
        console.error(err);
        return;
    }
    if (generation !== state.previewGeneration) return; // 過期的渲染結果，丟棄
    rt.lastRenderResult = result;
    updateFontFallbackNotice(result.fontFallbacks);
    updateImageFailureNotice(result.imageFailures);
    els["canvas-host"].innerHTML = "";
    els["canvas-host"].appendChild(result.canvas);
    if (!els["edit-overlay"]) {
        els["edit-overlay"] = document.createElement("div");
        els["edit-overlay"].className = "edit-overlay";
    }
    els["canvas-host"].appendChild(els["edit-overlay"]);
    renderEditOverlay();
    if (rebuilt) revealActivePage();
    // 拖曳／打字這類 live 更新只改作用中頁面，其他頁的縮圖不用跟著每個畫格重算
    if (!live) renderPageThumbs({ data, mode: state.mode, profile: getEffectiveProfile() });
}

/** 批次資料的圖片網址被拒絕或載入失敗時，在預覽區上方提示已略過。 */
function updateImageFailureNotice(failures) {
    if (!failures?.length) return hideStageNotice("image-failure-notice");
    showStageNotice("image-failure-notice", `有 ${failures.length} 張圖片無法載入，已略過`, { title: failures.join("\n") });
}

/** 網頁字體（等寬）載入失敗時，在預覽區上方明確提示目前顯示與列印的是系統字體，不默默換字。 */
function updateFontFallbackNotice(failedLabels) {
    if (!failedLabels?.length) return hideStageNotice("font-fallback-notice");
    showStageNotice("font-fallback-notice", `字體「${failedLabels.join("、")}」沒有載入成功（可能沒有網路），預覽與列印暫時改用系統字體。`);
}

// 預覽區行內文字編輯（見 inline-text-editor.js）。textSel 是面板工具列操作的選取範圍，
// 來源可能是面板 textarea，也可能是預覽區的編輯框。
export const textSel = { start: 0, end: 0, refresh: null };
export const inlineEditor = createInlineTextEditor({
    getHost: () => els["paper-shadow"],
    getElement: (id) => findElementById(currentElements(), id),
    getBlockNode: (id) => els["edit-overlay"]?.querySelector(`.edit-block[data-id="${id}"]`),
    getScale: () => (rt.lastRenderResult ? rt.lastRenderResult.canvas.clientWidth / rt.lastRenderResult.widthDots : 1) || 1,
    onInput: () => onModelChange({ live: true }),
    onSelection: (id, start, end) => {
        if (id !== state.selectedId) return;
        textSel.start = start;
        textSel.end = end;
        textSel.refresh?.();
    },
});

// ---- 列印設定（WebUSB／WebSerial 直連、印表機識別、走紙／切紙／可列印點數偏好） ----
// 連線狀態、走紙／切紙偏好都是「這台瀏覽器、這台印表機」的本機操作習慣，不寫進 .ptan，
// 同一份版型換人、換印表機開啟時不應該被綁死。

// ---- 變更彙整：儲存草稿 + 重新渲染 ----

let saveTimer = null;
// live=true：畫布／安全線等視覺跟手（rAF 節流，同拖曳把手），不用 schedulePreview() 的 120ms
// debounce——那個 debounce 會被連續輸入（打字、貼上、按住刪除）不斷重置，畫面卡在舊高度直到停手。
export function onModelChange({ skipInspector = false, live = false } = {}) {
    recordHistory();
    renderOutline();
    if (!skipInspector) renderInspector();
    renderVariables();
    if (live) schedulePreviewLive(); else schedulePreview();
    scheduleSave();
}

let previewTimer = null;
export function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
}

// 拖曳把手時用：每個畫格最多重繪一次，且上一次還沒畫完就只標記「還要再畫」，
// 不會像 120ms debounce 那樣拖著不停就完全不更新，也不會因為結果被判過期而一直畫不出來。
let liveBusy = false;
let liveDirty = false;
export function schedulePreviewLive() {
    liveDirty = true;
    if (liveBusy) return;
    liveBusy = true;
    requestAnimationFrame(async () => {
        while (liveDirty) {
            liveDirty = false;
            clearTimeout(previewTimer);
            await updatePreview({ live: true });
        }
        liveBusy = false;
    });
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        const id = await runAutosave(els["save-status"], () => saveDraft(state.project));
        if (!id) return;
        safeSetItem(LAST_DRAFT_KEY, id);
        populateRecentDrafts();
    }, 500);
}

init();
