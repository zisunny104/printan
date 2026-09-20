# 待辦

## 需實機／使用者決定
- [ ] 實機驗證邊距校正與校正紙（640 點寬資料機器是否吃），含 80mm 邊距校正流程
- [ ] 實機驗證 GS L／ESC a／GS I 在不同機型的行為
- [ ] 非 Epson USB 印表機相容性（WebUSB filter、指令集差異）
- [ ] 1:1 顯示比例實體尺寸驗證（96 CSS px = 1 inch）
- [ ] 58mm 紙寬置中假設（commit 23ea7ab）尚未實機驗證
- [ ] 測試列印新版（專案收據）實機外觀
- [ ] 觸控裝置（pointer:coarse）：大綱列 40px 目標、圖片／欄寬把手命中區，只用視窗縮放＋計算樣式檢查過，未真機驗證
- [ ] 文繞圖：待使用者決定是否做

## 進行中
- [ ] 文字直書（site-b3）：writingMode／renderer 直排／檢視器切換已提交（1～3/3），版面細節與實機列印待驗證

## 已知但未處理
- [ ] editor.js 仍偏大：已拆出 context／inspector-widgets／inspector／printer-settings，剩 outline／add menu／canvas overlay／batch export／model actions／toolbar

## 無法處理
- 系統列印／PDF 的左邊補白：由驅動程式控制，只能縮窄寬度（已寫進說明書）
