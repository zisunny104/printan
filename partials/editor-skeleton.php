<?php defined('PRINTAN_VIEW') || exit; ?>
                <!-- 載入骨架畫面：editor.js 的模組（字型、印表機設定、IndexedDB 草稿還原……）
                     還沒跑完前，三欄都還是空殼（大綱樹是空的、畫布沒東西、檢視器顯示「尚未選取元素」），
                     直接看到會像是壞掉。蓋一層假的版面骨架＋呼吸動畫頂著，跟 Figma／現代網頁常見的
                     skeleton screen 一樣先讓人看出「這裡是大綱／畫布／檢視器」三塊，init() 跑完
                     （js/editor/editor.js 的 hideEditorSkeleton()）就淡出移除，比空白畫面或轉圈圈更看得出進度。 -->
                <div class="editor-skeleton" id="editorSkeleton" aria-hidden="true">
                    <div class="skeleton-pane skeleton-pane-list">
                        <div class="skeleton-block skeleton-line is-title"></div>
                        <div class="skeleton-block skeleton-row"></div>
                        <div class="skeleton-block skeleton-row"></div>
                        <div class="skeleton-block skeleton-row"></div>
                        <div class="skeleton-block skeleton-row"></div>
                        <div class="skeleton-block skeleton-row"></div>
                    </div>
                    <div class="skeleton-pane skeleton-pane-canvas">
                        <div class="skeleton-block skeleton-toolbar"></div>
                        <div class="skeleton-block skeleton-paper"></div>
                    </div>
                    <div class="skeleton-pane skeleton-pane-dock">
                        <div class="skeleton-block skeleton-line is-title"></div>
                        <div class="skeleton-block skeleton-row is-tall"></div>
                        <div class="skeleton-block skeleton-row"></div>
                        <div class="skeleton-block skeleton-row"></div>
                        <div class="skeleton-block skeleton-row"></div>
                    </div>
                </div>
