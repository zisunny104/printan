// 印表機：連線、列印、偏好與「印表機設定」面板。

import {
    MARGIN_MM_MAX, PRINTABLE_DOTS_MAX, PRINTABLE_DOTS_MIN, getMarginPad, getPaperWidth, getPrintHeadWidthDots,
    getPrinterProfile, matchPrinterProfile, sanitizeMarginCalibration, sanitizePrintableDotsOverrides,
} from "../core/printer-profiles.js";
import { PRINT_PREFS_KEY, els, serialAdapter, state, usbAdapter } from "./context.js";
import { SystemDialogAdapter, describePrinterError, interpretRealtimeStatus, isSelectionCancelled, rotateCanvas180 } from "../core/printer-adapter.js";
import { getBaseProfile, getEffectiveProfile, schedulePreview } from "./editor.js";
import { confirmFontFallbacks, describeFontFallbackIssues } from "./batch-export.js";
import { safeGetItem, safeSetItem } from "../core/storage.js";
import { createInfoIcon, hideStageNotice, showSnackbar, showStageNotice } from "./ui-helpers.js";
import { renderCalibrationSheet, renderTestPrint } from "./test-print-project.js";
import { renderPages } from "../core/renderer.js";

// ESC/POS 直連列印（WebUSB／WebSerial）用的列印選項：在使用者的走紙／切紙偏好之外，
// 額外帶入目前印表機 profile 的列印頭最大寬度，讓 buildEscposJob 統一置中輸出
// （見 printer-adapter.js centerCanvasOnWidth），避免紙寬較窄時印出來的內容偏移；左右邊距校正的補白點數一併帶入。
// pageCutAfter：多頁列印時每一頁各自的切紙旗標（見 schema.js Page.cutAfter）。跟使用者全域的
// 「切紙」偏好（state.printPrefs.cutPaper）是「且」的關係——全域偏好本來就是給沒有自動切刀、
// 或不想切紙的使用者關掉用的，單頁專案沒有 pages 概念之前這個偏好就是唯一開關，多頁專案
// 加了每頁各自的旗標之後，兩者都要開才真的送切紙指令，維持「全域關掉＝完全不切」的既有行為。
// project 參數預設是 state.project；kiosk.js 多範本模式（printComposedSilently）沒有單一
// state.project 可用，傳自己手上第一份範本的 project 進來算 profile／紙寬，見 getBaseProfile。
function getEscposPrintOptions(pageCutAfter = true, project = state.project) {
    const pad = getMarginPad(getEffectiveProfile(project), project.paper.widthId);
    return {
        ...state.printPrefs,
        cutPaper: state.printPrefs.cutPaper && pageCutAfter,
        targetWidthDots: getPrintHeadWidthDots(getBaseProfile(project)),
        padLeftDots: pad.left,
        padRightDots: pad.right,
    };
}

// 印表機倒裝偏好（state.printPrefs.rotate180）：直接把 renderPages 結果的 canvas 換成轉過的版本，
// USB/Serial（buildEscposJob→canvasToEscposRaster）與系統列印對話框都是拿 result.canvas 出去用，
// 在這裡統一處理一次，兩條路徑都不用各自知道有這個偏好存在。
function applyRotationPref(results) {
    if (!state.printPrefs.rotate180) return results;
    for (const result of results) result.canvas = rotateCanvas180(result.canvas);
    return results;
}

// 依序印出多頁：任何一頁失敗就整個中止（不跳過繼續印剩下的頁），因為列印順序有意義
// （同一段連續紙、或後面頁面內容承接前面），跳過中間一頁會印出不完整、順序錯亂的結果，
// 比整個失敗更難察覺、更難補救。回傳 { ok, failedPageIndex, error } 或 { ok: true }。
async function printPagesInOrder(adapter, results) {
    for (let i = 0; i < results.length; i++) {
        const cutAfter = results[i].page?.cutAfter !== false;
        try {
            await adapter.print(results[i], getEscposPrintOptions(cutAfter));
        } catch (err) {
            return { ok: false, failedPageIndex: i, error: err };
        }
    }
    return { ok: true };
}

