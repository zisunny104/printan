// 右側檢視器：依選取的元素類型組出對應的編輯面板。

import { BARCODE_FORMATS, BARCODE_FORMAT_INFO, validateBarcodeValue } from "../core/barcode.js";
import {
    DEFAULT_ROW_GAP, MIXED, resolveImageFit, resolveTextWidthMode, resolveTextHeightMode, resolveTextOverflow, resolveTextVAlign,
    resolveDividerDrawMode, resolveFill,
    applyStyleToRange, applyTextStylePreset, getRangeStyle, getTextContent, replaceFullText, TEXT_STYLE_PRESETS,
} from "../core/document-model.js";
import { MAX_ROW_GAP, normalizeRowGap, dotsToPt as dotsToPtRaw, ptToDots as ptToDotsRaw, dotsToMm, mmToDots } from "../core/units.js";
import { WEB_FONTS, findWebFont, isWebFontFailed } from "../core/web-fonts.js";
import { applyFieldToElements, findElementById, setRowRatio, splitRowColumn, MAX_ROW_COLUMNS } from "../core/element-tree.js";
import { createInfoIcon } from "./ui-helpers.js";
import {
    getLocalFontFamilies, isFontInstalled, isLocalFontAccessSupported, loadLocalFonts, localFontStack,
    primaryFamilyName,
} from "../core/fonts.js";
import {
    alignGroup, IMAGE_FIT_OPTIONS, IMAGE_SIDE_OPTIONS, checkboxInput, dropdownField, emptyState, field, fieldRow, foldSection, iconButton, iconToggleButton, mkButton, numberStepperInput, sectionDivider,
    sectionHeader, selectInput, sliderField, textInput,
} from "./inspector-widgets.js";
import { getEffectiveProfile, inlineEditor, onModelChange, textSel } from "./editor.js";
import { deleteElement, deleteElements, duplicateElement, duplicateElements, ungroupElements } from "./element-actions.js";
import { currentElements, els, rt, state } from "./context.js";

// 字級輸入介面單位：內部資料模型（fontSize/textSize）維持 dots 不動——渲染公式（renderer.js 一堆
// style.fontSize 相關換算）與 .ptan 舊檔都假設 dots。只在「輸入框顯示」這個邊界做 pt↔dots 換算，
// 換算公式本身在 units.js（樣式預設展開時也是同一份公式，見 document-model.js applyTextStylePreset）。
function dotsToPt(dots) {
    return dotsToPtRaw(dots, getEffectiveProfile().dpi.x);
}
function ptToDots(pt) {
    return ptToDotsRaw(pt, getEffectiveProfile().dpi.x);
}
// 分隔線粗細：dot 數字本身沒有實體大小概念，改比照 Word／Excel 框線粗細那種「細／普通／粗／特粗」
// 預設選單，標示 mm 讓使用者看得出「這條多粗」。色塊（fill）模式是拿來當裝飾色塊，預設值比線條粗上
// 一截。內部資料仍存 dot（渲染公式、.ptan 都是 dot），選單只是換算成 dot 存回去，兩者互相對得起來。
const DIVIDER_LINE_THICKNESS_PRESETS_MM = [
    ["細", 0.3], ["普通", 0.5], ["粗", 1], ["特粗", 2],
];
const DIVIDER_FILL_THICKNESS_PRESETS_MM = [
    ["細", 2], ["普通", 4], ["粗", 8], ["特粗", 12],
];
// 預設選單快速選常用粗細，下面永遠留一個 mm 數字輸入框可以打精確值（不用先選「自訂」才看得到、
// 也不會因為目前值剛好卡在某個預設值上就找不到自訂輸入框——兩者一直並存，改其中一個兩邊都會同步）。
function dividerThicknessSelect(el, presets) {
    const dpiX = getEffectiveProfile().dpi.x;
    const options = presets.map(([name, mm]) => [String(mmToDots(mm, dpiX)), `${name}（${mm} mm）`]);
    const current = String(el.thicknessDots);
    if (!options.some(([v]) => v === current)) {
        options.unshift([current, `目前（${dotsToMm(el.thicknessDots, dpiX).toFixed(1)} mm）`]);
    }
    const wrap = document.createElement("div");
    wrap.appendChild(selectInput(options, current, (v) => { el.thicknessDots = Number(v); onModelChange(); }));
    const mmInput = textInput(Number(dotsToMm(el.thicknessDots, dpiX).toFixed(2)), (v) => {
        if (v > 0) { el.thicknessDots = mmToDots(v, dpiX); onModelChange({ skipInspector: true }); }
    }, "number");
    const mmBox = mmInput.querySelector("input");
    mmBox.step = "0.1";
    mmBox.min = "0.1";
    wrap.appendChild(field("自訂 (mm)", mmInput));
    return wrap;
}

// 選取對象改變時通知訂閱者（小螢幕抽屜據此打開元素設定面板）；同一個元素重繪不會重發
let announcedSelection = null;

export function renderInspector() {
    const selection = state.selectedId || state.multi[0] || null;
    if (selection !== announcedSelection) {
        announcedSelection = selection;
        document.dispatchEvent(new CustomEvent("printan:selectionchange", { detail: { id: selection } }));
    }
    const panel = els.inspector;
    panel.innerHTML = "";
    if (state.multi.length > 1) {
        buildMultiInspector(panel, state.multi);
        return;
    }
    const el = state.selectedId ? findElementById(currentElements(), state.selectedId) : null;
    if (!el) {
        panel.appendChild(emptyState("sliders", "尚未選取元素"));
        return;
    }

    const builders = { text: buildTextInspector, image: buildImageInspector, "float-block": buildFloatBlockInspector, spacer: buildSpacerInspector, divider: buildDividerInspector, row: buildRowInspector, group: buildGroupInspector, barcode: buildBarcodeInspector };
    (builders[el.type] || (() => {}))(panel, el);

    panel.appendChild(sectionDivider());
    const actions = document.createElement("div");
    actions.className = "ts-wrap is-compact";
    const dupBtn = mkButton("複製", "copy", () => duplicateElement(el.id));
    const delBtn = mkButton("刪除", "trash", () => deleteElement(el.id), { negative: true });
    actions.append(dupBtn, delBtn);
    panel.appendChild(actions);
}

