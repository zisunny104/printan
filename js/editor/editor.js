// Printan Editor — 串接 core（Document Model / Renderer / Storage）與畫面互動。
// Editor 本身不做排版運算，排版與繪製一律呼叫 core/renderer.js，
// 確保「編輯器看到的結果」跟「實際輸出結果」用同一套邏輯（見需求單第廿一節）。

import { createEmptyProject, loadProject } from "../core/schema.js";
import {
    getPrinterProfile, getPaperWidth, getDefaultPrinterProfileId, getPrintHeadWidthDots,
    withPrintableDotsOverrides, sanitizePrintableDotsOverrides, matchPrinterProfile,
    PRINTABLE_DOTS_MIN, PRINTABLE_DOTS_MAX,
} from "../core/printer-profiles.js";
import {
    createTextElement, createImageElement, createSpacerElement, createDividerElement,
    createRowElement, createBarcodeElement, cloneElementWithNewIds, extractPlaceholders, getTextContent,
    getRangeStyle, applyStyleToRange, replaceFullText, MIXED,
} from "../core/document-model.js";
import { renderTemplate, renderBatch } from "../core/renderer.js";
import { BARCODE_FORMATS, BARCODE_FORMAT_INFO, validateBarcodeValue } from "../core/barcode.js";
import { splitDotsByRatio } from "../core/units.js";
import {
    isLocalFontAccessSupported, getLocalFontFamilies, loadLocalFonts, restoreLocalFontsIfGranted,
    localFontStack, primaryFamilyName, isFontInstalled,
} from "../core/fonts.js";
import { WEB_FONTS, findWebFont, isWebFontFailed, onWebFontStatusChange } from "../core/web-fonts.js";
import { downloadPtan, readPtanFile, fileToDataUrl } from "../core/ptan-file.js";
import { convertHeicIfNeeded } from "../core/heic.js";
import { exportToPdf } from "../core/pdf-export.js";
import { saveDraft, loadDraft, deleteDraft, listRecent } from "../core/storage.js";
import {
    SystemDialogAdapter, WebUsbEscposAdapter, WebSerialEscposAdapter, interpretRealtimeStatus,
} from "../core/printer-adapter.js";
import { wireResizableColumns } from "./resizable-columns.js";
import { createInlineTextEditor } from "./inline-text-editor.js";

const LAST_DRAFT_KEY = "printan:lastDraftId";
const PX_PER_MM = 3.2;

const state = {
    project: null,
    selectedId: null,
    insertionTarget: null, // null = 根目錄；{ rowId, colIndex } = 某個 row 的某一欄
    previewData: {},
    mode: "screen", // "screen" | "thermal"
    viewMode: "edit", // "edit"（畫布顯示可拖曳的虛線外框）| "preview"（隱藏編輯用外框，接近實際列印畫面）
    previewGeneration: 0,
    batchPreview: { active: false, records: [], index: 0 }, // 逐筆預覽批次資料時取代 previewData
    usbConnected: false, // WebUSB 印表機是否已連接；true 時「列印」按鈕直接送 ESC/POS，不走系統對話框
    serialConnected: false, // WebSerial 印表機是否已連接；設定 modal 的連線區塊同一時間只允許連一種方式，見 updatePrinterConnectionUi
    // 列印／測試列印／查詢狀態三個操作共用同一個 usbAdapter／serialAdapter（同一個 USB 裝置或
    // 序列埠），沒有各自獨立的通道；同時觸發兩個會讓 transferOut／write 的位元組流疊在一起，
    // 印表機收到的可能是兩份 ESC/POS 指令交錯後的亂碼，或狀態查詢讀到不相干的回應。
    // 用一個共用旗標序列化這三個操作，見 printCurrent／testPrintCurrentPrinter／queryPrinterStatus。
    printerBusy: false,
    // 連線後讀到的印表機識別資料（WebUSB 裝置名稱 + GS I 回傳的廠牌／型號／韌體）與比對到的 profile，
    // 未連接時為 null；見 identifyConnectedPrinter()。
    printerIdentity: null,
    printPrefs: { feedLines: 4, cutPaper: true, serialBaudRate: 9600, connectMethod: "usb", printableDots: {} }, // 走紙／切紙／序列傳輸速率／上次選的連接方式／各紙寬「可列印點數」覆寫（{ 紙寬id: 點數 }，空物件＝全用內建規格值）偏好，跟印表機連線一樣是本機操作習慣，不進 .ptan 文件；切紙預設開啟（大多數熱感印表機使用情境都希望列印完直接切下來）。
    // feedLines 預設 4（2026-09 實機驗證：0 會切到內容尾端、4 不會）：印表機規格檔的
    // autocutter.bladeOffsetMm（切刀跟列印頭之間固定的實體距離）不是自動切紙機構自己會走的，
    // 是「切紙前」需要應用程式自己走紙走過這段距離，走不夠切刀就會切在剛印完、還沒通過
    // 切刀位置的內容上，見 updateFeedLinesHint()。
};

const usbAdapter = new WebUsbEscposAdapter(); // 整個編輯器共用同一個連線實例
const serialAdapter = new WebSerialEscposAdapter(); // 跟 usbAdapter 一樣整個編輯器共用同一個連線實例

const BATCH_PANEL_EXPANDED_KEY = "printan-batch-panel-expanded";
const PRINT_PREFS_KEY = "printan:printPrefs";

const els = {}; // 快取常用 DOM 節點
let lastRenderResult = null; // 最近一次渲染結果（含排版 items 樹），供編輯疊層與模式切換重繪使用

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
    wireResizableColumns();
    wireFloatingToolbarPosition();
    wireFloatingToolbarFooterAvoidance();
    wireToolbarOverflow();
    onModelChange({ skipInspector: false });
    onWebFontStatusChange(() => renderInspector()); // 字體載入失敗／恢復時，選單上的標示要跟著更新
    restoreLocalFontsIfGranted().then((restored) => { if (restored) renderInspector(); });
    await attemptSilentPrinterReconnect();
}

function cacheDom() {
    [
        "save-status", "paper-width-tabs",
        "btn-add-text", "btn-add-image", "btn-add-spacer", "btn-add-divider", "btn-add-barcode",
        "btn-toggle-thermal", "btn-toggle-preview-mode",
        "btn-new-ptan", "btn-open-ptan", "open-project-from-file", "recent-drafts-list",
        "btn-save-ptan", "btn-export-pdf",
        "btn-export-batch-pdf", "btn-print", "outline-list", "inspector",
        "variables-panel", "variables-card", "variables-card-spacer", "batch-data", "paper-viewport", "paper-shadow", "safe-area-guide",
        "canvas-host", "image-file-input", "ptan-file-input",
        "batch-card", "batch-card-spacer", "batch-panel-toggle", "batch-panel-body", "btn-preview-batch", "batch-preview-nav",
        "btn-batch-prev", "btn-batch-next", "batch-preview-counter", "btn-batch-end-preview",
        "btn-printer-settings", "printer-settings-dialog", "printer-toolbar-dot",
        "printer-conn-badge", "printer-conn-badge-text", "printer-connect-method",
        "printer-connection-unsupported", "printer-connection-status", "printer-serial-options",
        "btn-printer-connect", "btn-printer-disconnect", "pref-serial-baud-rate",
        "pref-feed-lines", "pref-feed-lines-hint", "pref-cut-paper", "btn-printer-settings-close",
        "btn-printer-test-print", "btn-printer-query-status", "printer-status-result",
        "btn-printer-forget", "printer-dots-list", "btn-printer-dots-reset",
        "printer-info-device", "printer-info-firmware", "printer-info-spec", "printer-info-dpi",
        "printer-info-paper", "printer-info-printable", "printer-info-blade",
    ].forEach((id) => (els[id] = document.getElementById(id)));
}

// ---- 專案初始化 / 還原 ----

