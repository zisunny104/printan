<?php defined('PRINTAN_VIEW') || exit; ?>
    <div id="app-footer" class="ts-content is-secondary is-vertically-padded">
        <div class="ts-container is-fluid">
            <div class="ts-grid">
                <div class="column is-fluid">
                    <div class="ts-wrap is-vertical is-compact">
                        <div class="ts-text is-description">
                            <a href="/koilisu/" class="footer-plain-link">KoiLiSu 開利手</a> -
                            讓工具使用更順手的開放專案 | <a href="https://toka.dev" target="_blank" rel="noopener" class="footer-plain-link">prjToka</a>
                        </div>
                        <div class="ts-wrap is-middle-aligned is-compact">
                            <button type="button" id="btn-license" class="ts-button is-small is-start-icon footer-action-button">
                                <span class="ts-icon is-copyright-icon" aria-hidden="true"></span>
                                License
                            </button>
                            <span class="ts-text is-description">|</span>
                            <a href="https://github.com/zisunny104/printan" target="_blank" rel="noopener noreferrer" class="ts-button is-small is-start-icon footer-action-button">
                                <svg class="ts-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                                </svg>
                                View on GitHub<span class="sr-only"> (在新視窗開啟)</span>
                            </a>
                        </div>
                    </div>
                </div>
                <div class="column is-end-aligned">
                    <div class="ts-wrap is-top-aligned" style="height:100%">
                        <div class="ts-selection is-circular is-compact mobile:theme-switcher-stacked" role="radiogroup" aria-label="佈景主題切換">
                            <label class="item">
                                <input type="radio" name="theme" value="light" id="theme-light">
                                <div class="text">淺色</div>
                            </label>
                            <label class="item">
                                <input checked type="radio" name="theme" value="system" id="theme-system">
                                <div class="text">系統</div>
                            </label>
                            <label class="item">
                                <input type="radio" name="theme" value="dark" id="theme-dark">
                                <div class="text">深色</div>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