// 多選：只列出「所有選取元素都有」的欄位，值不同時顯示「混合」，改了就套用到全部。
const MULTI_FIELDS = [
    { key: "fontSize", label: "字級 (pt)", kind: "number", types: ["text"], runField: true },
    { key: "bold", label: "粗體", kind: "bool", types: ["text"], runField: true },
    { key: "inverse", label: "容器底色反轉（黑底白字）", kind: "bool", types: ["text"] },
    { key: "lineHeight", label: "行高", kind: "number", types: ["text"] },
    { key: "letterSpacing", label: "字距", kind: "number", types: ["text"] },
    { key: "align", label: "對齊", kind: "align", types: ["text", "image", "barcode"] },
    { key: "heightDots", label: "高度", kind: "number", types: ["spacer", "barcode"] },
    { key: "widthPercent", label: "寬度 %", kind: "number", types: ["image"] },
    { key: "drawMode", label: "畫法", kind: "select", options: [["line", "線條"], ["fill", "色塊"]], types: ["divider"] },
    { key: "style", label: "樣式", kind: "select", options: [["solid", "實線"], ["dashed", "虛線"], ["dotted", "點線"]], types: ["divider"] },
    { key: "thicknessDots", label: "粗細", kind: "number", types: ["divider"] },
    { key: "marginTopDots", label: "上邊距", kind: "number", types: ["divider"] },
    { key: "marginBottomDots", label: "下邊距", kind: "number", types: ["divider"] },
];

function buildMultiInspector(panel, ids) {
    const selected = ids.map((id) => findElementById(currentElements(), id)).filter(Boolean);
    panel.appendChild(sectionHeader("shapes", `已選 ${selected.length} 個元素`));
    const apply = (spec, value) => {
        applyFieldToElements(selected, spec.key, value, { runField: spec.runField }); // 片段自己的覆寫要一併清掉才看得到效果
        if (PRESET_BACKED_FIELDS.includes(spec.key)) {
            for (const el of selected) delete el.stylePreset; // 跟單一元素路徑一致：改了展開欄位就不再是套用預設的樣子
        }
        onModelChange({ skipInspector: true });
    };
    let shown = 0;
    for (const spec of MULTI_FIELDS) {
        if (!selected.every((el) => spec.types.includes(el.type))) continue;
        shown++;
        const values = selected.map((el) => el[spec.key]);
        const mixed = values.some((v) => v !== values[0]);
        let input;
        if (spec.kind === "number") {
            const isFontSize = spec.key === "fontSize"; // 字級用 pt 顯示，其餘 dot 數值欄位不動，見上方 dotsToPt/ptToDots 說明
            input = textInput(mixed ? "" : (isFontSize ? dotsToPt(values[0]) : values[0]), () => {}, "number");
            const box = input.querySelector("input");
            box.placeholder = mixed ? "混合" : "";
            box.addEventListener("input", () => { if (box.value !== "") apply(spec, isFontSize ? ptToDots(Number(box.value)) : Number(box.value)); });
        } else if (spec.kind === "align") {
            input = alignGroup(mixed ? null : values[0], (v) => apply(spec, v));
        } else {
            const options = spec.kind === "bool" ? [["1", "是"], ["0", "否"]] : spec.options;
            const current = spec.kind === "bool" ? (values[0] ? "1" : "0") : values[0];
            input = selectInput(mixed ? [["__mixed", "混合"], ...options] : options, mixed ? "__mixed" : current, (v) => {
                if (v !== "__mixed") apply(spec, spec.kind === "bool" ? v === "1" : v);
            });
        }
        panel.appendChild(field(spec.label, input));
    }
    if (!shown) panel.appendChild(emptyState("sliders", "沒有共同欄位"));

    panel.appendChild(sectionDivider());
    const actions = document.createElement("div");
    actions.className = "ts-wrap is-compact";
    actions.append(
        mkButton("複製", "copy", () => duplicateElements(ids)),
        mkButton("刪除", "trash", () => deleteElements(ids), { negative: true }),
    );
    panel.appendChild(actions);
}

// 可選字體（比照 Figma 對齊等段落屬性維持在元素層級，這裡列的字體/字級/粗體/
// 斜體/底線/刪除線則是「片段（run）」層級，同一個文字元素裡的每個片段可以各自
// 覆寫；片段沒指定時繼承這份清單第一項以外的元素預設值（見 renderer.js resolveRunStyle）。
const FONT_CHOICES = [
    ['"Noto Sans TC", "Microsoft JhengHei", sans-serif', "思源黑體"],
    ['"Noto Serif TC", PMingLiU, serif', "思源宋體"],
    ['DFKai-SB, BiauKai, "Kaiti TC", serif', "標楷體"],
    ["ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", "系統等寬"],
    ...WEB_FONTS.map((font) => [font.stack, font.label]),
];

/**
 * 字體下拉選單（段落預設字體與選取範圍字體共用）：leading 是最前面的固定選項，接著內建清單，
 * 授權過本機字體就再接一組「本機字體」；目前值不在清單裡（例如 .ptan 來自別台電腦的本機字體）就補一項並標明這台電腦有沒有。
 */
function buildFontSelect({ value, leading, disabled = false, onChange }) {
    const fontChoices = FONT_CHOICES.map(([v, label]) => [
        v, findWebFont(v) && isWebFontFailed(findWebFont(v).id) ? `${label}（載入失敗，暫用系統字體）` : label,
    ]);
    const groups = [[null, [...leading, ...fontChoices]]];

    const localFonts = getLocalFontFamilies();
    if (localFonts.length) groups.push(["本機字體", localFonts.map((family) => [localFontStack(family), family])]);

    const known = new Set(groups.flatMap(([, options]) => options.map(([v]) => v)));
    if (value && value !== MIXED && !known.has(value)) {
        const name = primaryFamilyName(value);
        groups.push([null, [[value, isFontInstalled(name) ? `${name}（本機字體）` : `${name}（此電腦沒有）`]]]);
    }

    const { el } = dropdownField(groups, value === MIXED ? "__mixed__" : (value || ""), (v) => onChange(v || null), { disabled });
    return el;
}

function fontFamilySelect(value, onChange, inheritLabel) {
    return buildFontSelect({ value, leading: [["", inheritLabel]], onChange });
}

/** 「使用本機字體」入口：授權後把這台電腦的字體併入所有字體下拉選單；瀏覽器不支援 Local Font Access 時整個不顯示。 */
function localFontEntry() {
    if (!isLocalFontAccessSupported()) return null;
    const wrap = document.createElement("div");
    wrap.className = "has-top-spaced-small";
    const note = document.createElement("div");
    note.className = "ts-text is-small is-description has-top-spaced-small";
    const count = getLocalFontFamilies().length;
    const info = createInfoIcon("允許後可選用本機字體；.ptan 只記字體名稱，沒有該字體的電腦改用預設字體");
    if (count) {
        note.append(`已加入 ${count} 款本機字體`, info);
        wrap.appendChild(note);
        return wrap;
    }
    const button = mkButton("使用本機字體", "font", async () => {
        button.disabled = true;
        try {
            await loadLocalFonts();
            renderInspector();
        } catch (err) {
            button.disabled = false;
            note.hidden = false;
            note.className = "ts-text is-small is-negative has-top-spaced-small";
            note.textContent = err.name === "NotAllowedError" || err.name === "SecurityError"
                ? "沒有取得本機字體的存取權限，請在瀏覽器詢問時選擇「允許」。"
                : `無法讀取本機字體：${err.message}`;
        }
    });
    note.hidden = true;
    wrap.append(button, info, note);
    return wrap;
}

