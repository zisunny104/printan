// Kiosk 模式：外部系統（例如測驗網站選到某個結果、或別的應用配對後）用網址 query string
// 觸發 printan 用指定版型＋變數值直接列印，畫面看不出是 printan。
// 這個模組只管「用 query string 驅動」這一層——資料怎麼送到這個網址（測驗邏輯、配對代碼）
// 是呼叫端自己的事，這裡不做任何後端配對機制，純前端讀 query string。
//
// 支援的 query 參數：
//   tpl=<.ptan 網址>   指定版型，限同源（不接受任意第三方網址，也不是 IndexedDB 草稿 id，
//                      這樣才能跨裝置／跨部署使用同一份版型檔）
//   kiosk=1            切 <html class="is-kiosk">，給 CSS 隱藏工具列／大綱／檢視器等編輯介面用
//                      （實際隱藏規則不在這裡，這裡只掛 class）
//   autoprint=1        印表機先前已被瀏覽器授權過，就不需要使用者手勢直接印；
//                      沒授權過的裝置本來就一定要跳系統選擇窗（WebUSB／Serial 規格要求使用者手勢），
//                      這種情況不強求全自動，改顯示 #kiosk-connect-print 候補配對按鈕讓人點一次
//                      （工具列被 kiosk CSS 藏起來，原本的列印鍵點不到）；配對成功後接著印，
//                      這台裝置之後再開同一個網址就會被上面的靜默重連直接接上，不用再點第二次
//   其餘參數：比照版型內用到的變數名稱，自動填進 state.previewData（見 editor.js renderVariables）
//
// 已知限制：如果版型剛好有變數叫 tpl／kiosk／autoprint，會被當保留字吃掉、進不了 previewData，
// 這種邊角案例不特別處理。

import { extractPlaceholders } from "../core/document-model.js";
import { loadProject } from "../core/schema.js";
import { registerEmbeddedFonts } from "../core/web-fonts.js";
import { describePrinterError } from "../core/printer-adapter.js";
import { els, state } from "./context.js";
import { attemptSilentPrinterReconnect, connectPrinter, printSilently } from "./printer-settings.js";

const KIOSK_CLASS = "is-kiosk";
const RESERVED_PARAMS = new Set(["tpl", "kiosk", "autoprint"]);

// 跟 editor.js 的 updateFontFallbackNotice／updateImageFailureNotice 同一套「畫面上一行不擋畫面的
// 提示列」寫法：kiosk 沒有人會去點 confirm()，問題一律用這個顯示，不彈原生對話框。
function showKioskNotice(message) {
    let notice = els["kiosk-notice"];
    if (!notice) {
        notice = document.createElement("div");
        notice.className = "ts-notice is-negative";
        notice.appendChild(Object.assign(document.createElement("div"), { className: "content" }));
        const stage = els["paper-shadow"].parentElement.parentElement;
        stage.parentElement.insertBefore(notice, stage);
        els["kiosk-notice"] = notice;
    }
    notice.hidden = false;
    notice.firstChild.textContent = message;
}

/**
 * autoprint=1 但沒有已授權裝置時顯示：WebUSB／Serial 規格要求配對一定要使用者手勢，
 * 工具列整組被 .is-kiosk 的 CSS 隱藏，畫面上沒有東西可點，所以另外準備一顆 kiosk 專用按鈕。
 * id：#kiosk-connect-print，樣式（大小、位置）給 89 接手，這裡只做行為：
 * 點下去走跟「連線印表機」按鈕（printer-settings.js 的 connectPrinter）同一套配對流程，
 * 配對成功後接著印——之後這台裝置再開同一個 kiosk 網址，attemptSilentPrinterReconnect 會直接接上，
 * 不用再點第二次。
 */
function showKioskConnectButton() {
    let button = els["kiosk-connect-print"];
    if (!button) {
        button = document.createElement("button");
        button.id = "kiosk-connect-print";
        button.type = "button";
        button.className = "ts-button is-primary";
        button.textContent = "連線印表機並列印";
        const stage = els["paper-shadow"].parentElement.parentElement;
        stage.parentElement.insertBefore(button, stage);
        button.addEventListener("click", async () => {
            button.disabled = true;
            await connectPrinter();
            if (!state.usbConnected && !state.serialConnected) {
                button.disabled = false; // 使用者取消選擇裝置或連線失敗，留著讓人可以再點一次
                return;
            }
            button.hidden = true;
            const outcome = await printSilently();
            if (outcome.ok && outcome.issues.length) showKioskNotice(outcome.issues.join("；"));
            else if (!outcome.ok && outcome.reason === "print-failed") showKioskNotice(describePrintFailure(outcome));
        });
        els["kiosk-connect-print"] = button;
    }
    button.hidden = false;
}

