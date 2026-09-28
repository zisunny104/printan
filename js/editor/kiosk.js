// Kiosk 模式：外部系統（例如測驗網站選到某個結果、或別的應用配對後）把 printan 嵌在 iframe 裡，
// 用指定範本＋postMessage 送進來的變數值直接列印，畫面看不出是 printan。
// 這個模組只管「kiosk 這一層」怎麼跟父視窗交換資料——資料本身怎麼產生（測驗邏輯、配對代碼）
// 是父視窗自己的事，這裡不做任何後端配對機制。
//
// 支援的 query 參數（只有這些，其餘一律忽略——變數值不再從網址列讀，全部走 postMessage）：
//   tpl=<.ptan 網址>[,<.ptan 網址>...]   指定範本，限同源（不接受任意第三方網址，也不是 IndexedDB
//                      草稿 id，這樣才能跨裝置／跨部署使用同一份範本檔）。可以用逗號分隔給多個
//                      網址——多份範本各自套用同一份 data 後由上而下拼成一張畫布再送印（見
//                      compose.js renderProjects），給「收據由後台排序的多個獨立區塊組成」這種
//                      用法用；單一網址時行為跟以前完全一樣（走單一專案，會載入畫面預覽）。
//   kiosk=1            切 <html class="is-kiosk">，給 CSS 隱藏工具列／大綱／檢視器等編輯介面用
//                      （實際隱藏規則不在這裡，這裡只掛 class）
//   jobId=<字串>       選填，工單識別碼初始值；收到 submit-job 時會被訊息裡的 jobId 覆蓋。
//                      只用來原樣帶回 postMessage 回報，讓父視窗在連續兩筆工單時對得上是哪一筆
//   parentOrigin=<origin> 父視窗 origin，回報與接收資料都只信任這個來源；沒給就退而用
//                      document.referrer 的 origin（iframe 嵌入時瀏覽器通常會帶）；兩者都拿不到，
//                      這個 kiosk session 就沒有任何安全的對象可以送資料／收資料，整組功能不會動作
//   gapDots=<數字>     選填，只有 tpl 給多個網址時有意義：多份範本合成時中間的留白點數，
//                      預設 0（父視窗如果自己有這個偏好設定，帶進來就好，不給就不留白）
//
// postMessage 協定：
//   printan → 父視窗（回報，只要判斷得出 parentOrigin 就會送，targetOrigin 一律是 parentOrigin，
//   不用 "*"，避免工單內容——姓名／留言等——洩漏給不明頁面）：
//     { source: "printan-kiosk", jobId, status: "ready"|"printed"|"print_failed"|"needs_connect", ...細節欄位 }
//     ready 代表範本已載入完成，可以送 submit-job 了。
//   父視窗 → printan（送資料，唯一的資料輸入管道）：
//     { type: "printan:submit-job", jobId, data: { 變數名: 值 } }
//     data 裡的鍵值比照範本 {{var}} 的規則套進 previewData（文字變數直接代換；照片變數是
//     圖片元素 assetId 用 {{var}} 佔位，值需為 https:// 開頭網址，見 renderer.js resolveImage）。
//     多範本模式下同一份 data 會分別套到每一份範本，各自只挑自己範本裡實際用到的變數名稱
//     （見 applyVariablesFromData），所以不同區塊的變數名稱不會互相污染，即使剛好同名也只是
//     兩邊都吃到同一個值，不會報錯。套用完立刻觸發一次列印（有已授權印表機就直接印，沒有就
//     顯示候補配對按鈕）。event.origin 必須等於 parentOrigin 且 event.source 必須是
//     window.parent，其餘一律忽略。
//
// 已知限制：如果範本剛好有變數叫 tpl／kiosk／jobId／parentOrigin／gapDots，會被當保留字吃掉、
// 進不了 previewData，這種邊角案例不特別處理。

import { extractPlaceholders } from "../core/document-model.js";
import { loadProject } from "../core/schema.js";
import { registerEmbeddedFonts } from "../core/web-fonts.js";
import { describePrinterError } from "../core/printer-adapter.js";
import { renderProjects } from "../core/compose.js";
import { getEffectiveProfile } from "./editor.js";
import { els, state } from "./context.js";
import { attemptSilentPrinterReconnect, connectPrinter, printComposedSilently, printSilently } from "./printer-settings.js";
import { mountStageElement, showStageNotice } from "./ui-helpers.js";

const KIOSK_CLASS = "is-kiosk";
const KIOSK_PREVIEW_CLASS = "kiosk-preview";
const RESERVED_PARAMS = new Set(["tpl", "kiosk", "jobId", "parentOrigin", "gapDots"]);