/** 選取範圍樣式工具列上的單一切換按鈕；value 為 MIXED 時顯示「混合」視覺狀態，沒有選取範圍時停用。 */
function rangeToggleButton(icon, label, value, hasRange, onToggle) {
    const isMixed = value === MIXED;
    const active = value === true;
    const btn = document.createElement("button");
    btn.className = "ts-button is-icon is-outlined is-small";
    btn.classList.toggle("is-active", active);
    btn.classList.toggle("is-mixed", isMixed);
    btn.type = "button";
    btn.disabled = !hasRange;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", String(active));
    btn.dataset.tooltip = label;
    btn.innerHTML = `<span class="ts-icon is-${icon}-icon" aria-hidden="true"></span>`;
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggle(isMixed ? true : !active);
    });
    return btn;
}

function rangeFontFamilySelect(value, hasRange, onChange) {
    const leading = [["", "跟隨段落預設"]];
    if (value === MIXED) leading.unshift(["__mixed__", "混合"]);
    return buildFontSelect({ value, leading, disabled: !hasRange, onChange });
}

function rangeFontSizeInput(value, hasRange, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "ts-input is-small is-fluid";
    const input = document.createElement("input");
    input.type = "number";
    input.disabled = !hasRange;
    if (value === MIXED) {
        input.value = "";
        input.placeholder = "混合";
    } else {
        input.value = value ? dotsToPt(value) : "";
    }
    input.addEventListener("input", () => onChange(input.value ? ptToDots(Number(input.value)) : null));
    wrap.appendChild(input);
    return wrap;
}

