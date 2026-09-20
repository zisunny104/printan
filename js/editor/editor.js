// Printan Editor — 串接 core（Document Model / Renderer / Storage）與畫面互動。
// Editor 本身不做排版運算，排版與繪製一律呼叫 core/renderer.js，
// 確保「編輯器看到的結果」跟「實際輸出結果」用同一套邏輯（見需求單第廿一節）。

import { createEmptyProject, loadProject } from "../core/schema.js";
import {
    getPrinterProfile, getPaperWidth, getDefaultPrinterProfileId, withPrintableDotsOverrides,
    withMarginCalibration,
} from "../core/printer-profiles.js";
import {
    createTextElement, createImageElement, createSpacerElement, createDividerElement, createRowElement,
    createBarcodeElement, cloneElementWithNewIds, extractPlaceholders, getTextContent,
} from "../core/document-model.js";
import {
    childArrays, resolveTargetArray, findElementById, findContainerOf, isSameTarget, flattenElements,
    removeElements, groupElementsIn, ungroupElementsIn, duplicateElementsIn, moveElementBy, moveElementsBy,
    moveElementToIndex, moveElementToContainerIn, containerToTarget as containerToTargetIn, selectionToIds,
    idsToSelection, pruneSelectionIn, snapshotElements, restoreElements,
} from "../core/element-tree.js";
import { renderTemplate, renderBatch } from "../core/renderer.js";
import { BARCODE_FORMATS } from "../core/barcode.js";
import { splitDotsByRatio } from "../core/units.js";
import { restoreLocalFontsIfGranted } from "../core/fonts.js";
import { onWebFontStatusChange } from "../core/web-fonts.js";
import { downloadPtan, readPtanFile, fileToDataUrl } from "../core/ptan-file.js";
import { convertHeicIfNeeded } from "../core/heic.js";
import { exportToPdf } from "../core/pdf-export.js";
import { saveDraft, loadDraft, deleteDraft, listRecent } from "../core/storage.js";
import { wireResizableColumns } from "./resizable-columns.js";
import { createInlineTextEditor } from "./inline-text-editor.js";
import { createWorkspaceView } from "./workspace-view.js";
import { wireHelpDialog } from "./ui-helpers.js";
import { BATCH_PANEL_EXPANDED_KEY, LAST_DRAFT_KEY, els, rt, state } from "./context.js";
import {
    attemptSilentPrinterReconnect, bindPrinterSettings, loadPrintPrefs, printCurrent, renderMarginRows,
    renderPrintableDotsRows,
} from "./printer-settings.js";
import { iconButton, textInput } from "./inspector-widgets.js";
import { renderInspector } from "./inspector.js";


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
    wireResizableColumns();
    wireToolbarOverflow();
    workspace.mount();
    wireHelpDialog();
    onModelChange({ skipInspector: false });
    onWebFontStatusChange(() => renderInspector()); // 字體載入失敗／恢復時，選單上的標示要跟著更新
    restoreLocalFontsIfGranted().then((restored) => { if (restored) renderInspector(); });
    await attemptSilentPrinterReconnect();
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
        const handler = rt.imageFileInputHandler;
        rt.imageFileInputHandler = null;
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

// 新增元素的種類清單：工具列、左側「＋」選單共用，避免兩處各寫一份。
const ADD_KINDS = [
    { kind: "text", label: "文字", icon: "font" },
    { kind: "image", label: "圖片", icon: "image" },
    { kind: "spacer", label: "間隔", icon: "arrows-up-down" },
    { kind: "divider", label: "分隔線", icon: "minus" },
    { kind: "barcode", label: "條碼", icon: "qrcode" },
];
const ROW_RATIOS = [[1, 1], [2, 1], [1, 2], [1, 1, 1]];

/** 新增一個元素。target 有給就插進那個容器（undefined＝目前的插入目標）。 */
function addElement(kind, { ratio, target } = {}) {
    if (target !== undefined) state.insertionTarget = target;
    switch (kind) {
        case "text": return insertElement(createTextElement());
        case "spacer": return insertElement(createSpacerElement());
        case "divider": return insertElement(createDividerElement());
        case "barcode": return insertElement(createBarcodeElement());
        case "row": return insertElement(createRowElement(ratio));
        case "image":
            rt.imageFileInputHandler = null;
            els["image-file-input"].click();
    }
}

// 新增後要把畫布捲到新元素、文字元素直接進入行內編輯；預覽是延後才畫好的，
// 所以先記下來，等 renderEditOverlay() 畫完疊層再處理。