// 這次工單的識別碼與回報／接收用的信任 origin；只有 bootKioskFromQuery 在跑，模組層級變數夠用，
// 不需要放進 state（跟編輯器畫面狀態無關，是這個 kiosk session 專屬的一次性資訊）。
let currentJobId = null;
let reportTargetOrigin = null;

// 跟 editor.js 的字體／圖片提示同一套「畫面上一行不擋畫面的提示列」（ui-helpers.js showStageNotice）：
// kiosk 沒有人會去點 confirm()，問題一律用這個顯示，不彈原生對話框。
function showKioskNotice(message) {
    showStageNotice("kiosk-notice", message);
}

// 候補配對按鈕按下、連線成功之後要執行的列印動作：單一範本模式傳 printSilently，
// 多範本模式（見 runMultiAutoprintFlow）傳一個包好 projects/data/gapDots 的 closure。
// 按鈕元素本身用 els 記憶只建一次（見 showKioskConnectButton），但每筆工單要印的內容不一樣，
// 監聽器要讀的是「當下」這個模組層級變數，不能在建立按鈕當下把 printFn 綁死進 closure 裡。
let pendingConnectPrint = printSilently;

/**
 * 沒有已授權裝置時顯示：WebUSB／Serial 規格要求配對一定要使用者手勢，
 * 工具列整組被 .is-kiosk 的 CSS 隱藏，畫面上沒有東西可點，所以另外準備一顆 kiosk 專用按鈕。
 * id：#kiosk-connect-print，樣式（大小、位置）給 89 接手，這裡只做行為：
 * 點下去走跟「連線印表機」按鈕（printer-settings.js 的 connectPrinter）同一套配對流程，
 * 配對成功後接著印——之後這台裝置再開同一個 kiosk 網址，attemptSilentPrinterReconnect 會直接接上，
 * 不用再點第二次。
 * printFn：連線成功後要呼叫的靜默列印函式（回傳跟 printSilently 一樣的 outcome 物件）。
 */
function showKioskConnectButton(printFn) {
    pendingConnectPrint = printFn;
    let button = els["kiosk-connect-print"];
    if (!button) {
        button = document.createElement("button");
        button.id = "kiosk-connect-print";
        button.type = "button";
        button.className = "ts-button is-primary";
        button.textContent = "連線印表機並列印";
        mountStageElement(button); // 同 showStageNotice，掛在工作區外面
        button.addEventListener("click", async () => {
            button.disabled = true;
            await connectPrinter();
            if (!state.usbConnected && !state.serialConnected) {
                button.disabled = false; // 使用者取消選擇裝置或連線失敗，留著讓人可以再點一次
                return;
            }
            button.hidden = true;
            const outcome = await pendingConnectPrint();
            reportPrintOutcome(outcome);
            if (outcome.ok && outcome.issues.length) showKioskNotice(outcome.issues.join("；"));
            else if (!outcome.ok && outcome.reason === "print-failed") showKioskNotice(describePrintFailure(outcome));
        });
        els["kiosk-connect-print"] = button;
    }
    button.hidden = false;
    button.disabled = false;
}

// printSilently() 多頁列印中途失敗時，把是第幾頁失敗一併講清楚——使用者才知道前面幾頁已經印出來了，
// 不是「整份都沒印到」，也知道要從哪一頁開始補印。
function describePrintFailure(outcome) {
    const pageInfo = outcome.totalPages > 1 ? `第 ${outcome.failedPageIndex + 1}/${outcome.totalPages} 頁「${outcome.pageName || ""}」` : "";
    return `自動列印失敗：${pageInfo}${pageInfo ? "，" : ""}${describePrinterError(outcome.error)}，請改用列印鍵`;
}

// parentOrigin= 沒給就用 document.referrer 的 origin 當預設（iframe 嵌入時瀏覽器會自動帶，
// 除非父頁面設了 Referrer-Policy 擋掉）；兩者都沒有就回傳 null，這個 kiosk session 整組不動作。
// 跟 isAllowedTemplateUrl 不同的是這裡允許跨源——父視窗本來就大多是別的網站（例如 chunghsingshashin）。
function resolveParentOrigin(params) {
    const explicit = params.get("parentOrigin");
    if (explicit) {
        try {
            const origin = new URL(explicit).origin;
            if (origin && origin !== "null") return origin;
        } catch {
            /* 格式不對就當沒給，往下看 referrer */
        }
    }
    if (document.referrer) {
        try {
            return new URL(document.referrer).origin;
        } catch {
            return null;
        }
    }
    return null;
}

// 回報工單狀態給父視窗；沒有 reportTargetOrigin（沒帶 parentOrigin 也讀不到 referrer）或根本沒被
// iframe 嵌入就整個跳過，不會用 "*" 亂猜目標，避免姓名／留言等工單內容送到不明頁面。
function reportJobStatus(status, extra = {}) {
    if (window.parent === window || !reportTargetOrigin) return;
    window.parent.postMessage({ source: "printan-kiosk", jobId: currentJobId, status, ...extra }, reportTargetOrigin);
}

