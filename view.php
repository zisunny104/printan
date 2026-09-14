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
    <link rel="stylesheet" href="<?= $appBasePath ?>/css/editor.css">
</head>

<body>
    <div class="ts-content">
        <div class="ts-container" style="max-width:1400px">

            <div class="ts-grid is-middle-aligned">
                <div class="column is-fluid">
                    <div class="ts-header is-big is-heavy is-start-icon">
                        <span class="ts-icon is-receipt-icon" aria-hidden="true"></span>
                        Printan 單仔
                        <span style="font-size:0.875rem;color:var(--ts-gray-500);font-weight:normal;margin-left:0.5rem;">v<?= htmlspecialchars($appVersion) ?></span>
                    </div>
                    <div class="ts-text is-description">熱感紙收據／標籤設計與預覽工具，所見即所印。</div>
                </div>
                <div class="column">
                    <span id="save-status" class="ts-text is-description is-small"></span>
                </div>
            </div>

            <div class="ts-divider has-vertically-spaced"></div>

            <div id="toolbar" class="pane-toolbar" role="toolbar" aria-label="編輯工具">
                <div class="ts-select is-small">
                    <select id="printer-profile-select" aria-label="印表機規格"></select>
                </div>
                <div class="ts-selection is-small" id="paper-width-tabs" role="radiogroup" aria-label="紙寬"></div>
                <div class="ts-divider is-vertical" style="height:1.4em"></div>
                <div class="ts-buttons">
                    <button class="ts-button is-small is-outlined is-start-icon" id="btn-add-text">
                        <span class="ts-icon is-font-icon" aria-hidden="true"></span> 文字
                    </button>
                    <button class="ts-button is-small is-outlined is-start-icon" id="btn-add-image">
                        <span class="ts-icon is-image-icon" aria-hidden="true"></span> 圖片
                    </button>
                    <button class="ts-button is-small is-outlined is-start-icon" id="btn-add-spacer">
                        <span class="ts-icon is-arrows-up-down-icon" aria-hidden="true"></span> 間隔
                    </button>
                    <button class="ts-button is-small is-outlined is-start-icon" id="btn-add-divider">
                        <span class="ts-icon is-minus-icon" aria-hidden="true"></span> 分隔線
                    </button>
                </div>
                <button class="ts-button is-small is-outlined is-start-icon" data-dropdown="row-ratio-dropdown">
                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span> 多欄
                </button>
                <div class="ts-divider is-vertical" style="height:1.4em"></div>
                <div class="ts-buttons">
                    <button class="ts-button is-small is-icon is-ghost" id="btn-toggle-thermal"
                        data-tooltip="切換熱感輸出預覽" aria-label="切換熱感輸出預覽" aria-pressed="false">
                        <span class="ts-icon is-circle-half-stroke-icon" aria-hidden="true"></span>
                    </button>
                    <button class="ts-button is-small is-icon is-ghost" id="btn-toggle-preview-mode"
                        data-tooltip="切換編輯／預覽模式" aria-label="切換編輯／預覽模式" aria-pressed="false">
                        <span class="ts-icon is-eye-icon" aria-hidden="true"></span>
                    </button>
                </div>
                <span class="toolbar-spacer"></span>
                <div class="ts-buttons">
                    <button class="ts-button is-small is-outlined is-start-icon" id="btn-open-ptan">
                        <span class="ts-icon is-folder-open-icon" aria-hidden="true"></span> 開啟
                    </button>
                    <button class="ts-button is-small is-outlined is-start-icon" id="btn-save-ptan">
                        <span class="ts-icon is-download-icon" aria-hidden="true"></span> 匯出 .ptan
                    </button>
                    <button class="ts-button is-small is-outlined is-start-icon" id="btn-export-pdf">
                        <span class="ts-icon is-file-pdf-icon" aria-hidden="true"></span> 匯出 PDF
                    </button>
                </div>
                <button class="ts-button is-small is-primary is-start-icon" id="btn-print">
                    <span class="ts-icon is-print-icon" aria-hidden="true"></span> 列印
                </button>
            </div>

            <!-- 多欄比例選單（放在 toolbar 外，避免干擾方向鍵巡覽，同 pitrace 慣例） -->
            <div class="ts-dropdown" id="row-ratio-dropdown">
                <a class="item" data-ratio="1,1">1 / 1</a>
                <a class="item" data-ratio="2,1">2 / 1</a>
                <a class="item" data-ratio="1,2">1 / 2</a>
                <a class="item" data-ratio="1,1,1">1 / 1 / 1</a>
            </div>

            <div class="ts-divider has-vertically-spaced-small"></div>

            <div class="ts-grid mobile:is-stacked" style="--gap:1.25rem">
                <div class="column mobile:is-16-wide tablet+:is-4-wide">
                    <div class="ts-box is-rounded">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-list-icon" aria-hidden="true"></span>
                                <span>版面結構</span>
                            </span>
                        </div>
                        <div class="ts-content is-padded">
                            <div id="outline-list" class="outline-list"></div>
                        </div>
                    </div>
                </div>

                <div class="column mobile:is-16-wide tablet+:is-8-wide">
                    <div class="ts-box is-rounded paper-viewport" id="paper-viewport">
                        <div class="paper-shadow" id="paper-shadow">
                            <div class="safe-area-guide" id="safe-area-guide"></div>
                            <div id="canvas-host" class="canvas-host"></div>
                        </div>
                    </div>
                </div>

                <div class="column mobile:is-16-wide tablet+:is-4-wide">
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
                                <div class="ts-text is-description">請先在左側版面結構中選取一個元素</div>
                            </div>
                        </div>
                    </div>

                    <div class="ts-space"></div>

                    <div class="ts-box is-rounded">
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

                    <div class="ts-space"></div>

                    <div class="ts-box is-rounded">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-clipboard-list-icon" aria-hidden="true"></span>
                                <span>批次資料（Mail Merge）</span>
                            </span>
                        </div>
                        <div class="ts-content is-padded">
                            <div class="ts-input is-small is-fluid">
                                <textarea id="batch-data" class="batch-data-textarea" rows="5"
                                    placeholder='[{"name":"手工餅乾","price":"120"}]'></textarea>
                            </div>
                            <div class="ts-space is-small"></div>
                            <button class="ts-button is-small is-fluid is-outlined is-start-icon" id="btn-export-batch-pdf">
                                <span class="ts-icon is-file-pdf-icon" aria-hidden="true"></span> 套用批次資料匯出 PDF
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <input type="file" id="image-file-input" accept="image/*" hidden>
    <input type="file" id="ptan-file-input" accept=".ptan,application/json" hidden>

    <script type="module" src="<?= $appBasePath ?>/js/editor/editor.js"></script>
</body>

</html>
