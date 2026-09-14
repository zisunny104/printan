<?php
// 載入應用設定
$config = include __DIR__ . '/config.php';

// 處理不同動作
switch ($_APP['action']) {
    case 'index':
        // 顯示 Printan 編輯介面
        include __DIR__ . '/view.php';
        break;

    default:
        redirect('printan');
}
