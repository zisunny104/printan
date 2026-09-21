<!DOCTYPE html>
<html lang="zh-tw" class="is-rounded">

<?php
// partials 用 PRINTAN_VIEW 擋掉直接以 URL 開啟
defined('PRINTAN_VIEW') || define('PRINTAN_VIEW', true);
// 計算此應用展開後的 URL 基準路徑（例： /koilisu/apps/printan）
$appBasePath = rtrim(str_replace($_SERVER['DOCUMENT_ROOT'], '', __DIR__), '/\\');
$appBasePath = str_replace('\\', '/', $appBasePath);
$appConfig = require __DIR__ . '/config.php';
$appVersion = $appConfig['version'] ?? '0.0.0';
?>

<?php require __DIR__ . '/partials/head.php'; ?>

<body class="is-rounded">
    <main class="main-content">
        <div class="ts-container is-fluid has-vertically-padded">

            <?php require __DIR__ . '/partials/header.php'; ?>

            <?php require __DIR__ . '/partials/toolbar.php'; ?>

            <?php require __DIR__ . '/partials/toolbar-menus.php'; ?>

            <?php require __DIR__ . '/partials/modal-printer.php'; ?>

            <div class="ts-divider has-vertically-spaced-small"></div>

            <div class="editor-shell" id="editorShell">
                <?php require __DIR__ . '/partials/outline.php'; ?>

                <div class="col-resizer" id="colResizerLeft" role="separator" aria-orientation="vertical"
                    aria-label="調整版面結構欄寬" tabindex="0" data-tooltip="拖曳調整欄寬（方向鍵微調、雙擊重設）">
                    <span class="ts-icon is-grip-lines-vertical-icon" aria-hidden="true"></span>
                </div>

                <?php require __DIR__ . '/partials/canvas.php'; ?>

                <div class="col-resizer" id="colResizerRight" role="separator" aria-orientation="vertical"
                    aria-label="調整元素設定欄寬" tabindex="0" data-tooltip="拖曳調整欄寬（方向鍵微調、雙擊重設）">
                    <span class="ts-icon is-grip-lines-vertical-icon" aria-hidden="true"></span>
                </div>

                <?php require __DIR__ . '/partials/inspector.php'; ?>
            </div>

            <?php require __DIR__ . '/partials/panel-buttons.php'; ?>
        </div>
    </main>

    <?php require __DIR__ . '/partials/modal-help.php'; ?>

    <?php require __DIR__ . '/partials/footer.php'; ?>

    <?php require __DIR__ . '/partials/theme-script.php'; ?>

    <input type="file" id="image-file-input" accept="image/*" hidden>
    <input type="file" id="ptan-file-input" accept=".ptan,application/json" hidden>

    <script type="module" src="<?= htmlspecialchars($appBasePath) ?>/js/editor/editor.js"></script>
</body>

</html>