const PRINTER_BUSY_MESSAGE = "印表機正在處理上一個操作（列印／測試列印／查詢狀態），請稍候再試一次";
const PRINT_NOTICE_KEY = "print-failure-notice";

export async function printCurrent() {
    if (state.printerBusy) {
        showSnackbar(PRINTER_BUSY_MESSAGE);
        return;
    }
    state.printerBusy = true;
    hideStageNotice(PRINT_NOTICE_KEY);
    try {
        const results = applyRotationPref(await renderPages(state.project, state.previewData, { mode: "thermal", profile: getEffectiveProfile() }));
        if (!confirmFontFallbacks(results)) return;

        if (state.usbConnected || state.serialConnected) {
            const adapter = state.usbConnected ? usbAdapter : serialAdapter;
            const outcome = await printPagesInOrder(adapter, results);
            if (outcome.ok) return;
            releaseFailedConnection();
            updatePrinterConnectionUi();
            const failed = outcome.failedPageIndex;
            const pageLabel = results.length > 1 ? `第 ${failed + 1}/${results.length} 頁「${results[failed].page?.name || ""}」` : "";
            const reason = describePrinterError(outcome.error);
            // 已經有頁面印到紙上（USB／Serial 是送出即列印）就整個中止：剩下的頁不能改走系統列印補印，
            // 那會把原本同一段連續紙的內容拆到另一個列印工作、中間多切一刀或順序錯亂，印出來的東西收不回來。
            // 第一頁就失敗（什麼都還沒印）才維持原本單頁時代「直連失敗改用系統列印」的行為。
            if (failed > 0) {
                showStageNotice(PRINT_NOTICE_KEY, `列印中止：${pageLabel}失敗（${reason}）。前 ${failed} 頁已印出，其餘頁面沒有列印。`, { dismissible: true });
                return;
            }
            showStageNotice(PRINT_NOTICE_KEY, `直連列印失敗：${pageLabel}${pageLabel ? "，" : ""}${reason}，已改用系統列印。`, { dismissible: true });
        }

        // 系統列印對話框一次只能印一份影像，多頁就開多個列印工作，逐一走過去；
        // 這裡不像 USB／Serial 失敗就整個中止——系統對話框本身就是使用者手動逐一確認／取消，
        // 沒有「靜默中途失敗」的問題，中止與否的差異對使用者沒有意義。
        const adapter = new SystemDialogAdapter();
        await adapter.connect();
        for (const result of results) await adapter.print(result);
    } catch (err) {
        showStageNotice(PRINT_NOTICE_KEY, `列印失敗：${describePrinterError(err)}`, { dismissible: true });
    } finally {
        state.printerBusy = false;
    }
}

/**
 * kiosk.js 自動列印用：跟 printCurrent 一樣依序送印全部頁面，但兩個地方刻意不一樣——
 * 1. 不呼叫 confirmFontFallbacks() 的 confirm()，kiosk 沒有人在旁邊可以點確認；
 * 2. USB／Serial 失敗時不像 printCurrent 退回 SystemDialogAdapter（跳系統列印對話框一樣要人手動
 *    操作，對 kiosk 沒有意義），直接回報失敗給呼叫端自己決定怎麼顯示（見 kiosk.js showKioskNotice）。
 * 只印已授權裝置：沒有已授權裝置時呼叫端會自己判斷、不呼叫這個函式（見 kiosk.js）。
 * 中途某一頁失敗就中止，不跳過繼續印剩下的頁（理由同 printPagesInOrder）。
 * 回傳 { ok, issues } 或 { ok:false, reason, error?, failedPageIndex?, pageName? }，不在這裡動畫面。
 */
export async function printSilently() {
    if (state.printerBusy) return { ok: false, reason: "busy" };
    if (!state.usbConnected && !state.serialConnected) return { ok: false, reason: "not-connected" };
    state.printerBusy = true;
    try {
        const results = applyRotationPref(await renderPages(state.project, state.previewData, { mode: "thermal", profile: getEffectiveProfile() }));
        const issues = describeFontFallbackIssues(results);
        const adapter = state.usbConnected ? usbAdapter : serialAdapter;
        const outcome = await printPagesInOrder(adapter, results);
        if (!outcome.ok) {
            releaseFailedConnection();
            updatePrinterConnectionUi();
            return {
                ok: false,
                reason: "print-failed",
                error: outcome.error,
                failedPageIndex: outcome.failedPageIndex,
                pageName: results[outcome.failedPageIndex]?.page?.name,
                totalPages: results.length,
            };
        }
        return { ok: true, issues };
    } catch (err) {
        releaseFailedConnection();
        updatePrinterConnectionUi();
        return { ok: false, reason: "print-failed", error: err };
    } finally {
        state.printerBusy = false;
    }
}

