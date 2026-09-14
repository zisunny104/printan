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
                    <button class="ts-button is-small is-icon is-ghost" id="btn-printer-settings"
                        data-tooltip="印表機設定" aria-label="印表機設定">
                        <span class="ts-icon is-gear-icon" aria-hidden="true"></span>
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

            <!-- 印表機設定：WebUSB 直連 + 走紙／切紙偏好，跟編輯器本體一樣是本機操作習慣 -->
            <dialog id="printer-settings-dialog" class="ts-modal">
                <div class="content">
                    <div class="ts-content">
                        <div class="ts-header is-start-icon">
                            <span class="ts-icon is-gear-icon" aria-hidden="true"></span>
                            印表機設定
                        </div>
                        <div class="ts-text is-description has-top-spaced-small">
                            設定完成且已連接時，工具列的「列印」會直接送出 ESC/POS 指令給印表機，不再跳出系統列印對話框。
                        </div>
                    </div>
                    <div class="ts-divider"></div>
                    <div class="ts-content">
                        <div class="ts-text is-label">USB 連線</div>
                        <div id="printer-webusb-unsupported" class="ts-text is-negative has-top-spaced-small" hidden>
                            此瀏覽器不支援 WebUSB，請改用 Chrome 或 Edge，或繼續使用系統列印對話框。
                        </div>
                        <div class="ts-text is-description has-top-spaced-small" id="printer-connection-status">尚未連接</div>
                        <div class="ts-space is-small"></div>
                        <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-connect">
                            <span class="ts-icon is-plug-icon" aria-hidden="true"></span> 連接印表機
                        </button>
                        <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-disconnect" hidden>
                            <span class="ts-icon is-plug-circle-xmark-icon" aria-hidden="true"></span> 中斷連接
                        </button>
                    </div>
                    <div class="ts-divider"></div>
                    <div class="ts-content">
                        <div class="ts-text is-label">列印行為</div>
                        <div class="ts-space is-small"></div>
                        <label class="ts-text is-label" for="pref-feed-lines">列印後走紙行數</label>
                        <div class="ts-input is-small is-fluid has-top-spaced-small">
                            <input type="number" id="pref-feed-lines" min="0" max="20" value="4">
                        </div>
                        <label class="ts-checkbox has-top-spaced">
                            <input type="checkbox" id="pref-cut-paper">
                            <div class="text">列印後自動切紙</div>
                        </label>
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
                        <div class="paper-shadow" id="paper-shadow">
                            <div class="safe-area-guide" id="safe-area-guide"></div>
                            <div id="canvas-host" class="canvas-host"></div>
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
                                <div class="ts-divider has-bottom-spaced-small" style="width:100%"></div>
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

    <!-- 開利手底部 -->
    <div class="ts-content is-secondary is-vertically-padded">
        <div class="ts-container" style="max-width:1400px">
            <div class="ts-divider is-section"></div>
            <div class="ts-grid">
                <div class="column is-fluid">
                    <div class="ts-text is-description">
                        <a href="/koilisu/" style="color:inherit;text-decoration:none;">KoiLiSu 開利手</a> -
                        讓工具使用更順手的開放專案 | prjToka
                    </div>
                    <div class="ts-text is-description">
                        Built with ❤️ using Tocas UI |
                        <a href="https://github.com/zisunny104/printan" target="_blank" rel="noopener noreferrer"
                            style="display:inline-block;padding:2px 8px;background:#24292f;color:white;text-decoration:none;border-radius:6px;font-size:0.85em;font-weight:500;margin-left:4px;">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="vertical-align:text-bottom;margin-right:4px;">
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
