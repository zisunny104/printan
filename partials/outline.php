<?php defined('PRINTAN_VIEW') || exit; ?>
                <!-- ≥768px 是一般側欄（CSS 讓未開啟的 dialog 也照常顯示）；<768px 是底部抽屜，由工具列 #btn-outline-drawer
                     以 showModal() 開啟（原生 dialog：Esc、焦點陷阱、焦點還原、body 鎖捲動）。內容只有這一份，不重複渲染。 -->
                <dialog class="ts-app-drawer is-bottom editor-list" id="outlineSidebar" aria-label="版面結構">
                    <button type="button" class="sheet-handle" aria-label="面板把手（拖曳調整高度）"><span aria-hidden="true"></span></button>
                    <div class="content">
                    <!-- 頁面清單：多頁（frame）支援，每頁各自一份 elements＋切紙旗標（見 js/editor/pages.js）。
                         目前是「一次編輯一頁」的分頁式介面（點列切換目前作用中的頁面），不是把所有頁面
                         2D 排開在畫布上同時顯示——2D 版面在窄螢幕本來就要退回這種簡單清單，考量到
                         2D 拖曳／縮放整層互動的複雜度，v1 版本直接統一採用這個較單純但功能完整的介面。 -->
                    <div class="ts-box is-rounded page-list-box">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-copy-icon" aria-hidden="true"></span>
                                <span>頁面</span>
                            </span>
                            <button type="button" id="btn-page-split" class="ts-button is-icon is-ghost is-small"
                                aria-label="從選取元素處分割成新頁" data-tooltip="從選取元素處分割成新頁" disabled>
                                <span class="ts-icon is-scissors-icon" aria-hidden="true"></span>
                            </button>
                            <button type="button" id="btn-page-add" class="ts-button is-icon is-ghost is-small"
                                aria-label="新增頁面" data-tooltip="新增頁面">
                                <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="ts-content is-padded">
                            <div id="page-list" class="page-list" role="listbox" aria-label="頁面列表"></div>
                        </div>
                    </div>
                    <div class="ts-box is-rounded">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-list-icon" aria-hidden="true"></span>
                                <span>版面結構</span>
                            </span>
                            <button type="button" id="btn-outline-close" class="ts-button is-icon is-ghost is-small tablet+:has-hidden"
                                aria-label="關閉版面結構">
                                <span class="ts-icon is-xmark-icon" aria-hidden="true"></span>
                            </button>
                            <button type="button" id="btn-outline-add" class="ts-button is-icon is-ghost is-small"
                                aria-label="新增元素" aria-haspopup="menu" aria-expanded="false" data-tooltip="新增元素">
                                <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="ts-content is-padded">
                            <div id="outline-list" class="outline-list"></div>
                            <div class="pane-empty-state-static outline-empty">
                                <span class="ts-icon is-list-icon is-heading" aria-hidden="true"></span>
                                <div class="ts-text is-description">尚無元素，按 ＋ 新增</div>
                            </div>
                        </div>
                    </div>
                    </div>
                </dialog>