/**
 * kiosk.js 多範本模式用：跟 printSilently 一樣靜默送印，但吃的是呼叫端已經用 compose.js
 * renderProjects()／composeResults() 合成好的單一畫布（見 kiosk.js runMultiAutoprintFlow），
 * 不是 state.project——多範本合成不經過單一專案的編輯器 state，沒有「頁」的概念，永遠當成一頁、
 * 一定切紙（cutAfter 恆真，多範本合成本來就是一張完整收據，沒有「這一頁先不切給下一頁接著印」的情境）。
 * profile 參數：多範本模式沒有 state.project 可用來算列印頭寬度／邊距補白，呼叫端傳第一份範本的
 * project 進來（見 getEscposPrintOptions 的 project 參數）。
 * 回傳格式跟 printSilently 一致，呼叫端（kiosk.js）不用分兩套處理。
 */
export async function printComposedSilently(composed, project) {
    if (state.printerBusy) return { ok: false, reason: "busy" };
    if (!state.usbConnected && !state.serialConnected) return { ok: false, reason: "not-connected" };
    state.printerBusy = true;
    try {
        const result = state.printPrefs.rotate180 ? { ...composed, canvas: rotateCanvas180(composed.canvas) } : composed;
        const issues = describeFontFallbackIssues([result]);
        const adapter = state.usbConnected ? usbAdapter : serialAdapter;
        try {
            await adapter.print(result, getEscposPrintOptions(true, project));
        } catch (err) {
            releaseFailedConnection();
            updatePrinterConnectionUi();
            return { ok: false, reason: "print-failed", error: err, failedPageIndex: 0, totalPages: 1 };
        }
        return { ok: true, issues };
    } finally {
        state.printerBusy = false;
    }
}

// 「切紙前走紙行數」走不夠，切刀會切在剛印完、還沒通過切刀位置的內容上：
// bladeOffsetMm 是切刀跟列印頭之間固定的實體距離，需要應用程式自己走紙走過這段距離，
// 印表機不會自動幫忙走（見 state.printPrefs 那邊的說明，2026-09 已用實機驗證）。
// 提示文字依專案內的印表機規格動態產生，開啟不同專案時要重新更新，見 editor.js init／drafts.js loadProjectIntoEditor。
export function updateFeedLinesHint() {
    const profile = getPrinterProfile(state.project.printerProfile.id);
    const bladeOffsetMm = profile.autocutter?.bladeOffsetMm;
    const label = document.querySelector('label[for="pref-feed-lines"]');
    label.querySelector(".info-icon")?.remove();
    label.appendChild(createInfoIcon(bladeOffsetMm
        ? `${profile.brand} ${profile.model} 切刀距列印頭約 ${bladeOffsetMm}mm，切到內容請調高行數`
        : "切到內容請調高行數"));
    els["pref-feed-lines-hint"].hidden = true;
}

// 連線狀態、走紙／切紙偏好都是「這台瀏覽器、這台印表機」的本機操作習慣，不寫進 .ptan，
// 同一份版型換人、換印表機開啟時不應該被綁死。
export function loadPrintPrefs() {
    try {
        const saved = JSON.parse(safeGetItem(PRINT_PREFS_KEY) || "{}");
        state.printPrefs = { ...state.printPrefs, ...saved };
        state.printPrefs.printableDots = sanitizePrintableDotsOverrides(state.printPrefs.printableDots);
        state.printPrefs.margins = sanitizeMarginCalibration(state.printPrefs.margins);
    } catch {
        // 格式壞掉就用預設值，不擋流程
    }
}

function savePrintPrefs() {
    safeSetItem(PRINT_PREFS_KEY, JSON.stringify(state.printPrefs));
}

