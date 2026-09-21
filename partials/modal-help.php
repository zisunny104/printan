<?php defined('PRINTAN_VIEW') || exit; ?>
    <!-- 使用說明：內文寫在 help/help.md（Markdown，## 分章），由 js/help/help-dialog.js 第一次開啟時載入，
         每章一個分頁；頁面上其他地方只留欄位名稱＋必要時的 ⓘ 短提示。 -->
    <dialog id="help-dialog" class="ts-modal is-large" aria-labelledby="help-dialog-title" data-help-src="<?= htmlspecialchars($appBasePath) ?>/help/help.md">
        <div class="content help-dialog-content">
            <div class="ts-content">
                <div class="ts-header is-start-icon" id="help-dialog-title">
                    <span class="ts-icon is-circle-question-icon" aria-hidden="true"></span>
                    使用說明
                </div>
            </div>
            <div class="ts-tab is-dense is-segmented help-tabs" role="tablist"></div>
            <div class="ts-content help-body">
                <div class="ts-text is-description">載入中…</div>
            </div>
            <div class="ts-divider"></div>
            <div class="ts-content">
                <div class="ts-wrap is-end-aligned">
                    <button type="button" class="ts-button" id="btn-help-close">關閉</button>
                </div>
            </div>
        </div>
    </dialog>