function insertElement(element) {
    const target = resolveTargetArray(state.project.template.elements, state.insertionTarget);
    target.push(element);
    state.selectedId = element.id;
    state.multi = [];
    rt.pendingReveal = { id: element.id, edit: element.type === "text" };
    onModelChange();
    els["outline-list"].querySelector(".outline-row.is-selected")?.scrollIntoView({ block: "nearest" });
}

function revealPendingElement() {
    if (!rt.pendingReveal) return;
    const { id, edit } = rt.pendingReveal;
    rt.pendingReveal = null;
    const block = els["edit-overlay"].querySelector(`.edit-block[data-id="${id}"]`);
    if (!block) return;
    block.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (edit) inlineEditor.open(id);
}

// 「＋」新增選單：版面結構標題與每個容器列共用同一個浮出選單，開啟時記下要插入的容器。
// 多欄比例收在子選單裡（addMenu.sub），主選單保持短。
const addMenu = { el: null, sub: null, subTrigger: null, target: null, anchor: null };

function menuItems(menu) {
    return Array.from(menu.querySelectorAll(':scope > [role="menuitem"]'));
}

function closeAddSubmenu() {
    if (!addMenu.sub || addMenu.sub.hidden) return;
    addMenu.sub.hidden = true;
    addMenu.subTrigger.setAttribute("aria-expanded", "false");
}

function closeAddMenu() {
    if (!addMenu.el || addMenu.el.hidden) return;
    closeAddSubmenu();
    addMenu.el.hidden = true;
    addMenu.anchor?.setAttribute("aria-expanded", "false");
}

/** 把固定定位的選單放到 (left, top) 附近，超出視窗就往內收。 */
function placeMenu(menu, left, top, flipTop = top) {
    menu.hidden = false;
    menu.style.visibility = "hidden";
    const fitsBelow = top + menu.offsetHeight <= window.innerHeight - 8;
    menu.style.top = `${fitsBelow ? top : Math.max(8, flipTop - menu.offsetHeight)}px`;
    menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.visibility = "";
}

function openAddMenu(anchor, target) {
    if (!addMenu.el.hidden && addMenu.anchor === anchor) return closeAddMenu();
    closeAddMenu();
    addMenu.target = target;
    addMenu.anchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    const rect = anchor.getBoundingClientRect();
    placeMenu(addMenu.el, rect.left, rect.bottom + 6, rect.top - 6);
    menuItems(addMenu.el)[0]?.focus();
}

function openAddSubmenu() {
    const trigger = addMenu.subTrigger;
    const rect = trigger.getBoundingClientRect();
    const sub = addMenu.sub;
    sub.hidden = false;
    // 右側放不下就開到主選單左邊
    const left = rect.right + sub.offsetWidth + 8 <= window.innerWidth ? rect.right + 2 : rect.left - sub.offsetWidth - 2;
    placeMenu(sub, left, rect.top - 4, rect.bottom + 4);
    trigger.setAttribute("aria-expanded", "true");
    menuItems(sub)[0]?.focus();
}

