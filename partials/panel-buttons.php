<?php defined('PRINTAN_VIEW') || exit; ?>
                <!-- 只在 <768px：畫布下方（頁尾之上、文件流內）的兩顆開關，開啟版面結構／元素設定抽屜（aria-expanded 由 JS 同步） -->
                <nav class="mobile-panel-bar tablet+:has-hidden" aria-label="面板">
                    <div class="ts-buttons" id="mobile-drawer-buttons">
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-outline-drawer"
                        aria-haspopup="dialog" aria-controls="outlineSidebar" aria-expanded="false">
                        <span class="ts-icon is-list-icon" aria-hidden="true"></span>
                        版面結構
                    </button>
                    <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-inspector-drawer"
                        aria-controls="inspectorDock" aria-expanded="false">
                        <span class="ts-icon is-sliders-icon" aria-hidden="true"></span>
                        元素設定
                    </button>
                </div>
                </nav>