function currentWebUsbVendorId() {
    return getPrinterProfile(state.project.printerProfile.id).webUsb?.vendorId;
}

/**
 * 「連線印表機」的實際連線動作：用目前選定的連線方式跳裝置選擇窗（WebUSB／Serial 規格要求使用者手勢），
 * 更新連線狀態與畫面。設定 modal 裡的「連線印表機」按鈕、kiosk 沒有已授權裝置時的候補配對按鈕共用同一套邏輯。
 */
export async function connectPrinter() {
    await releasing;
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
        if (!isSelectionCancelled(err)) showSnackbar(`連線失敗：${describePrinterError(err)}`, { error: true });
    }
    updatePrinterConnectionUi();
    await identifyConnectedPrinter();
}

// 列印失敗（缺紙逾時、線被拔、裝置回錯）後，只把 state 旗標設成 false 不夠：adapter 還握著開啟中的
// port／裝置。下次按「連線印表機」會對已開啟的 port 再 open()，丟 InvalidStateError；斷線鈕又因為
// 顯示未連線而藏起來，只能重新整理頁面。所以一併釋放，讓下一次連線是乾淨的。
// releasing 讓後續的連線／重連先等釋放做完，避免對還沒關好的 port 又 open。
let releasing = Promise.resolve();
function releaseFailedConnection() {
    const wasUsb = state.usbConnected;
    const wasSerial = state.serialConnected;
    state.usbConnected = false;
    state.serialConnected = false;
    releasing = Promise.all([
        wasUsb ? usbAdapter.disconnect().catch(() => {}) : null,
        wasSerial ? serialAdapter.disconnect().catch(() => {}) : null,
    ]);
}

// 同一時間只跑一次重連，後來的呼叫直接接同一個 Promise：編輯器初始化、kiosk 啟動檢查、
// 每筆列印工作都會呼叫，同時對同一個 USB 裝置 open 兩次，後到的丟例外會被當成「沒連上」。
let reconnectInFlight = null;
export function attemptSilentPrinterReconnect() {
    if (!reconnectInFlight) reconnectInFlight = reconnectAuthorizedPrinter().finally(() => { reconnectInFlight = null; });
    return reconnectInFlight;
}

async function reconnectAuthorizedPrinter() {
    await releasing;
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
    // 自動重連不送 GS I：只有使用者手動按「連線印表機」才查詢（部分機型會把指令當文字印出）
    await identifyConnectedPrinter({ query: false });
}

