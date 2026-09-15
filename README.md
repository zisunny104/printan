# Printan 單仔

> 熱感紙收據／標籤設計與預覽工具，所見即所印。

隸屬 [KoiLiSu 開利手](https://github.com/zisunny104/koilisu) 專案家族的一員。

## 功能特色

- **版面編輯器**：文字、圖片、間隔、分隔線、多欄（Row/Column，欄寬可自訂比例，不限兩欄）
- **熱感紙精確預覽**：所有內容（文字、線條、圖片）統一以 Canvas 點陣繪製，可切換「熱感輸出預覽」套用灰階＋Floyd–Steinberg 誤差擴散抖動，還原真實 1-bit 熱感輸出效果，而非只是螢幕顯示色
- **佔位變數／Mail Merge**：文字或圖片來源可用 `{{變數名稱}}`，貼上一組 JSON 陣列即可一次套用多筆資料，批次匯出多頁 PDF（一筆資料一頁）
- **印表機規格檔（Printer Profile）**：目前內建 Epson TM-T82II（203 DPI，80mm／58mm 雙紙寬），規格資料與版面邏輯完全分離，之後新增機型不需要更動核心程式
- **點（dot）為單位的內部座標系統**：對應印表機 DPI，紙寬切換不需要重建專案；欄寬採相對比例，同一份版型可以直接套用到不同紙寬
- **`.ptan` 專案檔**：版本化 JSON 格式，可匯出／匯入，未來格式升級有 migration 機制
- **本機自動儲存**：編輯中的草稿存在瀏覽器 IndexedDB，不會佔用 `.ptan` 正式匯出的角色
- **PDF 匯出**：依熱感紙實際寬度與內容高度產生頁面尺寸，不會被硬塞進 A4
- **列印**：可透過瀏覽器原生列印對話框（`window.print()`）走系統已安裝的印表機驅動，也可用 WebUSB 直接連線印表機送出 ESC/POS 點陣指令（Chrome/Edge），依環境自動偵測可用連線方式
- **條碼／QR Code 元素**：可插入 QR Code、Code128、EAN-13，內容支援 `{{變數}}`，一維條碼可切換是否顯示明碼
- **Renderer Core 可獨立嵌入**：[js/core/renderer.js](js/core/renderer.js) 是不依賴編輯器狀態、不依賴 UI 框架的 ES module，其他網頁專案可以直接 `import` 使用同一套版面／熱感模擬邏輯

## 使用方式

1. 選擇印表機規格與紙寬（工具列左側）
2. 從工具列新增文字／圖片／間隔／分隔線／多欄，點選左側「版面結構」項目可選取或指定插入位置
3. 於右側「元素設定」編輯選取元素的內容與樣式；文字或圖片來源可輸入 `{{變數名稱}}`
4. 「變數與預覽資料」會自動列出目前用到的變數，可直接填入預覽用的測試值
5. 點擊熱感圖示切換「熱感輸出預覽」，確認實際列印效果
6. 於「批次資料」貼上 JSON 陣列即可用「套用批次資料匯出 PDF」一次輸出多筆（Mail Merge）
7. 完成後可「匯出 .ptan」保存版型，或直接「匯出 PDF」／「列印」

## 技術規格

- **前端框架**：Tocas UI 5.7
- **執行環境**：PHP 頁面殼 + 原生 ES6 模組（無建置工具、無 Node.js 依賴）
- **版面渲染**：Canvas 2D，1 canvas pixel = 1 個印表機實體點，螢幕預覽／PDF／未來 ESC/POS 點陣輸出共用同一份渲染邏輯
- **PDF 匯出**：jsPDF，頁面尺寸依實際紙寬與內容高度動態決定
- **本機儲存**：IndexedDB（草稿／圖片），localStorage 只存「最近使用」等輕量 metadata
- **專案檔格式**：`.ptan`，版本化 JSON

## 安裝

### 獨立使用

1. Clone repo：
```bash
git clone https://github.com/zisunny104/printan.git
cd printan
```

2. 配置網頁伺服器（需支援 PHP）

3. 直接訪問 `index.php`

### 與 KoiLiSu 開利手整合

1. 將此 repo 放置在 `koilisu/apps/printan/` 目錄
2. 透過 `https://toka.dev/koilisu/printan` 造訪

## 已知限制與後續規劃

此版本為第一階段可完整操作的雛型，以下項目列為後續階段：

- WebSerial／WebBluetooth 印表機連線（目前已支援 WebUSB 直連）
- CSV／外部 API 作為批次資料來源（目前僅支援貼上 JSON）
- Shape／Table／Icon 元素
- 新增其他印表機規格檔（Printer Profile 架構已預留擴充空間）

## 使用的開源函式庫

- [Tocas UI](https://tocas-ui.com/) - MIT License
- [MaterialDesign-Webfont](https://materialdesignicons.com/) - Apache-2.0 License（圖示）
- [jsPDF](https://github.com/parallax/jsPDF) - MIT License

版面渲染、熱感模擬（灰階／抖動）、`.ptan` 讀寫等核心邏輯皆為原生實作。

## 授權

此專案為 [KoiLiSu 開利手](https://github.com/zisunny104/koilisu) 專案的一部分，MIT 授權，由 Tokas (Xiang-zi Xie) 開發。詳見 [LICENSE](LICENSE)。

---

**版本**：0.1.0
**作者**：Tokas (Xiang-zi Xie)
**專案**：KoiLiSu 開利手
**網址**：https://toka.dev/koilisu/printan