async function restoreOrCreateProject() {
    const lastId = localStorage.getItem(LAST_DRAFT_KEY);
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
function getEffectiveProfile() {
    return withPrintableDotsOverrides(getPrinterProfile(state.project.printerProfile.id), state.printPrefs.printableDots);
}

// 「切紙前走紙行數」走不夠，切刀會切在剛印完、還沒通過切刀位置的內容上：
// bladeOffsetMm 是切刀跟列印頭之間固定的實體距離，需要應用程式自己走紙走過這段距離，
// 印表機不會自動幫忙走（見 state.printPrefs 那邊的說明，2026-09 已用實機驗證）。
// 提示文字依專案內的印表機規格動態產生，開啟不同專案時要重新更新，見 init／loadProjectIntoEditor。
function updateFeedLinesHint() {
    const profile = getPrinterProfile(state.project.printerProfile.id);
    const bladeOffsetMm = profile.autocutter?.bladeOffsetMm;
    els["pref-feed-lines-hint"].textContent = bladeOffsetMm
        ? `${profile.brand} ${profile.model} 的切刀跟列印頭之間有約 ${bladeOffsetMm}mm 的固定距離，走紙行數太少切刀會切到剛印完的內容尾端；預設 4 行通常足夠，如果切紙時還是會切到內容，請調高這個數字。`
        : "這是切紙（或列印結束）前走紙的行數，走太少切刀可能會切到剛印完的內容尾端；如果切紙時切到內容，請調高這個數字。";
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

// .canvas-floating-toolbar 用 position:fixed 錨定視窗底部（見 editor.css 註解：
// Tocas UI 在 <body> 設 overflow-x:hidden 會連帶讓 overflow-y 被規範提升成 auto，
// 使 sticky 的捲動基準變成永遠 scrollTop=0 的 <body>，因此失效，改用 fixed）。
// 水平置中量測的是 .editor-canvas-pane 而不是整個視窗，用 ResizeObserver 盯著這個
// pane 本身的 box，欄寬拖曳（.col-resizer）、桌面/手機斷點造成的堆疊都會自動反映。
// 但 ResizeObserver 只在 pane 自己的「尺寸」變動時觸發——外層 .ts-container 有
// max-width:1400px，視窗超過這個寬度後再變寬，容器只是靠 margin:auto 整塊往右挪，
// pane 的寬度完全沒變、ResizeObserver 不會發火，toolbar.style.left 卻是視窗絕對座標，
// 於是寬螢幕下 toolbar 會停在舊位置，相對畫面越看越偏左（使用者回報「偏左」的根因）。
// 額外掛 window resize 補這個「位置變了但尺寸沒變」的情況。
//
// max-width 同理：CSS 預設 calc(100% - 2rem) 在 position:fixed 底下是相對「視窗」寬度
// 算的（fixed 元素的 % 一律相對 initial containing block），跟 pane 實際寬度無關——
// 欄寬拉桿（.col-resizer）把 pane 拖窄時，工具列的寬度上限完全不會跟著變小，直接拿
// pane 的 rect.width 覆寫成 px 值，才能讓 wireToolbarOverflow() 的「容器變窄→收合」
// 判斷（量 bar.scrollWidth vs bar.clientWidth）正確反映拉桿拖曳，不是只反映視窗尺寸。
function wireFloatingToolbarPosition() {
    const pane = document.getElementById("canvasPane");
    const toolbar = document.querySelector(".canvas-floating-toolbar");
    if (!pane || !toolbar) return;
    function reposition() {
        const rect = pane.getBoundingClientRect();
        toolbar.style.left = `${rect.left + rect.width / 2}px`;
        const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        toolbar.style.maxWidth = `${Math.max(0, rect.width - remPx * 2)}px`;
    }
    new ResizeObserver(reposition).observe(pane);
    window.addEventListener("resize", reposition);
    reposition();
}

// 頁面內容短的時候，position:fixed 的浮動工具列會整條疊在頁尾（開利手底部／GitHub
// 連結／主題切換）上面，兩種「固定在畫面上」的元素互相打架，就是回報裡「底部怪怪的」
// 的實際成因。頁尾進入視窗範圍時先把工具列淡出、讓開，離開視窗（往上捲回編輯區）再淡入。
function wireFloatingToolbarFooterAvoidance() {
    const toolbar = document.querySelector(".canvas-floating-toolbar");
    const footer = document.getElementById("app-footer");
    if (!toolbar || !footer || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
        ([entry]) => toolbar.classList.toggle("is-yielding", entry.isIntersecting),
        { rootMargin: "0px" }
    );
    observer.observe(footer);
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

    // 觀察的不是 bar 自己，是它 position:fixed 水平置中所依據的父層 #canvasPane（見
    // wireFloatingToolbarPosition）。bar 本身沒有明確 width，收合到只剩內容需要的寬度後，
    // 即使父層之後變寬，bar 自己的 border-box 也不會再變——因為它已經小於新的 max-width
    // 上限，不再被撐開。只盯著 bar 會導致容器變寬後收合狀態永遠無法還原。
    new ResizeObserver(applyCollapse).observe(bar.parentElement);
    applyCollapse();
}

function bindToolbar() {
    els["btn-add-text"].addEventListener("click", () => insertElement(createTextElement()));
    els["btn-add-spacer"].addEventListener("click", () => insertElement(createSpacerElement()));
    els["btn-add-divider"].addEventListener("click", () => insertElement(createDividerElement()));
    els["btn-add-barcode"].addEventListener("click", () => insertElement(createBarcodeElement()));

    els["btn-add-image"].addEventListener("click", () => {
        imageFileInputHandler = null;
        els["image-file-input"].click();
    });

    document.querySelectorAll("#row-ratio-dropdown .item[data-ratio]").forEach((item) => {
        item.addEventListener("click", () => {
            const ratio = item.dataset.ratio.split(",").map(Number);
            insertElement(createRowElement(ratio));
        });
    });

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
    els["btn-save-ptan"].addEventListener("click", () => {
        downloadPtan(state.project, state.project.meta.name || "printan");
    });

    els["btn-export-pdf"].addEventListener("click", exportSinglePdf);
    els["btn-export-batch-pdf"].addEventListener("click", exportBatchPdf);
    els["btn-print"].addEventListener("click", printCurrent);
}

// image-file-input 是整個編輯器共用的單一 hidden input（工具列「新增圖片」與各圖片元素
// inspector 的「更換圖片」都借用同一個），用這個變數帶「這一次選檔要怎麼處理」，避免像過去
// 那樣在同一個 input 上疊加第二個 change 監聽器（會兩邊都觸發，多插入一個重複元素）。
let imageFileInputHandler = null; // null＝新增一個圖片元素；有值＝把選到的 assetId 交給這個 callback（例如更換既有元素的圖片）

async function handleImageFileSelected(file) {
    let converted;
    try {
        converted = await convertHeicIfNeeded(file);
    } catch (err) {
        alert(`HEIC 轉換失敗：${err.message}`);
        return null;
    }
    const dataUrl = await fileToDataUrl(converted);
    const assetId = `asset_${Date.now().toString(36)}`;
    state.project.assets.push({ id: assetId, type: converted.type, dataUrl });
    return assetId;
}

function bindFileInputs() {
    els["image-file-input"].addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        const handler = imageFileInputHandler;
        imageFileInputHandler = null;
        if (!file) return;
        const assetId = await handleImageFileSelected(file);
        if (!assetId) return;
        if (handler) handler(assetId);
        else insertElement(createImageElement({ assetId }));
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

function loadProjectIntoEditor(project) {
    state.project = project;
    state.selectedId = null;
    state.insertionTarget = null;
    state.previewData = {};
    endBatchPreview();
    updateFeedLinesHint();
    renderPrintableDotsRows();
    populatePaperWidthTabs();
    populateRecentDrafts();
    onModelChange();
}

function startNewProject() {
    loadProjectIntoEditor(createEmptyProject({
        printerProfileId: state.project.printerProfile.id,
        paperWidthId: state.project.paper.widthId,
    }));
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
            localStorage.setItem(LAST_DRAFT_KEY, r.id);
            loadProjectIntoEditor(result.project);
        });
        list.appendChild(row);
    }
}

// ---- Element tree 操作 ----

function insertElement(element) {
    const target = resolveTargetArray(state.project.template.elements, state.insertionTarget);
    target.push(element);
    state.selectedId = element.id;
    onModelChange();
}

function resolveTargetArray(rootElements, target) {
    if (!target) return rootElements;
    const row = findElementById(rootElements, target.rowId);
    if (!row || row.type !== "row") return rootElements;
    return row.columns[target.colIndex] || rootElements;
}

function findElementById(elements, id) {
    for (const el of elements) {
        if (el.id === id) return el;
        if (el.type === "row") {
            for (const col of el.columns) {
                const found = findElementById(col, id);
                if (found) return found;
            }
        }
    }
    return null;
}

function findContainerOf(elements, id) {
    for (let i = 0; i < elements.length; i++) {
        if (elements[i].id === id) return { array: elements, index: i };
        if (elements[i].type === "row") {
            for (const col of elements[i].columns) {
                const found = findContainerOf(col, id);
                if (found) return found;
            }
        }
    }
    return null;
}

function isSameTarget(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.rowId === b.rowId && a.colIndex === b.colIndex;
}

function setRowRatio(rowEl, newRatio) {
    const newColumns = newRatio.map(() => []);
    rowEl.columns.forEach((col, i) => {
        const idx = Math.min(i, newColumns.length - 1);
        newColumns[idx].push(...col);
    });
    rowEl.ratio = newRatio;
    rowEl.columns = newColumns;
}

function deleteElement(id) {
    const found = findContainerOf(state.project.template.elements, id);
    if (!found) return;
    found.array.splice(found.index, 1);
    if (state.selectedId === id) state.selectedId = null;
    if (state.insertionTarget && state.insertionTarget.rowId === id) state.insertionTarget = null;
    onModelChange();
}

function duplicateElement(id) {
    const found = findContainerOf(state.project.template.elements, id);
    if (!found) return;
    const clone = cloneElementWithNewIds(found.array[found.index]);
    found.array.splice(found.index + 1, 0, clone);
    state.selectedId = clone.id;
    onModelChange();
}

function moveElement(id, direction) {
    const found = findContainerOf(state.project.template.elements, id);
    if (!found) return;
    const newIndex = found.index + direction;
    if (newIndex < 0 || newIndex >= found.array.length) return;
    const [item] = found.array.splice(found.index, 1);
    found.array.splice(newIndex, 0, item);
    onModelChange();
}

/** 拖曳排序用：把元素移到「同一個容器內、目前索引為 newIndex 的元素之前」。 */
function moveElementTo(id, newIndex) {
    const found = findContainerOf(state.project.template.elements, id);
    if (!found) return;
    const { array, index } = found;
    let target = newIndex;
    if (target > index) target -= 1;
    target = Math.max(0, Math.min(target, array.length - 1));
    if (target === index) return;
    const [item] = array.splice(index, 1);
    array.splice(target, 0, item);
    onModelChange();
}

/** 選取元素：outline 清單點擊、畫布疊層點擊共用同一套邏輯。 */
function selectElementById(id) {
    state.selectedId = id;
    const el = findElementById(state.project.template.elements, id);
    if (el && el.type !== "row") {
        const found = findContainerOf(state.project.template.elements, id);
        state.insertionTarget = containerToTarget(found?.array);
    }
    renderOutline();
    renderInspector();
    highlightSelectedBlock();
}

function highlightSelectedBlock() {
    const overlay = els["edit-overlay"];
    if (!overlay) return;
    overlay.querySelectorAll(".edit-block.is-selected").forEach((n) => n.classList.remove("is-selected"));
    if (state.selectedId) {
        overlay.querySelector(`.edit-block[data-id="${state.selectedId}"]`)?.classList.add("is-selected");
    }
}

// ---- 版面結構大綱 ----

function renderOutline() {
    const root = els["outline-list"];
    root.innerHTML = "";
    root.appendChild(buildTargetHeader("版面（最上層）", null, 0));
    root.appendChild(buildElementList(state.project.template.elements, 0, "root"));
}

function buildElementList(elements, depth, parentKey) {
    const frag = document.createDocumentFragment();
    elements.forEach((el) => {
        frag.appendChild(buildElementRow(el, depth, parentKey));
        if (el.type === "row") {
            el.columns.forEach((col, colIndex) => {
                const target = { rowId: el.id, colIndex };
                frag.appendChild(buildTargetHeader(`第 ${colIndex + 1} 欄`, target, depth + 1));
                frag.appendChild(buildElementList(col, depth + 2, `${el.id}:${colIndex}`));
            });
        }
    });
    return frag;
}

// ---- 大綱拖曳排序：只允許在同一個容器（同一層陣列）內重新排序，跨容器拖放會被擋掉，
// 因為 moveElementTo() 本身只在元素目前所在的陣列裡搬動位置。----

let outlineDragState = null; // { id, parentKey }

function clearOutlineDropIndicators() {
    els["outline-list"].querySelectorAll(".is-drop-before, .is-drop-after").forEach((n) => {
        n.classList.remove("is-drop-before", "is-drop-after");
    });
}

function wireOutlineRowDrag(row, el, parentKey) {
    row.draggable = true;
    row.addEventListener("dragstart", (evt) => {
        outlineDragState = { id: el.id, parentKey };
        evt.dataTransfer.effectAllowed = "move";
        evt.dataTransfer.setData("text/plain", el.id);
        row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        clearOutlineDropIndicators();
        outlineDragState = null;
    });
    row.addEventListener("dragover", (evt) => {
        if (!outlineDragState || outlineDragState.parentKey !== parentKey || outlineDragState.id === el.id) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        clearOutlineDropIndicators();
        row.classList.add(before ? "is-drop-before" : "is-drop-after");
    });
    row.addEventListener("drop", (evt) => {
        if (!outlineDragState || outlineDragState.parentKey !== parentKey || outlineDragState.id === el.id) return;
        evt.preventDefault();
        const rect = row.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        const found = findContainerOf(state.project.template.elements, el.id);
        if (!found) return;
        const targetIndex = before ? found.index : found.index + 1;
        moveElementTo(outlineDragState.id, targetIndex);
        outlineDragState = null;
    });
}

function buildTargetHeader(label, target, depth) {
    const row = document.createElement("div");
    row.className = `outline-row outline-target-row outline-indent-${depth}`;
    if (isSameTarget(state.insertionTarget, target)) row.classList.add("is-target");
    const icon = document.createElement("span");
    icon.className = "ts-icon is-plus-icon";
    icon.setAttribute("aria-hidden", "true");
    const span = document.createElement("span");
    span.className = "outline-label";
    span.textContent = label;
    row.appendChild(icon);
    row.appendChild(span);
    row.addEventListener("click", () => {
        state.insertionTarget = target;
        state.selectedId = null;
        renderOutline();
        renderInspector();
    });
    return row;
}

const TYPE_ICON = { text: "font", image: "image", spacer: "arrows-up-down", divider: "minus", row: "table-columns", barcode: "qrcode" };

const BARCODE_FORMAT_LABEL = Object.fromEntries(BARCODE_FORMATS);

function elementLabel(el) {
    switch (el.type) {
        case "text": { const t = getTextContent(el); return t ? t.slice(0, 14) : "（空白文字）"; }
        case "image": return el.assetId ? "圖片" : "圖片（未設定）";
        case "spacer": return `間隔 ${el.heightDots}dot`;
        case "divider": return "分隔線";
        case "row": return `多欄（${el.ratio.join(" : ")}）`;
        case "barcode": return BARCODE_FORMAT_LABEL[el.format] || "條碼";
        default: return el.type;
    }
}

