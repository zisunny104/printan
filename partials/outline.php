<?php defined('PRINTAN_VIEW') || exit; ?>
                <!-- ≥768px 是一般側欄（CSS 讓未開啟的 dialog 也照常顯示）；<768px 是底部抽屜，由工具列 #btn-outline-drawer
                     以 showModal() 開啟（原生 dialog：Esc、焦點陷阱、焦點還原、body 鎖捲動）。內容只有這一份，不重複渲染。 -->
                <dialog class="ts-app-drawer is-bottom editor-list" id="outlineSidebar" aria-label="版面結構">
                    <button type="button" class="sheet-handle" aria-label="面板把手（拖曳調整高度）"><span aria-hidden="true"></span></button>
                    <div class="content">
                    <!-- 版面結構樹：比照 Figma 圖層面板，最上層是頁面（frame），底下是該頁元素，各層可收合（js/editor/outline.js）。
                         頁面的新增／刪除／改名／排序／合併／切紙開關都在頁面列上；分割是「從選取的元素處切開」，放標題列。 -->
                    <div class="ts-box is-rounded">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-list-icon" aria-hidden="true"></span>
                                <span>版面結構</span>
                            </span>
                            <button type="button" id="btn-page-split" class="ts-button is-icon is-ghost is-small"
                                aria-label="從選取的元素處分割成新頁" data-tooltip="從選取的元素處分割成新頁" disabled>
                                <span class="ts-icon is-arrows-split-up-and-left-icon" aria-hidden="true"></span>
                            </button>
                            <button type="button" id="btn-page-add" class="ts-button is-icon is-ghost is-small"
                                aria-label="新增頁面" data-tooltip="新增頁面">
                                <span class="ts-icon is-square-plus-icon" aria-hidden="true"></span>
                            </button>
                            <button type="button" id="btn-outline-add" class="ts-button is-icon is-ghost is-small"
                                aria-label="新增元素" aria-haspopup="menu" aria-expanded="false" data-tooltip="新增元素">
                                <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                            </button>
                            <button type="button" id="btn-outline-close" class="ts-button is-icon is-ghost is-small tablet+:has-hidden"
                                aria-label="關閉版面結構">
                                <span class="ts-icon is-xmark-icon" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="ts-content is-padded">
                            <div id="outline-list" class="outline-list"></div>
                        </div>
                    </div>
                    </div>
                </dialog>