// printSilently() 的回傳結果轉成對外回報用的狀態；describePrintFailure 沿用既有的中文訊息組法，
// 不再另外維護一套回報專用文案。
function reportPrintOutcome(outcome) {
    if (outcome.ok) {
        reportJobStatus("printed", { issues: outcome.issues });
        return;
    }
    if (outcome.reason === "print-failed") {
        reportJobStatus("print_failed", {
            message: describePrintFailure(outcome),
            failedPageIndex: outcome.failedPageIndex,
            totalPages: outcome.totalPages,
            pageName: outcome.pageName,
        });
        return;
    }
    reportJobStatus("print_failed", { message: describePrinterError(outcome.error) });
}

// tpl= 只接受同源網址：印表機是實體輸出，風險不算高，但沒必要開放任意第三方網址當範本來源。
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
        showKioskNotice("範本網址不允許（僅接受同源網址）");
        return null;
    }
    let text;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
    } catch {
        showKioskNotice("範本讀取失敗，請確認網址是否正確");
        return null;
    }
    const result = loadProject(text);
    if (!result.ok) {
        showKioskNotice("範本內容有誤，無法開啟");
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

/** 把 submit-job 送來的 data 套進 state.previewData，只收範本裡實際用到的變數名稱。 */
function applyVariablesFromData(data, project) {
    // 變數要掃全部頁面，不是只有第一頁：kiosk 送來的變數值要能填到任何一頁用到的 placeholder。
    const names = new Set(extractPlaceholders(project.template.pages.flatMap((p) => p.elements)));
    for (const [key, value] of Object.entries(data)) {
        if (RESERVED_PARAMS.has(key) || !names.has(key)) continue;
        state.previewData[key] = value;
    }
}

// 收到 submit-job 就觸發一次（單一範本模式）：已授權裝置就直接印，沒有就顯示候補配對按鈕；
// 不論哪種結果都回報。
async function runAutoprintFlow() {
    await attemptSilentPrinterReconnect();
    if (state.usbConnected || state.serialConnected) {
        const outcome = await printSilently();
        reportPrintOutcome(outcome);
        if (outcome.ok && outcome.issues.length) showKioskNotice(outcome.issues.join("；"));
        else if (!outcome.ok && outcome.reason === "print-failed") showKioskNotice(describePrintFailure(outcome));
    } else {
        // 沒有已授權裝置：WebUSB／Serial 規格要求跳選擇窗一定要使用者手勢，做不到全自動，
        // 顯示候補配對按鈕讓人點一次；工具列被 .is-kiosk 隱藏，原本的列印鍵點不到。
        reportJobStatus("needs_connect");
        showKioskConnectButton(printSilently);
    }
}

/**
 * 多範本模式（tpl= 給了逗號分隔的多個網址）：把 submit-job 送來的同一份 data 分別套到每一份
 * 範本，用 compose.js renderProjects() 由上而下拼成一張畫布，再靜默送印（printer-settings.js
 * printComposedSilently）。不經過單一專案的編輯器 state，也不呼叫 schedulePreview——kiosk 頁面
 * 本來就是被父視窗（例如 chunghsingshashin 的「kiosk 控制台」後台頁）藏在看不到的 iframe 裡，
 * 沒有需要顯示畫面預覽的對象，跟單一範本模式（會把範本載進編輯器、有機會被看到）不一樣。
 * 不套用 applyVariablesFromData／state.previewData 過濾：data 直接整包傳給 renderProjects，
 * merge.js applyDataToElements 本身只會替換範本裡真的用到的 {{var}}，沒用到的鍵值直接忽略，
 * 不需要先篩過（也代表多個區塊剛好同名變數時兩邊會吃到同一個值，不是錯誤，是預期行為）。
 */
async function composeAndPrint(projects, data, gapDots) {
    const composed = await renderProjects(
        projects.map((project) => ({ project, data })),
        { gapDots, options: { mode: "thermal", profile: getEffectiveProfile(projects[0]) } },
    );
    return printComposedSilently(composed, projects[0]);
}

async function runMultiAutoprintFlow(projects, data, gapDots) {
    const printFn = () => composeAndPrint(projects, data, gapDots);
    await attemptSilentPrinterReconnect();
    if (state.usbConnected || state.serialConnected) {
        const outcome = await printFn();
        reportPrintOutcome(outcome);
        if (outcome.ok && outcome.issues.length) showKioskNotice(outcome.issues.join("；"));
        else if (!outcome.ok && outcome.reason === "print-failed") showKioskNotice(describePrintFailure(outcome));
    } else {
        reportJobStatus("needs_connect");
        showKioskConnectButton(printFn);
    }
}

/**
 * 讀網址 query string，有 tpl= 就切換成 kiosk 流程；沒有就什麼都不做（一般編輯器行為不受影響）。
 * 要在 editor.js 的 init() 完成一般初始化（含靜默重連印表機）之後呼叫，回傳是否進了 kiosk 流程。
 * loadProjectIntoEditor／schedulePreview 由呼叫端（editor.js）傳進來，避免這個檔案反過來 import
 * editor.js 造成循環依賴。
 *
 * tpl= 可以是單一網址（沿用原本行為：載入編輯器、有畫面預覽），也可以是逗號分隔的多個網址
 * （多範本模式，見 runMultiAutoprintFlow：不進編輯器、不預覽，收到資料直接合成＋送印）。
 */
export async function bootKioskFromQuery(loadProjectIntoEditor, schedulePreview) {
    const params = new URLSearchParams(location.search);
    // kiosk=1 要獨立於 tpl= 判斷式之外先套用：外部網站嵌入 iframe 時 tpl= 若漏帶或載入失敗，
    // 沒有這行畫面會整個回退成可編輯的完整編輯器（工具列、大綱、印表機連線都在），嵌入方等於
    // 意外把整個 app 暴露出去，不是預期中乾淨的列印預覽。
    if (params.get("kiosk") === "1") document.documentElement.classList.add(KIOSK_CLASS);

    const tplParam = params.get("tpl");
    if (!tplParam) return false;

    // origin 要在讀範本之前先算出來：範本讀取失敗（網址錯、範本內容壞掉、同源檢查沒過……）
    // 也要能回報給父視窗，不然父視窗只會看到「一直沒收到 ready」，完全不知道是什麼問題、
    // 也無從在自己的畫面上顯示錯誤原因給現場人員看——只能盯著 iframe 裡那行小提示字。
    currentJobId = params.get("jobId") || null;
    reportTargetOrigin = resolveParentOrigin(params);

    const tplUrls = tplParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (!tplUrls.length) return true;
    const isMulti = tplUrls.length > 1;
    const gapDots = Math.max(0, Number(params.get("gapDots")) || 0);

    const projects = [];
    for (const url of tplUrls) {
        const project = await loadTemplateFromUrl(url);
        if (!project) {
            // 任一份讀取失敗就整個中止，維持 kiosk 外觀顯示錯誤提示，不退回一般編輯畫面；
            // 同時盡量回報給父視窗（沒有 reportTargetOrigin 就跟以前一樣完全不動作）。
            reportJobStatus("load_failed", { message: `範本載入失敗：${url}` });
            return true;
        }
        projects.push(project);
    }

    if (!isMulti) {
        loadProjectIntoEditor(projects[0]);
        schedulePreview();
        // 範本載入完成才顯示畫布：kiosk 剛開啟、範本還沒到之前，畫面上不該先出現一張空白的紙，
        // 看起來像沒填內容的編輯區。多範本模式本來就不進編輯器、不預覽，這個 class 也就不會加。
        if (document.documentElement.classList.contains(KIOSK_CLASS)) {
            document.documentElement.classList.add(KIOSK_PREVIEW_CLASS);
        }
    }

    if (!reportTargetOrigin) {
        // 判斷不出安全的父視窗 origin：既沒有 parentOrigin 也讀不到 referrer，沒有可信任的對象
        // 可以送資料進來，這個 kiosk session 就只顯示範本本身，不會有任何 postMessage 動作。
        return true;
    }

    // 唯一的資料輸入管道：父視窗收到 ready 之後送 submit-job 帶變數值進來，套用完立刻觸發列印。
    // 嚴格比對 event.origin／event.source，其餘一律忽略。
    window.addEventListener("message", (event) => {
        if (event.origin !== reportTargetOrigin || event.source !== window.parent) return;
        const msg = event.data;
        if (!msg || msg.type !== "printan:submit-job") return;
        if (msg.jobId) currentJobId = msg.jobId;
        const data = msg.data && typeof msg.data === "object" ? msg.data : {};
        if (isMulti) {
            void runMultiAutoprintFlow(projects, data, gapDots);
            return;
        }
        // 每筆 submit-job 都是獨立工單，先清空再套用新資料：同一個 iframe 連續處理第二筆工單時，
        // 如果這筆沒帶到跟上一筆一樣的變數名稱（例如少了 photoB），不能讓上一位客人的舊值殘留、
        // 印到這一份收據上。
        state.previewData = {};
        applyVariablesFromData(data, projects[0]);
        schedulePreview();
        void runAutoprintFlow();
    });
    reportJobStatus("ready");
    return true;
}
