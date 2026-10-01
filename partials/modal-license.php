<?php defined('PRINTAN_VIEW') || exit; ?>
    <!-- 授權內容讀根目錄 LICENSE，由 js/help/license-dialog.js 第一次開啟時載入，每章一個分頁。 -->
    <dialog id="license-dialog" class="ts-modal is-large" aria-labelledby="license-dialog-title" data-license-src="<?= htmlspecialchars($appBasePath) ?>/LICENSE">
        <div class="content help-dialog-content">
            <div class="ts-content">
                <div class="ts-header is-start-icon" id="license-dialog-title">
                    <span class="ts-icon is-copyright-icon" aria-hidden="true"></span>
                    授權
                </div>
            </div>
            <div class="ts-tab is-dense is-segmented help-tabs" role="tablist"></div>
            <div class="ts-content help-body">
                <div class="ts-text is-description">載入中…</div>
            </div>
            <div class="ts-divider"></div>
            <div class="ts-content">
                <div class="ts-wrap is-end-aligned">
                    <button type="button" class="ts-button" id="btn-license-close">關閉</button>
                </div>
            </div>
        </div>
    </dialog>
