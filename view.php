<!DOCTYPE html>
<html lang="zh-tw" class="is-rounded">

<?php
// 計算此應用展開後的 URL 基準路徑（例： /koilisu/apps/printan）
$appBasePath = rtrim(str_replace($_SERVER['DOCUMENT_ROOT'], '', __DIR__), '/\\');
$appBasePath = str_replace('\\', '/', $appBasePath);
$appConfig = require __DIR__ . '/config.php';
$appVersion = $appConfig['version'] ?? '0.0.0';
?>

<head>
    <meta charset="UTF-8">
    <title>Printan 單仔 - KoiLiSu | prjToka</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tocas-ui/5.7.0/tocas.min.css"
        integrity="sha512-F4xj0Qcc6/jwQjpN70mZP1F5edUVg/WbWEYqUu1FEnvZFAg5IxvBAlNgji+6547uhPtaO14HmBdMhsZ19fHVSw=="
        crossorigin="anonymous">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/tocas-ui/5.7.0/tocas.min.js"
        integrity="sha512-nzuAF7sDvUg8SagRIjY6B5mXfwuMW/3fOU/LITsIukL7PVzfN1srR+2GSfqYr53gRkq8B2y0Sb7Z66ZRMmtxdg=="
        crossorigin="anonymous"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js"></script>
    <!-- cdnjs 上的 qrcode-generator 套件實際上沒有檔案（打開會 404／ORB 擋下且無 console 錯誤，很難察覺），改用 jsdelivr 直接讀 npm 套件內容 -->
    <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode_UTF8.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.12.3/JsBarcode.all.min.js"></script>
    <link rel="stylesheet" href="<?= $appBasePath ?>/css/editor.css">
</head>

