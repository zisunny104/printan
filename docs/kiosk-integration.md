# Kiosk 模式串接說明

給要把 printan 嵌進自己專案（例如某個測驗網站、報到系統）的開發者看：怎麼用 iframe 嵌入
printan、指定範本、送資料、拿到列印結果。不限定特定專案，任何網站都可以照這份文件串接。

實作在 [`js/editor/kiosk.js`](../js/editor/kiosk.js)，這份文件是它的使用說明；程式碼本身的
註解更完整，有疑問以程式碼為準。

## 概念

你（父視窗）把 printan 嵌在一個 `<iframe>` 裡，網址帶上要用哪個範本；printan 載入完範本後，
你透過 `postMessage` 把這次要印的資料（姓名、留言、照片網址…）送進去，printan 套用資料、
自動列印，印完再透過 `postMessage` 把結果（印好了／印失敗／還沒接印表機）回報給你。

一次 iframe 載入對應一份範本；同一個 iframe 可以連續送多筆 `submit-job` 處理多筆工單，不需要
每筆都重新載入整個頁面（但要重新載入也可以，各自獨立）。

## 1. 用 iframe 載入

```html
<iframe src="https://your-printan-host/?tpl=https%3A%2F%2Fyour-printan-host%2Ftemplates%2Freceipt.ptan&kiosk=1&jobId=job-001&parentOrigin=https%3A%2F%2Fyour-site.example"></iframe>
```

query 參數（其餘一律忽略，姓名／留言／照片網址等資料**不要**塞在網址列，改用下面的 postMessage）：

| 參數 | 必要 | 說明 |
| --- | --- | --- |
| `tpl` | 是 | `.ptan` 範本檔的網址，**限同源**（跟 printan 本身同一個 origin），避免任意第三方網址被當範本讀取 |
| `kiosk` | 建議帶 `1` | 隱藏編輯器工具列／大綱／檢視器等介面，畫面看起來不像編輯器 |
| `jobId` | 選填 | 這次工單的識別碼初始值，之後 `submit-job` 訊息裡的 `jobId` 會覆蓋它；純粹讓你在回報訊息裡認出是哪一筆 |
| `parentOrigin` | 建議帶 | 你自己網站的 origin（例如 `https://your-site.example`），printan 只信任這個來源送來的訊息，也只送 postMessage 給這個來源。**沒帶這個參數時，printan 會退而用 `document.referrer` 的 origin**；兩者都判斷不出來，postMessage 功能整組不會動作（只會顯示範本本身，不會有任何資料或回報） |

## 2. 等 `ready`，送 `submit-job`

範本載入完成後，printan 會送：

```json
{ "source": "printan-kiosk", "jobId": "job-001", "status": "ready" }
```

收到之後，送這次要印的資料進去：

```js
iframeEl.contentWindow.postMessage(
  {
    type: "printan:submit-job",
    jobId: "job-001",
    data: {
      name: "王小明",
      note: "生日快樂！",
      photoA: "https://your-site.example/uploads/abc.jpg",
      photoB: "https://your-site.example/uploads/def.jpg",
    },
  },
  "https://your-printan-host" // targetOrigin：printan 這個頁面的 origin
);
```

- `data` 的鍵要跟範本裡用到的 `{{變數名稱}}` 對應：文字變數（如 `name`、`note`）直接代換文字；
  圖片變數（如 `photoA`）是圖片元素的 assetId 用 `{{var}}` 佔位，值要填一個**`https://` 開頭**
  的圖片網址（`http://`、`data:` 以外的其他 scheme 都不會被接受，見 `renderer.js` 的
  `resolveImage`）；跟你的網站要同源或有正確的 CORS 設定，不然圖片載入會失敗被略過。
- `data` 裡沒對到範本變數名稱的鍵會被忽略，不會報錯。
- printan 只接受 `event.origin` 等於 `parentOrigin`、`event.source` 是自己的父視窗的訊息，其餘
  一律忽略——不用擔心其他分頁或第三方腳本亂塞資料進來。
- 收到 `submit-job` 後 printan 會**自動觸發列印**，不需要另外的「開始列印」指令。

## 3. 收列印結果回報

printan 送出以下其中一種：

```json
{ "source": "printan-kiosk", "jobId": "job-001", "status": "printed", "issues": [] }
```
```json
{ "source": "printan-kiosk", "jobId": "job-001", "status": "print_failed", "message": "...", "failedPageIndex": 0, "totalPages": 1, "pageName": "第一頁" }
```
```json
{ "source": "printan-kiosk", "jobId": "job-001", "status": "needs_connect" }
```

- **`printed`**：印出來了。`issues` 是非致命的提示（例如某張圖片載入失敗被略過，其他部分照印），
  可能是空陣列。
- **`print_failed`**：印表機已連線但實際列印失敗（斷線、印表機回報錯誤等），`message` 是可以直接
  顯示的中文說明，多頁時會附上失敗在第幾頁。
- **`needs_connect`**：還沒有已授權的印表機裝置。WebUSB／Serial 規格要求選擇裝置一定要使用者
  手勢，程式沒辦法自動跳過，畫面上會出現一顆「連線印表機並列印」按鈕，需要現場有人手動點一次
  配對；配對成功後這個瀏覽器之後再開同一個 kiosk 網址就會自動重連，不用再點第二次。這個狀態
  之後還會再收到一次 `printed` 或 `print_failed`（配對完成、實際印完之後）。

在父視窗這邊監聽：

```js
window.addEventListener("message", (event) => {
  if (event.origin !== "https://your-printan-host") return;
  if (event.data?.source !== "printan-kiosk") return;
  const { jobId, status } = event.data;
  // 依 jobId 找到對應的工單，更新它的狀態
});
```

## 已知限制

- 每一筆 `submit-job` 都是獨立工單：收到新的一筆會先清空上一筆的變數值再套用，不會殘留（例如
  這筆沒帶 `photoB`，畫面上不會留著上一位客人的 `photoB`）。可以對同一個已經印完的 iframe
  連續送下一筆 `submit-job`，不用每筆都重新指派 `iframe.src`。
- `jobId`／`parentOrigin` 若剛好跟範本裡的變數同名會被當保留字吃掉，這種邊角案例不特別處理。
- 這是破壞性 API（沒有向後相容舊版純 query string 塞資料的方式）；如果你串接的是舊版 printan，
  請先確認部署的版本已經包含這個變更。