// 設定 modal 的連線區塊只有一組連線／中斷按鈕，「目前選哪種連線方式」跟「實際連上哪一種」
// 要分開看：已連線時以實際連上的為準（方式選項鎖住，要換得先中斷）；未連線時才用使用者選的方式。
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
        ? `已連線：${connectedLabel}`
        : "列印會走系統列印對話框";
    els["btn-printer-connect"].hidden = connected;
    els["btn-printer-connect"].disabled = !supported;
    els["btn-printer-disconnect"].hidden = !connected;

    // 連線狀態燈：modal 標題旁的 badge 是主要指示，工具列「列印設定」按鈕文字後面的小綠點
    // 讓不開 modal 也看得出有沒有連線。都是 in-flow 元素，不用絕對定位貼在按鈕角落
    // （貼角的圓點會被邊框吃掉一半，看起來像「有問題」的角標，也不是 .is-active 那種
    // 整顆填色的「目前開啟」語意，見 editor.css .printer-conn-dot）。
    // 未連線時 badge 用紅底（最搶眼，提醒要連線）；已連線改成綠燈外框。
    els["printer-conn-badge"].classList.toggle("is-negative", !connected);
    els["printer-conn-badge"].classList.toggle("is-outlined", connected);
    els["printer-conn-badge"].querySelector(".printer-conn-dot").classList.toggle("is-on", connected);
    els["printer-conn-badge-text"].textContent = connected ? "已連線" : "未連線";
    els["printer-toolbar-dot"].hidden = !connected;
    els["btn-printer-settings"].dataset.tooltip = connected
        ? `列印設定（已連線：${connectedLabel}）`
        : "列印設定";
    els["btn-printer-settings"].setAttribute("aria-label", connected ? "列印設定（印表機已連線）" : "列印設定（印表機未連線）");

    // 識別資料只在連線期間有意義，斷線（含裝置被拔掉）就清掉，見 identifyConnectedPrinter()。
    if (!connected) state.printerIdentity = null;
    updatePrinterInfo();
    els["btn-printer-forget"].disabled = !(usbAdapter.canForget() || serialAdapter.canForget());

    // 跟連線／中斷按鈕一樣用狀態控制可用性，不要讓沒接印表機時還能按「測試列印」／
    // 「查詢印表機狀態」再跳 alert 說明——那樣使用者得先點一次才知道不能用，體驗上
    // 比按鈕本身直接變成無法點擊差一截。
    els["btn-printer-test-print"].disabled = !connected;
    els["btn-printer-margin-sheet"].disabled = !connected;
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
// 只有型號比對得到內建規格才標成「機器提供」，比對不到就明講「無法辨識，使用預設值」。
function updatePrinterInfo() {
    const base = getPrinterProfile(state.project.printerProfile.id);
    const profile = getBaseProfile();
    const paper = getPaperWidth(profile, state.project.paper.widthId);
    const basePaper = getPaperWidth(base, state.project.paper.widthId);
    const identity = state.printerIdentity;

    if (!identity) {
        setInfoCell("printer-info-device", "未連線");
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
            identity.pending ? "讀取中…" : identity.firmware || (identity.queried ? "印表機未回報" : "—"),
            identity.firmware ? "machine" : null,
        );
        if (identity.pending) setInfoCell("printer-info-spec", "比對中…");
        else if (!identity.queried) setInfoCell("printer-info-spec", `無法辨識（自動重連不查詢）`, "default");
        else if (identity.profileId) setInfoCell("printer-info-spec", `${base.brand} ${base.model}`, "machine");
        else setInfoCell("printer-info-spec", `無法辨識，使用預設值（${base.brand} ${base.model}）`, "default");
    }
    setInfoCell("printer-info-dpi", `${base.dpi.x} × ${base.dpi.y} dpi`, "default");
    setInfoCell("printer-info-paper", `捲紙寬 ${paper.rollWidthMm} mm`);
    els["printer-info-paper"].appendChild(createInfoIcon("由工具列選擇，ESC/POS 讀不到"));
    const overridden = paper.printableWidthDots !== basePaper.printableWidthDots;
    setInfoCell("printer-info-printable", `${paper.printableWidthDots} 點（約 ${paper.printableWidthMm.toFixed(1)} mm）`, overridden ? "override" : "default");
    setInfoCell("printer-info-blade", base.autocutter?.bladeOffsetMm ? `約 ${base.autocutter.bladeOffsetMm} mm` : "—", base.autocutter ? "default" : null);
}