<body class="is-rounded">
    <div class="main-content">
        <div class="ts-container is-fluid has-vertically-padded">

            <div class="ts-grid is-middle-aligned">
                <div class="column is-fluid">
                    <div class="ts-header is-heavy is-large is-start-icon">
                        <span class="ts-icon is-receipt-icon" aria-hidden="true"></span>
                        Printan 單仔
                        <span class="app-version">v<?= htmlspecialchars($appVersion) ?></span>
                    </div>
                    <div class="ts-text is-description">熱感紙收據／標籤設計與預覽工具，所見即所印。</div>
                </div>
                <div class="column">
                    <span id="save-status" class="ts-text is-description is-small"></span>
                </div>
                <div class="column">
                    <button type="button" class="ts-button is-small is-outlined is-icon" id="btn-help"
                        data-tooltip="使用說明" aria-label="使用說明">
                        <span class="ts-icon is-circle-question-icon" aria-hidden="true"></span>
                    </button>
                </div>
            </div>

            <div class="ts-divider has-vertically-spaced"></div>

            <div id="toolbar" class="pane-toolbar" role="toolbar" aria-label="編輯工具">
                <!-- 左：檔案／版型操作（新增、開啟、匯出）；右：紙張與印表機輸出操作（紙寬、
                     列印設定、列印）。兩組用途不同（前者管版型檔案，後者管實體輸出），分兩側
                     排列比全部擠在一起好找。 -->
                <div class="ts-buttons">
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-new-ptan"
                        data-tooltip="新增空白版型（目前版型會留在「最近編輯」清單，不會遺失）">
                        <span class="ts-icon is-file-circle-plus-icon" aria-hidden="true"></span> 新增
                    </button>
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-open-ptan"
                        data-dropdown="open-project-dropdown" aria-haspopup="true">
                        <span class="ts-icon is-folder-open-icon" aria-hidden="true"></span> 開啟
                    </button>
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-export-menu"
                        data-dropdown="export-dropdown" aria-haspopup="true">
                        <span class="ts-icon is-download-icon" aria-hidden="true"></span> 匯出
                    </button>
                </div>
                <span class="toolbar-spacer"></span>
                <!-- 印表機連線、走紙／切紙、可列印點數、測試列印都歸在同一顆「列印設定」按鈕底下同一個 modal 裡。
                     紙寬（80/58mm）編輯時常常切換，維持獨立的快速開關，不塞進 modal
                     （ESC/POS 也沒有標準指令能讀回印表機目前的紙寬，不做自動偵測）。
                     印表機型號不開放使用者選，內部固定用預設規格（見 printer-profiles.js）。 -->
                <div class="ts-selection is-small" id="paper-width-tabs" role="radiogroup" aria-label="紙寬"></div>
                <div class="ts-divider is-vertical toolbar-divider"></div>
                <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-settings"
                    data-tooltip="列印設定（印表機連線、走紙／切紙、可列印點數、測試列印）" aria-label="列印設定">
                    <span class="ts-icon is-gear-icon" aria-hidden="true"></span>
                    列印設定
                    <span class="printer-conn-dot is-on" id="printer-toolbar-dot" aria-hidden="true" hidden></span>
                </button>
                <button class="ts-button is-small is-primary is-start-icon" id="btn-print">
                    <span class="ts-icon is-print-icon" aria-hidden="true"></span> 列印
                </button>
            </div>

            <!-- 多欄比例選單（放在 toolbar 外，避免干擾方向鍵巡覽，同 pitrace 慣例） -->
            <div class="ts-dropdown" id="row-ratio-dropdown">
                <a class="item" data-ratio="1,1" id="row-ratio-1-1">1 / 1</a>
                <a class="item" data-ratio="2,1" id="row-ratio-2-1">2 / 1</a>
                <a class="item" data-ratio="1,2" id="row-ratio-1-2">1 / 2</a>
                <a class="item" data-ratio="1,1,1" id="row-ratio-1-1-1">1 / 1 / 1</a>
            </div>

            <!-- 開啟：本機 .ptan 檔案，或最近編輯過、還沒手動匯出的版型（存在瀏覽器 IndexedDB
                 草稿裡）。清單由 populateRecentDrafts() 動態產生，見「新增」按鈕的說明：
                 新增空白版型不會刪掉舊的，舊版型會留在這份清單裡可以再打開。 -->
            <div class="ts-dropdown" id="open-project-dropdown">
                <a class="item" id="open-project-from-file">
                    <span class="ts-icon is-folder-open-icon" aria-hidden="true"></span> 從電腦開啟 .ptan 檔…
                </a>
                <div class="divider"></div>
                <div class="header">最近編輯</div>
                <div id="recent-drafts-list"></div>
            </div>

            <div class="ts-dropdown" id="export-dropdown">
                <a class="item" id="btn-save-ptan">
                    <span class="ts-icon is-download-icon" aria-hidden="true"></span> 匯出 .ptan
                </a>
                <div class="item" id="export-embed-fonts-row">
                    <label class="ts-checkbox is-small">
                        <input type="checkbox" id="export-embed-fonts">
                        <div class="text">內嵌字體</div>
                    </label>
                    <span class="info-icon" tabindex="0" role="img" aria-label="僅開源字體，檔案會變大" data-tooltip="僅開源字體，檔案會變大"><span class="ts-icon is-circle-info-icon" aria-hidden="true"></span></span>
                </div>
                <a class="item" id="btn-export-pdf">
                    <span class="ts-icon is-file-pdf-icon" aria-hidden="true"></span> 匯出 PDF
                </a>
            </div>

            <!-- 列印設定：一個 modal 由上到下四區——連線（最上面、最明顯）→ 列印設定（走紙／切紙／可列印點數）
                 → 印表機資訊（唯讀）→ 測試與診斷。「機器讀到的」與「預設／手動覆寫」的值用來源 badge
                 （.src-badge）區分，見 editor.js sourceBadge()。 -->
            <dialog id="printer-settings-dialog" class="ts-modal">
                <div class="content">
                    <div class="ts-content">
                        <div class="ts-header is-start-icon">
                            <span class="ts-icon is-gear-icon" aria-hidden="true"></span>
                            列印設定
                        </div>
                    </div>
                    <div class="ts-divider"></div>
                    <!-- 連線區塊：連接印表機是這個 modal 的主要動作。總狀態 badge 放大，未連接時用紅底最醒目，
                         已連接改綠燈；同一時間只會有一條連線（USB／序列埠二選一，已連接時方式選項鎖住）。 -->
                    <div class="ts-content">
                        <div class="ts-wrap is-middle-aligned is-relaxed">
                            <div class="ts-text is-label">印表機連線</div>
                            <span class="ts-badge is-large is-negative" id="printer-conn-badge" role="status">
                                <span class="printer-conn-dot" aria-hidden="true"></span><span id="printer-conn-badge-text">未連接</span>
                            </span>
                        </div>
                        <div class="has-top-spaced-small"></div>
                        <div class="ts-selection is-small" id="printer-connect-method" role="radiogroup" aria-label="連接方式">
                            <label class="item">
                                <input type="radio" name="printer-connect-method" value="usb">
                                <div class="text">USB（WebUSB）</div>
                            </label>
                            <label class="item">
                                <input type="radio" name="printer-connect-method" value="serial">
                                <div class="text">序列埠（RS-232 / Web Serial）</div>
                            </label>
                        </div>
                        <div id="printer-connection-unsupported" class="ts-text is-negative has-top-spaced-small" hidden></div>
                        <div class="ts-text is-description has-top-spaced-small" id="printer-connection-status">尚未連接</div>
                        <!-- 傳輸速率只有序列埠需要，選 USB 時不顯示 -->
                        <div id="printer-serial-options" hidden>
                            <div class="has-top-spaced-small"></div>
                            <label class="ts-text is-label" for="pref-serial-baud-rate">傳輸速率（baud rate）</label>
                            <div class="ts-input is-small is-fluid has-top-spaced-small">
                                <input type="number" id="pref-serial-baud-rate" min="1200" max="115200" step="1" value="9600">
                            </div>
                        </div>
                        <div class="has-top-spaced-small"></div>
                        <button type="button" class="ts-button is-primary is-start-icon" id="btn-printer-connect">
                            <span class="ts-icon is-plug-icon" aria-hidden="true"></span> 連接印表機
                        </button>
                        <button type="button" class="ts-button is-outlined is-start-icon" id="btn-printer-disconnect" hidden>
                            <span class="ts-icon is-plug-circle-xmark-icon" aria-hidden="true"></span> 中斷連接
                        </button>
                    </div>
                    <div class="ts-divider"></div>
                    <div class="ts-content">
                        <div class="ts-text is-label">列印設定</div>
                        <div class="ts-text is-description is-small has-top-spaced-small">
                            以下設定只在 USB／序列埠直連時套用，走系統列印對話框時不受影響。
                        </div>
                        <div class="has-top-spaced-small"></div>
                        <label class="ts-text is-label" for="pref-feed-lines">切紙前走紙行數</label>
                        <div class="ts-input is-small is-fluid has-top-spaced-small">
                            <input type="number" id="pref-feed-lines" min="0" max="20" value="4">
                        </div>
                        <!-- 內容由 updateFeedLinesHint() 依目前印表機規格動態填入，見 editor.js -->
                        <div class="ts-text is-description is-small has-top-spaced-small" id="pref-feed-lines-hint"></div>
                        <label class="ts-checkbox has-top-spaced">
                            <input type="checkbox" id="pref-cut-paper">
                            <div class="text">列印後自動切紙</div>
                        </label>
                        <div class="has-top-spaced"></div>
                        <div class="ts-text is-label">可列印點數（依紙寬）</div>
                        <div class="ts-text is-description is-small has-top-spaced-small">
                            ESC/POS 讀不到印表機的可列印寬度，預設用內建規格的值；別牌印表機的點數可能不同
                            （例如 58 mm 機常見 384 點），請依印表機規格書填寫（範圍 64–1024），留空＝使用預設。
                            列印頭最大寬度取所有紙寬中最大的點數，列印內容會置中補白到這個寬度再送出。
                        </div>
                        <div class="has-top-spaced-small"></div>
                        <!-- 每個紙寬一列輸入框，由 renderPrintableDotsRows() 產生，見 editor.js -->
                        <div id="printer-dots-list"></div>
                        <div class="has-top-spaced-small"></div>
                        <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-dots-reset">
                            <span class="ts-icon is-rotate-left-icon" aria-hidden="true"></span> 還原預設點數
                        </button>
                        <div class="has-top-spaced"></div>
                        <div class="ts-text is-label">邊距校正</div>
                        <div class="has-top-spaced-small"></div>
                        <!-- 每個紙寬一列（左／右留白 mm），由 renderMarginRows() 產生，見 editor.js -->
                        <div id="printer-margin-list"></div>
                        <div class="has-top-spaced-small"></div>
                        <div class="ts-wrap">
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-margin-reset">
                                <span class="ts-icon is-rotate-left-icon" aria-hidden="true"></span> 重設
                            </button>
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-margin-sheet">
                                <span class="ts-icon is-ruler-icon" aria-hidden="true"></span> 校正紙
                            </button>
                        </div>
                    </div>
                    <div class="ts-divider"></div>
                    <!-- 印表機資訊（唯讀）：連線後盡量用機器讀到的（WebUSB 裝置名稱、GS I 回傳的廠牌／型號／韌體）；
                         規格資料（DPI、紙寬、切刀距離）來自內建規格，比對不到已知型號就標示「無法辨識，使用預設值」。
                         各列內容由 updatePrinterInfo() 填入，見 editor.js。 -->
                    <div class="ts-content">
                        <div class="ts-text is-label">印表機資訊</div>
                        <div class="has-top-spaced-small"></div>
                        <table class="ts-table is-definition is-small" id="printer-info-table">
                            <tbody>
                                <tr><td>連接的印表機</td><td id="printer-info-device">—</td></tr>
                                <tr><td>韌體版本</td><td id="printer-info-firmware">—</td></tr>
                                <tr><td>規格資料</td><td id="printer-info-spec">—</td></tr>
                                <tr><td>解析度</td><td id="printer-info-dpi">—</td></tr>
                                <tr><td>目前紙寬</td><td id="printer-info-paper">—</td></tr>
                                <tr><td>可列印寬度</td><td id="printer-info-printable">—</td></tr>
                                <tr><td>切刀距離</td><td id="printer-info-blade">—</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="ts-divider"></div>
                    <!-- 測試列印：套用目前走紙／切紙偏好印一小段測試圖樣，不用印整張收據就能校正
                         走紙行數／切紙位置；查詢狀態：即時查詢連線／紙張感應器（DLE EOT），兩者都
                         需要 USB 或序列埠其中一個已連接，走系統列印對話框時無法使用。
                         忘記已授權裝置：清掉瀏覽器記住的授權，換印表機或想重新選擇裝置時用。 -->
                    <div class="ts-content">
                        <div class="ts-text is-label">測試與診斷</div>
                        <div class="ts-text is-description has-top-spaced-small">
                            測試列印與查詢狀態需要先連接印表機才能使用。
                        </div>
                        <div class="has-top-spaced-small"></div>
                        <div class="ts-wrap">
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-test-print">
                                <span class="ts-icon is-ruler-icon" aria-hidden="true"></span> 測試列印
                            </button>
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-query-status">
                                <span class="ts-icon is-circle-info-icon" aria-hidden="true"></span> 查詢印表機狀態
                            </button>
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-forget">
                                <span class="ts-icon is-eraser-icon" aria-hidden="true"></span> 忘記已授權裝置
                            </button>
                        </div>
                        <!-- 內容由 queryPrinterStatus() 動態填入，見 editor.js -->
                        <div class="ts-text is-description is-small has-top-spaced-small" id="printer-status-result"></div>
                    </div>
                    <div class="ts-divider"></div>
                    <div class="ts-content">
                        <div class="ts-wrap is-end-aligned">
                            <button type="button" class="ts-button" id="btn-printer-settings-close">關閉</button>
                        </div>
                    </div>
                </div>
            </dialog>

            <div class="ts-divider has-vertically-spaced-small"></div>

            <div class="editor-shell" id="editorShell">
                <aside class="editor-list" id="outlineSidebar" aria-label="版面結構">
                    <div class="ts-box is-rounded">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-list-icon" aria-hidden="true"></span>
                                <span>版面結構</span>
                            </span>
                            <button type="button" id="btn-outline-add" class="ts-button is-icon is-ghost is-small"
                                aria-label="新增元素" aria-haspopup="menu" aria-expanded="false" data-tooltip="新增元素">
                                <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="ts-content is-padded">
                            <div id="outline-list" class="outline-list"></div>
                        </div>
                    </div>
                </aside>

                <div class="col-resizer" id="colResizerLeft" role="separator" aria-orientation="vertical"
                    aria-label="調整版面結構欄寬" tabindex="0" data-tooltip="拖曳調整欄寬（方向鍵微調、雙擊重設）">
                    <span class="ts-icon is-grip-lines-vertical-icon" aria-hidden="true"></span>
                </div>

                <div class="editor-canvas-pane" id="canvasPane">
                    <div class="ts-box is-rounded paper-viewport" id="paper-viewport">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-receipt-icon" aria-hidden="true"></span>
                                <span>工作區</span>
                            </span>
                            <div class="pane-header-toggle-buttons pane-zoom-controls" role="group" aria-label="縮放">
                                <button class="ts-button is-icon is-ghost" id="btn-zoom-out"
                                    data-tooltip="縮小" aria-label="縮小">
                                    <span class="ts-icon is-minus-icon" aria-hidden="true"></span>
                                </button>
                                <span class="pane-zoom-value" id="zoom-value" aria-live="polite">100%</span>
                                <button class="ts-button is-icon is-ghost" id="btn-zoom-in"
                                    data-tooltip="放大" aria-label="放大">
                                    <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                                </button>
                                <button class="ts-button is-small is-ghost" id="btn-zoom-fit">符合寬度</button>
                                <button class="ts-button is-small is-ghost" id="btn-zoom-actual"
                                    data-tooltip="實際大小">1:1</button>
                            </div>
                            <div class="pane-header-toggle-buttons">
                                <button class="ts-button is-icon is-ghost" id="btn-toggle-rulers"
                                    data-tooltip="尺規" aria-label="尺規" aria-pressed="true">
                                    <span class="ts-icon is-ruler-combined-icon" aria-hidden="true"></span>
                                </button>
                                <button class="ts-button is-icon is-ghost" id="btn-toggle-thermal"
                                    data-tooltip="切換熱感輸出預覽" aria-label="切換熱感輸出預覽" aria-pressed="false">
                                    <span class="ts-icon is-circle-half-stroke-icon" aria-hidden="true"></span>
                                </button>
                                <button class="ts-button is-icon is-ghost" id="btn-toggle-preview-mode"
                                    data-tooltip="切換編輯／預覽模式" aria-label="切換編輯／預覽模式" aria-pressed="false">
                                    <span class="ts-icon is-eye-icon" aria-hidden="true"></span>
                                </button>
                            </div>
                        </div>
                        <div class="paper-viewport-stage">
                            <div class="paper-ruler-corner" id="ruler-corner" aria-hidden="true"></div>
                            <div class="paper-ruler is-horizontal" id="ruler-h" aria-hidden="true"><canvas></canvas></div>
                            <div class="paper-ruler is-vertical" id="ruler-v" aria-hidden="true"><canvas></canvas></div>
                            <div class="paper-viewport-body" id="paper-scroll">
                                <div class="paper-shadow" id="paper-shadow">
                                    <div class="safe-area-guide" id="safe-area-guide"></div>
                                    <div id="canvas-host" class="canvas-host"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 浮動工具列：快速新增元素，比照 koilisu/apps/pitrace 的
                         .canvas-floating-toolbar。元素設定仍在右側「元素設定」面板，
                         這裡只放「新增」這類畫布層級的快速操作。
                         data-collapse-priority：容器窄到放不下整排按鈕時，依數字由小到大
                         把整顆按鈕收進最後的「更多工具」選單（不是壓縮/裁切），同 pitrace
                         wireToolbarOverflow()。數字愈小愈先被收，「新增文字」最常用留到最後。 -->
                    <div class="canvas-floating-toolbar pane-toolbar" role="toolbar" aria-label="新增元素">
                        <button type="button" class="ts-button is-start-icon" id="btn-toolbar-add"
                            aria-haspopup="menu" aria-expanded="false">
                            <span class="ts-icon is-plus-icon" aria-hidden="true"></span> 新增
                        </button>
                        <div class="ts-divider is-vertical toolbar-divider"></div>
                        <button class="ts-button is-icon" id="btn-add-text" data-tooltip="新增文字"
                            aria-label="新增文字" data-collapse-priority="6">
                            <span class="ts-icon is-font-icon" aria-hidden="true"></span>
                        </button>
                        <button class="ts-button is-icon" id="btn-add-image" data-tooltip="新增圖片"
                            aria-label="新增圖片" data-collapse-priority="5">
                            <span class="ts-icon is-image-icon" aria-hidden="true"></span>
                        </button>
                        <button class="ts-button is-icon" id="btn-add-spacer" data-tooltip="新增間隔"
                            aria-label="新增間隔" data-collapse-priority="2">
                            <span class="ts-icon is-arrows-up-down-icon" aria-hidden="true"></span>
                        </button>
                        <button class="ts-button is-icon" id="btn-add-divider" data-tooltip="新增分隔線"
                            aria-label="新增分隔線" data-collapse-priority="4">
                            <span class="ts-icon is-minus-icon" aria-hidden="true"></span>
                        </button>
                        <button class="ts-button is-icon" id="btn-add-barcode" data-tooltip="新增條碼／QR Code"
                            aria-label="新增條碼／QR Code" data-collapse-priority="3">
                            <span class="ts-icon is-qrcode-icon" aria-hidden="true"></span>
                        </button>
                        <div class="ts-divider is-vertical toolbar-divider" data-collapse-priority="1"></div>
                        <button type="button" class="ts-button is-icon" data-dropdown="row-ratio-dropdown"
                            data-tooltip="多欄" aria-label="多欄" aria-haspopup="true" data-collapse-priority="1">
                            <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                        </button>

                        <!-- 容器寬度不夠同時放下所有按鈕時，依上面標的 data-collapse-priority
                             由小到大依序把整顆按鈕收進這個選單，可見按鈕永遠維持原始大小，
                             不需要橫向捲動工具列才找得到——比照 Figma 窄寬度工具列的做法，
                             同 koilisu/apps/pitrace。JS 邏輯見 editor.js wireToolbarOverflow()。 -->
                        <div class="pane-menu-wrap" id="toolbarOverflowWrap" hidden>
                            <button type="button" id="btnToolbarOverflow" class="ts-button is-icon is-ghost"
                                aria-label="更多工具" aria-haspopup="menu" aria-expanded="false"
                                data-tooltip="更多工具">
                                <span class="ts-icon is-ellipsis-vertical-icon" aria-hidden="true"></span>
                            </button>
                            <div class="ts-menu is-dense is-small is-separated pane-dropdown-menu"
                                id="toolbarOverflowMenu" role="menu" aria-label="更多工具" hidden>
                                <button type="button" class="item" role="menuitem" id="overflowRatio11" hidden>
                                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                                    <span>多欄：1 / 1</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowRatio21" hidden>
                                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                                    <span>多欄：2 / 1</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowRatio12" hidden>
                                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                                    <span>多欄：1 / 2</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowRatio111" hidden>
                                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                                    <span>多欄：1 / 1 / 1</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddSpacer" hidden>
                                    <span class="ts-icon is-arrows-up-down-icon" aria-hidden="true"></span>
                                    <span>新增間隔</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddBarcode" hidden>
                                    <span class="ts-icon is-qrcode-icon" aria-hidden="true"></span>
                                    <span>新增條碼／QR Code</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddDivider" hidden>
                                    <span class="ts-icon is-minus-icon" aria-hidden="true"></span>
                                    <span>新增分隔線</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddImage" hidden>
                                    <span class="ts-icon is-image-icon" aria-hidden="true"></span>
                                    <span>新增圖片</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddText" hidden>
                                    <span class="ts-icon is-font-icon" aria-hidden="true"></span>
                                    <span>新增文字</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-resizer" id="colResizerRight" role="separator" aria-orientation="vertical"
                    aria-label="調整元素設定欄寬" tabindex="0" data-tooltip="拖曳調整欄寬（方向鍵微調、雙擊重設）">
                    <span class="ts-icon is-grip-lines-vertical-icon" aria-hidden="true"></span>
                </div>

                <aside class="editor-dock" id="inspectorDock" aria-label="元素設定與批次資料">
                    <div class="ts-box is-rounded">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-sliders-icon" aria-hidden="true"></span>
                                <span>元素設定</span>
                            </span>
                        </div>
                        <div class="ts-content is-padded" id="inspector">
                            <div class="pane-empty-state-static">
                                <span class="ts-icon is-sliders-icon is-heading" aria-hidden="true"></span>
                                <div class="ts-text is-description">尚未選取元素</div>
                            </div>
                        </div>
                    </div>

                    <div class="ts-space" id="variables-card-spacer" hidden></div>

                    <div class="ts-box is-rounded" id="variables-card" hidden>
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-list-check-icon" aria-hidden="true"></span>
                                <span>變數與預覽資料</span>
                            </span>
                        </div>
                        <div class="ts-content is-padded">
                            <div id="variables-panel"></div>
                        </div>
                    </div>

                    <div class="ts-space" id="batch-card-spacer" hidden></div>

                    <div class="ts-box is-rounded" id="batch-card" hidden>
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-clipboard-list-icon" aria-hidden="true"></span>
                                <span>批次資料（Mail Merge）</span>
                            </span>
                            <button type="button" class="ts-button is-icon is-ghost pane-collapse-toggle"
                                id="batch-panel-toggle" aria-expanded="false" aria-controls="batch-panel-body"
                                aria-label="展開／收合批次資料面板" data-tooltip="展開／收合">
                                <span class="ts-icon is-chevron-down-icon" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="ts-content is-padded" id="batch-panel-body" hidden>
                            <div class="ts-input is-small is-fluid">
                                <textarea id="batch-data" class="batch-data-textarea" rows="5"
                                    placeholder='[{"name":"手工餅乾","price":"120"}]'></textarea>
                            </div>
                            <div class="ts-space is-small"></div>
                            <div class="ts-buttons is-fluid">
                                <button class="ts-button is-small is-outlined is-start-icon" id="btn-preview-batch">
                                    <span class="ts-icon is-eye-icon" aria-hidden="true"></span> 預覽批次資料
                                </button>
                                <button class="ts-button is-small is-outlined is-start-icon" id="btn-export-batch-pdf">
                                    <span class="ts-icon is-file-pdf-icon" aria-hidden="true"></span> 匯出 PDF
                                </button>
                            </div>

                            <div id="batch-preview-nav" class="pane-toolbar has-top-spaced-small" hidden>
                                <div class="ts-divider has-bottom-spaced-small batch-nav-divider"></div>
                                <button type="button" class="ts-button is-icon is-small is-ghost" id="btn-batch-prev" aria-label="上一筆">
                                    <span class="ts-icon is-chevron-left-icon" aria-hidden="true"></span>
                                </button>
                                <span class="ts-text is-description" id="batch-preview-counter">第 1 / 1 筆</span>
                                <button type="button" class="ts-button is-icon is-small is-ghost" id="btn-batch-next" aria-label="下一筆">
                                    <span class="ts-icon is-chevron-right-icon" aria-hidden="true"></span>
                                </button>
                                <span class="toolbar-spacer"></span>
                                <button type="button" class="ts-button is-small is-text" id="btn-batch-end-preview">結束預覽</button>
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    </div>

    <!-- 使用說明：完整說明集中在這裡，頁面上其他地方只留欄位名稱＋必要時的 ⓘ 短提示。
         分頁切換見 ui-helpers.js wireHelpDialog()。 -->
    <dialog id="help-dialog" class="ts-modal is-large">
        <div class="content">
            <div class="ts-content">
                <div class="ts-header is-start-icon">
                    <span class="ts-icon is-circle-question-icon" aria-hidden="true"></span>
                    使用說明
                </div>
            </div>
            <div class="ts-tab is-dense is-segmented help-tabs" role="tablist">
                <a class="item" role="tab" data-help-tab="basic">基本操作</a>
                <a class="item" role="tab" data-help-tab="layout">版面元素</a>
                <a class="item" role="tab" data-help-tab="text">文字樣式</a>
                <a class="item" role="tab" data-help-tab="variables">文字與變數</a>
                <a class="item" role="tab" data-help-tab="fonts">字體</a>
                <a class="item" role="tab" data-help-tab="barcode">條碼</a>
                <a class="item" role="tab" data-help-tab="print">列印與校正</a>
                <a class="item" role="tab" data-help-tab="shortcuts">快捷鍵</a>
            </div>
            <div class="ts-content help-body">
                <div data-help-panel="basic">
                    <ul class="help-list">
                        <li>用工作區下方的工具列，或左側「版面結構」的「＋」新增元素；點選元素後到右側「元素設定」調整。</li>
                        <li>在工作區拖曳元素外框可調整順序；拖曳間隔、圖片、條碼的下緣調整高度，拖曳欄與欄之間的把手調整欄寬。</li>
                        <li>已選取的文字再點一次，可直接在紙上編輯；點紙外空白處取消選取。</li>
                        <li>工作區標題列可縮放與開關尺規；「1:1」是實際大小。虛線標出可列印範圍與切刀安全線。</li>
                        <li>版型自動存在這台電腦的瀏覽器；「匯出」可存成 .ptan 檔或 PDF。</li>
                    </ul>
                </div>
                <div data-help-panel="layout" hidden>
                    <ul class="help-list">
                        <li>「版面結構」列出所有元素。「最上層」與「第 N 欄」是容器，點選後新元素會加到那裡。</li>
                        <li>元素有文字、圖片、間隔（空白高度）、分隔線、條碼、多欄。</li>
                        <li>多欄可選 1/1、2/1、1/2、1/1/1 的欄寬比例，欄內可再放任何元素。</li>
                        <li>同層元素可用列上的上移／下移，或在工作區拖曳排序；在「版面結構」拖曳列可換層，放到「最上層」「第 N 欄」列上就移進該容器。</li>
                    </ul>
                </div>
                <div data-help-panel="text" hidden>
                    <ul class="help-list">
                        <li>在紙上或「元素設定」的文字框選取一段字，再套用粗體、斜體、底線、刪除線、反白（黑底白字）。</li>
                        <li>選取範圍可各自設定字體與字級（dot）；沒選取時設定的是整個文字元素的預設值。</li>
                        <li>對齊（靠左／置中／靠右）是整個文字元素的設定。</li>
                    </ul>
                </div>
                <div data-help-panel="variables" hidden>
                    <ul class="help-list">
                        <li>文字、圖片來源、條碼內容可寫 <code>{{名稱}}</code>，列印時換成實際資料。</li>
                        <li>「變數與預覽資料」會列出用到的變數，填入測試值即可在工作區預覽。</li>
                        <li>「批次資料」貼上 JSON 陣列，每筆資料輸出一頁 PDF（Mail Merge）。</li>
                    </ul>
                </div>
                <div data-help-panel="fonts" hidden>
                    <ul class="help-list">
                        <li>文字可選內建字體、等寬字體，或授權後使用本機字體。</li>
                        <li>.ptan 預設只記錄字體名稱；匯出時勾選「內嵌字體」，會帶入用到的等寬開源字體（只含用到的字，檔案會變大），換電腦也能照樣顯示。本機字體因授權不會內嵌，換電腦需自行安裝。</li>
                        <li>網頁字體沒載入成功時，預覽與列印會改用系統字體，並在工作區上方提示。</li>
                    </ul>
                </div>
                <div data-help-panel="barcode" hidden>
                    <ul class="help-list">
                        <li>支援 QR Code、Code128、EAN-13；內容可含 <code>{{變數}}</code>。</li>
                        <li>一維條碼可切換是否顯示明碼。</li>
                        <li>內容格式不符時會在「元素設定」提示；含變數的內容要套用資料後才會檢查。</li>
                    </ul>
                </div>
                <div data-help-panel="print" hidden>
                    <ul class="help-list">
                        <li>「列印設定」可連接印表機（USB 或序列埠，需 Chrome／Edge），並設定走紙、切紙、可列印點數、邊距校正。</li>
                        <li>直連印表機才有邊距校正；未連接時「列印」走系統列印對話框。</li>
                        <li>系統列印與 PDF 只能縮窄可列印寬度，沒有左側補白，邊距校正對它們無效。</li>
                        <li>邊距校正：按「校正紙」印出量尺，量出左右實際留白（mm）填入該紙寬的兩格；兩格都填才生效，清空即不校正。</li>
                        <li>測試列印可確認走紙與切紙位置；切紙前走紙不夠，切刀會切到剛印完的內容。</li>
                        <li>熱感圖示切換為 1-bit 抖動預覽，接近實際列印效果。</li>
                    </ul>
                </div>
                <div data-help-panel="shortcuts" hidden>
                    <ul class="help-list">
                        <li><kbd>Delete</kbd>：刪除選取的元素。</li>
                        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd>：復原；<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 或 <kbd>Ctrl</kbd>+<kbd>Y</kbd>：重做。</li>
                        <li><kbd>Ctrl</kbd>+<kbd>D</kbd>：複製一份到下方；<kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd>：複製、貼上。</li>
                        <li><kbd>↑</kbd> <kbd>↓</kbd>：選取上一個／下一個元素；加 <kbd>Alt</kbd> 或 <kbd>Ctrl</kbd> 則移動它的順序。</li>
                        <li><kbd>Shift</kbd> 點選（同一層內）或在空白處拖曳框選：多選，右側可一起改共同欄位，Delete、Ctrl+D、方向鍵、復原都套用到全部。</li>
                        <li><kbd>Ctrl</kbd>+<kbd>G</kbd>：把選取的元素組成群組，可整體選取與拖曳；<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>：解散群組。</li>
                        <li><kbd>Esc</kbd>：取消選取、關閉選單或結束紙上的文字編輯。</li>
                        <li>欄寬拉桿：方向鍵微調，雙擊重設。</li>
                    </ul>
                </div>
            </div>
            <div class="ts-divider"></div>
            <div class="ts-content">
                <div class="ts-wrap is-end-aligned">
                    <button type="button" class="ts-button" id="btn-help-close">關閉</button>
                </div>
            </div>
        </div>
    </dialog>

    <!-- 開利手底部 -->
    <div id="app-footer" class="ts-content is-secondary is-vertically-padded">
        <div class="ts-container is-fluid">
            <div class="ts-grid">
                <div class="column is-fluid">
                    <div class="ts-text is-description">
                        <a href="/koilisu/" class="footer-plain-link">KoiLiSu 開利手</a> -
                        讓工具使用更順手的開放專案 | prjToka
                    </div>
                    <div class="ts-text is-description">
                        Built with ❤️ using Tocas UI |
                        <a href="https://github.com/zisunny104/printan" target="_blank" rel="noopener noreferrer" class="footer-github-badge">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                            </svg>
                            View on GitHub<span class="sr-only"> (在新視窗開啟)</span>
                        </a>
                    </div>
                </div>
                <div class="column is-end-aligned">
                    <div class="ts-selection is-circular is-compact" role="radiogroup" aria-label="佈景主題切換">
                        <label class="item">
                            <input type="radio" name="theme" value="light" id="theme-light">
                            <div class="text">淺色</div>
                        </label>
                        <label class="item">
                            <input checked type="radio" name="theme" value="system" id="theme-system">
                            <div class="text">系統</div>
                        </label>
                        <label class="item">
                            <input type="radio" name="theme" value="dark" id="theme-dark">
                            <div class="text">深色</div>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // 深淺色模式功能
        function setTheme(theme) {
            document.body.className = theme === 'system'
                ? 'is-rounded'
                : `is-rounded is-${theme}`;

            const secure = location.protocol === 'https:' ? '; Secure' : '';
            document.cookie = `preferred-theme=${theme}; path=/; max-age=31536000; SameSite=Lax${secure}`; // 1 year
        }

        function getPreferredTheme() {
            const cookies = document.cookie.split(';');
            for (let cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'preferred-theme') {
                    return value;
                }
            }
            return 'system';
        }

        document.addEventListener('DOMContentLoaded', function () {
            const preferredTheme = getPreferredTheme();
            const themeRadio = document.getElementById(`theme-${preferredTheme}`);
            if (themeRadio) {
                themeRadio.checked = true;
                setTheme(preferredTheme);
            }
        });

        document.getElementById('theme-light').addEventListener('change', function () {
            if (this.checked) setTheme('light');
        });
        document.getElementById('theme-dark').addEventListener('change', function () {
            if (this.checked) setTheme('dark');
        });
        document.getElementById('theme-system').addEventListener('change', function () {
            if (this.checked) setTheme('system');
        });
    </script>

    <input type="file" id="image-file-input" accept="image/*" hidden>
    <input type="file" id="ptan-file-input" accept=".ptan,application/json" hidden>

    <script type="module" src="<?= $appBasePath ?>/js/editor/editor.js"></script>
</body>

</html>