// 文字自由寬高的 icon group 選項（比照 IMAGE_FIT_OPTIONS 的自製示意圖風格；svgIcon 是 inspector-widgets.js 內部私有函式，這裡不共用，直接寫死小張 SVG）。
const textSvgIcon = (body) => `<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const TEXT_WIDTH_MODE_OPTIONS = [
    ["column", "沿用欄寬", textSvgIcon('<path d="M1.5 1.5v13M14.5 1.5v13"/><rect x="4" y="4.5" width="8" height="3" fill="currentColor"/><rect x="4" y="9" width="5" height="3" fill="currentColor"/>')],
    ["fixed", "固定寬度", textSvgIcon('<path d="M2 1.5v13M9 1.5v13" stroke-dasharray="2 1.5"/><rect x="2" y="4.5" width="7" height="3" fill="currentColor"/><rect x="2" y="9" width="7" height="3" fill="currentColor"/>')],
];
const TEXT_OVERFLOW_OPTIONS = [
    ["grow", "自動變高", textSvgIcon('<rect x="2" y="1.5" width="12" height="7" rx="1" stroke-dasharray="2 1.5"/><path d="M8 5v7M5.5 9.5 8 12l2.5-2.5"/>')],
    ["clip", "裁切", textSvgIcon('<rect x="2" y="1.5" width="12" height="6" rx="1" fill="currentColor" fill-opacity=".15"/><path d="M2 7.5h12" stroke-dasharray="1.5 1.5"/>')],
];
// 框內容垂直位置：外框虛線示意固定高度的框，實心色塊代表內容貼齊的位置（頂／中／底）
const TEXT_VALIGN_OPTIONS = [
    ["top", "靠上", textSvgIcon('<rect x="2" y="1.5" width="12" height="13" rx="1" stroke-dasharray="2 1.5"/><rect x="4" y="3.5" width="8" height="3" fill="currentColor"/>')],
    ["middle", "置中", textSvgIcon('<rect x="2" y="1.5" width="12" height="13" rx="1" stroke-dasharray="2 1.5"/><rect x="4" y="6.5" width="8" height="3" fill="currentColor"/>')],
    ["bottom", "靠下", textSvgIcon('<rect x="2" y="1.5" width="12" height="13" rx="1" stroke-dasharray="2 1.5"/><rect x="4" y="9.5" width="8" height="3" fill="currentColor"/>')],
];

// 樣式預設選單：每個選項直接秀縮小後的實際樣子（字級比例／粗細），不用純文字標籤，
// 這樣不用先套用才知道「H2」長怎樣。標籤直接用 H1-H5／P（見 document-model.js TEXT_STYLE_PRESETS
// 開頭說明），不轉中文說法，方便之後對照 Markdown 的標題階層。
const TEXT_STYLE_PRESET_INFO = "標籤對應 Markdown 的標題階層（H1-H5）與本文（P），套用後會展開成" +
    "字級／粗體／行高等具體欄位，之後仍可個別手動調整；手動調整這些欄位後會自動改回「自訂」，" +
    "不會被預設值蓋回去。";
// 樣式預設展開後的具體欄位（見 document-model.js TEXT_STYLE_PRESETS）：單一元素與多選共用
// 這份清單，任一欄位被手動改動都代表元素不再是單純套用預設的樣子，要清掉 stylePreset 標記。
const PRESET_BACKED_FIELDS = ["fontSize", "bold", "lineHeight", "letterSpacing"];

// 「容器底色」選單：多一個「無」對應 el.inverse=false（見 buildTextInspector），其餘沿用 fillFields
// 的模式名稱，但「純黑」在這裡改叫「反轉」，比較貼近使用者實際感受到的效果（黑底白字）。
// 填色方式按鈕直接用色票（實際填色效果的縮圖）取代抽象圖示，跟工具列的粗體/斜體一樣是單選圖示按鈕組。
const fillSwatch = (bg) => `<span class="fill-swatch" style="background:${bg}" aria-hidden="true"></span>`;
const SWATCH_SOLID = fillSwatch("#000");
const SWATCH_HALFTONE = fillSwatch("radial-gradient(circle, #000 34%, transparent 36%) 0 0/40% 40%, #fff");
const SWATCH_GRADIENT = fillSwatch("linear-gradient(135deg, #000, #fff)");
const INK_FILL_MODE_OPTIONS = [["solid", "純黑", SWATCH_SOLID], ["halftone", "網點", SWATCH_HALFTONE], ["gradient", "漸層", SWATCH_GRADIENT]];
// 「無」「反轉」是狀態／動作不是顏色，用圖示比色票更好懂；網點／漸層是實際填色效果，用色票。
const BG_FILL_MODE_OPTIONS = [["none", "無", "ban"], ["solid", "反轉", "circle-half-stroke"], ["halftone", "網點", SWATCH_HALFTONE], ["gradient", "漸層", SWATCH_GRADIENT]];
const FILL_DIRECTION_OPTIONS = [["horizontal", "水平", fillSwatch("linear-gradient(90deg, #000, #fff)")], ["vertical", "垂直", fillSwatch("linear-gradient(180deg, #000, #fff)")]];

// 每個選項左邊放縮小後的實際樣子（字級比例／粗細）、右邊放階層標籤（H1-H5／P），
// 觸發鈕與選單裡的每一列共用同一份內容，比照 Word／Docs 那種段落樣式下拉選單。
function styleOptionRow(key) {
    const row = document.createDocumentFragment();
    const preset = TEXT_STYLE_PRESETS[key];
    const sample = document.createElement("span");
    sample.className = "style-preset-sample";
    // pt 數字偏小，*1.3 讓縮圖看得出對比；但 H1~H5 實際字級差距很大（8pt~20pt），直接照比例縮放
    // 會讓選單每一列高度落差很大（H1 那列爆大、H5 那列擠成一條），這裡夾在合理範圍內讓每列高度接近一致，
    // 大小關係還是看得出來（H1 明顯比 H5 大），只是不會整個選單看起來忽大忽小。
    sample.style.fontSize = `${Math.min(22, Math.max(14, Math.round(preset.fontSizePt * 1.3)))}px`;
    sample.style.fontWeight = preset.bold ? "700" : "400";
    sample.textContent = "Aa";
    const label = document.createElement("span");
    label.className = "ts-text is-description style-preset-label";
    label.textContent = key;
    row.append(sample, label);
    return row;
}

let stylePresetDropdownSeq = 0;

function textStylePresetPicker(current, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "dropdown-select style-preset-dropdown has-top-spaced-small";
    const menuId = `style-preset-dropdown-${++stylePresetDropdownSeq}`;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ts-button is-small is-outlined is-fluid dropdown-select-trigger";
    trigger.dataset.dropdown = menuId;
    trigger.setAttribute("aria-haspopup", "listbox");
    const triggerContent = document.createElement("span");
    triggerContent.className = "style-preset-trigger-content";
    const caret = document.createElement("span");
    caret.className = "ts-icon is-chevron-down-icon dropdown-select-caret";
    caret.setAttribute("aria-hidden", "true");
    trigger.append(triggerContent, caret);

    const menu = document.createElement("div");
    menu.id = menuId;
    menu.className = "ts-dropdown dropdown-select-menu style-preset-dropdown-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "文字樣式");

    const items = [];
    for (const key of Object.keys(TEXT_STYLE_PRESETS)) {
        const item = document.createElement("a");
        item.className = "item style-preset-item";
        item.dataset.value = key;
        item.setAttribute("role", "option");
        item.appendChild(styleOptionRow(key));
        item.addEventListener("click", () => setValue(item.classList.contains("is-active") ? null : key, true)); // 再點一次目前已選的＝改回自訂
        menu.appendChild(item);
        items.push(item);
    }

    function setValue(value, fire) {
        triggerContent.innerHTML = "";
        const match = items.find((it) => it.dataset.value === value);
        triggerContent.appendChild(match ? styleOptionRow(value) : document.createTextNode("自訂"));
        items.forEach((it) => it.classList.toggle("is-active", it === match));
        if (fire) onChange(value);
    }
    setValue(current, false);

    wrap.append(trigger, menu);
    wrap.setValue = setValue; // 供 clearPresetPickerActiveState 在欄位手動編輯後同步回「自訂」
    return wrap;
}

// 手動編輯展開後的欄位時要把樣式選單同步回「自訂」，但不能靠整個重繪 inspector 來做——
// 那會摧毀使用者正在輸入、持有焦點的欄位（例如打第二個數字時整個 input 被換成新節點，
// 焦點跟著消失，後續按鍵變成打到別的地方）。直接呼叫既有節點的 setValue，欄位輸入不受影響。
function clearPresetPickerActiveState(group) {
    group.setValue?.(null, false);
}

// fontSize／bold／lineHeight／letterSpacing 是樣式預設展開後的具體欄位（見 document-model.js
// TEXT_STYLE_PRESETS）：使用者手動改了其中任一個，代表這個元素已經不是單純套用預設的樣子，
// 把標記清掉退回「自訂」，不動其餘欄位、不跳提示，維持操作單純；一律沿用 skipInspector
// 保留輸入欄位的焦點，樣式選單改用 clearPresetPickerActiveState 直接同步視覺狀態。
function applyParagraphField(el, presetGroup, mutate) {
    const hadPreset = !!el.stylePreset;
    mutate();
    if (hadPreset) {
        delete el.stylePreset;
        clearPresetPickerActiveState(presetGroup);
    }
    onModelChange({ skipInspector: true });
}

function buildTextInspector(panel, el) {
    panel.appendChild(sectionHeader("font", "文字樣式", TEXT_STYLE_PRESET_INFO));
    const presetGroup = textStylePresetPicker(el.stylePreset || null, (preset) => {
        applyTextStylePreset(el, preset, getEffectiveProfile().dpi.x);
        onModelChange(); // 展開後的字級／粗體／行高／字距欄位在下面「段落樣式」要一併重繪，不能只 skipInspector
    });
    panel.appendChild(presetGroup);
    panel.appendChild(sectionDivider());

    panel.appendChild(sectionHeader("align-left", "內容", VARIABLE_INFO));

    const sel = textSel;
    const live = inlineEditor.isEditing(el.id) ? inlineEditor.getSelection() : null;
    sel.start = live ? live.start : 0;
    sel.end = live ? live.end : 0;
    const toolbar = document.createElement("div");
    toolbar.className = "pane-toolbar has-top-spaced-small";
    toolbar.addEventListener("mousedown", (e) => e.preventDefault()); // 按工具列不搶走預覽區編輯框的焦點／選取
    const styleRow = document.createElement("div");

    const textareaWrap = document.createElement("div");
    textareaWrap.className = "ts-input is-small is-fluid has-top-spaced-small";
    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.setAttribute("aria-label", "文字內容");
    textarea.value = getTextContent(el);
    textareaWrap.appendChild(textarea);
    // 內容在最上面，選取文字後的樣式（工具列、字體字級）緊接在下
    panel.appendChild(textareaWrap);
    panel.appendChild(toolbar);
    panel.appendChild(styleRow);

    function renderStyleControls() {
        const hasRange = sel.start !== sel.end;
        const style = getRangeStyle(el, sel.start, sel.end);
        // 工具列按鈕點擊時焦點仍留在 textarea（見上面 mousedown 的 preventDefault），
        // 所以這裡照常整個重建沒問題；只有 styleRow 底下自己的欄位（字級 input 等）
        // 才可能在使用者打字中途、欄位本身持有焦點時被呼叫到。
        toolbar.innerHTML = "";
        toolbar.appendChild(rangeToggleButton("bold", "粗體", style.bold, hasRange, (v) => applyRangeStyle("bold", v)));
        toolbar.appendChild(rangeToggleButton("italic", "斜體", style.italic, hasRange, (v) => applyRangeStyle("italic", v)));
        toolbar.appendChild(rangeToggleButton("underline", "底線", style.underline, hasRange, (v) => applyRangeStyle("underline", v)));
        toolbar.appendChild(rangeToggleButton("strikethrough", "刪除線", style.strikethrough, hasRange, (v) => applyRangeStyle("strikethrough", v)));
        toolbar.appendChild(rangeToggleButton("circle-half-stroke", "反相", style.inverse, hasRange, (v) => applyRangeStyle("inverse", v)));

        // 目前有焦點的欄位（例如正在打字的字級 input）就不整個重建 styleRow：
        // innerHTML = "" 會把使用者正在輸入、持有焦點的 DOM node 整個摧毀重建，
        // 新節點不會拿到焦點，導致打字被截斷、焦點跑掉後下一個按鍵變成取代到別處的選取內容。
        // 欄位失焦後下一次選取／編輯事件會再觸發一次完整重繪，資料仍會同步。
        if (styleRow.contains(document.activeElement)) return;
        styleRow.innerHTML = "";
        styleRow.appendChild(fieldRow([
            ["字體", rangeFontFamilySelect(style.fontFamily, hasRange, (v) => applyRangeStyle("fontFamily", v))],
            ["字級 (pt)", rangeFontSizeInput(style.fontSize, hasRange, (v) => applyRangeStyle("fontSize", v))],
        ]));
        const localEntry = localFontEntry();
        if (localEntry) styleRow.appendChild(localEntry);
    }

    function applyRangeStyle(field, value) {
        applyStyleToRange(el, sel.start, sel.end, field, value);
        onModelChange({ skipInspector: true });
        inlineEditor.refresh();
        renderStyleControls();
    }

    function trackSelection() {
        sel.start = textarea.selectionStart;
        sel.end = textarea.selectionEnd;
        renderStyleControls();
    }
    ["select", "keyup", "mouseup", "click", "focus"].forEach((evt) => textarea.addEventListener(evt, trackSelection));
    textarea.addEventListener("input", () => {
        replaceFullText(el, textarea.value);
        inlineEditor.refresh(); // 行內編輯框開著時內容要同步，否則會以舊內容蓋住畫布
        onModelChange({ skipInspector: true });
        trackSelection();
    });

    sel.refresh = renderStyleControls;
    renderStyleControls();

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("font", "段落樣式"));
    panel.appendChild(fieldRow([
        ["預設字體", fontFamilySelect(el.fontFamily, (v) => { el.fontFamily = v; onModelChange({ skipInspector: true }); }, "跟隨全域預設")],
        ["預設字級 (pt)", textInput(dotsToPt(el.fontSize), (v) => applyParagraphField(el, presetGroup, () => { el.fontSize = ptToDots(v); }), "number")],
    ]));
    // 水平對齊跟垂直對齊是同一組「對齊」概念，擺在一起比照 Figma 的做法；
    // 垂直對齊只有固定高度的容器才有意義（沒有多的高度可以分配），所以高度為自動時不顯示，
    // 但位置緊接在水平對齊旁邊，不會像之前那樣被拆到後面「寬高」區塊裡讓人找不到。
    const heightFixedForAlign = el.type === "text" && resolveTextHeightMode(el) === "fixed";
    if (heightFixedForAlign) {
        panel.appendChild(fieldRow([
            ["水平對齊", alignGroup(el.align, (v) => { el.align = v; onModelChange({ skipInspector: true }); })],
            ["垂直對齊", alignGroup(resolveTextVAlign(el), (v) => { el.vAlign = v; onModelChange({ skipInspector: true }); }, "垂直對齊", TEXT_VALIGN_OPTIONS)],
        ]));
    } else {
        panel.appendChild(field("對齊", alignGroup(el.align, (v) => { el.align = v; onModelChange({ skipInspector: true }); })));
    }
    panel.appendChild(field(null, checkboxInput(el.bold, (v) => applyParagraphField(el, presetGroup, () => { el.bold = v; }), "預設粗體")));

    panel.appendChild(foldSection(`${el.type}.inkFill`, "文字顏色", (body) => {
        const inkFill = resolveFill(el.inkFill);
        body.appendChild(fillFields(inkFill, (patch, redraw) => {
            el.inkFill = { ...inkFill, ...patch };
            onModelChange(redraw ? {} : { skipInspector: true });
        }));
    }));
    // 「容器底色」統一 el.inverse（開關）＋ el.bgFill（樣式）：選「無」等於 inverse=false（bgFill 設定保留，
    // 下次選別的樣式不用重設）；選反轉／網點／漸層等於 inverse=true 並把 bgFill.mode 設成對應值。
    // 局部反白（富文字工具列的反白鈕）跟這個相抵的效果在 renderer.js 已經處理，這裡不用管。
    panel.appendChild(foldSection(`${el.type}.bgFill`, "容器底色", (body) => {
        const bgFill = resolveFill(el.bgFill);
        const mode = el.inverse ? bgFill.mode : "none";
        body.appendChild(field("填色方式", alignGroup(mode, (v) => {
            if (v === "none") { el.inverse = false; onModelChange(); return; }
            el.inverse = true;
            el.bgFill = { ...bgFill, mode: v };
            onModelChange();
        }, "填色方式", BG_FILL_MODE_OPTIONS)));
        if (mode === "halftone") {
            body.appendChild(sliderField("網點濃度", bgFill.level, 0, 255, (v) => {
                el.bgFill = { ...bgFill, level: v };
                onModelChange({ skipInspector: true });
            }));
        } else if (mode === "gradient") {
            body.appendChild(field("方向", alignGroup(
                bgFill.direction,
                (v) => { el.bgFill = { ...bgFill, direction: v }; onModelChange({ skipInspector: true }); },
                "方向", FILL_DIRECTION_OPTIONS,
            )));
            body.appendChild(field(null, checkboxInput(bgFill.reverse, (v) => {
                el.bgFill = { ...bgFill, reverse: v };
                onModelChange({ skipInspector: true });
            }, "反轉方向（深到淺）")));
        }
    }));

    panel.appendChild(foldSection(`${el.type}.layout`, "排版", (body) => {
        body.appendChild(fieldRow([
            ["行高倍數", numberStepperInput(el.lineHeight, (v) => applyParagraphField(el, presetGroup, () => { el.lineHeight = v; }), { icon: "text-height", step: 0.1, min: 0.5, precision: 2 })],
            ["字距 (dot)", numberStepperInput(el.letterSpacing, (v) => applyParagraphField(el, presetGroup, () => { el.letterSpacing = v; }), { icon: "arrows-left-right", step: 1, bigStep: 5 })],
        ]));
        body.appendChild(field("最多行數", textInput(el.maxLines || "", (v) => { el.maxLines = v; onModelChange({ skipInspector: true }); }, "number", "不限")));
        body.appendChild(field(null, checkboxInput(el.wrap, (v) => { el.wrap = v; onModelChange({ skipInspector: true }); }, "自動換行")));
        if (el.type === "float-block") return; // 圖文段落只支援橫書
        const modeRow = document.createElement("div");
        modeRow.className = "ts-wrap is-compact has-top-spaced-small";
        const vertical = el.writingMode === "vertical";
        modeRow.appendChild(iconToggleButton("grip-lines", "橫書", !vertical, () => { el.writingMode = "horizontal"; onModelChange(); }));
        modeRow.appendChild(iconToggleButton("grip-lines-vertical", "直書", vertical, () => { el.writingMode = "vertical"; onModelChange(); }));
        body.appendChild(modeRow);
    }));

    // 自由寬高：只給純文字元素用，圖文段落（float-block）版面是圖＋文繞排的另一套邏輯，這兩個欄位對它沒作用，不顯示避免誤導。
    if (el.type === "text") {
        panel.appendChild(foldSection("text.box", "寬高", (body) => {
            const widthMode = resolveTextWidthMode(el);
            body.appendChild(field("寬度", alignGroup(widthMode, (v) => {
                el.widthMode = v;
                if (v === "fixed" && !(el.widthDots > 0)) el.widthDots = 300; // 第一次切到固定寬度給個非 0 起始值
                onModelChange();
            }, "寬度模式", TEXT_WIDTH_MODE_OPTIONS)));
            if (widthMode === "fixed") {
                const wInput = textInput(el.widthDots || 0, (v) => {
                    if (!(v > 0)) return;
                    el.widthDots = Math.round(v);
                    onModelChange({ skipInspector: true });
                }, "number");
                Object.assign(wInput.querySelector("input"), { min: 1, step: 1 });
                body.appendChild(field("寬度 (dot)", wInput));
            }
            const heightFixed = resolveTextHeightMode(el) === "fixed";
            body.appendChild(field(null, checkboxInput(heightFixed, (checked) => {
                el.heightMode = checked ? "fixed" : "auto";
                if (checked && !(el.heightDots > 0)) el.heightDots = 200;
                onModelChange();
            }, "固定高度")));
            if (heightFixed) {
                const hInput = textInput(el.heightDots || 0, (v) => {
                    if (!(v > 0)) return;
                    el.heightDots = Math.round(v);
                    onModelChange({ skipInspector: true });
                }, "number");
                Object.assign(hInput.querySelector("input"), { min: 1, step: 1 });
                body.appendChild(field("高度 (dot)", hInput));
                body.appendChild(field("超出處理", alignGroup(resolveTextOverflow(el), (v) => {
                    el.overflow = v;
                    onModelChange();
                }, "超出處理", TEXT_OVERFLOW_OPTIONS)));
            }
        }));
    }
}

// 圖文段落：上半是圖片（來源、左右、寬度），下半直接沿用文字元素的內容與段落樣式。
function buildFloatBlockInspector(panel, el) {
    panel.appendChild(sectionHeader("image", "圖片"));
    const sideRow = document.createElement("div");
    sideRow.className = "ts-wrap is-compact has-top-spaced-small";
    sideRow.appendChild(mkButton(el.assetId ? "更換圖片" : "選擇圖片", "upload", () => {
        rt.imageFileInputHandler = (assetId) => {
            el.assetId = assetId;
            el.cropRect = null;
            onModelChange();
        };
        els["image-file-input"].click();
    }, { outlined: true }));
    panel.appendChild(sideRow);
    panel.appendChild(field("圖片位置", alignGroup(el.imageSide === "right" ? "right" : "left", (v) => { el.imageSide = v; onModelChange({ skipInspector: true }); }, "圖片位置", IMAGE_SIDE_OPTIONS)));
    const widthInput = textInput(Math.max(1, Math.min(100, el.widthPercent ?? 40)), (v) => {
        if (!(v > 0)) return;
        el.widthPercent = Math.min(100, Math.max(1, v));
        onModelChange({ skipInspector: true });
    }, "number");
    Object.assign(widthInput.querySelector("input"), { min: 1, max: 100, step: 1 });
    panel.appendChild(field("寬度 (%)", widthInput));
    panel.appendChild(sectionDivider());
    buildTextInspector(panel, el);
}

function resolveAssetDataUrl(assetId) {
    const asset = state.project.assets.find((a) => a.id === assetId);
    return asset ? asset.dataUrl : null;
}

function loadImageElement(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

/** 圖片元素的裁切工具：canvas 顯示「旋轉後」的圖片，疊一層可拖曳/縮放的裁切框。
 * cropRect 儲存在 el 上為 0-1 正規化座標，相對旋轉後的圖片（與 renderer.js 的裁切邏輯一致）。 */
function buildCropTool(el) {
    const wrap = document.createElement("div");
    wrap.className = "image-crop-tool";
    const dataUrl = resolveAssetDataUrl(el.assetId);
    if (!dataUrl) {
        wrap.hidden = true;
        return wrap;
    }

    const canvas = document.createElement("canvas");
    const box = document.createElement("div");
    box.className = "image-crop-box";
    ["nw", "ne", "sw", "se"].forEach((pos) => {
        const handle = document.createElement("div");
        handle.className = `image-crop-handle is-${pos}`;
        handle.dataset.pos = pos;
        box.appendChild(handle);
    });
    wrap.appendChild(canvas);
    wrap.appendChild(box);

    function currentRect() {
        return el.cropRect || { x: 0, y: 0, w: 1, h: 1 };
    }

    function layoutBox() {
        const r = currentRect();
        box.style.left = `${r.x * 100}%`;
        box.style.top = `${r.y * 100}%`;
        box.style.width = `${r.w * 100}%`;
        box.style.height = `${r.h * 100}%`;
    }

    function setCropRect(next) {
        const MIN = 0.04;
        let w = Math.max(MIN, Math.min(1, next.w));
        let h = Math.max(MIN, Math.min(1, next.h));
        const x = Math.max(0, Math.min(1 - w, next.x));
        const y = Math.max(0, Math.min(1 - h, next.y));
        el.cropRect = { x, y, w, h };
        layoutBox();
        onModelChange({ skipInspector: true });
    }

    box.addEventListener("pointerdown", (e) => {
        const handlePos = e.target instanceof HTMLElement ? e.target.dataset.pos : null;
        e.preventDefault();
        e.stopPropagation();
        box.setPointerCapture(e.pointerId);
        const startRect = currentRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const rect = canvas.getBoundingClientRect();
        const move = (ev) => {
            const dxFrac = (ev.clientX - startX) / rect.width;
            const dyFrac = (ev.clientY - startY) / rect.height;
            if (!handlePos) {
                setCropRect({ ...startRect, x: startRect.x + dxFrac, y: startRect.y + dyFrac });
                return;
            }
            let { x, y, w, h } = startRect;
            if (handlePos.includes("w")) { x = startRect.x + dxFrac; w = startRect.w - dxFrac; }
            if (handlePos.includes("e")) { w = startRect.w + dxFrac; }
            if (handlePos.includes("n")) { y = startRect.y + dyFrac; h = startRect.h - dyFrac; }
            if (handlePos.includes("s")) { h = startRect.h + dyFrac; }
            setCropRect({ x, y, w, h });
        };
        const up = () => {
            box.releasePointerCapture(e.pointerId);
            box.removeEventListener("pointermove", move);
            box.removeEventListener("pointerup", up);
        };
        box.addEventListener("pointermove", move);
        box.addEventListener("pointerup", up);
    });

    (async () => {
        const img = await loadImageElement(dataUrl);
        if (!img) { wrap.hidden = true; return; }
        const rotation = ((el.rotation || 0) % 360 + 360) % 360;
        const swapped = rotation === 90 || rotation === 270;
        const rotatedW = swapped ? img.naturalHeight : img.naturalWidth;
        const rotatedH = swapped ? img.naturalWidth : img.naturalHeight;
        const scale = Math.min(1, 260 / rotatedW);
        canvas.width = Math.max(1, Math.round(rotatedW * scale));
        canvas.height = Math.max(1, Math.round(rotatedH * scale));
        const ctx = canvas.getContext("2d");
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        const drawW = img.naturalWidth * scale;
        const drawH = img.naturalHeight * scale;
        ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        ctx.restore();
        layoutBox();
    })();

    return wrap;
}

function buildImageInspector(panel, el) {
    panel.appendChild(sectionHeader("image", "圖片來源"));
    const isVariable = typeof el.assetId === "string" && /\{\{.*\}\}/.test(el.assetId);

    const pickBtn = mkButton(el.assetId && !isVariable ? "更換圖片" : "選擇圖片", "upload", () => {
        rt.imageFileInputHandler = (assetId) => {
            el.assetId = assetId;
            el.cropRect = null; // 換圖後舊的裁切窗格對新圖不再有意義
            onModelChange();
        };
        els["image-file-input"].click();
    }, { outlined: true });

    const varInput = textInput(el.assetId || "", (v) => { el.assetId = v; onModelChange({ skipInspector: true }); });
    varInput.querySelector("input").placeholder = "{{image}}";
    varInput.querySelector("input").setAttribute("aria-label", "圖片變數");
    const varWrap = field(null, varInput);
    varWrap.hidden = !isVariable;
    const varToggle = iconToggleButton("list-check", "改用變數綁定圖片", isVariable, () => {
        varWrap.hidden = !varWrap.hidden;
        if (!varWrap.hidden) varInput.querySelector("input").focus();
    });

    const sourceRow = document.createElement("div");
    sourceRow.className = "ts-wrap is-compact has-top-spaced-small";
    sourceRow.appendChild(pickBtn);
    sourceRow.appendChild(varToggle);
    panel.appendChild(sourceRow);
    panel.appendChild(varWrap);

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("ruler", "版面"));
    const widthInput = textInput(Math.max(1, Math.min(100, el.widthPercent ?? 100)), (v) => {
        if (!(v > 0)) return;
        el.widthPercent = Math.min(100, Math.max(1, v));
        onModelChange({ skipInspector: true });
    }, "number");
    Object.assign(widthInput.querySelector("input"), { min: 1, max: 100, step: 1 });
    if (resolveImageFit(el) !== "none") panel.appendChild(field("寬度 (%)", widthInput)); // 原尺寸不看寬度

    const layoutRow = document.createElement("div");
    layoutRow.className = "ts-wrap is-compact has-top-spaced-small";
    layoutRow.appendChild(iconToggleButton("rotate-right", "順時針旋轉 90°", false, () => {
        el.rotation = ((el.rotation || 0) + 90) % 360;
        el.cropRect = null; // 旋轉後舊裁切窗格的座標系不再對應原圖，重置避免裁到錯的地方
        onModelChange();
    }));
    const fit = resolveImageFit(el);
    panel.appendChild(field("縮放", alignGroup(fit, (v) => {
        el.fit = v;
        onModelChange(); // 寬度／指定高度欄位隨之增減，整個檢視器會重畫，焦點要接回選中的那顆（方向鍵連續切換）
        document.querySelector('#inspector [role=radiogroup][aria-label="縮放"] [aria-checked="true"]')?.focus();
    }, "縮放", IMAGE_FIT_OPTIONS)));
    panel.appendChild(field("對齊", alignGroup(el.align || "center", (v) => { el.align = v; onModelChange({ skipInspector: true }); })));
    panel.appendChild(layoutRow);

    if (fit === "stretch") {
        panel.appendChild(field("指定高度 (dot)", textInput(el.heightDots || 0, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
    }

    if (!isVariable && el.assetId) {
        panel.appendChild(foldSection("image.crop", "裁切", (body) => {
            body.appendChild(buildCropTool(el));
            const cropActions = document.createElement("div");
            cropActions.className = "ts-wrap is-compact has-top-spaced-small";
            cropActions.appendChild(iconButton("expand", "還原（取消裁切）", () => {
                el.cropRect = null;
                onModelChange();
            }));
            body.appendChild(cropActions);
        }));
    }

    panel.appendChild(foldSection("image.adjust", "調整", (body) => {
        body.appendChild(sliderField("亮度", el.brightness ?? 0, -100, 100, (v) => { el.brightness = v; onModelChange({ skipInspector: true }); }));
        body.appendChild(sliderField("對比", el.contrast ?? 0, -100, 100, (v) => { el.contrast = v; onModelChange({ skipInspector: true }); }));
        body.appendChild(field(null, checkboxInput(!!el.invert, (v) => { el.invert = v; onModelChange({ skipInspector: true }); }, "反相")));
        body.appendChild(field("取樣方式", selectInput(
            [["floyd-steinberg", "誤差擴散"], ["ordered", "網點"], ["threshold", "純黑白"]],
            el.ditherMode || "floyd-steinberg",
            (v) => { el.ditherMode = v; onModelChange(); },
        )));
        if (el.ditherMode === "threshold") {
            body.appendChild(sliderField("門檻", el.thresholdLevel ?? 128, 0, 255, (v) => { el.thresholdLevel = v; onModelChange({ skipInspector: true }); }));
        }
    }, true));
}

function buildSpacerInspector(panel, el) {
    panel.appendChild(sectionHeader("arrows-up-down", "間隔"));
    panel.appendChild(field("高度 (dot)", textInput(el.heightDots, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
}

// 共用的填色控制項：純黑／網點／漸層，分隔線色塊、文字墨色、文字反白背景都用這一組（見
// document-model.js createFill／resolveFill）。onChange(patch, needsRedraw)：patch 是要併入
// 目前 fill 物件的欄位，needsRedraw 是「模式」這類會讓子欄位跟著變、面板要整個重繪的變動；
// 其餘（濃度／方向／反轉）用 skipInspector，行為比照其它欄位（例如 divider 原本的粗細）。
function fillFields(fill, onChange) {
    const frag = document.createDocumentFragment();
    frag.appendChild(field("填色方式", alignGroup(fill.mode, (v) => onChange({ mode: v }, true), "填色方式", INK_FILL_MODE_OPTIONS)));
    if (fill.mode === "halftone") {
        frag.appendChild(sliderField("網點濃度", fill.level, 0, 255, (v) => onChange({ level: v }, false)));
    } else if (fill.mode === "gradient") {
        frag.appendChild(field("方向", alignGroup(fill.direction, (v) => onChange({ direction: v }, false), "方向", FILL_DIRECTION_OPTIONS)));
        frag.appendChild(field(null, checkboxInput(fill.reverse, (v) => onChange({ reverse: v }, false), "反轉方向（深到淺）")));
    }
    return frag;
}

function buildDividerInspector(panel, el) {
    panel.appendChild(sectionHeader("minus", "分隔線"));
    const drawMode = resolveDividerDrawMode(el);
    panel.appendChild(field("畫法", selectInput(
        [["line", "線條"], ["fill", "色塊"]],
        drawMode,
        (v) => { el.drawMode = v; onModelChange(); },
    )));
    if (drawMode === "line") {
        panel.appendChild(fieldRow([
            ["樣式", selectInput([["solid", "實線"], ["dashed", "虛線"], ["dotted", "點線"]], el.style, (v) => { el.style = v; onModelChange({ skipInspector: true }); })],
            ["粗細", dividerThicknessSelect(el, DIVIDER_LINE_THICKNESS_PRESETS_MM)],
        ]));
    } else {
        panel.appendChild(field("高度", dividerThicknessSelect(el, DIVIDER_FILL_THICKNESS_PRESETS_MM)));
        const fill = resolveFill(el.fill);
        panel.appendChild(fillFields(fill, (patch, redraw) => {
            el.fill = { ...fill, ...patch };
            onModelChange(redraw ? {} : { skipInspector: true });
        }));
    }
    panel.appendChild(foldSection("divider.margin", "邊距", (body) => {
        body.appendChild(fieldRow([
            ["上 (dot)", textInput(el.marginTopDots, (v) => { el.marginTopDots = v; onModelChange({ skipInspector: true }); }, "number")],
            ["下 (dot)", textInput(el.marginBottomDots, (v) => { el.marginBottomDots = v; onModelChange({ skipInspector: true }); }, "number")],
        ]));
    }));
}

function buildGroupInspector(panel, el) {
    panel.appendChild(sectionHeader("object-group", "群組"));
    const wrap = document.createElement("div");
    wrap.className = "ts-wrap is-compact has-top-spaced-small";
    wrap.appendChild(mkButton("解散群組", "object-ungroup", () => ungroupElements([el.id]), { outlined: true }));
    panel.appendChild(wrap);
}

function buildRowInspector(panel, el) {
    panel.appendChild(sectionHeader("table-columns", "多欄"));
    const ratioText = el.ratio.map((v) => Math.round(v * 100) / 100).join(" : ");
    // 用 change 而非 input：套用會重繪檢視器，邊打邊套用會失去焦點
    const ratioInput = textInput(ratioText, () => {}, "text", "1 : 1");
    ratioInput.querySelector("input").addEventListener("change", (e) => {
        const ratio = e.target.value.split(/[:：,，\s]+/).filter(Boolean).map(Number);
        if (!ratio.length || ratio.length > MAX_ROW_COLUMNS || ratio.some((n) => !(n > 0))) return renderInspector();
        setRowRatio(el, ratio);
        onModelChange();
    });
    panel.appendChild(field("欄位比例", ratioInput));
    const gapInput = textInput(normalizeRowGap(el.gap), () => {}, "number");
    const gapBox = gapInput.querySelector("input");
    gapBox.min = "0";
    gapBox.max = String(MAX_ROW_GAP);
    gapBox.addEventListener("change", () => {
        const gap = normalizeRowGap(Number(gapBox.value));
        if (gap > 0) el.gap = gap;
        else delete el.gap;
        onModelChange();
    });
    panel.appendChild(field("欄距", gapInput, `欄與欄之間的空白，單位點，0～${MAX_ROW_GAP}；新建預設 ${DEFAULT_ROW_GAP}，舊專案為 0`));
    const wrap = document.createElement("div");
    wrap.className = "ts-wrap is-compact has-top-spaced-small";
    wrap.appendChild(mkButton("分割欄位", "table-columns", () => {
        if (splitRowColumn(el, el.columns.length - 1)) onModelChange();
    }, { outlined: true }));
    panel.appendChild(wrap);
}

const VARIABLE_INFO = "可用 {{變數}} 代入資料";

function barcodeNote(text, isError) {
    const note = document.createElement("div");
    setBarcodeNote(note, text, isError);
    return note;
}

function setBarcodeNote(note, text, isError) {
    note.className = `ts-text is-small has-top-spaced-small ${isError ? "is-negative" : "is-description"}`;
    note.textContent = text;
    note.hidden = !text;
}

function buildBarcodeInspector(panel, el) {
    panel.appendChild(sectionHeader("qrcode", "條碼／QR Code"));
    panel.appendChild(field("類型", selectInput(BARCODE_FORMATS, el.format, (v) => {
        el.format = v;
        onModelChange();
    }), BARCODE_FORMAT_INFO[el.format]));

    const valueHint = barcodeNote("", false);
    const refreshValueHint = () => {
        const value = el.value || "";
        if (!value || el.format === "qrcode") return setBarcodeNote(valueHint, "", false);
        if (value.includes("{{")) return setBarcodeNote(valueHint, "內容含變數，套用資料後才會檢查格式", false);
        const checked = validateBarcodeValue(el.format, value);
        setBarcodeNote(valueHint, checked.ok ? checked.note : checked.message, !checked.ok);
    };
    panel.appendChild(field("內容", textInput(el.value || "", (v) => {
        el.value = v;
        refreshValueHint();
        onModelChange({ skipInspector: true });
    }), VARIABLE_INFO));
    panel.appendChild(valueHint);
    refreshValueHint();

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("ruler", "版面"));
    panel.appendChild(field("高度 (dot)", textInput(el.heightDots, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
    panel.appendChild(field("對齊", alignGroup(el.align, (v) => { el.align = v; onModelChange({ skipInspector: true }); })));

    if (el.format !== "qrcode") {
        panel.appendChild(foldSection("barcode.text", "明碼", (body) => {
            body.appendChild(field(null, checkboxInput(el.showText !== false, (v) => {
                el.showText = v;
                onModelChange({ skipInspector: true });
            }, "顯示明碼")));
            body.appendChild(field("明碼字級 (pt)", textInput(el.textSize ? dotsToPt(el.textSize) : "", (v) => {
                if (Number(v) > 0) el.textSize = ptToDots(Number(v));
                else delete el.textSize;
                onModelChange({ skipInspector: true });
            }, "number"), "留空＝自動。熱感應列印字小容易糊，建議 7pt 以上"));
        }));
    }
}