// 每個紙寬一列「可列印點數」輸入框：留空＝用內建規格的預設值，填了就是手動覆寫（存在本機偏好，
// 不進 .ptan）。輸入時就地更新 badge／mm 換算，不重畫整列——輸入框 change 事件是在切到下一格
// 之前觸發，重畫會讓焦點掉掉。
export function renderPrintableDotsRows() {
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

// 每個紙寬一列「邊距校正」：填測試列印量到的左右留白（mm），兩格都填才生效、兩格清空＝不校正；
// 存在本機偏好，不進 .ptan。
export function renderMarginRows() {
    const base = getPrinterProfile(state.project.printerProfile.id);
    const margins = state.printPrefs.margins;
    els["printer-margin-list"].replaceChildren();
    for (const paper of base.paperWidths) {
        const row = document.createElement("div");
        row.className = "printer-dots-row";

        const label = document.createElement("span");
        label.className = "ts-text is-label printer-dots-label";
        label.textContent = paper.label;
        row.appendChild(label);

        const inputs = [["leftMm", "左"], ["rightMm", "右"]].map(([key, name]) => {
            const wrap = document.createElement("div");
            wrap.className = "ts-input is-small printer-dots-input";
            const input = document.createElement("input");
            input.type = "number";
            input.min = 0;
            input.max = MARGIN_MM_MAX;
            input.step = 0.1;
            input.placeholder = name;
            input.value = margins[paper.id]?.[key] ?? "";
            input.setAttribute("aria-label", `${paper.label} ${name}邊距（mm）`);
            wrap.appendChild(input);
            row.appendChild(wrap);
            return { key, input };
        });

        const unit = document.createElement("span");
        unit.className = "ts-text is-description is-small";
        unit.textContent = "mm";
        row.appendChild(unit);

        const commit = () => {
            const [left, right] = inputs.map(({ input }) => input.value.trim());
            if (left === "" && right === "") {
                delete margins[paper.id];
            } else {
                const next = sanitizeMarginCalibration({ [paper.id]: { leftMm: left, rightMm: right } })[paper.id];
                if (!next) return; // 只填一邊：等另一邊也填了才生效
                margins[paper.id] = next;
                inputs.forEach(({ key, input }) => { input.value = next[key]; });
            }
            savePrintPrefs();
            els["btn-printer-margin-reset"].disabled = Object.keys(margins).length === 0;
            schedulePreview();
        };
        inputs.forEach(({ input }) => input.addEventListener("change", commit));
        els["printer-margin-list"].appendChild(row);
    }
    els["btn-printer-margin-reset"].disabled = Object.keys(margins).length === 0;
}

// 連線後讀印表機自報的辨識資料，再拿去比對內建規格表（query:false＝自動重連，只讀裝置名稱、不送 GS I）：
// 1. WebUSB 有 manufacturerName／productName（裝置描述元，不用送指令）；序列埠讀不到裝置名稱。
// 2. GS I n（n=66 廠牌、67 型號、65 韌體）是 ESC/POS 標準的「傳送印表機 ID」指令，但只有
//    「有回應」才算數：第一個查詢沒回應就整個停下來（逾時的 USB 讀取取消不了，會卡住之後的回應），
//    也不會影響連線、列印本身。此功能沒有實機驗證，見 README 已知限制。
// 3. 用 GS I 型號＋裝置名稱去比對 printer-profiles.js 的 model；比對不到不報錯，
//    UI 明確標成「無法辨識，使用預設值」，規格照舊用專案指定的預設 profile。
async function identifyConnectedPrinter({ query = true } = {}) {
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
        queried: query,
        pending: query,
    };
    state.printerIdentity = identity;
    updatePrinterInfo();

    // 跟列印／測試列印／查詢狀態共用同一條連線，忙碌中就不插隊送指令，只用裝置名稱比對
    const canQuery = query && !state.printerBusy;
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
    identity.profileId = !query ? null : matchPrinterProfile([identity.model, adapter.deviceLabel]);
    updatePrinterInfo();
}

// 測試列印／校正紙：canvas 由 test-print-project.js 產生，跟一般列印共用 adapter.print() 與 printerBusy 序列化
async function printTestSheet(label, build) {
    if (!state.usbConnected && !state.serialConnected) {
        showSnackbar(`請先連線 USB 或序列埠印表機才能${label}`);
        return;
    }
    if (state.printerBusy) {
        showSnackbar(PRINTER_BUSY_MESSAGE);
        return;
    }
    state.printerBusy = true;
    // 資料送給印表機要花時間（印表機缺紙、上蓋打開時會一直等到逾時），按下去沒有任何變化會讓人以為沒反應、
    // 又按一次就撞到「忙碌中」：傳送期間按鈕鎖起來，狀態列寫明在做什麼
    const sending = [els["btn-printer-test-print"], els["btn-printer-margin-sheet"]];
    for (const button of sending) button.disabled = true;
    els["printer-status-result"].textContent = `${label}：傳送資料中…（印表機沒有回應時最多等 ${Math.round(usbAdapter.transferTimeoutMs / 1000)} 秒）`;
    let outcome = "";
    try {
        const widthId = state.project.paper.widthId;
        const profile = getEffectiveProfile();
        const ctx = {
            baseProfile: getBaseProfile(),
            profile,
            widthId,
            headWidthDots: getPrintHeadWidthDots(getBaseProfile()),
            pad: getMarginPad(profile, widthId),
            prefs: state.printPrefs,
            connection: state.usbConnected ? "USB" : "序列埠",
            firmware: state.printerIdentity?.firmware || "",
        };
        const renderResult = await build(ctx);
        // 測試列印／校正紙正是使用者要確認倒裝旋轉有沒有裝對的地方，跟正式列印用同一份偏好、同一個轉換函式。
        if (state.printPrefs.rotate180) renderResult.canvas = rotateCanvas180(renderResult.canvas);
        if (!confirmFontFallbacks(renderResult)) {
            outcome = `${label}：已取消`;
            return;
        }
        const adapter = state.usbConnected ? usbAdapter : serialAdapter;
        await adapter.print(renderResult, getEscposPrintOptions());
        outcome = `${label}：資料已送出`;
    } catch (err) {
        outcome = `${label}失敗：${describePrinterError(err)}`;
        showSnackbar(outcome, { error: true });
    } finally {
        state.printerBusy = false;
        for (const button of sending) button.disabled = !(state.usbConnected || state.serialConnected);
        els["printer-status-result"].textContent = outcome;
    }
}

