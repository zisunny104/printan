# 待辦

## 需實機／使用者決定
- [ ] 實機驗證 GS L／ESC a／GS I 在不同機型的行為
- [ ] 非 Epson USB 印表機相容性（WebUSB filter、指令集差異）
- [ ] 1:1 顯示比例實體尺寸驗證（96 CSS px = 1 inch）
- [ ] 測試列印新版（專案收據）實機外觀
- [ ] 觸控裝置（pointer:coarse）：大綱列 40px 目標、圖片／欄寬把手命中區，只用視窗縮放＋計算樣式檢查過，未真機驗證
- [ ] 螢幕閱讀器實際朗讀、Windows 高對比模式：只做過 Tab 順序、焦點外框與對比度計算，未實測

## 進行中
- [ ] 圖文段落（site-b3，最小版：單圖靠左／右＋橫書文字）：渲染、檢視器、畫布把手、測試、說明書已提交，實機列印與各紙寬繞排外觀待驗證
- [ ] 文字直書（site-b3）：writingMode／renderer 直排／檢視器切換已提交（1～3/3）。多段落（多欄）總寬度超出框寬時會被靜默裁掉的問題已修（layoutVerticalText 補上 widthClipped 偵測，編輯疊層會提示），其餘版面細節與實機列印待驗證

## 已知但未處理
- [ ] editor.js 仍有 674 行：已拆出 context／inspector-widgets／inspector／printer-settings／outline／batch-export／element-actions／canvas-overlay／workspace-view，是否再拆待評估

## 低優先
- [ ] （選用）實機驗證邊距校正與校正紙（640 點寬資料機器是否吃），含 80mm 邊距校正流程：左右不對稱為印表機機構限制，使用者已接受；邊距校正只用於補固定偏差，非必要
- [ ] 58mm 紙寬置中假設（commit 23ea7ab）尚未實機驗證（使用者確認紙寬固定 80mm）
