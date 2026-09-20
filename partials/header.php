<?php defined('PRINTAN_VIEW') || exit; ?>
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