// 依序查詢（不用 Promise.all 平行送出）：USB／序列埠的 queryStatus 都是「送出 DLE EOT
// 指令 → 等一個回應」，兩個查詢平行送會讓兩組請求／回應交錯，讀出來對不到是哪一個。
async function queryPrinterStatus() {
    const adapter = state.usbConnected ? usbAdapter : state.serialConnected ? serialAdapter : null;
    if (!adapter) {
        showSnackbar("請先連線 USB 或序列埠印表機才能查詢狀態");
        return;
    }
    if (state.printerBusy) {
        showSnackbar(PRINTER_BUSY_MESSAGE);
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
            : "印表機沒有回應";
    } catch (err) {
        els["printer-status-result"].textContent = `查詢失敗：${describePrinterError(err)}`;
    } finally {
        state.printerBusy = false;
    }
}

export function bindPrinterSettings() {
    els["pref-feed-lines"].value = state.printPrefs.feedLines;
    els["pref-cut-paper"].checked = state.printPrefs.cutPaper;
    els["pref-rotate-180"].checked = state.printPrefs.rotate180;
    els["pref-serial-baud-rate"].value = state.printPrefs.serialBaudRate;
    renderPrintableDotsRows();
    renderMarginRows();
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

    els["btn-printer-connect"].addEventListener("click", connectPrinter);

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
            showSnackbar(PRINTER_BUSY_MESSAGE);
            return;
        }
        if (!confirm("忘記後，瀏覽器不再記得已授權的印表機，目前的連線也會中斷；下次要按「連線印表機」重新選擇裝置。確定要忘記嗎？")) return;
        try {
            const usbCount = await usbAdapter.forgetAuthorizedDevices();
            const serialCount = await serialAdapter.forgetAuthorizedPorts();
            els["printer-status-result"].textContent = `已忘記 ${(usbCount ?? 0) + (serialCount ?? 0)} 個已授權的裝置`;
        } catch (err) {
            els["printer-status-result"].textContent = `忘記裝置失敗：${describePrinterError(err)}`;
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

    els["btn-printer-margin-reset"].addEventListener("click", () => {
        state.printPrefs.margins = {};
        savePrintPrefs();
        renderMarginRows();
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

    els["pref-rotate-180"].addEventListener("change", () => {
        state.printPrefs.rotate180 = els["pref-rotate-180"].checked;
        savePrintPrefs();
    });

    els["btn-printer-test-print"].addEventListener("click", () => {
        printTestSheet("測試列印", renderTestPrint);
    });

    els["btn-printer-margin-sheet"].addEventListener("click", () => {
        printTestSheet("列印校正紙", renderCalibrationSheet);
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
                usbAdapter.disconnect().catch(() => {}); // 已拔除的裝置 close() 可能丟錯，狀態照樣清掉
                state.usbConnected = false;
                updatePrinterConnectionUi();
            }
        });
    }

    if (serialAdapter.isSupported()) {
        navigator.serial.addEventListener("disconnect", (e) => {
            if (e.target === serialAdapter.port) {
                serialAdapter.disconnect().catch(() => {}); // 已拔除的埠 close() 可能丟錯，狀態照樣清掉
                state.serialConnected = false;
                updatePrinterConnectionUi();
            }
        });
    }
}
