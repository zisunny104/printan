<?php defined('PRINTAN_VIEW') || exit; ?>
            <!-- 列印設定：一個 modal 由上到下四區——連線（最上面、最明顯）→ 列印設定（走紙／切紙／可列印點數）
                 → 印表機資訊（唯讀）→ 測試與診斷。「機器讀到的」與「預設／手動覆寫」的值用來源 badge
                 （.src-badge）區分，見 printer-settings.js sourceBadge()。 -->
            <dialog id="printer-settings-dialog" class="ts-modal">
                <div class="content">
                    <div class="ts-content">
                        <div class="ts-header is-start-icon">
                            <span class="ts-icon is-gear-icon" aria-hidden="true"></span>
                            列印設定
                        </div>
                    </div>
                    <div class="ts-divider"></div>
                    <!-- 連線區塊：連線印表機是這個 modal 的主要動作。總狀態 badge 放大，未連線時用紅底最醒目，
                         已連線改綠燈；同一時間只會有一條連線（USB／序列埠二選一，已連線時方式選項鎖住）。 -->
                    <div class="ts-content">
                        <div class="ts-wrap is-middle-aligned is-relaxed">
                            <div class="ts-text is-label">印表機連線</div>
                            <span class="ts-badge is-large is-negative" id="printer-conn-badge" role="status">
                                <span class="printer-conn-dot" aria-hidden="true"></span><span id="printer-conn-badge-text">未連線</span>
                            </span>
                        </div>
                        <div class="has-top-spaced-small"></div>
                        <div class="ts-selection is-small" id="printer-connect-method" role="radiogroup" aria-label="連線方式">
                            <label class="item">
                                <input type="radio" name="printer-connect-method" value="usb">
                                <div class="text">USB（WebUSB）</div>
                            </label>
                            <label class="item">
                                <input type="radio" name="printer-connect-method" value="serial">
                                <div class="text">序列埠（RS-232 / Web Serial）</div>
                            </label>
                        </div>
                        <div id="printer-connection-unsupported" class="ts-text is-negative has-top-spaced-small" hidden></div>
                        <div class="ts-text is-description has-top-spaced-small" id="printer-connection-status">尚未連線</div>
                        <!-- 傳輸速率只有序列埠需要，選 USB 時不顯示 -->
                        <div id="printer-serial-options" hidden>
                            <div class="has-top-spaced-small"></div>
                            <label class="ts-text is-label" for="pref-serial-baud-rate">傳輸速率（baud rate）</label>
                            <div class="ts-input is-small is-fluid has-top-spaced-small">
                                <input type="number" id="pref-serial-baud-rate" min="1200" max="115200" step="1" value="9600">
                            </div>
                        </div>
                        <div class="has-top-spaced-small"></div>
                        <button type="button" class="ts-button is-primary is-start-icon" id="btn-printer-connect">
                            <span class="ts-icon is-plug-icon" aria-hidden="true"></span> 連線印表機
                        </button>
                        <button type="button" class="ts-button is-outlined is-start-icon" id="btn-printer-disconnect" hidden>
                            <span class="ts-icon is-plug-circle-xmark-icon" aria-hidden="true"></span> 中斷連線
                        </button>
                    </div>
                    <div class="ts-divider"></div>
                    <div class="ts-content">
                        <div class="ts-text is-label">列印設定<span class="info-icon" tabindex="0" role="img" aria-label="只在 USB／序列埠直連時套用，系統列印不受影響" data-tooltip="只在 USB／序列埠直連時套用，系統列印不受影響"><span class="ts-icon is-circle-info-icon" aria-hidden="true"></span></span></div>
                        <div class="has-top-spaced-small"></div>
                        <label class="ts-text is-label" for="pref-feed-lines">切紙前走紙行數</label>
                        <div class="ts-input is-small is-fluid has-top-spaced-small">
                            <input type="number" id="pref-feed-lines" min="0" max="20" value="4">
                        </div>
                        <!-- 內容由 updateFeedLinesHint() 依目前印表機規格動態填入，見 editor.js -->
                        <div class="ts-text is-description is-small has-top-spaced-small" id="pref-feed-lines-hint"></div>
                        <label class="ts-checkbox has-top-spaced">
                            <input type="checkbox" id="pref-cut-paper">
                            <div class="text">列印後自動切紙</div>
                        </label>
                        <div class="has-top-spaced"></div>
                        <div class="ts-text is-label">可列印點數（依紙寬）<span class="info-icon" tabindex="0" role="img" aria-label="預設用內建規格；別牌印表機可能不同（58 mm 常見 384 點），依規格書填寫，範圍 64–1024，留空＝預設" data-tooltip="預設用內建規格；別牌印表機可能不同（58 mm 常見 384 點），依規格書填寫，範圍 64–1024，留空＝預設"><span class="ts-icon is-circle-info-icon" aria-hidden="true"></span></span></div>
                        <div class="has-top-spaced-small"></div>
                        <!-- 每個紙寬一列輸入框，由 renderPrintableDotsRows() 產生，見 printer-settings.js -->
                        <div id="printer-dots-list"></div>
                        <div class="has-top-spaced-small"></div>
                        <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-dots-reset">
                            <span class="ts-icon is-rotate-left-icon" aria-hidden="true"></span> 還原預設點數
                        </button>
                        <div class="has-top-spaced"></div>
                        <div class="ts-text is-label">邊距校正</div>
                        <div class="has-top-spaced-small"></div>
                        <!-- 每個紙寬一列（左／右留白 mm），由 renderMarginRows() 產生，見 printer-settings.js -->
                        <div id="printer-margin-list"></div>
                        <div class="has-top-spaced-small"></div>
                        <div class="ts-wrap">
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-margin-reset">
                                <span class="ts-icon is-rotate-left-icon" aria-hidden="true"></span> 重設
                            </button>
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-margin-sheet">
                                <span class="ts-icon is-ruler-icon" aria-hidden="true"></span> 校正紙
                            </button>
                        </div>
                    </div>
                    <div class="ts-divider"></div>
                    <!-- 印表機資訊（唯讀）：連線後盡量用機器讀到的（WebUSB 裝置名稱、GS I 回傳的廠牌／型號／韌體）；
                         規格資料（DPI、紙寬、切刀距離）來自內建規格，比對不到已知型號就標示「無法辨識，使用預設值」。
                         各列內容由 updatePrinterInfo() 填入，見 printer-settings.js。 -->
                    <div class="ts-content">
                        <div class="ts-text is-label">印表機資訊</div>
                        <div class="has-top-spaced-small"></div>
                        <table class="ts-table is-definition is-small" id="printer-info-table">
                            <tbody>
                                <tr><td>連線的印表機</td><td id="printer-info-device">—</td></tr>
                                <tr><td>韌體版本</td><td id="printer-info-firmware">—</td></tr>
                                <tr><td>規格資料</td><td id="printer-info-spec">—</td></tr>
                                <tr><td>解析度</td><td id="printer-info-dpi">—</td></tr>
                                <tr><td>目前紙寬</td><td id="printer-info-paper">—</td></tr>
                                <tr><td>可列印寬度</td><td id="printer-info-printable">—</td></tr>
                                <tr><td>切刀距離</td><td id="printer-info-blade">—</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="ts-divider"></div>
                    <!-- 測試列印：套用目前走紙／切紙偏好印一小段測試圖樣，不用印整張收據就能校正
                         走紙行數／切紙位置；查詢狀態：即時查詢連線／紙張感應器（DLE EOT），兩者都
                         需要 USB 或序列埠其中一個已連線，走系統列印對話框時無法使用。
                         忘記已授權裝置：清掉瀏覽器記住的授權，換印表機或想重新選擇裝置時用。 -->
                    <div class="ts-content">
                        <div class="ts-text is-label">測試與診斷<span class="info-icon" tabindex="0" role="img" aria-label="測試列印與查詢狀態需要先連線印表機" data-tooltip="測試列印與查詢狀態需要先連線印表機"><span class="ts-icon is-circle-info-icon" aria-hidden="true"></span></span></div>
                        <div class="has-top-spaced-small"></div>
                        <div class="ts-wrap">
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-test-print">
                                <span class="ts-icon is-ruler-icon" aria-hidden="true"></span> 測試列印
                            </button>
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-query-status">
                                <span class="ts-icon is-circle-info-icon" aria-hidden="true"></span> 查詢印表機狀態
                            </button>
                            <button type="button" class="ts-button is-small is-outlined is-start-icon" id="btn-printer-forget">
                                <span class="ts-icon is-eraser-icon" aria-hidden="true"></span> 忘記已授權裝置
                            </button>
                        </div>
                        <!-- 內容由 queryPrinterStatus() 動態填入，見 editor.js -->
                        <div class="ts-text is-description is-small has-top-spaced-small" id="printer-status-result"></div>
                    </div>
                    <div class="ts-divider"></div>
                    <div class="ts-content">
                        <div class="ts-wrap is-end-aligned">
                            <button type="button" class="ts-button" id="btn-printer-settings-close">關閉</button>
                        </div>
                    </div>
                </div>
            </dialog>
