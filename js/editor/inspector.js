// 右側檢視器：依選取的元素類型組出對應的編輯面板。

import { BARCODE_FORMATS, BARCODE_FORMAT_INFO, validateBarcodeValue } from "../core/barcode.js";
import { MIXED, applyStyleToRange, getRangeStyle, getTextContent, replaceFullText } from "../core/document-model.js";
import { WEB_FONTS, findWebFont, isWebFontFailed } from "../core/web-fonts.js";
import { applyFieldToElements, findElementById, setRowRatio, splitRowColumn, MAX_ROW_COLUMNS } from "../core/element-tree.js";
import { createInfoIcon } from "./ui-helpers.js";
import {
    getLocalFontFamilies, isFontInstalled, isLocalFontAccessSupported, loadLocalFonts, localFontStack,
    primaryFamilyName,
} from "../core/fonts.js";
import {
    checkboxInput, emptyState, field, fieldRow, iconButton, iconToggleButton, mkButton, sectionDivider,
    sectionHeader, selectInput, sliderField, textInput,
} from "./inspector-widgets.js";
import {
    deleteElement, deleteElements, duplicateElement, duplicateElements, inlineEditor, onModelChange, textSel,
    ungroupElements,
} from "./editor.js";
import { els, rt, state } from "./context.js";

export function renderInspector() {
    const panel = els.inspector;
    panel.innerHTML = "";
    if (state.multi.length > 1) {
        buildMultiInspector(panel, state.multi);
        return;
    }
    const el = state.selectedId ? findElementById(state.project.template.elements, state.selectedId) : null;
    if (!el) {
        panel.appendChild(emptyState("sliders", "尚未選取元素"));
        return;
    }

    const builders = { text: buildTextInspector, image: buildImageInspector, spacer: buildSpacerInspector, divider: buildDividerInspector, row: buildRowInspector, group: buildGroupInspector, barcode: buildBarcodeInspector };
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
    { key: "fontSize", label: "字級", kind: "number", types: ["text"], runField: true },
    { key: "bold", label: "粗體", kind: "bool", types: ["text"], runField: true },
    { key: "inverse", label: "整行反白", kind: "bool", types: ["text"] },
    { key: "lineHeight", label: "行高", kind: "number", types: ["text"] },
    { key: "letterSpacing", label: "字距", kind: "number", types: ["text"] },
    { key: "align", label: "對齊", kind: "select", options: [["left", "靠左"], ["center", "置中"], ["right", "靠右"]], types: ["text", "image", "barcode"] },
    { key: "heightDots", label: "高度", kind: "number", types: ["spacer", "barcode"] },
    { key: "widthPercent", label: "寬度 %", kind: "number", types: ["image"] },
    { key: "style", label: "樣式", kind: "select", options: [["solid", "實線"], ["dashed", "虛線"], ["dotted", "點線"]], types: ["divider"] },
    { key: "thicknessDots", label: "粗細", kind: "number", types: ["divider"] },
    { key: "marginTopDots", label: "上邊距", kind: "number", types: ["divider"] },
    { key: "marginBottomDots", label: "下邊距", kind: "number", types: ["divider"] },
];

function buildMultiInspector(panel, ids) {
    const selected = ids.map((id) => findElementById(state.project.template.elements, id)).filter(Boolean);
    panel.appendChild(sectionHeader("shapes", `已選 ${selected.length} 個元素`));
    const apply = (spec, value) => {
        applyFieldToElements(selected, spec.key, value, { runField: spec.runField }); // 片段自己的覆寫要一併清掉才看得到效果
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
            input = textInput(mixed ? "" : values[0], () => {}, "number");
            const box = input.querySelector("input");
            box.placeholder = mixed ? "混合" : "";
            box.addEventListener("input", () => { if (box.value !== "") apply(spec, Number(box.value)); });
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
    const wrap = document.createElement("div");
    wrap.className = "ts-select is-small is-fluid";
    const select = document.createElement("select");
    select.disabled = disabled;
    const addOption = (parent, v, label) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = label;
        parent.appendChild(opt);
    };
    for (const [v, label] of leading) addOption(select, v, label);
    for (const [v, label] of FONT_CHOICES) {
        addOption(select, v, findWebFont(v) && isWebFontFailed(findWebFont(v).id) ? `${label}（載入失敗，暫用系統字體）` : label);
    }

    const localFonts = getLocalFontFamilies();
    if (localFonts.length) {
        const group = document.createElement("optgroup");
        group.label = "本機字體";
        for (const family of localFonts) addOption(group, localFontStack(family), family);
        select.appendChild(group);
    }

    if (value && value !== MIXED && ![...select.options].some((o) => o.value === value)) {
        const name = primaryFamilyName(value);
        addOption(select, value, isFontInstalled(name) ? `${name}（本機字體）` : `${name}（此電腦沒有）`);
    }
    select.value = value === MIXED ? "__mixed__" : (value || "");
    select.addEventListener("change", () => onChange(select.value || null));
    wrap.appendChild(select);
    return wrap;
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
        input.value = value || "";
    }
    input.addEventListener("input", () => onChange(input.value ? Number(input.value) : null));
    wrap.appendChild(input);
    return wrap;
}

