<?php defined('PRINTAN_VIEW') || exit; ?>
                <aside class="editor-dock" id="inspectorDock" aria-label="元素設定與批次資料">
                    <div class="ts-box is-rounded">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-sliders-icon" aria-hidden="true"></span>
                                <span>元素設定</span>
                            </span>
                        </div>
                        <div class="ts-content is-padded" id="inspector">
                            <div class="pane-empty-state-static">
                                <span class="ts-icon is-sliders-icon is-heading" aria-hidden="true"></span>
                                <div class="ts-text is-description">尚未選取元素</div>
                            </div>
                        </div>
                    </div>

                    <div class="ts-space" id="variables-card-spacer" hidden></div>

                    <div class="ts-box is-rounded" id="variables-card" hidden>
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-list-check-icon" aria-hidden="true"></span>
                                <span>變數與預覽資料</span>
                            </span>
                        </div>
                        <div class="ts-content is-padded">
                            <div id="variables-panel"></div>
                        </div>
                    </div>

                    <div class="ts-space" id="batch-card-spacer" hidden></div>

                    <div class="ts-box is-rounded" id="batch-card" hidden>
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-clipboard-list-icon" aria-hidden="true"></span>
                                <span>批次資料（Mail Merge）</span>
                            </span>
                            <button type="button" class="ts-button is-icon is-ghost pane-collapse-toggle"
                                id="batch-panel-toggle" aria-expanded="false" aria-controls="batch-panel-body"
                                aria-label="展開／收合批次資料面板" data-tooltip="展開／收合">
                                <span class="ts-icon is-chevron-down-icon" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="ts-content is-padded" id="batch-panel-body" hidden>
                            <div class="ts-input is-small is-fluid">
                                <textarea id="batch-data" class="batch-data-textarea" rows="5"
                                    placeholder='[{"name":"手工餅乾","price":"120"}]'></textarea>
                            </div>
                            <div class="ts-space is-small"></div>
                            <div class="ts-buttons is-fluid">
                                <button class="ts-button is-small is-outlined is-start-icon" id="btn-preview-batch">
                                    <span class="ts-icon is-eye-icon" aria-hidden="true"></span> 預覽批次資料
                                </button>
                                <button class="ts-button is-small is-outlined is-start-icon" id="btn-export-batch-pdf">
                                    <span class="ts-icon is-file-pdf-icon" aria-hidden="true"></span> 匯出 PDF
                                </button>
                            </div>

                            <div id="batch-preview-nav" class="pane-toolbar has-top-spaced-small" hidden>
                                <div class="ts-divider has-bottom-spaced-small batch-nav-divider"></div>
                                <button type="button" class="ts-button is-icon is-small is-ghost" id="btn-batch-prev" aria-label="上一筆">
                                    <span class="ts-icon is-chevron-left-icon" aria-hidden="true"></span>
                                </button>
                                <span class="ts-text is-description" id="batch-preview-counter">第 1 / 1 筆</span>
                                <button type="button" class="ts-button is-icon is-small is-ghost" id="btn-batch-next" aria-label="下一筆">
                                    <span class="ts-icon is-chevron-right-icon" aria-hidden="true"></span>
                                </button>
                                <span class="toolbar-spacer"></span>
                                <button type="button" class="ts-button is-small is-text" id="btn-batch-end-preview">結束預覽</button>
                            </div>
                        </div>
                    </div>
                </aside>
