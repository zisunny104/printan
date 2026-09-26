<?php defined('PRINTAN_VIEW') || exit; ?>
                <div class="editor-canvas-pane" id="canvasPane">
                    <div class="ts-box is-rounded paper-viewport" id="paper-viewport">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-receipt-icon" aria-hidden="true"></span>
                                <span>工作區</span>
                            </span>
                            <div class="pane-header-toggle-buttons pane-zoom-controls" role="group" aria-label="縮放">
                                <button class="ts-button is-icon is-ghost" id="btn-zoom-out"
                                    data-tooltip="縮小" aria-label="縮小">
                                    <span class="ts-icon is-minus-icon" aria-hidden="true"></span>
                                </button>
                                <div class="ts-input is-small is-basic pane-zoom-value">
                                    <input type="text" id="zoom-value" inputmode="numeric" autocomplete="off"
                                        spellcheck="false" aria-label="縮放比例" value="100%">
                                </div>
                                <button class="ts-button is-icon is-ghost" id="btn-zoom-in"
                                    data-tooltip="放大" aria-label="放大">
                                    <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                                </button>
                                <button class="ts-button is-icon is-ghost" id="btn-zoom-fit"
                                    data-tooltip="符合寬度" aria-label="符合寬度">
                                    <span class="ts-icon is-arrows-left-right-icon" aria-hidden="true"></span>
                                </button>
                                <button class="ts-button is-small is-ghost" id="btn-zoom-actual"
                                    data-tooltip="實際大小">1:1</button>
                            </div>
                            <div class="pane-header-toggle-buttons">
                                <button class="ts-button is-icon is-ghost" id="btn-toggle-rulers"
                                    data-tooltip="尺規" aria-label="尺規" aria-pressed="true">
                                    <span class="ts-icon is-ruler-combined-icon" aria-hidden="true"></span>
                                </button>
                                <button class="ts-button is-icon is-ghost" id="btn-toggle-thermal"
                                    data-tooltip="切換熱感輸出預覽" aria-label="切換熱感輸出預覽" aria-pressed="false">
                                    <span class="ts-icon is-circle-half-stroke-icon" aria-hidden="true"></span>
                                </button>
                                <button class="ts-button is-icon is-ghost" id="btn-toggle-preview-mode"
                                    data-tooltip="切換編輯／預覽模式" aria-label="切換編輯／預覽模式" aria-pressed="false">
                                    <span class="ts-icon is-eye-icon" aria-hidden="true"></span>
                                </button>
                            </div>
                        </div>
                        <!-- 窄螢幕（<768px）不排 2D 佈局，一次顯示一頁，用這列前後切換；只有一頁時隱藏 -->
                        <div class="page-pager" id="page-pager" hidden>
                            <button type="button" class="ts-button is-icon is-ghost is-small" id="btn-page-prev" aria-label="上一頁">
                                <span class="ts-icon is-chevron-left-icon" aria-hidden="true"></span>
                            </button>
                            <span class="ts-text is-small page-pager-label" id="page-pager-label" aria-live="polite"></span>
                            <span class="ts-icon is-scissors-icon page-pager-cut" id="page-pager-cut" role="img" aria-label="印完切紙"></span>
                            <button type="button" class="ts-button is-icon is-ghost is-small" id="btn-page-next" aria-label="下一頁">
                                <span class="ts-icon is-chevron-right-icon" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="paper-viewport-stage">
                            <div class="paper-ruler-corner" id="ruler-corner" aria-hidden="true"></div>
                            <div class="paper-ruler is-horizontal" id="ruler-h" aria-hidden="true"><canvas></canvas></div>
                            <div class="paper-ruler is-vertical" id="ruler-v" aria-hidden="true"><canvas></canvas></div>
                            <div class="paper-viewport-body" id="paper-scroll">
                                <!-- 2D 多頁佈局（js/editor/page-board.js）：水平＝不同段（之間會切紙），垂直＝同段接續的連續紙。
                                     下面這組 #paper-shadow 永遠是「作用中頁面」，切頁時由 JS 搬進對應的欄位；其餘頁面是唯讀縮圖。 -->
                                <div class="page-board" id="page-board">
                                    <div class="page-group">
                                        <div class="page-frame is-active">
                                            <div class="paper-shadow" id="paper-shadow">
                                                <div class="safe-area-guide" id="safe-area-guide">
                                                    <span class="ts-icon is-circle-info-icon" data-tooltip="切刀安全線：低於此線的內容，切紙時可能被切到" aria-hidden="true"></span>
                                                </div>
                                                <div id="canvas-host" class="canvas-host"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 浮動工具列：快速新增元素，比照 koilisu/apps/pitrace 的
                         .canvas-floating-toolbar。元素設定仍在右側「元素設定」面板，
                         這裡只放「新增」這類畫布層級的快速操作。
                         data-collapse-priority：容器窄到放不下整排按鈕時，依數字由小到大
                         把整顆按鈕收進最後的「更多工具」選單（不是壓縮/裁切），同 pitrace
                         wireToolbarOverflow()。數字愈小愈先被收，「新增文字」最常用留到最後。 -->
                    <div class="canvas-floating-toolbar pane-toolbar" role="toolbar" aria-label="新增元素">
                        <button type="button" class="ts-button is-icon" id="btn-toolbar-add"
                            aria-haspopup="menu" aria-expanded="false" aria-label="新增元素" data-tooltip="新增元素">
                            <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                        </button>
                        <div class="ts-divider is-vertical toolbar-divider"></div>
                        <button class="ts-button is-icon" id="btn-add-text" data-tooltip="新增文字"
                            aria-label="新增文字" data-collapse-priority="6">
                            <span class="ts-icon is-font-icon" aria-hidden="true"></span>
                        </button>
                        <button class="ts-button is-icon" id="btn-add-image" data-tooltip="新增圖片"
                            aria-label="新增圖片" data-collapse-priority="5">
                            <span class="ts-icon is-image-icon" aria-hidden="true"></span>
                        </button>
                        <button class="ts-button is-icon" id="btn-add-spacer" data-tooltip="新增間隔"
                            aria-label="新增間隔" data-collapse-priority="2">
                            <span class="ts-icon is-arrows-up-down-icon" aria-hidden="true"></span>
                        </button>
                        <button class="ts-button is-icon" id="btn-add-divider" data-tooltip="新增分隔線"
                            aria-label="新增分隔線" data-collapse-priority="4">
                            <span class="ts-icon is-minus-icon" aria-hidden="true"></span>
                        </button>
                        <button class="ts-button is-icon" id="btn-add-barcode" data-tooltip="新增條碼／QR Code"
                            aria-label="新增條碼／QR Code" data-collapse-priority="3">
                            <span class="ts-icon is-qrcode-icon" aria-hidden="true"></span>
                        </button>
                        <div class="ts-divider is-vertical toolbar-divider" data-collapse-priority="1"></div>
                        <button type="button" class="ts-button is-icon" data-dropdown="row-ratio-dropdown"
                            data-tooltip="多欄" aria-label="多欄" aria-haspopup="true" data-collapse-priority="1">
                            <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                        </button>

                        <!-- 容器寬度不夠同時放下所有按鈕時，依上面標的 data-collapse-priority
                             由小到大依序把整顆按鈕收進這個選單，可見按鈕永遠維持原始大小，
                             不需要橫向捲動工具列才找得到——比照 Figma 窄寬度工具列的做法，
                             同 koilisu/apps/pitrace。JS 邏輯見 toolbar.js wireToolbarOverflow()。 -->
                        <div class="pane-menu-wrap" id="toolbarOverflowWrap" hidden>
                            <button type="button" id="btnToolbarOverflow" class="ts-button is-icon is-ghost"
                                aria-label="更多工具" aria-haspopup="menu" aria-expanded="false"
                                data-tooltip="更多工具">
                                <span class="ts-icon is-ellipsis-vertical-icon" aria-hidden="true"></span>
                            </button>
                            <div class="ts-menu is-dense is-small is-separated pane-dropdown-menu"
                                id="toolbarOverflowMenu" role="menu" aria-label="更多工具" hidden>
                                <button type="button" class="item" role="menuitem" id="overflowRatio11" hidden>
                                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                                    <span>多欄：1 / 1</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowRatio21" hidden>
                                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                                    <span>多欄：2 / 1</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowRatio12" hidden>
                                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                                    <span>多欄：1 / 2</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowRatio111" hidden>
                                    <span class="ts-icon is-table-columns-icon" aria-hidden="true"></span>
                                    <span>多欄：1 / 1 / 1</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddSpacer" hidden>
                                    <span class="ts-icon is-arrows-up-down-icon" aria-hidden="true"></span>
                                    <span>新增間隔</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddBarcode" hidden>
                                    <span class="ts-icon is-qrcode-icon" aria-hidden="true"></span>
                                    <span>新增條碼／QR Code</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddDivider" hidden>
                                    <span class="ts-icon is-minus-icon" aria-hidden="true"></span>
                                    <span>新增分隔線</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddImage" hidden>
                                    <span class="ts-icon is-image-icon" aria-hidden="true"></span>
                                    <span>新增圖片</span>
                                </button>
                                <button type="button" class="item" role="menuitem" id="overflowAddText" hidden>
                                    <span class="ts-icon is-font-icon" aria-hidden="true"></span>
                                    <span>新增文字</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- 多欄比例選單（放在懸浮工具列外，避免干擾方向鍵巡覽，同 pitrace 慣例） -->
                    <div class="ts-dropdown" id="row-ratio-dropdown">
                        <a class="item" data-ratio="1,1" id="row-ratio-1-1">1 / 1</a>
                        <a class="item" data-ratio="2,1" id="row-ratio-2-1">2 / 1</a>
                        <a class="item" data-ratio="1,2" id="row-ratio-1-2">1 / 2</a>
                        <a class="item" data-ratio="1,1,1" id="row-ratio-1-1-1">1 / 1 / 1</a>
                    </div>
                </div>
