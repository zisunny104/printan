<?php defined('PRINTAN_VIEW') || exit; ?>
            <div id="operations" class="pane-toolbar" role="toolbar" aria-label="編輯工具">
                <!-- 左：檔案／版型操作（新增、開啟、匯出）；右：紙張與印表機輸出操作（紙寬、
                     列印設定、列印）。兩組用途不同（前者管版型檔案，後者管實體輸出），分兩側
                     排列比全部擠在一起好找。 -->
                <div class="ts-buttons">
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-new-ptan"
                        data-tooltip="新增空白版型（目前版型會留在「最近編輯」清單，不會遺失）" aria-label="新增">
                        <span class="ts-icon is-file-circle-plus-icon" aria-hidden="true"></span>
                        <span>新增</span>
                    </button>
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-open-ptan"
                        data-dropdown="open-project-dropdown" aria-haspopup="true" aria-label="開啟">
                        <span class="ts-icon is-folder-open-icon" aria-hidden="true"></span>
                        <span>開啟</span>
                        <span class="ts-icon is-chevron-down-icon dropdown-caret" aria-hidden="true"></span>
                    </button>
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-export-menu"
                        data-dropdown="export-dropdown" aria-haspopup="true" aria-label="匯出">
                        <span class="ts-icon is-download-icon" aria-hidden="true"></span>
                        <span>匯出</span>
                        <span class="ts-icon is-chevron-down-icon dropdown-caret" aria-hidden="true"></span>
                    </button>
                </div>
                <div class="ts-divider is-vertical toolbar-divider"></div>
                <!-- 專案名稱（state.project.meta.name）：平時顯示為 ts-button，點擊／Enter 切成 ts-input；
                     Enter 確認、Esc 取消、blur 視同確認，互動邏輯見 operations.js bindProjectName() -->
                <div class="project-name-group">
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-project-name"
                        aria-label="專案名稱，點擊重新命名" data-tooltip="點擊重新命名">
                        <span class="ts-icon is-pen-icon" aria-hidden="true"></span>
                        <span class="project-name-text" id="project-name-text">未命名專案</span>
                    </button>
                    <div class="ts-input is-small project-name-input" id="project-name-input-wrap" hidden>
                        <input type="text" id="project-name-input" aria-label="專案名稱" maxlength="60">
                    </div>
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
                    <span>列印設定</span>
                    <span class="printer-conn-dot is-on" id="printer-toolbar-dot" aria-hidden="true" hidden></span>
                </button>
                <button class="ts-button is-small is-primary is-start-icon" id="btn-print">
                    <span class="ts-icon is-print-icon" aria-hidden="true"></span> 列印
                </button>
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
                    <span class="info-icon" tabindex="0" role="img" aria-label="僅開源字體，檔案會變大" data-tooltip="僅開源字體，檔案會變大" data-trigger="hover focus"><span class="ts-icon is-circle-info-icon" aria-hidden="true"></span></span>
                </div>
                <a class="item" id="btn-export-pdf">
                    <span class="ts-icon is-file-pdf-icon" aria-hidden="true"></span> 匯出 PDF
                </a>
            </div>
