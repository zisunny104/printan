// 編輯器各模組共用的狀態與 DOM 節點快取。

import { WebSerialEscposAdapter, WebUsbEscposAdapter } from "../core/printer-adapter.js";

export const LAST_DRAFT_KEY = "printan:lastDraftId";

export const state = {
    project: null,
    selectedId: null,
    multi: [], // 多選時的全部 id（同一層內，含 selectedId）；單選時是空陣列
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
    printPrefs: { feedLines: 4, cutPaper: true, serialBaudRate: 9600, connectMethod: "usb", printableDots: {}, margins: {} }, // 走紙／切紙／序列傳輸速率／上次選的連接方式／各紙寬「可列印點數」覆寫（{ 紙寬id: 點數 }，空物件＝全用內建規格值）／各紙寬左右邊距校正（{ 紙寬id: { leftMm, rightMm } }，空物件＝不校正）偏好，跟印表機連線一樣是本機操作習慣，不進 .ptan 文件；切紙預設開啟（大多數熱感印表機使用情境都希望列印完直接切下來）。
    // feedLines 預設 4（2026-09 實機驗證：0 會切到內容尾端、4 不會）：印表機規格檔的
    // autocutter.bladeOffsetMm（切刀跟列印頭之間固定的實體距離）不是自動切紙機構自己會走的，
    // 是「切紙前」需要應用程式自己走紙走過這段距離，走不夠切刀就會切在剛印完、還沒通過
    // 切刀位置的內容上，見 updateFeedLinesHint()。
};

export const usbAdapter = new WebUsbEscposAdapter(); // 整個編輯器共用同一個連線實例

export const serialAdapter = new WebSerialEscposAdapter(); // 跟 usbAdapter 一樣整個編輯器共用同一個連線實例

export const BATCH_PANEL_EXPANDED_KEY = "printan-batch-panel-expanded";

export const PRINT_PREFS_KEY = "printan:printPrefs";

export const els = {}; // 快取常用 DOM 節點

// 跨模組共用、會被重新指派的變數（ES module 的 let 不能被別的檔案改寫，所以放在物件屬性）
export const rt = {
    lastRenderResult: null, // 最近一次渲染結果（含排版 items 樹），供編輯疊層與模式切換重繪使用
    imageFileInputHandler: null, // null＝新增一個圖片元素；有值＝把選到的 assetId 交給這個 callback（例如更換既有元素的圖片）
    pendingReveal: null, // 新增元素後要捲動到／進入編輯的目標 { id, edit }
};