// printSilently() 多頁列印中途失敗時，把是第幾頁失敗一併講清楚——使用者才知道前面幾頁已經印出來了，
// 不是「整份都沒印到」，也知道要從哪一頁開始補印。
function describePrintFailure(outcome) {
    const pageInfo = outcome.totalPages > 1 ? `第 ${outcome.failedPageIndex + 1}/${outcome.totalPages} 頁「${outcome.pageName || ""}」` : "";
    return `自動列印失敗：${pageInfo}${pageInfo ? "，" : ""}${describePrinterError(outcome.error)}，請改用列印鍵`;
}

// tpl= 只接受同源網址：印表機是實體輸出，風險不算高，但沒必要開放任意第三方網址當版型來源。
function isAllowedTemplateUrl(url) {
    try {
        return new URL(url, location.href).origin === location.origin;
    } catch {
        return false;
    }
}

/** 抓 tpl= 指定的 .ptan 內容、解析、註冊內嵌字體，回傳 project；失敗回傳 null 並顯示提示。 */
async function loadTemplateFromUrl(url) {
    if (!isAllowedTemplateUrl(url)) {
        showKioskNotice("版型網址不允許（僅接受同源網址）");
        return null;
    }
    let text;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
    } catch {
        showKioskNotice("版型讀取失敗，請確認網址是否正確");
        return null;
    }
    const result = loadProject(text);
    if (!result.ok) {
        showKioskNotice("版型內容有誤，無法開啟");
        return null;
    }
    if (result.project.embeddedFonts) {
        // 字體資料只用來註冊 FontFace，不留在專案裡，跟 ptan-file.js 的 readPtanFile 做法一致
        const { embeddedFonts, ...rest } = result.project;
        await registerEmbeddedFonts(embeddedFonts);
        result.project = rest;
    }
    return result.project;
}

/** query string 裡跟版型變數同名的參數，填進 state.previewData。 */
function applyVariablesFromQuery(params, project) {
    // 變數要掃全部頁面，不是只有第一頁：kiosk 網址帶的變數值要能填到任何一頁用到的 placeholder。
    const names = new Set(extractPlaceholders(project.template.pages.flatMap((p) => p.elements)));
    for (const [key, value] of params) {
        if (RESERVED_PARAMS.has(key) || !names.has(key)) continue;
        state.previewData[key] = value;
    }
}

/**
 * 讀網址 query string，有 tpl= 就切換成 kiosk 流程；沒有就什麼都不做（一般編輯器行為不受影響）。
 * 要在 editor.js 的 init() 完成一般初始化（含靜默重連印表機）之後呼叫，回傳是否進了 kiosk 流程。
 * loadProjectIntoEditor／schedulePreview 由呼叫端（editor.js）傳進來，避免這個檔案反過來 import
 * editor.js 造成循環依賴。
 */
export async function bootKioskFromQuery(loadProjectIntoEditor, schedulePreview) {
    const params = new URLSearchParams(location.search);
    const tplUrl = params.get("tpl");
    if (!tplUrl) return false;

    if (params.get("kiosk") === "1") document.documentElement.classList.add(KIOSK_CLASS);

    const project = await loadTemplateFromUrl(tplUrl);
    if (!project) return true; // tpl= 有給但讀取失敗，維持 kiosk 外觀顯示錯誤提示，不要退回一般編輯畫面

    loadProjectIntoEditor(project);
    // loadProjectIntoEditor 內部已經呼叫過一次 onModelChange()／schedulePreview()，
    // 但那時 previewData 還沒套用 query 變數，這裡套用完變數後要再排一次預覽更新，
    // 讓畫面（跟接下來 autoprint 要印出來的內容）反映實際變數值。
    applyVariablesFromQuery(params, project);
    schedulePreview();

    if (params.get("autoprint") === "1") {
        await attemptSilentPrinterReconnect();
        if (state.usbConnected || state.serialConnected) {
            const outcome = await printSilently();
            if (outcome.ok && outcome.issues.length) showKioskNotice(outcome.issues.join("；"));
            else if (!outcome.ok && outcome.reason === "print-failed") showKioskNotice(describePrintFailure(outcome));
        } else {
            // 沒有已授權裝置：WebUSB／Serial 規格要求跳選擇窗一定要使用者手勢，做不到全自動，
            // 顯示候補配對按鈕讓人點一次；工具列被 .is-kiosk 隱藏，原本的列印鍵點不到。
            showKioskConnectButton();
        }
    }
    return true;
}
