<?php defined('PRINTAN_VIEW') || exit; ?>
    <!-- 使用說明：完整說明集中在這裡，頁面上其他地方只留欄位名稱＋必要時的 ⓘ 短提示。
         分頁切換見 ui-helpers.js wireHelpDialog()。 -->
    <dialog id="help-dialog" class="ts-modal is-large">
        <div class="content">
            <div class="ts-content">
                <div class="ts-header is-start-icon">
                    <span class="ts-icon is-circle-question-icon" aria-hidden="true"></span>
                    使用說明
                </div>
            </div>
            <div class="ts-tab is-dense is-segmented help-tabs" role="tablist">
                <a class="item" role="tab" data-help-tab="basic">基本操作</a>
                <a class="item" role="tab" data-help-tab="layout">版面元素</a>
                <a class="item" role="tab" data-help-tab="text">文字樣式</a>
                <a class="item" role="tab" data-help-tab="variables">文字與變數</a>
                <a class="item" role="tab" data-help-tab="fonts">字體</a>
                <a class="item" role="tab" data-help-tab="barcode">條碼</a>
                <a class="item" role="tab" data-help-tab="print">列印與校正</a>
                <a class="item" role="tab" data-help-tab="shortcuts">快捷鍵</a>
            </div>
            <div class="ts-content help-body">
                <div data-help-panel="basic">
                    <ul class="help-list">
                        <li>用工作區下方的工具列，或左側「版面結構」的「＋」新增元素；點選元素後到右側「元素設定」調整。</li>
                        <li>在工作區拖曳元素外框可調整順序；拖曳間隔、圖片、條碼的下緣調整高度，拖曳欄與欄之間的把手調整欄寬。</li>
                        <li>已選取的文字再點一次，可直接在紙上編輯；點紙外空白處取消選取。</li>
                        <li>工作區標題列可縮放與開關尺規；「1:1」是實際大小。虛線標出可列印範圍與切刀安全線。</li>
                        <li>版型自動存在這台電腦的瀏覽器；「匯出」可存成 .ptan 檔或 PDF。</li>
                    </ul>
                </div>
                <div data-help-panel="layout" hidden>
                    <ul class="help-list">
                        <li>「版面結構」列出所有元素。「最上層」與「第 N 欄」是容器，點選後新元素會加到那裡。</li>
                        <li>元素有文字、圖片、間隔（空白高度）、分隔線、條碼、多欄。</li>
                        <li>多欄可選 1/1、2/1、1/2、1/1/1 的欄寬比例，欄內可再放任何元素。</li>
                        <li>同層元素可用列上的上移／下移，或在工作區拖曳排序；在「版面結構」拖曳列可換層，放到「最上層」「第 N 欄」列上就移進該容器。</li>
                    </ul>
                </div>
                <div data-help-panel="text" hidden>
                    <ul class="help-list">
                        <li>在紙上或「元素設定」的文字框選取一段字，再套用粗體、斜體、底線、刪除線、反白（黑底白字）。</li>
                        <li>選取範圍可各自設定字體與字級（dot）；沒選取時設定的是整個文字元素的預設值。</li>
                        <li>對齊（靠左／置中／靠右）是整個文字元素的設定。</li>
                    </ul>
                </div>
                <div data-help-panel="variables" hidden>
                    <ul class="help-list">
                        <li>文字、圖片來源、條碼內容可寫 <code>{{名稱}}</code>，列印時換成實際資料。</li>
                        <li>「變數與預覽資料」會列出用到的變數，填入測試值即可在工作區預覽。</li>
                        <li>「批次資料」貼上 JSON 陣列，每筆資料輸出一頁 PDF（Mail Merge）。</li>
                    </ul>
                </div>
                <div data-help-panel="fonts" hidden>
                    <ul class="help-list">
                        <li>文字可選內建字體、等寬字體，或授權後使用本機字體。</li>
                        <li>.ptan 預設只記錄字體名稱；匯出時勾選「內嵌字體」，會帶入用到的等寬開源字體（只含用到的字，檔案會變大），換電腦也能照樣顯示。本機字體因授權不會內嵌，換電腦需自行安裝。</li>
                        <li>網頁字體沒載入成功時，預覽與列印會改用系統字體，並在工作區上方提示。</li>
                    </ul>
                </div>
                <div data-help-panel="barcode" hidden>
                    <ul class="help-list">
                        <li>支援 QR Code、Code128、EAN-13；內容可含 <code>{{變數}}</code>。</li>
                        <li>一維條碼可切換是否顯示明碼。</li>
                        <li>內容格式不符時會在「元素設定」提示；含變數的內容要套用資料後才會檢查。</li>
                    </ul>
                </div>
                <div data-help-panel="print" hidden>
                    <ul class="help-list">
                        <li>「列印設定」可連接印表機（USB 或序列埠，需 Chrome／Edge），並設定走紙、切紙、可列印點數、邊距校正。</li>
                        <li>直連印表機才有邊距校正；未連接時「列印」走系統列印對話框。</li>
                        <li>系統列印與 PDF 只能縮窄可列印寬度，沒有左側補白，邊距校正對它們無效。</li>
                        <li>邊距校正：按「校正紙」印出量尺，量出左右實際留白（mm）填入該紙寬的兩格；兩格都填才生效，清空即不校正。</li>
                        <li>測試列印可確認走紙與切紙位置；切紙前走紙不夠，切刀會切到剛印完的內容。</li>
                        <li>熱感圖示切換為 1-bit 抖動預覽，接近實際列印效果。</li>
                    </ul>
                </div>
                <div data-help-panel="shortcuts" hidden>
                    <ul class="help-list">
                        <li><kbd>Delete</kbd>：刪除選取的元素。</li>
                        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd>：復原；<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> 或 <kbd>Ctrl</kbd>+<kbd>Y</kbd>：重做。</li>
                        <li><kbd>Ctrl</kbd>+<kbd>D</kbd>：複製一份到下方；<kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd>：複製、貼上。</li>
                        <li><kbd>↑</kbd> <kbd>↓</kbd>：選取上一個／下一個元素；加 <kbd>Alt</kbd> 或 <kbd>Ctrl</kbd> 則移動它的順序。</li>
                        <li><kbd>Shift</kbd> 點選（同一層內）或在空白處拖曳框選：多選，右側可一起改共同欄位，Delete、Ctrl+D、方向鍵、復原都套用到全部。</li>
                        <li><kbd>Ctrl</kbd>+<kbd>G</kbd>：把選取的元素組成群組，可整體選取與拖曳；<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>：解散群組。</li>
                        <li><kbd>Esc</kbd>：取消選取、關閉選單或結束紙上的文字編輯。</li>
                        <li>欄寬拉桿：方向鍵微調，雙擊重設。</li>
                    </ul>
                </div>
            </div>
            <div class="ts-divider"></div>
            <div class="ts-content">
                <div class="ts-wrap is-end-aligned">
                    <button type="button" class="ts-button" id="btn-help-close">關閉</button>
                </div>
            </div>
        </div>
    </dialog>
