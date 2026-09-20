<?php defined('PRINTAN_VIEW') || exit; ?>
                <aside class="editor-list" id="outlineSidebar" aria-label="版面結構">
                    <div class="ts-box is-rounded">
                        <div class="pane-card-header">
                            <span class="pane-card-header-title">
                                <span class="ts-icon is-list-icon" aria-hidden="true"></span>
                                <span>版面結構</span>
                            </span>
                            <button type="button" id="btn-outline-add" class="ts-button is-icon is-ghost is-small"
                                aria-label="新增元素" aria-haspopup="menu" aria-expanded="false" data-tooltip="新增元素">
                                <span class="ts-icon is-plus-icon" aria-hidden="true"></span>
                            </button>
                        </div>
                        <div class="ts-content is-padded">
                            <div id="outline-list" class="outline-list"></div>
                        </div>
                    </div>
                </aside>
