<?php defined('PRINTAN_VIEW') || exit; ?>
            <div class="ts-grid is-middle-aligned">
                <div class="column is-fluid">
                    <div class="ts-header is-heavy is-large is-start-icon" role="heading" aria-level="1">
                        <span class="ts-icon is-receipt-icon" aria-hidden="true"></span>
                        Printan 單仔
                        <span class="app-version">v<?= htmlspecialchars($appVersion) ?></span>
                    </div>
                    <div class="ts-text is-description mobile:has-hidden">熱感紙收據／標籤設計與預覽工具，所見即所印。</div>
                    <!-- 專案名稱（state.project.meta.name）：平時顯示為可點擊的文字按鈕，點擊／Enter 切成輸入框；
                         Enter 確認、Esc 取消、blur 視同確認，清理與存檔／匯出檔名串接見 js/editor/editor.js（b3） -->
                    <div class="project-name-row">
                        <button type="button" class="project-name-button" id="btn-project-name"
                            aria-label="專案名稱，點擊重新命名" data-tooltip="點擊重新命名">
                            <span class="project-name-text" id="project-name-text">未命名專案</span>
                            <span class="ts-icon is-pen-icon" aria-hidden="true"></span>
                        </button>
                        <input type="text" class="ts-input is-small project-name-input" id="project-name-input"
                            aria-label="專案名稱" maxlength="60" hidden>
                    </div>
                </div>
                <div class="column mobile:is-16-wide app-header-save">
                    <span id="save-status" class="ts-text is-description is-small"></span>
                </div>
                <div class="column">
                    <button type="button" class="ts-button is-small is-outlined is-icon" id="btn-help"
                        data-tooltip="使用說明" aria-label="使用說明">
                        <span class="ts-icon is-circle-question-icon" aria-hidden="true"></span>
                    </button>
                </div>
            </div>

            <div class="ts-divider has-vertically-spaced-small tablet+:has-vertically-spaced"></div>
