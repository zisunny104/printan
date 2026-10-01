本專案的版面渲染、熱感模擬（灰階／抖動）、`.ptan` 讀寫等核心邏輯皆為原生實作。
下列第三方元件不受上方 MIT 授權約束，各依其原授權條款。

#### 隨本 repo 散布 · Redistributed in this repo (unmodified)

| 元件 Component | 路徑 Path | 用途 Purpose | 授權 License |
|---|---|---|---|
| libheif-js 1.23.2 | `vendor/libheif/` | HEIC／HEIF 解碼 decoding | LGPL-3.0 |
| Sarasa Mono TC | `fonts/sarasa-mono-tc/` | 內建字型 bundled font | SIL OFL 1.1 |

libheif 以獨立檔案自行託管、未與 printan 程式碼合併，使用者可自行替換；授權全文見
`vendor/libheif/LICENSE-libheif-js.txt`、`LICENSE-libheif.txt`。Sarasa Mono TC 為子集
化的 woff2 分片，授權全文見 `fonts/sarasa-mono-tc/LICENSE.txt`。

#### 由瀏覽器自 CDN 載入 · Loaded at runtime from a CDN (not redistributed here)

| 元件 Component | 用途 Purpose | 授權 License |
|---|---|---|
| Tocas UI | 介面框架 UI shell | MIT |
| jsPDF | PDF 匯出 PDF export | MIT |
| JsBarcode | 一維條碼 Barcode | MIT |
| qrcode-generator | QR Code | MIT |
| JetBrains Mono | 等寬字型 Monospace font | SIL OFL 1.1 |

Tocas UI 內含 Font Awesome Free 圖示（Icons CC BY 4.0 / Fonts SIL OFL 1.1 / Code MIT）。
JetBrains Mono 經由 jsDelivr 的 @fontsource 套件載入。
