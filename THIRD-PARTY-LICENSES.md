# 第三方元件 · Third-Party Components

本授權（MIT）僅涵蓋本專案的程式碼本身，以下元件另有不同來源與條款：

## 隨程式碼一起發佈 · Bundled with the source

- JetBrains Mono 字型：SIL Open Font License 1.1，詳見 `licenses/JetBrainsMono-OFL.txt`。
- libheif（HEIC/HEIF 圖片解碼，WASM）：函式庫本體為 LGPL-3.0，範例程式與語言綁定為 MIT，
  詳見 `vendor/libheif/LICENSE-libheif.txt`（LGPL-3.0）與 `vendor/libheif/LICENSE-libheif-js.txt`（MIT）。
  使用方式：以原始未修改的WASM函式庫動態載入，未對libheif原始碼做任何修改，已隨附完整授權條款文字。