function buildElementRow(el, depth, parentKey) {
    const row = document.createElement("div");
    row.className = `outline-row outline-indent-${depth}`;
    row.dataset.elType = el.type;
    if (state.selectedId === el.id) row.classList.add("is-selected");

    const icon = document.createElement("span");
    icon.className = `ts-icon is-${TYPE_ICON[el.type] || "shapes"}-icon`;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "outline-label";
    label.textContent = elementLabel(el);

    const actions = document.createElement("span");
    actions.className = "outline-actions";
    actions.appendChild(iconButton("arrow-up", "上移", () => moveElement(el.id, -1)));
    actions.appendChild(iconButton("arrow-down", "下移", () => moveElement(el.id, 1)));
    actions.appendChild(iconButton("copy", "複製", () => duplicateElement(el.id)));
    actions.appendChild(iconButton("trash", "刪除", () => deleteElement(el.id)));

    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(actions);

    row.addEventListener("click", () => selectElementById(el.id));
    wireOutlineRowDrag(row, el, parentKey);

    return row;
}

function containerToTarget(array) {
    if (array === state.project.template.elements) return null;
    // 找出這個 array 屬於哪個 row 的哪一欄
    let result = null;
    (function walk(elements) {
        for (const el of elements) {
            if (el.type === "row") {
                el.columns.forEach((col, i) => {
                    if (col === array) result = { rowId: el.id, colIndex: i };
                    walk(col);
                });
            }
        }
    })(state.project.template.elements);
    return result;
}

function iconButton(icon, label, onClick) {
    const btn = document.createElement("button");
    btn.className = "ts-button is-icon is-ghost is-small";
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    btn.dataset.tooltip = label;
    btn.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span>`;
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

// ---- 元素屬性面板 ----

function renderInspector() {
    const panel = els.inspector;
    panel.innerHTML = "";
    const el = state.selectedId ? findElementById(state.project.template.elements, state.selectedId) : null;
    if (!el) {
        panel.appendChild(emptyState("sliders", "尚未選取元素"));
        return;
    }

    const builders = { text: buildTextInspector, image: buildImageInspector, spacer: buildSpacerInspector, divider: buildDividerInspector, row: buildRowInspector, barcode: buildBarcodeInspector };
    (builders[el.type] || (() => {}))(panel, el);

    panel.appendChild(sectionDivider());
    const actions = document.createElement("div");
    actions.className = "ts-wrap is-compact";
    const dupBtn = mkButton("複製", "copy", () => duplicateElement(el.id));
    const delBtn = mkButton("刪除", "trash", () => deleteElement(el.id), { negative: true });
    actions.append(dupBtn, delBtn);
    panel.appendChild(actions);
}

function emptyState(icon, title, description) {
    const wrap = document.createElement("div");
    wrap.className = "pane-empty-state-static";
    wrap.innerHTML = `
        <span class="ts-icon is-${icon}-icon is-heading" aria-hidden="true"></span>
        <div class="ts-text is-description">${title}</div>
        ${description ? `<div class="ts-text is-description">${description}</div>` : ""}
    `;
    return wrap;
}

function sectionHeader(icon, text) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced ts-header is-start-icon is-small";
    wrap.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span> ${text}`;
    return wrap;
}

function sectionDivider() {
    const hr = document.createElement("div");
    hr.className = "ts-divider has-vertically-spaced";
    return hr;
}

function mkButton(text, icon, onClick, { negative = false, outlined = true } = {}) {
    const b = document.createElement("button");
    b.className = `ts-button is-small${outlined ? " is-outlined" : ""}${negative ? " is-negative" : ""}${icon ? " is-start-icon" : ""}`;
    b.type = "button";
    b.innerHTML = icon ? `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span> ${text}` : text;
    b.addEventListener("click", onClick);
    return b;
}

function iconToggleButton(icon, label, active, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ts-button is-small is-icon is-outlined";
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-label", label);
    b.dataset.tooltip = label;
    b.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span>`;
    b.addEventListener("click", onClick);
    return b;
}

function field(labelText, inputEl) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced-small";
    if (labelText) {
        const label = document.createElement("label");
        label.className = "ts-text is-label";
        label.textContent = labelText;
        wrap.appendChild(label);
        const inner = document.createElement("div");
        inner.className = "has-top-spaced-small";
        inner.appendChild(inputEl);
        wrap.appendChild(inner);
    } else {
        wrap.appendChild(inputEl);
    }
    return wrap;
}

function fieldRow(fields) {
    const grid = document.createElement("div");
    grid.className = "ts-grid has-top-spaced-small";
    const wide = Math.floor(16 / fields.length);
    for (const [labelText, inputEl] of fields) {
        const col = document.createElement("div");
        col.className = `column is-${wide}-wide`;
        const label = document.createElement("label");
        label.className = "ts-text is-label";
        label.textContent = labelText;
        const inner = document.createElement("div");
        inner.className = "has-top-spaced-small";
        inner.appendChild(inputEl);
        col.appendChild(label);
        col.appendChild(inner);
        grid.appendChild(col);
    }
    return grid;
}

function textInput(value, onInput, type = "text") {
    const wrap = document.createElement("div");
    wrap.className = "ts-input is-small is-fluid";
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.addEventListener("input", () => onInput(type === "number" ? Number(input.value) : input.value));
    wrap.appendChild(input);
    return wrap;
}

function selectInput(options, value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "ts-select is-small is-fluid";
    const select = document.createElement("select");
    for (const [v, label] of options) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = label;
        if (v === value) opt.selected = true;
        select.appendChild(opt);
    }
    select.addEventListener("change", () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
}

function sliderField(labelText, value, min, max, onInput) {
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced-small";
    const label = document.createElement("label");
    label.className = "ts-text is-label field-label-row";
    const valueTag = document.createElement("span");
    valueTag.className = "ts-text is-description";
    valueTag.textContent = value;
    label.append(labelText, valueTag);

    const sliderWrap = document.createElement("div");
    sliderWrap.className = "ts-slider is-small is-fluid has-top-spaced-small";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener("input", () => {
        valueTag.textContent = input.value;
        onInput(Number(input.value));
    });
    sliderWrap.appendChild(input);

    wrap.appendChild(label);
    wrap.appendChild(sliderWrap);
    return wrap;
}

function checkboxInput(checked, onChange, labelText) {
    const label = document.createElement("label");
    label.className = "ts-checkbox is-small";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = labelText;
    label.appendChild(input);
    label.appendChild(text);
    return label;
}

// 可選字體（比照 Figma 對齊等段落屬性維持在元素層級，這裡列的字體/字級/粗體/
// 斜體/底線/刪除線則是「片段（run）」層級，同一個文字元素裡的每個片段可以各自
// 覆寫；片段沒指定時繼承這份清單第一項以外的元素預設值（見 renderer.js resolveRunStyle）。
const FONT_CHOICES = [
    ['"Noto Sans TC", "Microsoft JhengHei", sans-serif', "思源黑體（無襯線）"],
    ['"Noto Serif TC", PMingLiU, serif', "思源宋體（襯線）"],
    ['DFKai-SB, BiauKai, "Kaiti TC", serif', "標楷體"],
    ["ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", "等寬（數字／條碼文字）"],
    ...WEB_FONTS.map((font) => [font.stack, font.label]),
];

/**
 * 字體下拉選單（段落預設字體與選取範圍字體共用）：leading 是最前面的固定選項，接著內建清單，
 * 授權過本機字體就再接一組「本機字體」；目前值不在清單裡（例如 .ptan 來自別台電腦的本機字體）就補一項並標明這台電腦有沒有。
 */
function buildFontSelect({ value, leading, disabled = false, onChange }) {
    const wrap = document.createElement("div");
    wrap.className = "ts-select is-small is-fluid";
    const select = document.createElement("select");
    select.disabled = disabled;
    const addOption = (parent, v, label) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = label;
        parent.appendChild(opt);
    };
    for (const [v, label] of leading) addOption(select, v, label);
    for (const [v, label] of FONT_CHOICES) {
        addOption(select, v, findWebFont(v) && isWebFontFailed(findWebFont(v).id) ? `${label}（載入失敗，暫用系統字體）` : label);
    }

    const localFonts = getLocalFontFamilies();
    if (localFonts.length) {
        const group = document.createElement("optgroup");
        group.label = "本機字體";
        for (const family of localFonts) addOption(group, localFontStack(family), family);
        select.appendChild(group);
    }

    if (value && value !== MIXED && ![...select.options].some((o) => o.value === value)) {
        const name = primaryFamilyName(value);
        addOption(select, value, isFontInstalled(name) ? `${name}（本機字體）` : `${name}（此電腦沒有，改用預設字體）`);
    }
    select.value = value === MIXED ? "__mixed__" : (value || "");
    select.addEventListener("change", () => onChange(select.value || null));
    wrap.appendChild(select);
    return wrap;
}

function fontFamilySelect(value, onChange, inheritLabel) {
    return buildFontSelect({ value, leading: [["", inheritLabel]], onChange });
}

/** 「使用本機字體」入口：授權後把這台電腦的字體併入所有字體下拉選單；瀏覽器不支援 Local Font Access 時整個不顯示。 */
function localFontEntry() {
    if (!isLocalFontAccessSupported()) return null;
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced-small";
    const note = document.createElement("div");
    note.className = "ts-text is-small is-description has-top-spaced-small";
    const count = getLocalFontFamilies().length;
    const explain = "字體檔不會存進 .ptan，只記字體名稱；沒有該字體的電腦會改用預設字體。";
    if (count) {
        note.textContent = `已加入 ${count} 款本機字體。${explain}`;
        wrap.appendChild(note);
        return wrap;
    }
    note.textContent = `允許後可選用這台電腦安裝的字體。${explain}`;
    const button = mkButton("使用本機字體", "font", async () => {
        button.disabled = true;
        try {
            await loadLocalFonts();
            renderInspector();
        } catch (err) {
            button.disabled = false;
            note.className = "ts-text is-small is-negative has-top-spaced-small";
            note.textContent = err.name === "NotAllowedError" || err.name === "SecurityError"
                ? "沒有取得本機字體的存取權限，請在瀏覽器詢問時選擇「允許」。"
                : `無法讀取本機字體：${err.message}`;
        }
    });
    wrap.append(button, note);
    return wrap;
}

/** 選取範圍樣式工具列上的單一切換按鈕；value 為 MIXED 時顯示「混合」視覺狀態，沒有選取範圍時停用。 */
function rangeToggleButton(icon, label, value, hasRange, onToggle) {
    const isMixed = value === MIXED;
    const active = value === true;
    const btn = document.createElement("button");
    btn.className = "ts-button is-icon is-outlined is-small";
    btn.classList.toggle("is-active", active);
    btn.classList.toggle("is-mixed", isMixed);
    btn.type = "button";
    btn.disabled = !hasRange;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", String(active));
    btn.dataset.tooltip = label;
    btn.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span>`;
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggle(isMixed ? true : !active);
    });
    return btn;
}

function rangeFontFamilySelect(value, hasRange, onChange) {
    const leading = [["", "跟隨段落預設"]];
    if (value === MIXED) leading.unshift(["__mixed__", "混合"]);
    return buildFontSelect({ value, leading, disabled: !hasRange, onChange });
}