function wireAddMenu() {
    const buildMenu = (label) => {
        const menu = document.createElement("div");
        menu.className = "ts-menu is-dense is-small is-separated pane-dropdown-menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", label);
        menu.hidden = true;
        menu.style.position = "fixed";
        document.body.appendChild(menu);
        return menu;
    };
    const menu = buildMenu("新增元素");
    const sub = buildMenu("新增多欄");
    sub.style.zIndex = "1";

    const addItem = (parent, icon, label, onPick) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "item";
        item.setAttribute("role", "menuitem");
        item.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span><span></span>`;
        item.lastChild.textContent = label;
        item.addEventListener("click", () => {
            const target = addMenu.target;
            closeAddMenu();
            onPick(target);
        });
        parent.appendChild(item);
        return item;
    };
    for (const { kind, label, icon } of ADD_KINDS) addItem(menu, icon, `新增${label}`, (target) => addElement(kind, { target }));

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "item";
    trigger.setAttribute("role", "menuitem");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = '<span class="ts-icon is-table-columns-icon" aria-hidden="true"></span><span>新增多欄</span><span class="ts-icon is-chevron-right-icon add-menu-more" aria-hidden="true"></span>';
    trigger.addEventListener("click", () => (sub.hidden ? openAddSubmenu() : closeAddSubmenu()));
    menu.appendChild(trigger);
    for (const ratio of ROW_RATIOS) addItem(sub, "table-columns", ratio.join(" / "), (target) => addElement("row", { ratio, target }));

    addMenu.el = menu;
    addMenu.sub = sub;
    addMenu.subTrigger = trigger;

    document.addEventListener("click", (evt) => {
        if (menu.hidden || menu.contains(evt.target) || sub.contains(evt.target) || addMenu.anchor?.contains(evt.target)) return;
        closeAddMenu();
    });
    document.addEventListener("keydown", (evt) => {
        if (menu.hidden) return;
        const inSub = sub.contains(document.activeElement);
        if (!inSub && !menu.contains(document.activeElement)) {
            if (evt.key === "Escape") closeAddMenu();
            return;
        }
        const list = menuItems(inSub ? sub : menu);
        const index = list.indexOf(document.activeElement);
        let handled = true;
        if (evt.key === "ArrowDown") list[(index + 1) % list.length].focus();
        else if (evt.key === "ArrowUp") list[(index - 1 + list.length) % list.length].focus();
        else if (evt.key === "Home") list[0].focus();
        else if (evt.key === "End") list[list.length - 1].focus();
        else if (evt.key === "ArrowRight" && document.activeElement === trigger) openAddSubmenu();
        else if (evt.key === "ArrowLeft" && inSub) {
            closeAddSubmenu();
            trigger.focus();
        } else if (evt.key === "Escape") {
            if (inSub) {
                closeAddSubmenu();
                trigger.focus();
            } else {
                const anchor = addMenu.anchor;
                closeAddMenu();
                anchor?.focus();
            }
        } else handled = false;
        if (handled) {
            evt.preventDefault();
            evt.stopPropagation();
        }
    });

    const header = els["btn-outline-add"];
    header.addEventListener("click", () => openAddMenu(header, state.insertionTarget));
    const toolbarAdd = els["btn-toolbar-add"];
    toolbarAdd.addEventListener("click", () => openAddMenu(toolbarAdd, state.insertionTarget));
}

export function deleteElement(id) {
    deleteElements([id]);
}

export function deleteElements(ids) {
    for (const id of removeElements(state.project.template.elements, ids)) {
        if (state.insertionTarget && state.insertionTarget.rowId === id) state.insertionTarget = null;
    }
    pruneSelection();
    onModelChange();
}

// 建立群組：把同一層的選取元素收進一個新群組（放在最前面那個的位置）；解散則把子元素放回原位
function groupElements(ids) {
    const group = groupElementsIn(state.project.template.elements, ids);
    if (!group) return;
    setSelection([group.id]);
    onModelChange();
}

export function ungroupElements(ids) {
    const freed = ungroupElementsIn(state.project.template.elements, ids);
    if (!freed.length) return;
    setSelection(freed);
    onModelChange();
}

export function duplicateElement(id) {
    duplicateElements([id]);
}

export function duplicateElements(ids) {
    const clones = duplicateElementsIn(state.project.template.elements, ids);
    if (!clones.length) return;
    setSelection(clones);
    onModelChange();
}

// 元素被刪掉（刪除、復原）之後，把選取範圍裡已經不存在的 id 拿掉
function pruneSelection() {
    Object.assign(state, pruneSelectionIn(state.project.template.elements, state));
}

function getSelectedIds() {
    return selectionToIds(state);
}

function setSelection(ids) {
    Object.assign(state, idsToSelection(ids));
}

function moveElement(id, direction) {
    if (moveElementBy(state.project.template.elements, id, direction)) onModelChange();
}

/** 多選整批上移／下移：同一層內，遇到邊界或前一個也是選取中的就不動，其餘保持相對順序。 */
function moveElements(ids, direction) {
    if (moveElementsBy(state.project.template.elements, ids, direction)) onModelChange();
}

/** 拖曳排序用：把元素移到「同一個容器內、目前索引為 newIndex 的元素之前」。 */
function moveElementTo(id, newIndex) {
    if (moveElementToIndex(state.project.template.elements, id, newIndex)) onModelChange();
}

/** 跨容器拖曳：把元素搬到另一個容器陣列的 index 位置（同容器時等同 moveElementTo）。
 *  不能把多欄元素搬進自己底下的欄位（會形成迴圈）。 */
function moveElementToContainer(id, targetArray, index) {
    const { moved, crossed } = moveElementToContainerIn(state.project.template.elements, id, targetArray, index);
    if (!moved) return;
    if (crossed) state.insertionTarget = containerToTarget(targetArray);
    onModelChange();
}

/** 選取元素：outline 清單點擊、畫布疊層點擊共用同一套邏輯。 */
function selectElementById(id, { toggle = false } = {}) {
    if (toggle) {
        // Shift／Ctrl 點選：在同一層內加入或移出選取，跨層就改成單選
        const current = getSelectedIds();
        const arrayOf = (x) => findContainerOf(state.project.template.elements, x)?.array;
        if (current.length && arrayOf(current[0]) === arrayOf(id)) {
            setSelection(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
            renderOutline();
            renderInspector();
            highlightSelectedBlock();
            return;
        }
    }
    setSelection([id]);
    const el = findElementById(state.project.template.elements, id);
    if (el && el.type !== "row" && el.type !== "group") {
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
    for (const id of getSelectedIds()) {
        overlay.querySelector(`.edit-block[data-id="${id}"]`)?.classList.add("is-selected");
    }
}

// ---- 版面結構大綱 ----

function renderOutline() {
    const root = els["outline-list"];
    // 列被重建時觸發 tooltip 的按鈕會直接消失、收不到 mouseleave，Tocas 掛在 body 的 tooltip 會殘留在左上角
    document.querySelectorAll("body > .ts-tooltip").forEach((tip) => tip.remove());
    const focusKey = root.contains(document.activeElement) ? document.activeElement.closest(".outline-row")?.dataset.rowKey : null;
    root.innerHTML = "";
    root.appendChild(buildTargetHeader("最上層", null, 0));
    root.appendChild(buildElementList(state.project.template.elements, 0, "root"));
    const rows = Array.from(root.querySelectorAll(".outline-row"));
    const active = rows.find((r) => r.dataset.rowKey === focusKey) || root.querySelector(".outline-row.is-selected") || rows[0];
    setOutlineRoving(active);
    if (focusKey && active?.dataset.rowKey === focusKey) active.focus({ preventScroll: true });
}

// 大綱是 listbox，列用 roving tabindex（只有一列在 Tab 順序內），方向鍵在列之間移動焦點
function setOutlineRoving(active) {
    els["outline-list"].querySelectorAll(".outline-row").forEach((r) => { r.tabIndex = r === active ? 0 : -1; });
}

function wireOutlineKeyboard() {
    const root = els["outline-list"];
    root.setAttribute("role", "listbox");
    root.setAttribute("aria-label", "版面結構");
    root.addEventListener("focusin", (e) => {
        const row = e.target.closest(".outline-row");
        if (row && e.target === row) setOutlineRoving(row);
    });
    root.addEventListener("keydown", (e) => {
        const row = e.target;
        if (!row.classList?.contains("outline-row")) return;
        const rows = Array.from(root.querySelectorAll(".outline-row"));
        const i = rows.indexOf(row);
        let next = null;
        if (e.key === "ArrowDown") next = rows[Math.min(i + 1, rows.length - 1)];
        else if (e.key === "ArrowUp") next = rows[Math.max(i - 1, 0)];
        else if (e.key === "Home") next = rows[0];
        else if (e.key === "End") next = rows[rows.length - 1];
        else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            row.click();
            return;
        } else return;
        // 焦點在大綱時方向鍵只移動焦點，不要讓全域快捷鍵去選取／移動畫布上的元素
        e.preventDefault();
        next?.focus();
    });
}

function buildElementList(elements, depth, parentKey) {
    const frag = document.createDocumentFragment();
    elements.forEach((el) => {
        frag.appendChild(buildElementRow(el, depth, parentKey));
        if (el.type === "row" || el.type === "group") {
            childArrays(el).forEach((col, colIndex) => {
                const target = { rowId: el.id, colIndex };
                frag.appendChild(buildTargetHeader(el.type === "group" ? "群組內" : `第 ${colIndex + 1} 欄`, target, depth + 1));
                frag.appendChild(buildElementList(col, depth + 2, `${el.id}:${colIndex}`));
            });
        }
    });
    return frag;
}

// ---- 大綱拖曳排序：可在同一層重新排序，也可拖到其他欄或最上層（放在元素列上＝插在它前／後，
// 放在容器列上＝放到該容器最前面）；不能把多欄元素拖進自己的欄位。----

let outlineDragState = null; // { id }

function clearOutlineDropIndicators() {
    els["outline-list"].querySelectorAll(".is-drop-before, .is-drop-after").forEach((n) => {
        n.classList.remove("is-drop-before", "is-drop-after");
    });
}

function wireOutlineTargetDrop(row, target) {
    row.addEventListener("dragover", (evt) => {
        if (!outlineDragState) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = "move";
        clearOutlineDropIndicators();
        row.classList.add("is-drop-after");
    });
    row.addEventListener("drop", (evt) => {
        if (!outlineDragState) return;
        evt.preventDefault();
        const id = outlineDragState.id;
        outlineDragState = null;
        moveElementToContainer(id, resolveTargetArray(state.project.template.elements, target), 0);
    });
}

function wireOutlineRowDrag(row, el) {
    row.draggable = true;
    row.addEventListener("dragstart", (evt) => {
        outlineDragState = { id: el.id };
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
        if (!outlineDragState || outlineDragState.id === el.id) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = "move";
        const rect = row.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        clearOutlineDropIndicators();
        row.classList.add(before ? "is-drop-before" : "is-drop-after");
    });
    row.addEventListener("drop", (evt) => {
        if (!outlineDragState || outlineDragState.id === el.id) return;
        evt.preventDefault();
        const rect = row.getBoundingClientRect();
        const before = evt.clientY < rect.top + rect.height / 2;
        const found = findContainerOf(state.project.template.elements, el.id);
        const id = outlineDragState.id;
        outlineDragState = null;
        if (!found) return;
        moveElementToContainer(id, found.array, before ? found.index : found.index + 1);
    });
}

function buildTargetHeader(label, target, depth) {
    const row = document.createElement("div");
    row.className = `outline-row outline-target-row outline-indent-${depth}`;
    const isTarget = isSameTarget(state.insertionTarget, target);
    if (isTarget) row.classList.add("is-target");
    row.dataset.rowKey = target ? `t:${target.rowId}:${target.colIndex}` : "t:root";
    row.setAttribute("role", "option");
    row.setAttribute("aria-level", String(depth + 1));
    row.setAttribute("aria-selected", String(isTarget));
    const icon = document.createElement("span");
    icon.className = `ts-icon is-${row.classList.contains("is-target") ? "folder-open" : "folder"}-icon`;
    icon.setAttribute("aria-hidden", "true");
    const span = document.createElement("span");
    span.className = "outline-label";
    span.textContent = label;
    span.title = label;
    row.appendChild(icon);
    row.appendChild(span);
    const add = iconButton("plus", `新增到「${label}」`, () => openAddMenu(add, target));
    add.setAttribute("aria-haspopup", "menu");
    add.setAttribute("aria-expanded", "false");
    row.appendChild(add);
    wireOutlineTargetDrop(row, target);
    row.addEventListener("click", () => {
        state.insertionTarget = target;
        state.selectedId = null;
        state.multi = [];
        renderOutline();
        renderInspector();
    });
    return row;
}

const TYPE_ICON = { text: "font", image: "image", spacer: "arrows-up-down", divider: "minus", row: "table-columns", barcode: "qrcode", group: "object-group" };

const BARCODE_FORMAT_LABEL = Object.fromEntries(BARCODE_FORMATS);

function elementLabel(el) {
    switch (el.type) {
        case "text": { const t = getTextContent(el); return t ? t.slice(0, 14) : "文字"; }
        case "image": return el.assetId ? "圖片" : "圖片（未設定）";
        case "spacer": return `間隔 ${el.heightDots}dot`;
        case "divider": return "分隔線";
        case "row": return `多欄（${el.ratio.join(" : ")}）`;
        case "barcode": return BARCODE_FORMAT_LABEL[el.format] || "條碼";
        case "group": return `群組（${el.children.length}）`;
        default: return el.type;
    }
}

function buildElementRow(el, depth, parentKey) {
    const row = document.createElement("div");
    row.className = `outline-row outline-indent-${depth}`;
    row.dataset.elType = el.type;
    row.dataset.rowKey = el.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-level", String(depth + 1));
    const selected = getSelectedIds().includes(el.id);
    row.setAttribute("aria-selected", String(selected));
    if (selected) row.classList.add("is-selected");

    const icon = document.createElement("span");
    icon.className = `ts-icon is-${TYPE_ICON[el.type] || "shapes"}-icon`;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "outline-label";
    label.textContent = elementLabel(el);
    label.title = label.textContent;

    const actions = document.createElement("span");
    actions.className = "outline-actions";
    actions.appendChild(iconButton("arrow-up", `上移 ${label.textContent}`, () => moveElement(el.id, -1)));
    actions.appendChild(iconButton("arrow-down", `下移 ${label.textContent}`, () => moveElement(el.id, 1)));
    actions.appendChild(iconButton("copy", `複製 ${label.textContent}`, () => duplicateElement(el.id)));
    actions.appendChild(iconButton("trash", `刪除 ${label.textContent}`, () => deleteElement(el.id)));

    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(actions);

    row.addEventListener("click", (e) => selectElementById(el.id, { toggle: e.shiftKey || e.ctrlKey || e.metaKey }));
    wireOutlineRowDrag(row, el, parentKey);

    return row;
}

function containerToTarget(array) {
    return containerToTargetIn(state.project.template.elements, array);
}

// ---- 元素屬性面板 ----

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

// 縮放與尺規（見 workspace-view.js）；縮放後紙張的 CSS 寬度變了，編輯疊層座標跟著重算
const workspace = createWorkspaceView({
    getPaperWidthMm: () => getPaperWidth(getEffectiveProfile(), state.project.paper.widthId).printableWidthMm,
    onZoom: () => {
        updatePaperFrame();
        renderEditOverlay();
    },
});

function updatePaperFrame() {
    const profile = getEffectiveProfile();
    const paper = getPaperWidth(profile, state.project.paper.widthId);
    // 連續紙沒有實體「上邊界」；下緣的切刀安全線是切刀刀片跟列印頭的實際距離（bladeOffsetMm）——
    // 太靠下緣的內容，切紙時有被裁到的風險。
    const bladeOffsetMm = profile.autocutter?.bladeOffsetMm ?? 0;
    const pxPerMm = workspace.pxPerMm();
    // 畫面上的紙＝可列印區：白底寬度＝printableWidthMm × pxPerMm（對應實際列印的 576 點）
    els["canvas-host"].style.width = `${paper.printableWidthMm * pxPerMm}px`;
    els["paper-shadow"].style.setProperty("--paper-safe-bottom", `${bladeOffsetMm * pxPerMm}px`);
    // 空白版型的白底＝最短可切下的一張紙（列印頭到切刀的距離），隨縮放與 profile 變動
    els["paper-shadow"].style.setProperty("--paper-min-height", `${bladeOffsetMm * pxPerMm}px`);
    // 版面完全沒有元素時，切刀安全線只是誤導（看起來像渲染壞掉），故不顯示
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
    rt.lastRenderResult = result;
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
        const stage = els["paper-shadow"].parentElement.parentElement;
        stage.parentElement.insertBefore(notice, stage);
        els["font-fallback-notice"] = notice;
    }
    notice.hidden = false;
    notice.firstChild.textContent = `字體「${failedLabels.join("、")}」沒有載入成功（可能沒有網路），預覽與列印暫時改用系統字體。`;
}

// 預覽區行內文字編輯（見 inline-text-editor.js）。textSel 是面板工具列操作的選取範圍，
// 來源可能是面板 textarea，也可能是預覽區的編輯框。
export const textSel = { start: 0, end: 0, refresh: null };
export const inlineEditor = createInlineTextEditor({
    getHost: () => els["paper-shadow"],
    getElement: (id) => findElementById(state.project.template.elements, id),
    getBlockNode: (id) => els["edit-overlay"]?.querySelector(`.edit-block[data-id="${id}"]`),
    getScale: () => (rt.lastRenderResult ? rt.lastRenderResult.canvas.clientWidth / rt.lastRenderResult.widthDots : 1) || 1,
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
    if (state.viewMode !== "edit" || !rt.lastRenderResult) {
        inlineEditor.close();
        return;
    }

    const { items, widthDots, canvas } = rt.lastRenderResult;
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
    revealPendingElement();
}

function walkItems(items, offsetX, offsetY, visit) {
    for (const item of items) {
        const box = { el: item.el, x: offsetX, y: offsetY + item.y, width: item.widthDots, height: item.height };
        visit(box, item);
        if (item.el.type === "row") {
            for (const col of item.columns) {
                walkItems(col.items, offsetX + col.x, offsetY + item.y, visit);
            }
        } else if (item.el.type === "group") {
            walkItems(item.children, offsetX, offsetY + item.y, visit);
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
    if (getSelectedIds().includes(box.el.id)) div.classList.add("is-selected");
    attachBlockInteractions(div, box.el.id);
    return div;
}

/** 點擊選取＋拖曳排序（在同一個容器內，跟大綱面板的上移／下移操作同一個 array）。 */
// 畫布上點到群組裡的元素：先選整個群組（可整體拖曳），群組已選取時再點才選到裡面的元素
function outermostGroupId(id) {
    const root = state.project.template.elements;
    let top = null;
    (function walk(elements, chain) {
        for (const el of elements) {
            if (el.id === id) { top = chain[0] ?? null; return true; }
            for (const col of childArrays(el)) {
                if (walk(col, el.type === "group" ? [...chain, el.id] : chain)) return true;
            }
        }
        return false;
    })(root, []);
    return top;
}

function attachBlockInteractions(div, origId) {
    div.addEventListener("pointerdown", (e) => {
        if (e.target !== div || e.button !== 0) return;
        const groupId = outermostGroupId(origId);
        const inside = groupId && getSelectedIds().some((sid) => sid !== groupId && findElementById([findElementById(state.project.template.elements, groupId)], sid));
        const elId = groupId && !inside ? groupId : origId;
        const startX = e.clientX;
        const startY = e.clientY;
        const scroller = els["paper-scroll"];
        const startScrollTop = scroller.scrollTop;
        const startScrollLeft = scroller.scrollLeft;
        let lastY = startY;
        let dragging = false;
        let siblings = null;
        let scrollFrame = 0;

        // 工作區是內部捲動容器：拖曳中捲動會讓元素框的螢幕位置移動，所以位移要補上捲動量，
        // 同層元素的座標也每次重新量（捲動後 client 座標會變）
        function updateDrag(clientX, clientY) {
            const dx = clientX - startX + (scroller.scrollLeft - startScrollLeft);
            const dy = clientY - startY + (scroller.scrollTop - startScrollTop);
            div.style.transform = `translate(${dx}px, ${dy}px)`;
            siblings = collectSiblingBoxes(elId);
            if (siblings) showInsertionLine(findDropTarget(siblings, clientY).edgeY);
        }
        let lastX = startX;

        // 游標靠近工作區上下緣時自動捲動，才拖得到目前畫面外的位置
        function autoScroll() {
            scrollFrame = 0;
            if (!dragging) return;
            const rect = scroller.getBoundingClientRect();
            const zone = 40;
            let speed = 0;
            if (lastY < rect.top + zone) speed = -Math.ceil(18 * Math.min(1, (rect.top + zone - lastY) / zone));
            else if (lastY > rect.bottom - zone) speed = Math.ceil(18 * Math.min(1, (lastY - (rect.bottom - zone)) / zone));
            if (!speed) return;
            const before = scroller.scrollTop;
            scroller.scrollTop += speed;
            if (scroller.scrollTop !== before) updateDrag(lastX, lastY);
            scrollFrame = requestAnimationFrame(autoScroll);
        }

        function onMove(ev) {
            lastX = ev.clientX;
            lastY = ev.clientY;
            if (!dragging) {
                if (Math.hypot(lastX - startX, lastY - startY) < 4) return;
                dragging = true;
                div.classList.add("is-dragging");
            }
            updateDrag(lastX, lastY);
            if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
        }
        function onUp(ev) {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            cancelAnimationFrame(scrollFrame);
            scrollFrame = 0;
            div.classList.remove("is-dragging");
            div.style.transform = "";
            clearInsertionLine();
            if (dragging && siblings) {
                moveElementTo(elId, findDropTarget(siblings, ev.clientY).index);
            } else if (!dragging) {
                // 已選取的文字元素再點一下＝在預覽區直接編輯，插入點落在點擊位置
                const toggle = ev.shiftKey || ev.ctrlKey || ev.metaKey;
                const editText = !toggle && state.selectedId === elId && !state.multi.length && findElementById(state.project.template.elements, elId)?.type === "text";
                const enter = elId !== origId && !toggle && getSelectedIds().includes(elId);
                selectElementById(enter ? origId : elId, { toggle });
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
        // 圖片預設是依比例縮放（fit=auto，heightDots 不生效）：從目前畫出的高度起算，並自動切成「拉伸」
        const startHeight = realEl.type === "image" && realEl.fit !== "stretch" ? box.height : realEl.heightDots;
        function onMove(ev) {
            const deltaDots = (ev.clientY - startY) / scale;
            if (realEl.type === "image") realEl.fit = "stretch";
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
export function confirmFontFallbacks(results) {
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

// ---- 列印設定（WebUSB／WebSerial 直連、印表機識別、走紙／切紙／可列印點數偏好） ----
// 連線狀態、走紙／切紙偏好都是「這台瀏覽器、這台印表機」的本機操作習慣，不寫進 .ptan，
// 同一份版型換人、換印表機開啟時不應該被綁死。

// ---- 變更彙整：儲存草稿 + 重新渲染 ----

let saveTimer = null;
export function onModelChange({ skipInspector = false } = {}) {
    recordHistory();
    renderOutline();
    if (!skipInspector) renderInspector();
    renderVariables();
    schedulePreview();
    scheduleSave();
}

let previewTimer = null;
export function schedulePreview() {
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

// ---- 復原／重做：版面元素樹的快照歷史 ----
// 每次 onModelChange 記一份快照；連續變動（拖曳、打字）在 HISTORY_MERGE_MS 內併成同一筆。
// 歷史第 0 筆是載入時的狀態，所以復原不會退到空白以前。

const HISTORY_MERGE_MS = 600;
const HISTORY_MAX = 100;
const history = { stack: [], index: -1, at: 0, restoring: false };

function resetHistory() {
    history.stack = [];
    history.index = -1;
    history.at = 0;
}

function recordHistory() {
    if (history.restoring) return;
    const snapshot = snapshotElements(state.project.template.elements);
    if (snapshot === history.stack[history.index]) return;
    const now = Date.now();
    history.stack.length = history.index + 1;
    if (history.index > 0 && now - history.at < HISTORY_MERGE_MS) {
        history.stack[history.index] = snapshot;
    } else {
        history.stack.push(snapshot);
        if (history.stack.length > HISTORY_MAX) history.stack.shift();
        history.index = history.stack.length - 1;
    }
    history.at = now;
}

function stepHistory(direction) {
    const next = history.index + direction;
    if (next < 0 || next >= history.stack.length) return;
    history.index = next;
    history.at = 0;
    state.project.template.elements = restoreElements(history.stack[next]);
    pruneSelection();
    if (state.insertionTarget && !findElementById(state.project.template.elements, state.insertionTarget.rowId)) state.insertionTarget = null;
    history.restoring = true;
    try {
        onModelChange();
    } finally {
        history.restoring = false;
    }
}

// ---- 鍵盤快捷鍵與點空白取消選取 ----
// 焦點在輸入框、文字編輯區或對話框時一律交給瀏覽器（輸入框自己的復原、Delete 刪字）。

let clipboardElements = [];

function deselectElement() {
    if (!getSelectedIds().length) return;
    state.selectedId = null;
    state.multi = [];
    renderOutline();
    renderInspector();
    highlightSelectedBlock();
}

function pasteElements() {
    if (!clipboardElements.length) return;
    const clones = clipboardElements.map((el) => cloneElementWithNewIds(el));
    const ids = getSelectedIds();
    const found = ids.length ? findContainerOf(state.project.template.elements, ids[ids.length - 1]) : null;
    if (found) found.array.splice(found.index + 1, 0, ...clones);
    else resolveTargetArray(state.project.template.elements, state.insertionTarget).push(...clones);
    setSelection(clones.map((c) => c.id));
    onModelChange();
}

function handleEditorShortcut(e) {
    if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable], [role=\"tab\"]") && e.key !== "Escape") return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const ids = getSelectedIds();
    const root = state.project.template.elements;

    if (mod && key === "z") {
        stepHistory(e.shiftKey ? 1 : -1);
    } else if (mod && key === "y") {
        stepHistory(1);
    } else if (mod && key === "g" && ids.length) {
        if (e.shiftKey) ungroupElements(ids);
        else groupElements(ids);
    } else if (mod && key === "d" && ids.length) {
        duplicateElements(ids);
    } else if (mod && key === "c" && ids.length && !window.getSelection().toString()) {
        clipboardElements = ids.map((id) => JSON.parse(JSON.stringify(findElementById(root, id))));
        return;
    } else if (mod && key === "v" && clipboardElements.length) {
        pasteElements();
    } else if ((e.key === "Delete" || e.key === "Backspace") && ids.length && !mod) {
        deleteElements(ids);
    } else if (e.key === "Escape") {
        deselectElement();
        return;
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey) {
        const dir = e.key === "ArrowUp" ? -1 : 1;
        if (e.altKey || mod) {
            if (ids.length) moveElements(ids, dir);
        } else {
            const flat = flattenElements(root);
            const anchor = ids.length ? flat.findIndex((el) => el.id === ids[dir < 0 ? 0 : ids.length - 1]) : -1;
            const next = anchor >= 0 ? flat[anchor + dir] : flat[dir < 0 ? flat.length - 1 : 0];
            if (next) selectElementById(next.id);
        }
    } else {
        return;
    }
    e.preventDefault();
}

// 框選：在空白處拖出矩形，選到碰到矩形的元素；一次只選同一層（有最上層元素就以最上層為準）。沒拖動＝取消選取。
function startMarquee(e) {
    const startX = e.clientX;
    const startY = e.clientY;
    let box = null;
    const rectOf = (ev) => ({
        left: Math.min(startX, ev.clientX), top: Math.min(startY, ev.clientY),
        right: Math.max(startX, ev.clientX), bottom: Math.max(startY, ev.clientY),
    });
    const onMove = (ev) => {
        if (!box) {
            if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
            box = document.createElement("div");
            box.className = "marquee-box";
            document.body.appendChild(box);
        }
        const r = rectOf(ev);
        Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
    };
    const onUp = (ev) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (!box) {
            deselectElement();
            return;
        }
        box.remove();
        const r = rectOf(ev);
        const root = state.project.template.elements;
        const hits = [...els["edit-overlay"].querySelectorAll(".edit-block")].filter((n) => {
            const b = n.getBoundingClientRect();
            return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        }).map((n) => n.dataset.id);
        const arrayOf = (id) => findContainerOf(root, id)?.array;
        const base = hits.find((id) => arrayOf(id) === root) ?? hits[0];
        if (!base) {
            deselectElement();
            return;
        }
        setSelection(hits.filter((id) => arrayOf(id) === arrayOf(base)));
        state.insertionTarget = containerToTarget(arrayOf(base));
        renderOutline();
        renderInspector();
        highlightSelectedBlock();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
}

function bindEditorShortcuts() {
    document.addEventListener("keydown", handleEditorShortcut);
    els["paper-scroll"].addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || state.viewMode !== "edit") return;
        const t = e.target;
        if (t === els["paper-scroll"] || t === els["paper-shadow"] || t === els["canvas-host"] || t.tagName === "CANVAS") startMarquee(e);
    });
}

init();