function buildTextInspector(panel, el) {
    panel.appendChild(sectionHeader("align-left", "內容", VARIABLE_INFO));

    const sel = textSel;
    const live = inlineEditor.isEditing(el.id) ? inlineEditor.getSelection() : null;
    sel.start = live ? live.start : 0;
    sel.end = live ? live.end : 0;
    const toolbar = document.createElement("div");
    toolbar.className = "pane-toolbar has-top-spaced-small";
    toolbar.addEventListener("mousedown", (e) => e.preventDefault()); // 按工具列不搶走預覽區編輯框的焦點／選取
    panel.appendChild(toolbar);
    const styleRow = document.createElement("div");
    panel.appendChild(styleRow);

    const textareaWrap = document.createElement("div");
    textareaWrap.className = "ts-input is-small is-fluid has-top-spaced-small";
    const textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.value = getTextContent(el);
    textareaWrap.appendChild(textarea);
    panel.appendChild(textareaWrap);

    function renderStyleControls() {
        const hasRange = sel.start !== sel.end;
        const style = getRangeStyle(el, sel.start, sel.end);
        toolbar.innerHTML = "";
        toolbar.appendChild(rangeToggleButton("bold", "粗體", style.bold, hasRange, (v) => applyRangeStyle("bold", v)));
        toolbar.appendChild(rangeToggleButton("italic", "斜體", style.italic, hasRange, (v) => applyRangeStyle("italic", v)));
        toolbar.appendChild(rangeToggleButton("underline", "底線", style.underline, hasRange, (v) => applyRangeStyle("underline", v)));
        toolbar.appendChild(rangeToggleButton("strikethrough", "刪除線", style.strikethrough, hasRange, (v) => applyRangeStyle("strikethrough", v)));
        toolbar.appendChild(rangeToggleButton("circle-half-stroke", "反白", style.inverse, hasRange, (v) => applyRangeStyle("inverse", v)));

        styleRow.innerHTML = "";
        styleRow.appendChild(fieldRow([
            ["字體", rangeFontFamilySelect(style.fontFamily, hasRange, (v) => applyRangeStyle("fontFamily", v))],
            ["字級 (dot)", rangeFontSizeInput(style.fontSize, hasRange, (v) => applyRangeStyle("fontSize", v))],
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
        ["預設字級 (dot)", textInput(el.fontSize, (v) => { el.fontSize = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
    panel.appendChild(fieldRow([
        ["行高倍數", textInput(el.lineHeight, (v) => { el.lineHeight = v; onModelChange({ skipInspector: true }); }, "number")],
        ["字距 (dot)", textInput(el.letterSpacing, (v) => { el.letterSpacing = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
    panel.appendChild(fieldRow([
        ["對齊", selectInput([["left", "靠左"], ["center", "置中"], ["right", "靠右"]], el.align, (v) => { el.align = v; onModelChange({ skipInspector: true }); })],
        ["最多行數", textInput(el.maxLines || "", (v) => { el.maxLines = v; onModelChange({ skipInspector: true }); }, "number", "不限")],
    ]));
    panel.appendChild(field(null, checkboxInput(el.bold, (v) => { el.bold = v; onModelChange({ skipInspector: true }); }, "預設粗體")));
    panel.appendChild(field(null, checkboxInput(!!el.inverse, (v) => { el.inverse = v; onModelChange({ skipInspector: true }); }, "整行反白")));
    panel.appendChild(field(null, checkboxInput(el.wrap, (v) => { el.wrap = v; onModelChange({ skipInspector: true }); }, "自動換行")));
    const modeRow = document.createElement("div");
    modeRow.className = "ts-wrap is-compact has-top-spaced-small";
    const vertical = el.writingMode === "vertical";
    modeRow.appendChild(iconToggleButton("grip-lines", "橫書", !vertical, () => { el.writingMode = "horizontal"; onModelChange(); }));
    modeRow.appendChild(iconToggleButton("grip-lines-vertical", "直書", vertical, () => { el.writingMode = "vertical"; onModelChange(); }));
    panel.appendChild(modeRow);
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
    panel.appendChild(sectionHeader("ruler", "尺寸與版面"));
    const widthInput = textInput(Math.max(1, Math.min(100, el.widthPercent ?? 100)), (v) => {
        if (!(v > 0)) return;
        el.widthPercent = Math.min(100, Math.max(1, v));
        onModelChange({ skipInspector: true });
    }, "number");
    Object.assign(widthInput.querySelector("input"), { min: 1, max: 100, step: 1 });
    panel.appendChild(field("寬度 (%)", widthInput));

    const layoutRow = document.createElement("div");
    layoutRow.className = "ts-wrap is-compact has-top-spaced-small";
    layoutRow.appendChild(iconToggleButton("align-left", "靠左", el.align === "left", () => { el.align = "left"; onModelChange(); }));
    layoutRow.appendChild(iconToggleButton("align-center", "置中", (el.align || "center") === "center", () => { el.align = "center"; onModelChange(); }));
    layoutRow.appendChild(iconToggleButton("align-right", "靠右", el.align === "right", () => { el.align = "right"; onModelChange(); }));
    layoutRow.appendChild(iconToggleButton("rotate-right", "順時針旋轉 90°", false, () => {
        el.rotation = ((el.rotation || 0) + 90) % 360;
        el.cropRect = null; // 旋轉後舊裁切窗格的座標系不再對應原圖，重置避免裁到錯的地方
        onModelChange();
    }));
    layoutRow.appendChild(iconToggleButton("arrows-up-down", "拉伸至指定高度", el.fit === "stretch", () => {
        el.fit = el.fit === "stretch" ? "auto" : "stretch";
        onModelChange();
    }));
    panel.appendChild(layoutRow);

    if (el.fit === "stretch") {
        panel.appendChild(field("指定高度 (dot)", textInput(el.heightDots || 0, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
    }

    if (!isVariable && el.assetId) {
        panel.appendChild(sectionDivider());
        panel.appendChild(sectionHeader("crop-simple", "裁切"));
        const cropTool = buildCropTool(el);
        panel.appendChild(cropTool);
        const cropActions = document.createElement("div");
        cropActions.className = "ts-wrap is-compact has-top-spaced-small";
        cropActions.appendChild(iconButton("expand", "還原（取消裁切）", () => {
            el.cropRect = null;
            onModelChange();
        }));
        panel.appendChild(cropActions);
    }

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("sliders", "調整"));
    panel.appendChild(sliderField("亮度", el.brightness ?? 0, -100, 100, (v) => { el.brightness = v; onModelChange({ skipInspector: true }); }));
    panel.appendChild(sliderField("對比", el.contrast ?? 0, -100, 100, (v) => { el.contrast = v; onModelChange({ skipInspector: true }); }));
    panel.appendChild(field(null, checkboxInput(!!el.invert, (v) => { el.invert = v; onModelChange({ skipInspector: true }); }, "反相")));
    panel.appendChild(field("取樣方式", selectInput(
        [["floyd-steinberg", "誤差擴散"], ["ordered", "網點"], ["threshold", "純黑白"]],
        el.ditherMode || "floyd-steinberg",
        (v) => { el.ditherMode = v; onModelChange(); },
    )));
    if (el.ditherMode === "threshold") {
        panel.appendChild(sliderField("門檻", el.thresholdLevel ?? 128, 0, 255, (v) => { el.thresholdLevel = v; onModelChange({ skipInspector: true }); }));
    }
}

function buildSpacerInspector(panel, el) {
    panel.appendChild(sectionHeader("arrows-up-down", "間隔"));
    panel.appendChild(field("高度 (dot)", textInput(el.heightDots, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")));
}

function buildDividerInspector(panel, el) {
    panel.appendChild(sectionHeader("minus", "分隔線"));
    panel.appendChild(field("樣式", selectInput([["solid", "實線"], ["dashed", "虛線"], ["dotted", "點線"]], el.style, (v) => { el.style = v; onModelChange({ skipInspector: true }); })));
    panel.appendChild(field("粗細 (dot)", textInput(el.thicknessDots, (v) => { el.thicknessDots = v; onModelChange({ skipInspector: true }); }, "number")));
    panel.appendChild(fieldRow([
        ["上邊距 (dot)", textInput(el.marginTopDots, (v) => { el.marginTopDots = v; onModelChange({ skipInspector: true }); }, "number")],
        ["下邊距 (dot)", textInput(el.marginBottomDots, (v) => { el.marginBottomDots = v; onModelChange({ skipInspector: true }); }, "number")],
    ]));
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
    if (el.format !== "qrcode") {
        panel.appendChild(field(null, checkboxInput(el.showText !== false, (v) => {
            el.showText = v;
            onModelChange({ skipInspector: true });
        }, "顯示明碼")));
    }

    panel.appendChild(sectionDivider());
    panel.appendChild(sectionHeader("ruler", "尺寸與對齊"));
    panel.appendChild(fieldRow([
        ["高度 (dot)", textInput(el.heightDots, (v) => { el.heightDots = v; onModelChange({ skipInspector: true }); }, "number")],
        ["對齊", selectInput([["left", "靠左"], ["center", "置中"], ["right", "靠右"]], el.align, (v) => { el.align = v; onModelChange({ skipInspector: true }); })],
    ]));
}
