// Printan Editor — 串接 core（Document Model / Renderer / Storage）與畫面互動。
// Editor 本身不做排版運算，排版與繪製一律呼叫 core/renderer.js，
// 確保「編輯器看到的結果」跟「實際輸出結果」用同一套邏輯（見需求單第廿一節）。

import { extractPlaceholders } from "../core/document-model.js";
import { getPaperWidth, getPrinterProfile, withMarginCalibration, withPrintableDotsOverrides } from "../core/printer-profiles.js";
import { findElementById } from "../core/element-tree.js";
import { renderTemplate } from "../core/renderer.js";

import { restoreLocalFontsIfGranted } from "../core/fonts.js";
import { onWebFontStatusChange } from "../core/web-fonts.js";

import { wireResizableColumns } from "./resizable-columns.js";
import { createInlineTextEditor } from "./inline-text-editor.js";
import { createWorkspaceView } from "./workspace-view.js";
import { hideStageNotice, showStageNotice, wireHelpDialog } from "./ui-helpers.js";
import { currentElements, currentPage, els, rt, state } from "./context.js";
import { attemptSilentPrinterReconnect, bindPrinterSettings, loadPrintPrefs, updateFeedLinesHint } from "./printer-settings.js";
import { textInput } from "./inspector-widgets.js";
import { renderInspector } from "./inspector.js";
import { initMobileDrawers } from "./mobile-drawers.js";
import { renderEditOverlay } from "./canvas-overlay.js";
import { renderOutline } from "./outline.js";
import { bindBatchPanel } from "./batch-export.js";
import { bindEditorShortcuts, recordHistory } from "./history.js";
import { bootKioskFromQuery } from "./kiosk.js";
import { bindPageList, renderPageList } from "./pages.js";
import { bindPagePager, invalidatePageThumbs, renderPageThumbs, revealActivePage, syncPageBoard } from "./page-board.js";
import { bindImageFileInput, bindToolbar, wireToolbarOverflow } from "./toolbar.js";
import { bindOperations, bindProjectName, bindPtanFileInput, populatePaperWidthTabs, renderProjectName } from "./operations.js";
import { loadProjectIntoEditor, populateRecentDrafts, restoreOrCreateProject, scheduleSave } from "./drafts.js";

async function init() {
    cacheDom();
    state.project = await restoreOrCreateProject();
    loadPrintPrefs();
    updateFeedLinesHint();
    populatePaperWidthTabs();
    populateRecentDrafts();
    bindOperations();
    bindPtanFileInput();
    bindToolbar();
    bindImageFileInput();
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

init();
