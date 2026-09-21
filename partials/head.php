<?php defined('PRINTAN_VIEW') || exit; ?>
<head>
    <meta charset="UTF-8">
    <title>Printan 單仔 - KoiLiSu | prjToka</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- CSP：只允許本站與用到的兩個 CDN；內嵌 theme-script 與 Tocas／Canvas 動態樣式需要 unsafe-inline，圖片放行 data:／blob:（畫布轉出、列印預覽）與 https:（批次資料的圖片網址），HEIC 轉檔（自行託管的 libheif wasm，在 same-origin worker 內執行）只需要 wasm-unsafe-eval，不放行 eval。 -->
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; font-src 'self' data: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; connect-src 'self' https://cdn.jsdelivr.net; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tocas-ui/5.7.0/tocas.min.css"
        integrity="sha512-F4xj0Qcc6/jwQjpN70mZP1F5edUVg/WbWEYqUu1FEnvZFAg5IxvBAlNgji+6547uhPtaO14HmBdMhsZ19fHVSw=="
        crossorigin="anonymous">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/tocas-ui/5.7.0/tocas.min.js"
        integrity="sha512-nzuAF7sDvUg8SagRIjY6B5mXfwuMW/3fOU/LITsIukL7PVzfN1srR+2GSfqYr53gRkq8B2y0Sb7Z66ZRMmtxdg=="
        crossorigin="anonymous"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js"
        integrity="sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg=="
        crossorigin="anonymous" defer></script>
    <!-- cdnjs 上的 qrcode-generator 套件實際上沒有檔案（打開會 404／ORB 擋下且無 console 錯誤，很難察覺），改用 jsdelivr 直接讀 npm 套件內容 -->
    <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"
        integrity="sha512-2BJF/j/2TII7JcHAPMIT74wLQ8BTk5NqeGAC5ypeSKLa6V96abAl86gvcsrU2etaN4fttehQtcxXXAriYXlDCg=="
        crossorigin="anonymous" defer></script>
    <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode_UTF8.js"
        integrity="sha512-KVY6a8I3VlMmJFe6rYFDdqyhNqKDMccyydi6pSE7G6iGR7Hqozi1Yde8iD1/KYBJNbct4iWa+4eN0dVSvqH2zg=="
        crossorigin="anonymous" defer></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.12.3/JsBarcode.all.min.js"
        integrity="sha512-nMnXAGKzA0wZ4YsriudrdnAKSFYXwdCvSt1Auwz6q7XXtSRoRcMVud13Q1LnQnobA2hRhLtHUv9tbVR5pyStPw=="
        crossorigin="anonymous" defer></script>
    <link rel="stylesheet" href="<?= htmlspecialchars($appBasePath) ?>/css/editor.css">
</head>
