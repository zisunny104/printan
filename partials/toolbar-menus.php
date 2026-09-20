<?php defined('PRINTAN_VIEW') || exit; ?>
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