function rangeFontSizeInput(value, hasRange, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "ts-input is-small is-fluid";
    const input = document.createElement("input");
    input.type = "number";
    input.disabled = !hasRange;
    if (value === MIXED) {
        input.value = "";
        input.placeholder = "混合";
    } else {
        input.value = value || "";
    }
    input.addEventListener("input", () => onChange(input.value ? Number(input.value) : null));
    wrap.appendChild(input);
    return wrap;
}

function buildTextInspector(panel, el) {
    panel.appendChild(sectionHeader("align-left", "內容（可用 {{變數}}）"));

    const sel = textSel;
    const live = inlineEditor.isEditing(el.id) ? inlineEditor.getSelection() : null;
    sel.start = live ? live.start : 0;
    sel.end = live ? live.end : 0;
    const toolbar = document.createElement("div");
    toolbar.className = "pane-toolbar has-top-spaced-small";
    toolbar.addEventListener("mousedown", (e) => e.preventDefault()); // 按工具列不搶走預覽區編輯框的焦點／選取
    panel.appendChild(toolbar);
    const styleRow = document.createElement("div");
    panel.appendChild(styleRow);

    const textareaWrap = document.createElement("div");
    textareaWrap.className = "ts-input is-small is-fluid has-top-spaced-small";
    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.value = getTextContent(el);
    textareaWrap.appendChild(textarea);
    panel.appendChild(textareaWrap);

    function renderStyleControls() {
        const hasRange = sel.start !== sel.end;
        const style = getRangeStyle(el, sel.start, sel.end);
        toolbar.innerHTML = "";
        toolbar.appendChild(rangeToggleButton("bold", "粗體", style.bold, hasRange, (v) => applyRangeStyle("bold", v)));
        toolbar.appendChild(rangeToggleButton("italic", "斜體", style.italic, hasRange, (v) => applyRangeStyle("italic", v)));
        toolbar.appendChild(rangeToggleButton("underline", "底線", style.underline, hasRange, (v) => applyRangeStyle("underline", v)));
        toolbar.appendChild(rangeToggleButton("strikethrough", "刪除線", style.strikethrough, hasRange, (v) => applyRangeStyle("strikethrough", v)));
        toolbar.appendChild(rangeToggleButton("circle-half-stroke", "反白（黑底白字）", style.inverse, hasRange, (v) => applyRangeStyle("inverse", v)));

        styleRow.innerHTML = "";
        styleRow.appendChild(fieldRow([
            ["字體", rangeFontFamilySelect(style.fontFamily, hasRange, (v) => applyRangeStyle("fontFamily", v))],
            ["字級 (dot)", rangeFontSizeInput(style.fontSize, hasRange, (v) => applyRangeStyle("fontSize", v))],
        ]));
        const localEntry = localFontEntry();
        if (localEntry) styleRow.appendChild(localEntry);
    }

    function applyRangeStyle(field, value) {
        applyStyleToRange(el, sel.start, sel.end, field, value);
        onModelChange({ skipInspector: true });
        inlineEditor.refresh();
        renderStyleControls();
    }

    function trackSelection() {
        sel.start = textarea.selectionStart;
        sel.end = textarea.selectionEnd;
        renderStyleControls();
    }
    ["select", "keyup", "mouseup", "click", "focus"].forEach((evt) => textarea.addEventListener(evt, trackSelection));
    textarea.addEventListener("input", () => {
        replaceFullText(el, textarea.value);
        onModelChange({ skipInspector: true });
        trackSelection();
    });

    sel.refresh = renderStyleControls;
    renderStyleControls();

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("font", "段落樣式"));
    panel.appendChild(fieldRow([
        ["預設字體", fontFamilySelect(el.fontFamily, (v) => { el.fontFamily = v; onModelChange({ skipInspector: true }); }, "跟隨全域預設")],
        ["預設字級 (dot)", textInput(el.fontSize, (v) => { el.fontSize = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
    panel.appendChild(fieldRow([
        ["行高倍數", textInput(el.lineHeight, (v) => { el.lineHeight = v; onModelChange({ skipInspector: true }); }, "number")],
        ["字距 (dot)", textInput(el.letterSpacing, (v) => { el.letterSpacing = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
    panel.appendChild(fieldRow([
        ["對齊", selectInput([["left", "靠左"], ["center", "置中"], ["right", "靠右"]], el.align, (v) => { el.align = v; onModelChange({ skipInspector: true }); })],
        ["最多行數（0＝不限制）", textInput(el.maxLines, (v) => { el.maxLines = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
    panel.appendChild(field(null, checkboxInput(el.bold, (v) => { el.bold = v; onModelChange({ skipInspector: true }); }, "預設粗體")));
    panel.appendChild(field(null, checkboxInput(!!el.inverse, (v) => { el.inverse = v; onModelChange({ skipInspector: true }); }, "整行反白（黑底白字）")));
    panel.appendChild(field(null, checkboxInput(el.wrap, (v) => { el.wrap = v; onModelChange({ skipInspector: true }); }, "自動換行")));
}

function resolveAssetDataUrl(assetId) {
    const asset = state.project.assets.find((a) => a.id === assetId);
    return asset ? asset.dataUrl : null;
}

function loadImageElement(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

/** 圖片元素的裁切工具：canvas 顯示「旋轉後」的圖片，疊一層可拖曳/縮放的裁切框。
 * cropRect 儲存在 el 上為 0-1 正規化座標，相對旋轉後的圖片（與 renderer.js 的裁切邏輯一致）。 */
function buildCropTool(el) {
    const wrap = document.createElement("div");
    wrap.className = "image-crop-tool";
    const dataUrl = resolveAssetDataUrl(el.assetId);
    if (!dataUrl) {
        wrap.hidden = true;
        return wrap;
    }

    const canvas = document.createElement("canvas");
    const box = document.createElement("div");
    box.className = "image-crop-box";
    ["nw", "ne", "sw", "se"].forEach((pos) => {
        const handle = document.createElement("div");
        handle.className = `image-crop-handle is-${pos}`;
        handle.dataset.pos = pos;
        box.appendChild(handle);
    });
    wrap.appendChild(canvas);
    wrap.appendChild(box);

    function currentRect() {
        return el.cropRect || { x: 0, y: 0, w: 1, h: 1 };
    }

    function layoutBox() {
        const r = currentRect();
        box.style.left = `${r.x * 100}%`;
        box.style.top = `${r.y * 100}%`;
        box.style.width = `${r.w * 100}%`;
        box.style.height = `${r.h * 100}%`;
    }

    function setCropRect(next) {
        const MIN = 0.04;
        let w = Math.max(MIN, Math.min(1, next.w));
        let h = Math.max(MIN, Math.min(1, next.h));
        const x = Math.max(0, Math.min(1 - w, next.x));
        const y = Math.max(0, Math.min(1 - h, next.y));
        el.cropRect = { x, y, w, h };
        layoutBox();
        onModelChange({ skipInspector: true });
    }

    box.addEventListener("pointerdown", (e) => {
        const handlePos = e.target instanceof HTMLElement ? e.target.dataset.pos : null;
        e.preventDefault();
        e.stopPropagation();
        box.setPointerCapture(e.pointerId);
        const startRect = currentRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = canvas.getBoundingClientRect();
        const move = (ev) => {
            const dxFrac = (ev.clientX - startX) / rect.width;
            const dyFrac = (ev.clientY - startY) / rect.height;
            if (!handlePos) {
                setCropRect({ ...startRect, x: startRect.x + dxFrac, y: startRect.y + dyFrac });
                return;
            }
            let { x, y, w, h } = startRect;
            if (handlePos.includes("w")) { x = startRect.x + dxFrac; w = startRect.w - dxFrac; }
            if (handlePos.includes("e")) { w = startRect.w + dxFrac; }
            if (handlePos.includes("n")) { y = startRect.y + dyFrac; h = startRect.h - dyFrac; }
            if (handlePos.includes("s")) { h = startRect.h + dyFrac; }
            setCropRect({ x, y, w, h });
        };
        const up = () => {
            box.releasePointerCapture(e.pointerId);
            box.removeEventListener("pointermove", move);
            box.removeEventListener("pointerup", up);
        };
        box.addEventListener("pointermove", move);
        box.addEventListener("pointerup", up);
    });

    (async () => {
        const img = await loadImageElement(dataUrl);
        if (!img) { wrap.hidden = true; return; }
        const rotation = ((el.rotation || 0) % 360 + 360) % 360;
        const swapped = rotation === 90 || rotation === 270;
        const rotatedW = swapped ? img.naturalHeight : img.naturalWidth;
        const rotatedH = swapped ? img.naturalWidth : img.naturalHeight;
        const scale = Math.min(1, 260 / rotatedW);
        canvas.width = Math.max(1, Math.round(rotatedW * scale));
        canvas.height = Math.max(1, Math.round(rotatedH * scale));
        const ctx = canvas.getContext("2d");
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        const drawW = img.naturalWidth * scale;
        const drawH = img.naturalHeight * scale;
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
        layoutBox();
    })();

    return wrap;
}

function buildImageInspector(panel, el) {
    panel.appendChild(sectionHeader("image", "圖片來源"));
    const isVariable = typeof el.assetId === "string" && /\{\{.*\}\}/.test(el.assetId);

    const pickBtn = mkButton(el.assetId && !isVariable ? "更換圖片" : "選擇圖片", "upload", () => {
        imageFileInputHandler = (assetId) => {
            el.assetId = assetId;
            el.cropRect = null; // 換圖後舊的裁切窗格對新圖不再有意義
            onModelChange();
        };
        els["image-file-input"].click();
    }, { outlined: true });

    const varInput = textInput(el.assetId || "", (v) => { el.assetId = v; onModelChange({ skipInspector: true }); });
    varInput.querySelector("input").placeholder = "{{image}}";
    const varWrap = field(null, varInput);
    varWrap.hidden = !isVariable;
    const varToggle = iconToggleButton("list-check", "改用變數綁定圖片", isVariable, () => {
        varWrap.hidden = !varWrap.hidden;
        if (!varWrap.hidden) varInput.querySelector("input").focus();
    });

    const sourceRow = document.createElement("div");
    sourceRow.className = "ts-wrap is-compact has-top-spaced-small";
    sourceRow.appendChild(pickBtn);
    sourceRow.appendChild(varToggle);
    panel.appendChild(sourceRow);
    panel.appendChild(varWrap);

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("ruler", "尺寸與版面"));
    panel.appendChild(sliderField("寬度 (%)", Math.max(1, Math.min(100, el.widthPercent ?? 100)), 1, 100, (v) => { el.widthPercent = v; onModelChange({ skipInspector: true }); }));

    const layoutRow = document.createElement("div");
    layoutRow.className = "ts-wrap is-compact has-top-spaced-small";
    layoutRow.appendChild(iconToggleButton("align-left", "靠左", el.align === "left", () => { el.align = "left"; onModelChange(); }));
    layoutRow.appendChild(iconToggleButton("align-center", "置中", (el.align || "center") === "center", () => { el.align = "center"; onModelChange(); }));
    layoutRow.appendChild(iconToggleButton("align-right", "靠右", el.align === "right", () => { el.align = "right"; onModelChange(); }));
    layoutRow.appendChild(iconToggleButton("rotate-right", "順時針旋轉 90°", false, () => {
        el.rotation = ((el.rotation || 0) + 90) % 360;
        el.cropRect = null; // 旋轉後舊裁切窗格的座標系不再對應原圖，重置避免裁到錯的地方
        onModelChange();
    }));
    layoutRow.appendChild(iconToggleButton("arrows-up-down", "拉伸至指定高度（關閉＝依比例縮放）", el.fit === "stretch", () => {
        el.fit = el.fit === "stretch" ? "auto" : "stretch";
        onModelChange();
    }));
    panel.appendChild(layoutRow);

    if (el.fit === "stretch") {
        panel.appendChild(field("指定高度 (dot)", textInput(el.heightDots || 0, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
    }

    if (!isVariable && el.assetId) {
        panel.appendChild(sectionDivider());
        panel.appendChild(sectionHeader("crop-simple", "裁切"));
        const cropTool = buildCropTool(el);
        panel.appendChild(cropTool);
        const cropActions = document.createElement("div");
        cropActions.className = "ts-wrap is-compact has-top-spaced-small";
        cropActions.appendChild(iconButton("expand", "還原（取消裁切）", () => {
            el.cropRect = null;
            onModelChange();
        }));
        panel.appendChild(cropActions);
    }

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("sliders", "調整"));
    panel.appendChild(sliderField("亮度", el.brightness ?? 0, -100, 100, (v) => { el.brightness = v; onModelChange({ skipInspector: true }); }));
    panel.appendChild(sliderField("對比", el.contrast ?? 0, -100, 100, (v) => { el.contrast = v; onModelChange({ skipInspector: true }); }));
    panel.appendChild(field(null, checkboxInput(!!el.invert, (v) => { el.invert = v; onModelChange({ skipInspector: true }); }, "反相")));
    panel.appendChild(field("取樣方式（熱感輸出網點）", selectInput(
        [["floyd-steinberg", "誤差擴散"], ["ordered", "網點"], ["threshold", "純黑白"]],
        el.ditherMode || "floyd-steinberg",
        (v) => { el.ditherMode = v; onModelChange(); },
    )));
    if (el.ditherMode === "threshold") {
        panel.appendChild(sliderField("門檻", el.thresholdLevel ?? 128, 0, 255, (v) => { el.thresholdLevel = v; onModelChange({ skipInspector: true }); }));
    }
}

function buildSpacerInspector(panel, el) {
    panel.appendChild(sectionHeader("arrows-up-down", "間隔"));
    panel.appendChild(field("高度 (dot)", textInput(el.heightDots, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
}

function buildDividerInspector(panel, el) {
    panel.appendChild(sectionHeader("minus", "分隔線"));
    panel.appendChild(field("樣式", selectInput([["solid", "實線"], ["dashed", "虛線"], ["dotted", "點線"]], el.style, (v) => { el.style = v; onModelChange({ skipInspector: true }); })));
    panel.appendChild(field("粗細 (dot)", textInput(el.thicknessDots, (v) => { el.thicknessDots = v; onModelChange({ skipInspector: true }); }, "number")));
    panel.appendChild(fieldRow([
        ["上邊距 (dot)", textInput(el.marginTopDots, (v) => { el.marginTopDots = v; onModelChange({ skipInspector: true }); }, "number")],
        ["下邊距 (dot)", textInput(el.marginBottomDots, (v) => { el.marginBottomDots = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
}

function buildRowInspector(panel, el) {
    panel.appendChild(sectionHeader("table-columns", "多欄"));
    const label = document.createElement("label");
    label.className = "ts-text is-label has-top-spaced-small";
    label.textContent = "欄位比例";
    panel.appendChild(label);

    const presets = [[1, 1], [2, 1], [1, 2], [1, 1, 1]];
    const wrap = document.createElement("div");
    wrap.className = "ts-wrap is-compact has-top-spaced-small";
    for (const ratio of presets) {
        const active = el.ratio.length === ratio.length && el.ratio.every((v, i) => v === ratio[i]);
        wrap.appendChild(mkButton(ratio.join(" : "), null, () => { setRowRatio(el, ratio); onModelChange(); }, { outlined: !active }));
    }
    panel.appendChild(wrap);
}

function barcodeNote(text, isError) {
    const note = document.createElement("div");
    setBarcodeNote(note, text, isError);
    return note;
}

function setBarcodeNote(note, text, isError) {
    note.className = `ts-text is-small has-top-spaced-small ${isError ? "is-negative" : "is-description"}`;
    note.textContent = text;
    note.hidden = !text;
}

function buildBarcodeInspector(panel, el) {
    panel.appendChild(sectionHeader("qrcode", "條碼／QR Code"));
    panel.appendChild(field("類型", selectInput(BARCODE_FORMATS, el.format, (v) => {
        el.format = v;
        onModelChange();
    })));
    panel.appendChild(barcodeNote(BARCODE_FORMAT_INFO[el.format] || "", false));

    const valueHint = barcodeNote("", false);
    const refreshValueHint = () => {
        const value = el.value || "";
        if (!value || el.format === "qrcode") return setBarcodeNote(valueHint, "", false);
        if (value.includes("{{")) return setBarcodeNote(valueHint, "內容含變數，套用資料後才會檢查格式", false);
        const checked = validateBarcodeValue(el.format, value);
        setBarcodeNote(valueHint, checked.ok ? checked.note : checked.message, !checked.ok);
    };
    panel.appendChild(field("內容（可用 {{變數}}）", textInput(el.value || "", (v) => {
        el.value = v;
        refreshValueHint();
        onModelChange({ skipInspector: true });
    })));
    panel.appendChild(valueHint);
    refreshValueHint();
    if (el.format !== "qrcode") {
        panel.appendChild(field(null, checkboxInput(el.showText !== false, (v) => {
            el.showText = v;
            onModelChange({ skipInspector: true });
        }, "顯示明碼（條碼下方數字）")));
    }

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("ruler", "尺寸與對齊"));
    panel.appendChild(fieldRow([
        ["高度 (dot)", textInput(el.heightDots, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")],
        ["對齊", selectInput([["left", "靠左"], ["center", "置中"], ["right", "靠右"]], el.align, (v) => { el.align = v; onModelChange({ skipInspector: true }); })],
    ]));
}

// ---- 變數 / 預覽資料 ----

function renderVariables() {
    const names = extractPlaceholders(state.project.template.elements);
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
        inputCol.appendChild(textInput(state.previewData[name] ?? "", (v) => {
            state.previewData[name] = v;
            schedulePreview();
        }));

        row.appendChild(labelCol);
        row.appendChild(inputCol);
        panel.appendChild(row);
    });
}

// ---- 紙張預覽 ----

function updatePaperFrame() {
    const profile = getEffectiveProfile();
    const paper = getPaperWidth(profile, state.project.paper.widthId);
    const marginMm = Math.max((paper.rollWidthMm - paper.printableWidthMm) / 2, 0);
    // 連續紙沒有實體「上邊界」，安全區上緣純粹是視覺留白；下緣則是切刀刀片跟列印頭的
    // 實際距離（bladeOffsetMm）——太靠下緣的內容，切紙時有被裁到的風險。
    const bladeOffsetMm = profile.autocutter?.bladeOffsetMm ?? 0;
    els["paper-shadow"].style.setProperty("--paper-margin", `${marginMm * PX_PER_MM}px`);
    els["paper-shadow"].style.setProperty("--paper-safe-bottom", `${bladeOffsetMm * PX_PER_MM}px`);
    els["canvas-host"].style.width = `${paper.printableWidthMm * PX_PER_MM}px`;
    // 版面完全沒有元素時，安全區虛線框只是誤導（看起來像渲染壞掉），故不顯示
    const isEmpty = state.project.template.elements.length === 0;
    els["paper-viewport"].classList.toggle("is-empty", isEmpty);
}

async function updatePreview() {
    updatePaperFrame();
    const generation = ++state.previewGeneration;
    let result;
    try {
        const data = state.batchPreview.active
            ? (state.batchPreview.records[state.batchPreview.index] ?? {})
            : state.previewData;
        result = await renderTemplate(state.project, data, { mode: state.mode, profile: getEffectiveProfile() });
    } catch (err) {
        console.error(err);
        return;
    }
    if (generation !== state.previewGeneration) return; // 過期的渲染結果，丟棄
    lastRenderResult = result;
    updateFontFallbackNotice(result.fontFallbacks);
    els["canvas-host"].innerHTML = "";
    els["canvas-host"].appendChild(result.canvas);
    if (!els["edit-overlay"]) {
        els["edit-overlay"] = document.createElement("div");
        els["edit-overlay"].className = "edit-overlay";
    }
    els["canvas-host"].appendChild(els["edit-overlay"]);
    renderEditOverlay();
}

/** 網頁字體（等寬）載入失敗時，在預覽區上方明確提示目前顯示與列印的是系統字體，不默默換字。 */
function updateFontFallbackNotice(failedLabels) {
    let notice = els["font-fallback-notice"];
    if (!failedLabels?.length) {
        if (notice) notice.hidden = true;
        return;
    }
    if (!notice) {
        notice = document.createElement("div");
        notice.className = "ts-notice is-negative";
        notice.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
        const body = els["paper-shadow"].parentElement;
        body.parentElement.insertBefore(notice, body);
        els["font-fallback-notice"] = notice;
    }
    notice.hidden = false;
    notice.firstChild.textContent = `字體「${failedLabels.join("、")}」沒有載入成功（可能沒有網路），預覽與列印暫時改用系統字體。`;
}

// 預覽區行內文字編輯（見 inline-text-editor.js）。textSel 是面板工具列操作的選取範圍，
// 來源可能是面板 textarea，也可能是預覽區的編輯框。
const textSel = { start: 0, end: 0, refresh: null };
const inlineEditor = createInlineTextEditor({
    getHost: () => els["paper-shadow"],
    getElement: (id) => findElementById(state.project.template.elements, id),
    getBlockNode: (id) => els["edit-overlay"]?.querySelector(`.edit-block[data-id="${id}"]`),
    getScale: () => (lastRenderResult ? lastRenderResult.canvas.clientWidth / lastRenderResult.widthDots : 1) || 1,
    onInput: () => onModelChange(),
    onSelection: (id, start, end) => {
        if (id !== state.selectedId) return;
        textSel.start = start;
        textSel.end = end;
        textSel.refresh?.();
    },
});

// ---- 編輯模式畫布疊層：虛線外框、拖曳排序、拖曳縮放 ----
// 疊層座標直接沿用 renderer.js 排版產出的 items 樹（跟畫面上的 canvas 完全同一份排版結果），
// 只是額外換算成 CSS px 蓋在 canvas 上面；預覽模式只是把這層疊層清空隱藏，canvas 本身不受影響。

function renderEditOverlay() {
    const overlay = els["edit-overlay"];
    if (!overlay) return;
    overlay.innerHTML = "";
    if (state.viewMode !== "edit" || !lastRenderResult) {
        inlineEditor.close();
        return;
    }

    const { items, widthDots, canvas } = lastRenderResult;
    const scale = canvas.clientWidth / widthDots || 1;
    const handleBuilders = [];

    walkItems(items, 0, 0, (box, item) => {
        overlay.appendChild(buildEditBlock(box, scale));
        if (box.el.type === "spacer" || box.el.type === "image" || box.el.type === "barcode") {
            handleBuilders.push(() => buildHeightResizeHandle(box, scale));
        }
        if (box.el.type === "row") {
            let cumulative = 0;
            item.columns.forEach((col, i) => {
                cumulative += col.width;
                if (i === item.columns.length - 1) return; // 最後一欄後面沒有把手
                const boundaryXDots = box.x + cumulative;
                handleBuilders.push(() => buildColumnResizeHandle(box.el, i, boundaryXDots, box.y, box.height, box.width, scale));
            });
        }
    });

    // 把手一律留到最後才加進 DOM，確保疊在所有元素外框之上，滑鼠才抓得到
    handleBuilders.forEach((build) => overlay.appendChild(build()));
    inlineEditor.reposition();
}

function walkItems(items, offsetX, offsetY, visit) {
    for (const item of items) {
        const box = { el: item.el, x: offsetX, y: offsetY + item.y, width: item.widthDots, height: item.height };
        visit(box, item);
        if (item.el.type === "row") {
            for (const col of item.columns) {
                walkItems(col.items, offsetX + col.x, offsetY + item.y, visit);
            }
        }
    }
}

function buildEditBlock(box, scale) {
    const div = document.createElement("div");
    div.className = "edit-block";
    div.dataset.id = box.el.id;
    div.style.left = `${box.x * scale}px`;
    div.style.top = `${box.y * scale}px`;
    div.style.width = `${box.width * scale}px`;
    div.style.height = `${Math.max(box.height, 1) * scale}px`;
    if (state.selectedId === box.el.id) div.classList.add("is-selected");
    attachBlockInteractions(div, box.el.id);
    return div;
}

/** 點擊選取＋拖曳排序（在同一個容器內，跟大綱面板的上移／下移操作同一個 array）。 */
function attachBlockInteractions(div, elId) {
    div.addEventListener("pointerdown", (e) => {
        if (e.target !== div || e.button !== 0) return;
        const startX = e.clientX;
        const startY = e.clientY;
        let dragging = false;
        let siblings = null;

        function onMove(ev) {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!dragging) {
                if (Math.hypot(dx, dy) < 4) return;
                dragging = true;
                div.classList.add("is-dragging");
                siblings = collectSiblingBoxes(elId);
            }
            div.style.transform = `translate(${dx}px, ${dy}px)`;
            if (siblings) showInsertionLine(findDropTarget(siblings, ev.clientY).edgeY);
        }
        function onUp(ev) {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            div.classList.remove("is-dragging");
            div.style.transform = "";
            clearInsertionLine();
            if (dragging && siblings) {
                moveElementTo(elId, findDropTarget(siblings, ev.clientY).index);
            } else if (!dragging) {
                // 已選取的文字元素再點一下＝在預覽區直接編輯，插入點落在點擊位置
                const editText = state.selectedId === elId && findElementById(state.project.template.elements, elId)?.type === "text";
                selectElementById(elId);
                if (editText) inlineEditor.open(elId, { x: ev.clientX, y: ev.clientY });
            }
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    });
}

function collectSiblingBoxes(elId) {
    const found = findContainerOf(state.project.template.elements, elId);
    if (!found) return null;
    const overlay = els["edit-overlay"];
    const others = found.array
        .filter((el) => el.id !== elId)
        .map((el) => {
            const node = overlay.querySelector(`.edit-block[data-id="${el.id}"]`);
            return node ? { id: el.id, rect: node.getBoundingClientRect() } : null;
        })
        .filter(Boolean);
    return { array: found.array, others };
}

function findDropTarget(siblings, clientY) {
    const { array, others } = siblings;
    for (const o of others) {
        const mid = o.rect.top + o.rect.height / 2;
        if (clientY < mid) {
            return { index: array.findIndex((el) => el.id === o.id), edgeY: o.rect.top };
        }
    }
    if (others.length) {
        const last = others[others.length - 1];
        return { index: array.length, edgeY: last.rect.bottom };
    }
    return { index: 0, edgeY: 0 };
}

function showInsertionLine(edgeYViewport) {
    const overlay = els["edit-overlay"];
    let line = overlay.querySelector(".edit-insertion-line");
    if (!line) {
        line = document.createElement("div");
        line.className = "edit-insertion-line";
        overlay.appendChild(line);
    }
    const overlayRect = overlay.getBoundingClientRect();
    line.style.top = `${edgeYViewport - overlayRect.top}px`;
}

function clearInsertionLine() {
    els["edit-overlay"]?.querySelector(".edit-insertion-line")?.remove();
}

/** 高度拖曳把手：目前只有 spacer／image 的高度是可以直接調整的數值。
 * box.el 來自 renderer 排版結果，是套用 mail merge 資料時深拷貝出來的節點（見 core/merge.js
 * 的 applyDataToElements），跟 state.project.template.elements 不是同一個物件，
 * 所以要修改的話必須用 id 找回真正的 element，直接改 box.el 不會反映到實際專案資料上。 */
function buildHeightResizeHandle(box, scale) {
    const handle = document.createElement("div");
    handle.className = "edit-resize-handle is-height";
    handle.style.left = `${box.x * scale}px`;
    handle.style.width = `${box.width * scale}px`;
    handle.style.top = `${(box.y + box.height) * scale - 3}px`;
    handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.classList.add("is-dragging");
        const realEl = findElementById(state.project.template.elements, box.el.id);
        if (!realEl) return;
        const startY = e.clientY;
        const startHeight = realEl.heightDots;
        function onMove(ev) {
            const deltaDots = (ev.clientY - startY) / scale;
            realEl.heightDots = Math.max(1, Math.round(startHeight + deltaDots));
            schedulePreview();
        }
        function onUp() {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            handle.classList.remove("is-dragging");
            onModelChange();
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    });
    return handle;
}

/** 欄寬拖曳把手：把兩欄的目前點寬直接當比例使用，拖曳時即時換算成新的 ratio。
 * rowEl 同樣是排版結果裡的深拷貝節點（理由同 buildHeightResizeHandle 的註解），
 * 要修改 ratio 必須用 id 找回 state.project.template.elements 裡真正的 row。 */
function buildColumnResizeHandle(rowEl, colIndex, boundaryXDots, rowYDots, rowHeightDots, rowWidthDots, scale) {
    const handle = document.createElement("div");
    handle.className = "edit-resize-handle is-col";
    handle.style.left = `${boundaryXDots * scale - 3}px`;
    handle.style.top = `${rowYDots * scale}px`;
    handle.style.height = `${Math.max(rowHeightDots, 1) * scale}px`;
    handle.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.classList.add("is-dragging");
        const realRow = findElementById(state.project.template.elements, rowEl.id);
        if (!realRow) return;
        const startX = e.clientX;
        const startWidths = splitDotsByRatio(rowWidthDots, realRow.ratio);
        const minWidth = 10;
        function onMove(ev) {
            let deltaDots = (ev.clientX - startX) / scale;
            deltaDots = Math.max(deltaDots, minWidth - startWidths[colIndex]);
            deltaDots = Math.min(deltaDots, startWidths[colIndex + 1] - minWidth);
            const widths = startWidths.slice();
            widths[colIndex] = Math.round(widths[colIndex] + deltaDots);
            widths[colIndex + 1] = Math.round(widths[colIndex + 1] - deltaDots);
            realRow.ratio = widths;
            schedulePreview();
        }
        function onUp() {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            handle.classList.remove("is-dragging");
            onModelChange();
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
    });
    return handle;
}

// ---- 匯出 / 列印 ----

// 有網頁字體沒載入成功時輸出會改用系統字體，版面跟預覽不同，輸出前讓使用者決定
function confirmFontFallbacks(results) {
    return ![].concat(results).some((r) => r.fontFallbacks?.length) || confirm("字體未載入，仍要列印？");
}

async function exportSinglePdf() {
    const result = await renderTemplate(state.project, state.previewData, { mode: "thermal", profile: getEffectiveProfile() });
    if (!confirmFontFallbacks(result)) return;
    exportToPdf([result], { fileName: `${state.project.meta.name || "printan"}.pdf` });
}

// 匯出跟預覽都要吃同一份批次資料，剖析／驗證邏輯只寫這一處，避免兩邊行為兜不起來
function parseBatchData() {
    try {
        const dataArray = JSON.parse(els["batch-data"].value || "[]");
        if (!Array.isArray(dataArray) || dataArray.length === 0) throw new Error("請提供至少一筆資料的 JSON 陣列");
        return dataArray;
    } catch (err) {
        alert(`批次資料格式錯誤：${err.message}`);
        return null;
    }
}

async function exportBatchPdf() {
    const dataArray = parseBatchData();
    if (!dataArray) return;
    const results = await renderBatch(state.project, dataArray, { mode: "thermal", profile: getEffectiveProfile() });
    if (!confirmFontFallbacks(results)) return;
    exportToPdf(results, { fileName: `${state.project.meta.name || "printan"}-batch.pdf` });
}

// ---- 批次資料面板：收合、逐筆預覽 ----

function updateBatchPreviewNav() {
    const { active, records, index } = state.batchPreview;
    els["batch-preview-nav"].hidden = !active;
    if (!active) return;
    els["batch-preview-counter"].textContent = `第 ${index + 1} / ${records.length} 筆`;
    els["btn-batch-prev"].disabled = index <= 0;
    els["btn-batch-next"].disabled = index >= records.length - 1;
}

function startBatchPreview() {
    const dataArray = parseBatchData();
    if (!dataArray) return;
    state.batchPreview = { active: true, records: dataArray, index: 0 };
    updateBatchPreviewNav();
    schedulePreview();
}

function stepBatchPreview(delta) {
    if (!state.batchPreview.active) return;
    const next = state.batchPreview.index + delta;
    if (next < 0 || next >= state.batchPreview.records.length) return;
    state.batchPreview.index = next;
    updateBatchPreviewNav();
    schedulePreview();
}

function endBatchPreview() {
    if (!state.batchPreview.active) return;
    state.batchPreview = { active: false, records: [], index: 0 };
    updateBatchPreviewNav();
    schedulePreview();
}

function setBatchPanelExpanded(expanded) {
    els["batch-panel-body"].hidden = !expanded;
    els["batch-panel-toggle"].setAttribute("aria-expanded", String(expanded));
    localStorage.setItem(BATCH_PANEL_EXPANDED_KEY, String(expanded));
}

function bindBatchPanel() {
    setBatchPanelExpanded(localStorage.getItem(BATCH_PANEL_EXPANDED_KEY) === "true");

    els["batch-panel-toggle"].addEventListener("click", () => {
        const expanded = els["batch-panel-toggle"].getAttribute("aria-expanded") === "true";
        setBatchPanelExpanded(!expanded);
    });

    els["btn-preview-batch"].addEventListener("click", startBatchPreview);
    els["btn-batch-prev"].addEventListener("click", () => stepBatchPreview(-1));
    els["btn-batch-next"].addEventListener("click", () => stepBatchPreview(1));
    els["btn-batch-end-preview"].addEventListener("click", endBatchPreview);
}

// ESC/POS 直連列印（WebUSB／WebSerial）用的列印選項：在使用者的走紙／切紙偏好之外，
// 額外帶入目前印表機 profile 的列印頭最大寬度，讓 buildEscposJob 統一置中輸出
// （見 printer-adapter.js centerCanvasOnWidth），避免紙寬較窄時印出來的內容偏移。
function getEscposPrintOptions() {
    return { ...state.printPrefs, targetWidthDots: getPrintHeadWidthDots(getEffectiveProfile()) };
}

async function printCurrent() {
    if (state.printerBusy) {
        alert("印表機正在處理上一個操作（列印／測試列印／查詢狀態），請稍候再試一次");
        return;
    }
    state.printerBusy = true;
    try {
        const result = await renderTemplate(state.project, state.previewData, { mode: "thermal", profile: getEffectiveProfile() });
        if (!confirmFontFallbacks(result)) return;

        if (state.usbConnected) {
            try {
                await usbAdapter.print(result, getEscposPrintOptions());
                return;
            } catch (err) {
                state.usbConnected = false;
                updatePrinterConnectionUi();
                alert(`印表機列印失敗，已改用系統列印對話框：${err.message}`);
            }
        } else if (state.serialConnected) {
            try {
                await serialAdapter.print(result, getEscposPrintOptions());
                return;
            } catch (err) {
                state.serialConnected = false;
                updatePrinterConnectionUi();
                alert(`印表機列印失敗，已改用系統列印對話框：${err.message}`);
            }
        }

        const adapter = new SystemDialogAdapter();
        await adapter.connect();
        await adapter.print(result);
    } finally {
        state.printerBusy = false;
    }
}

// ---- 列印設定（WebUSB／WebSerial 直連、印表機識別、走紙／切紙／可列印點數偏好） ----
// 連線狀態、走紙／切紙偏好都是「這台瀏覽器、這台印表機」的本機操作習慣，不寫進 .ptan，
// 同一份版型換人、換印表機開啟時不應該被綁死。

function loadPrintPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(PRINT_PREFS_KEY) || "{}");
        state.printPrefs = { ...state.printPrefs, ...saved };
        state.printPrefs.printableDots = sanitizePrintableDotsOverrides(state.printPrefs.printableDots);
    } catch {
        // 格式壞掉就用預設值，不擋流程
    }
}

function savePrintPrefs() {
    localStorage.setItem(PRINT_PREFS_KEY, JSON.stringify(state.printPrefs));
}

function currentWebUsbVendorId() {
    return getPrinterProfile(state.project.printerProfile.id).webUsb?.vendorId;
}

async function attemptSilentPrinterReconnect() {
    if (usbAdapter.isSupported()) {
        try {
            state.usbConnected = await usbAdapter.reconnectIfAuthorized(currentWebUsbVendorId());
        } catch {
            state.usbConnected = false;
        }
    }
    if (!state.usbConnected && serialAdapter.isSupported()) {
        try {
            state.serialConnected = await serialAdapter.reconnectIfAuthorized(currentWebUsbVendorId(), state.printPrefs.serialBaudRate);
        } catch {
            state.serialConnected = false;
        }
    }
    updatePrinterConnectionUi();
    await identifyConnectedPrinter();
}

// 設定 modal 的連線區塊只有一組連接／中斷按鈕，「目前選哪種連接方式」跟「實際連上哪一種」
// 要分開看：已連接時以實際連上的為準（方式選項鎖住，要換得先中斷）；未連接時才用使用者選的方式。
function currentConnectMethod() {
    if (state.usbConnected) return "usb";
    if (state.serialConnected) return "serial";
    return state.printPrefs.connectMethod === "serial" ? "serial" : "usb";
}

function updatePrinterConnectionUi() {
    const connected = state.usbConnected || state.serialConnected;
    const method = currentConnectMethod();
    const methodAdapter = method === "serial" ? serialAdapter : usbAdapter;
    const supported = methodAdapter.isSupported();
    const connectedLabel = connected
        ? `${state.usbConnected ? usbAdapter.deviceLabel : serialAdapter.deviceLabel}（${state.usbConnected ? "USB" : "序列埠"}）`
        : "";

    for (const input of els["printer-connect-method"].querySelectorAll("input")) {
        input.checked = input.value === method;
        input.disabled = connected;
    }
    els["printer-serial-options"].hidden = method !== "serial";
    els["printer-connection-unsupported"].hidden = supported;
    els["printer-connection-unsupported"].textContent = method === "serial"
        ? "此瀏覽器不支援 Web Serial API，請改用 Chrome 或 Edge，或繼續使用系統列印對話框。"
        : "此瀏覽器不支援 WebUSB，請改用 Chrome 或 Edge，或繼續使用系統列印對話框。";
    els["printer-connection-status"].textContent = connected
        ? `已連接：${connectedLabel}`
        : "尚未連接，列印會走系統列印對話框";
    els["btn-printer-connect"].hidden = connected;
    els["btn-printer-connect"].disabled = !supported;
    els["btn-printer-disconnect"].hidden = !connected;

    // 連線狀態燈：modal 標題旁的 badge 是主要指示，工具列「列印設定」按鈕文字後面的小綠點
    // 讓不開 modal 也看得出有沒有連接。都是 in-flow 元素，不用絕對定位貼在按鈕角落
    // （貼角的圓點會被邊框吃掉一半，看起來像「有問題」的角標，也不是 .is-active 那種
    // 整顆填色的「目前開啟」語意，見 editor.css .printer-conn-dot）。
    // 未連接時 badge 用紅底（最搶眼，提醒要連線）；已連接改成綠燈外框。
    els["printer-conn-badge"].classList.toggle("is-negative", !connected);
    els["printer-conn-badge"].classList.toggle("is-outlined", connected);
    els["printer-conn-badge"].querySelector(".printer-conn-dot").classList.toggle("is-on", connected);
    els["printer-conn-badge-text"].textContent = connected ? "已連接" : "未連接";
    els["printer-toolbar-dot"].hidden = !connected;
    els["btn-printer-settings"].dataset.tooltip = connected
        ? `列印設定（已連接：${connectedLabel}）`
        : "列印設定（印表機連線、走紙／切紙、可列印點數、測試列印）";
    els["btn-printer-settings"].setAttribute("aria-label", connected ? "列印設定（印表機已連接）" : "列印設定（印表機未連接）");

    // 識別資料只在連線期間有意義，斷線（含裝置被拔掉）就清掉，見 identifyConnectedPrinter()。
    if (!connected) state.printerIdentity = null;
    updatePrinterInfo();
    els["btn-printer-forget"].disabled = !(usbAdapter.canForget() || serialAdapter.canForget());

    // 跟連接／中斷按鈕一樣用狀態控制可用性，不要讓沒接印表機時還能按「測試列印」／
    // 「查詢印表機狀態」再跳 alert 說明——那樣使用者得先點一次才知道不能用，體驗上
    // 比按鈕本身直接變成無法點擊差一截。
    els["btn-printer-test-print"].disabled = !connected;
    els["btn-printer-query-status"].disabled = !connected;
}

// 值的來源 badge：讓使用者分得出這個數字是印表機自己回報的（機器提供）、內建規格表的
// 預設值（預設）、還是自己手動改過的（已覆寫）。樣式見 editor.css .src-badge。
const SOURCE_BADGE_TEXT = { machine: "機器提供", default: "預設", override: "已覆寫" };

function sourceBadge(kind) {
    const badge = document.createElement("span");
    badge.className = `ts-badge is-small is-outlined src-badge src-${kind}`;
    badge.textContent = SOURCE_BADGE_TEXT[kind];
    return badge;
}

function setInfoCell(id, text, kind = null) {
    els[id].replaceChildren(text, ...(kind ? [sourceBadge(kind)] : []));
}

// 印表機資訊區（唯讀）。取值優先序：機器自己回報的（WebUSB 裝置名稱、GS I 廠牌／型號／韌體）
// > 內建規格表的預設值；「可列印寬度」另外允許使用者手動覆寫（見 renderPrintableDotsRows）。
// 只有型號比對得到內建規格才標成「機器提供」，比對不到就明講「未識別，使用預設值」。
function updatePrinterInfo() {
    const base = getPrinterProfile(state.project.printerProfile.id);
    const profile = getEffectiveProfile();
    const paper = getPaperWidth(profile, state.project.paper.widthId);
    const basePaper = getPaperWidth(base, state.project.paper.widthId);
    const identity = state.printerIdentity;

    if (!identity) {
        setInfoCell("printer-info-device", "未連接");
        setInfoCell("printer-info-firmware", "—");
        setInfoCell("printer-info-spec", `${base.brand} ${base.model}`, "default");
    } else {
        setInfoCell(
            "printer-info-device",
            identity.detail ? `${identity.name}（${identity.detail}）` : identity.name,
            identity.nameFromMachine ? "machine" : null,
        );
        setInfoCell(
            "printer-info-firmware",
            identity.pending ? "讀取中…" : identity.firmware || "印表機未回報",
            identity.firmware ? "machine" : null,
        );
        if (identity.pending) setInfoCell("printer-info-spec", "比對中…");
        else if (identity.profileId) setInfoCell("printer-info-spec", `${base.brand} ${base.model}（型號與機器回報相符）`, "machine");
        else setInfoCell("printer-info-spec", `未識別，使用預設值（${base.brand} ${base.model}）`, "default");
    }
    setInfoCell("printer-info-dpi", `${base.dpi.x} × ${base.dpi.y} dpi`, "default");
    setInfoCell("printer-info-paper", `${paper.label}（捲紙寬 ${paper.rollWidthMm} mm，由工具列選擇，ESC/POS 讀不到）`);
    const overridden = paper.printableWidthDots !== basePaper.printableWidthDots;
    setInfoCell("printer-info-printable", `${paper.printableWidthDots} 點（約 ${paper.printableWidthMm.toFixed(1)} mm）`, overridden ? "override" : "default");
    setInfoCell("printer-info-blade", base.autocutter?.bladeOffsetMm ? `約 ${base.autocutter.bladeOffsetMm} mm` : "—", base.autocutter ? "default" : null);
}

// 每個紙寬一列「可列印點數」輸入框：留空＝用內建規格的預設值，填了就是手動覆寫（存在本機偏好，
// 不進 .ptan）。輸入時就地更新 badge／mm 換算，不重畫整列——輸入框 change 事件是在切到下一格
// 之前觸發，重畫會讓焦點掉掉。
function renderPrintableDotsRows() {
    const base = getPrinterProfile(state.project.printerProfile.id);
    const overrides = state.printPrefs.printableDots;
    const syncResetButton = () => {
        els["btn-printer-dots-reset"].disabled = Object.keys(overrides).length === 0;
    };

    els["printer-dots-list"].replaceChildren();
    for (const paper of base.paperWidths) {
        const row = document.createElement("div");
        row.className = "printer-dots-row";

        const label = document.createElement("label");
        label.className = "ts-text is-label printer-dots-label";
        label.textContent = paper.label;

        const wrap = document.createElement("div");
        wrap.className = "ts-input is-small printer-dots-input";
        const input = document.createElement("input");
        input.type = "number";
        input.min = PRINTABLE_DOTS_MIN;
        input.max = PRINTABLE_DOTS_MAX;
        input.step = 1;
        input.placeholder = paper.printableWidthDots;
        input.value = overrides[paper.id] ?? "";
        input.id = `pref-printable-dots-${paper.id}`;
        input.setAttribute("aria-label", `${paper.label} 可列印點數（留空使用預設 ${paper.printableWidthDots}）`);
        label.htmlFor = input.id;
        wrap.appendChild(input);

        const unit = document.createElement("span");
        unit.className = "ts-text is-description is-small";
        const badgeHolder = document.createElement("span");

        const sync = () => {
            const mm = paper.id in overrides ? (overrides[paper.id] / base.dpi.x) * 25.4 : paper.printableWidthMm;
            unit.textContent = `點（約 ${mm.toFixed(1)} mm）`;
            badgeHolder.replaceChildren(sourceBadge(paper.id in overrides ? "override" : "default"));
        };

        input.addEventListener("change", () => {
            const raw = input.value.trim();
            const n = Number(raw);
            if (raw === "" || !Number.isFinite(n)) {
                delete overrides[paper.id];
            } else {
                const dots = Math.min(Math.max(Math.round(n), PRINTABLE_DOTS_MIN), PRINTABLE_DOTS_MAX);
                if (dots === paper.printableWidthDots) delete overrides[paper.id];
                else overrides[paper.id] = dots;
            }
            input.value = overrides[paper.id] ?? "";
            savePrintPrefs();
            sync();
            syncResetButton();
            updatePrinterInfo();
            schedulePreview();
        });

        sync();
        row.append(label, wrap, unit, badgeHolder);
        els["printer-dots-list"].appendChild(row);
    }
    syncResetButton();
}

// 連線後讀印表機自報的識別資料，再拿去比對內建規格表：
// 1. WebUSB 有 manufacturerName／productName（裝置描述元，不用送指令）；序列埠讀不到裝置名稱。
// 2. GS I n（n=66 廠牌、67 型號、65 韌體）是 ESC/POS 標準的「傳送印表機 ID」指令，但只有
//    「有回應」才算數：第一個查詢沒回應就整個停下來（逾時的 USB 讀取取消不了，會卡住之後的回應），
//    也不會影響連線、列印本身。此功能沒有實機驗證，見 README 已知限制。
// 3. 用 GS I 型號＋裝置名稱去比對 printer-profiles.js 的 model；比對不到不報錯，
//    UI 明確標成「未識別，使用預設值」，規格照舊用專案指定的預設 profile。
async function identifyConnectedPrinter() {
    const adapter = state.usbConnected ? usbAdapter : state.serialConnected ? serialAdapter : null;
    if (!adapter) {
        state.printerIdentity = null;
        updatePrinterInfo();
        return;
    }
    const identity = {
        name: adapter.deviceLabel,
        nameFromMachine: state.usbConnected && Boolean(usbAdapter.device.productName),
        detail: adapter.deviceDetail,
        maker: null,
        model: null,
        firmware: null,
        profileId: null,
        pending: true,
    };
    state.printerIdentity = identity;
    updatePrinterInfo();

    // 跟列印／測試列印／查詢狀態共用同一條連線，忙碌中就不插隊送指令，只用裝置名稱比對
    const canQuery = !state.printerBusy;
    if (canQuery) state.printerBusy = true;
    try {
        if (canQuery) {
            try {
                identity.maker = await adapter.queryPrinterId(66);
                if (identity.maker !== null) {
                    identity.model = await adapter.queryPrinterId(67);
                    identity.firmware = await adapter.queryPrinterId(65);
                }
            } catch {
                // 讀不到就當作這台機器不回報，不影響連線
            }
        }
    } finally {
        if (canQuery) state.printerBusy = false;
    }

    // 等待期間如果已經斷線或換了連線，這份結果就作廢
    if (state.printerIdentity !== identity) return;
    identity.pending = false;
    const reported = [identity.maker, identity.model].filter(Boolean).join(" ");
    if (reported) {
        identity.name = reported;
        identity.nameFromMachine = true;
    }
    identity.profileId = matchPrinterProfile([identity.model, adapter.deviceLabel]);
    updatePrinterInfo();
}

// 測試列印用的 canvas 是普通 HTMLCanvasElement，跟 renderTemplate() 產出的 thermal canvas
// 走同一個 adapter.print()（buildEscposJob／canvasToEscposRaster），不另外寫 ESC/POS 組包邏輯。
// 最下面畫一段黑條代表「內容結尾」：切紙位置（走紙行數）設得不夠時，切刀會切在這段黑條上
// 而不是它下面的空白，肉眼就能直接判斷 pref-feed-lines 夠不夠，不用拿正式收據內容去試。
function buildTestPrintCanvas() {
    const profile = getEffectiveProfile();
    const paper = getPaperWidth(profile, state.project.paper.widthId);
    const widthDots = paper.printableWidthDots;
    const heightDots = 260;
    const endBarHeight = 24;

    const canvas = document.createElement("canvas");
    canvas.width = widthDots;
    canvas.height = heightDots;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, widthDots, heightDots);

    ctx.fillStyle = "#000";
    ctx.font = "16px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(`${profile.brand} ${profile.model} 測試列印`, 8, 8);
    ctx.font = "13px sans-serif";
    ctx.fillText(`紙寬 ${paper.label}／走紙 ${state.printPrefs.feedLines} 行／切紙 ${state.printPrefs.cutPaper ? "開" : "關"}`, 8, 30);
    ctx.fillText(new Date().toLocaleString(), 8, 48);

    // 每 8 點一小格、每 80 點一大格的刻度尺，方便對照走紙距離
    const rulerBaseline = heightDots - endBarHeight;
    for (let x = 0; x < widthDots; x += 8) {
        const tall = x % 80 === 0;
        ctx.fillRect(x, rulerBaseline - (tall ? 14 : 6), 1, tall ? 14 : 6);
    }

    ctx.fillRect(0, rulerBaseline, widthDots, endBarHeight);
    ctx.fillStyle = "#fff";
    ctx.font = "13px sans-serif";
    ctx.fillText("內容結尾 — 切紙應在此線之後", 8, rulerBaseline + 5);

    return canvas;
}

async function testPrintCurrentPrinter() {
    if (!state.usbConnected && !state.serialConnected) {
        alert("請先連接 USB 或序列埠印表機才能測試列印");
        return;
    }
    if (state.printerBusy) {
        alert("印表機正在處理上一個操作（列印／測試列印／查詢狀態），請稍候再試一次");
        return;
    }
    state.printerBusy = true;
    try {
        const renderResult = { canvas: buildTestPrintCanvas() };
        if (state.usbConnected) {
            await usbAdapter.print(renderResult, getEscposPrintOptions());
        } else {
            await serialAdapter.print(renderResult, getEscposPrintOptions());
        }
    } catch (err) {
        alert(`測試列印失敗：${err.message}`);
    } finally {
        state.printerBusy = false;
    }
}

// 依序查詢（不用 Promise.all 平行送出）：USB／序列埠的 queryStatus 都是「送出 DLE EOT
// 指令 → 等一個回應」，兩個查詢平行送會讓兩組請求／回應交錯，讀出來對不到是哪一個。
async function queryPrinterStatus() {
    const adapter = state.usbConnected ? usbAdapter : state.serialConnected ? serialAdapter : null;
    if (!adapter) {
        alert("請先連接 USB 或序列埠印表機才能查詢狀態");
        return;
    }
    if (state.printerBusy) {
        alert("印表機正在處理上一個操作（列印／測試列印／查詢狀態），請稍候再試一次");
        return;
    }
    state.printerBusy = true;
    els["printer-status-result"].textContent = "查詢中…";
    try {
        const statusByte = await adapter.queryStatus(1);
        const paperByte = await adapter.queryStatus(4);
        const parts = [];
        if (statusByte.length > 0) {
            const { online } = interpretRealtimeStatus(1, statusByte[0]);
            parts.push(`連線狀態：${online ? "online" : "offline"}`);
        }
        if (paperByte.length > 0) {
            const { paper } = interpretRealtimeStatus(4, paperByte[0]);
            parts.push(`紙張感應器：${paper === "out" ? "缺紙" : paper === "near-end" ? "紙快用完" : "正常"}`);
        }
        els["printer-status-result"].textContent = parts.length > 0
            ? parts.join("；")
            : "印表機沒有回應（可能不支援即時狀態查詢，或這個連線沒有讀取通道）";
    } catch (err) {
        els["printer-status-result"].textContent = `查詢失敗：${err.message}`;
    } finally {
        state.printerBusy = false;
    }
}

function bindPrinterSettings() {
    els["pref-feed-lines"].value = state.printPrefs.feedLines;
    els["pref-cut-paper"].checked = state.printPrefs.cutPaper;
    els["pref-serial-baud-rate"].value = state.printPrefs.serialBaudRate;
    renderPrintableDotsRows();
    updatePrinterConnectionUi();

    els["btn-printer-settings"].addEventListener("click", () => {
        els["printer-settings-dialog"].showModal();
    });
    els["btn-printer-settings-close"].addEventListener("click", () => {
        els["printer-settings-dialog"].close();
    });

    for (const input of els["printer-connect-method"].querySelectorAll("input")) {
        input.addEventListener("change", () => {
            if (!input.checked) return;
            state.printPrefs.connectMethod = input.value;
            savePrintPrefs();
            updatePrinterConnectionUi();
        });
    }

    els["btn-printer-connect"].addEventListener("click", async () => {
        const method = currentConnectMethod();
        try {
            if (method === "serial") {
                await serialAdapter.connect({ vendorId: currentWebUsbVendorId(), baudRate: state.printPrefs.serialBaudRate });
                state.serialConnected = true;
            } else {
                await usbAdapter.connect({ vendorId: currentWebUsbVendorId() });
                state.usbConnected = true;
            }
        } catch (err) {
            alert(`連接印表機失敗：${err.message}`);
        }
        updatePrinterConnectionUi();
        await identifyConnectedPrinter();
    });

    els["btn-printer-disconnect"].addEventListener("click", async () => {
        if (state.usbConnected) {
            await usbAdapter.disconnect();
            state.usbConnected = false;
        }
        if (state.serialConnected) {
            await serialAdapter.disconnect();
            state.serialConnected = false;
        }
        updatePrinterConnectionUi();
    });

    els["btn-printer-forget"].addEventListener("click", async () => {
        if (state.printerBusy) {
            alert("印表機正在處理上一個操作（列印／測試列印／查詢狀態），請稍候再試一次");
            return;
        }
        if (!confirm("忘記後，瀏覽器不再記得已授權的印表機，目前的連線也會中斷；下次要按「連接印表機」重新選擇裝置。確定要忘記嗎？")) return;
        try {
            const usbCount = await usbAdapter.forgetAuthorizedDevices();
            const serialCount = await serialAdapter.forgetAuthorizedPorts();
            els["printer-status-result"].textContent = `已忘記 ${(usbCount ?? 0) + (serialCount ?? 0)} 個已授權的裝置`;
        } catch (err) {
            els["printer-status-result"].textContent = `忘記裝置失敗：${err.message}`;
        }
        state.usbConnected = usbAdapter.device !== null;
        state.serialConnected = serialAdapter.port !== null;
        updatePrinterConnectionUi();
    });

    els["btn-printer-dots-reset"].addEventListener("click", () => {
        state.printPrefs.printableDots = {};
        savePrintPrefs();
        renderPrintableDotsRows();
        updatePrinterInfo();
        schedulePreview();
    });

    els["pref-feed-lines"].addEventListener("change", () => {
        const n = Math.max(0, Math.round(Number(els["pref-feed-lines"].value) || 0));
        state.printPrefs.feedLines = n;
        els["pref-feed-lines"].value = n;
        savePrintPrefs();
    });

    els["pref-cut-paper"].addEventListener("change", () => {
        state.printPrefs.cutPaper = els["pref-cut-paper"].checked;
        savePrintPrefs();
    });

    els["btn-printer-test-print"].addEventListener("click", () => {
        testPrintCurrentPrinter();
    });

    els["btn-printer-query-status"].addEventListener("click", () => {
        queryPrinterStatus();
    });

    els["pref-serial-baud-rate"].addEventListener("change", () => {
        const n = Math.max(1200, Math.round(Number(els["pref-serial-baud-rate"].value) || 9600));
        state.printPrefs.serialBaudRate = n;
        els["pref-serial-baud-rate"].value = n;
        savePrintPrefs();
    });

    if (usbAdapter.isSupported()) {
        navigator.usb.addEventListener("disconnect", (e) => {
            if (e.device === usbAdapter.device) {
                state.usbConnected = false;
                updatePrinterConnectionUi();
            }
        });
    }

    if (serialAdapter.isSupported()) {
        navigator.serial.addEventListener("disconnect", (e) => {
            if (e.target === serialAdapter.port) {
                state.serialConnected = false;
                updatePrinterConnectionUi();
            }
        });
    }
}

// ---- 變更彙整：儲存草稿 + 重新渲染 ----

let saveTimer = null;
function onModelChange({ skipInspector = false } = {}) {
    renderOutline();
    if (!skipInspector) renderInspector();
    renderVariables();
    schedulePreview();
    scheduleSave();
}

let previewTimer = null;
function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 120);
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        const id = await saveDraft(state.project);
        localStorage.setItem(LAST_DRAFT_KEY, id);
        populateRecentDrafts();
        const time = new Date().toLocaleTimeString("zh-TW", { hour12: false });
        els["save-status"].textContent = `已自動儲存 ${time}`;
    }, 500);
}

init();
