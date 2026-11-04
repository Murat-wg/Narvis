// Canvas 2D uzerine cizim. Arka planlar, kenarliklar, gradyanlar, golgeler,
// resimler, metinler ve liste isaretleri.

import { cssColor } from './css/values.js';
import { fontString } from './font.js';
import { controlLabel, optionLabel, selectedOption, selectedOptionIndexes, optionElements } from './form.js';
import { multiSelectRowHeight } from './form.js';

const isPct = (v) => v && typeof v === 'object' && 'pct' in v;

export function paintDocument(ctx, layout, options = {}) {
  const viewport = options.viewport ?? layout.viewport;
  const dpr = options.dpr ?? 1;
  const scrollX = options.scrollX ?? 0;
  const scrollY = options.scrollY ?? 0;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.fillStyle = options.background ?? '#ffffff';
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  ctx.save();
  ctx.translate(-scrollX, -scrollY);
  ctx.textBaseline = 'alphabetic';
  paintBackgrounds(ctx, layout.root, { skipFixed: true });
  paintTexts(ctx, layout.root, { skipFixed: true });
  /* Konumlanmis sticky kutular normal akisin ustunde cizilir. */
  paintStickyLayer(ctx, layout.root, { skipFixed: true });
  ctx.restore();

  const fixed = [];
  collectFixed(layout.root, fixed);
  if (fixed.length) {
    ctx.save();
    for (const box of fixed) {
      paintBackgrounds(ctx, box, { skipFixed: false, paintSticky: true });
      paintTexts(ctx, box, { skipFixed: false, paintSticky: true });
    }
    ctx.restore();
  }

  /* Etkilesim katmani: dogrulama balonu ve acik select listesi belgenin
     ustunde, ekran koordinatlarinda cizilir. */
  if (options.validation) paintValidationBubble(ctx, options.validation, { viewport, scrollX, scrollY });
  if (options.selectPopup) paintSelectPopup(ctx, options.selectPopup, viewport);
}

function collectFixed(box, out) {
  if (box.fixed) { out.push(box); return; }
  for (const child of box.children) collectFixed(child, out);
}

function collectStickyRoots(box, out) {
  if (box.fixed) return;
  if (box.style.position === 'sticky') { out.push(box); return; }
  for (const child of box.children) collectStickyRoots(child, out);
}

/* Sticky kutulari normal akistan sonra, atalarindaki kirpma dikdortgenleri
   hala gecerliyken ciz. Boylece kaydirma sirasinda sonraki icerigin altinda
   kalmazlar. */
function paintStickyLayer(ctx, root, env) {
  const roots = [];
  collectStickyRoots(root, roots);
  if (!roots.length) return;
  for (const box of roots) {
    const clips = [];
    for (let parent = box.parentBox; parent; parent = parent.parentBox) {
      if (parent._overflow) clips.push(parent._overflow.clipRect);
    }
    ctx.save();
    for (const rect of clips) {
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, Math.max(0, rect.width), Math.max(0, rect.height));
      ctx.clip();
    }
    paintBackgrounds(ctx, box, { ...env, paintSticky: true });
    paintTexts(ctx, box, { ...env, paintSticky: true });
    ctx.restore();
  }
}

function alphaFor(box) {
  let a = 1;
  for (let b = box; b; b = b.parentBox) {
    if (b.style.opacity != null) a *= b.style.opacity;
  }
  return Math.max(0, Math.min(1, a));
}

/* Kirpan kutunun icerigini padding box'a hapseder. Kutunun kendi arka
   plani ve cercevesi bu kirpmadan etkilenmez. */
function clipToOverflow(ctx, box) {
  const rect = box._overflow?.clipRect;
  if (!rect) return false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, Math.max(0, rect.width), Math.max(0, rect.height));
  ctx.clip();
  return true;
}

function paintBackgrounds(ctx, box, env) {
  if (box.fixed && env.skipFixed) return;
  if (box.style.visibility === 'hidden' || box.style.display === 'none') return;

  const alpha = alphaFor(box);
  if (alpha <= 0) return;

  if (box.kind === 'inline' && !box.parentBox?.isFlex) paintInlineSegments(ctx, box, alpha);
  else if (box.kind !== 'text' && box.kind !== 'anonymous') paintBoxBackground(ctx, box, alpha);

  if (box.kind === 'image') paintImage(ctx, box, alpha);

  const clipped = clipToOverflow(ctx, box);
  for (const child of box.children) {
    if (!env.paintSticky && child.style.position === 'sticky') continue;
    paintBackgrounds(ctx, child, env);
  }
  if (clipped) ctx.restore();
}

function paintTexts(ctx, box, env) {
  if (box.fixed && env.skipFixed) return;
  if (box.style.visibility === 'hidden' || box.style.display === 'none') return;
  const alpha = alphaFor(box);
  if (alpha <= 0) return;

  const clipped = clipToOverflow(ctx, box);
  if (box.kind === 'list-item') paintMarker(ctx, box, alpha);
  if (box.isFormControl) {
    ctx.save();
    ctx.globalAlpha = alpha;
    paintFormControl(ctx, box);
    ctx.restore();
  }
  if (box.lineBoxes?.length) {
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const line of box.lineBoxes) {
      for (const frag of line.fragments) {
        if (frag.type !== 'text') continue;
        paintTextFragment(ctx, frag);
      }
    }
    ctx.restore();
  }
  for (const child of box.children) {
    if (!env.paintSticky && child.style.position === 'sticky') continue;
    paintTexts(ctx, child, env);
  }
  if (clipped) ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Form kontrolleri: tarayici benzeri dogal gorunum
 * ------------------------------------------------------------------ */

function controlLineHeight(style) {
  const fs = style.fontSize || 16;
  return typeof style.lineHeight === 'number' && style.lineHeight > 0 ? style.lineHeight : fs * 1.4;
}

function paintFormControl(ctx, box) {
  const kind = box.formKind;
  if (!kind) return;
  if (kind === 'checkbox') paintCheckbox(ctx, box);
  else if (kind === 'radio') paintRadio(ctx, box);
  else if (kind === 'textarea') paintTextControl(ctx, box, true);
  else if (kind === 'text') paintTextControl(ctx, box, false);
  else if (kind === 'file') paintFileControl(ctx, box);
  else if (kind === 'select') paintSelectControl(ctx, box);
  else if (kind === 'button' && box.el?.localName !== 'button') {
    /* <button> etiketi cocuk metin olarak normal akista cizilir; yalnizca
       input[type=submit/reset/button] etiketini burada ciz. */
    paintButtonLabel(ctx, box);
  }
  const focused = box.el?.ownerDocument?.activeElement === box.el;
  if (focused || box.el?._invalid) {
    paintFocusRing(ctx, box, box.el?._invalid);
  }
}

function paintFocusRing(ctx, box, invalid = false) {
  const w = box.width;
  const h = box.height;
  if (w <= 0 || h <= 0) return;
  ctx.strokeStyle = invalid ? 'rgba(198, 62, 52, 0.9)' : 'rgba(90, 140, 220, 0.72)';
  ctx.lineWidth = 1.5;
  roundedRect(ctx, box.x - 2, box.y - 2, w + 4, h + 4, 3);
  ctx.stroke();
}

function paintCheckbox(ctx, box) {
  const x = box.x;
  const y = box.y;
  const w = box.width;
  const h = box.height;
  if (w <= 0 || h <= 0) return;
  const disabled = box.el?.hasAttribute('disabled');
  ctx.fillStyle = disabled ? '#f2f2f2' : '#ffffff';
  ctx.fillRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.strokeStyle = disabled ? '#a9a9a9' : '#767676';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  if (box.el?.checked) {
    ctx.strokeStyle = disabled ? '#9b9b9b' : '#1b1f24';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 3.1, y + h * 0.52);
    ctx.lineTo(x + 5.6, y + h * 0.75);
    ctx.lineTo(x + w - 3.0, y + h * 0.27);
    ctx.stroke();
  }
}

function paintRadio(ctx, box) {
  const w = box.width;
  const h = box.height;
  if (w <= 0 || h <= 0) return;
  const cx = box.x + w / 2;
  const cy = box.y + h / 2;
  const r = Math.max(0.5, Math.min(w, h) / 2 - 0.5);
  const disabled = box.el?.hasAttribute('disabled');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = disabled ? '#f2f2f2' : '#ffffff';
  ctx.fill();
  ctx.strokeStyle = disabled ? '#a9a9a9' : '#767676';
  ctx.lineWidth = 1;
  ctx.stroke();
  if (box.el?.checked) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, r * 0.46), 0, Math.PI * 2);
    ctx.fillStyle = disabled ? '#9b9b9b' : '#1b1f24';
    ctx.fill();
  }
}

function paintTextControl(ctx, box, multiline) {
  const el = box.el;
  const style = box.style;
  const value = String(el?.value ?? '');
  const placeholder = String(el?.getAttribute?.('placeholder') ?? '');
  const text = value || placeholder;
  const cx = box.contentX;
  const cy = box.contentY;
  const cw = Math.max(0, box.contentWidth);
  const ch = Math.max(0, box.contentHeight);
  if (cw <= 0 || ch <= 0) return;
  const fs = style.fontSize || 16;
  const lh = controlLineHeight(style);
  const lines = multiline ? text.split('\n') : [text.replace(/\n/g, ' ')];
  const maxLines = multiline ? Math.max(1, Math.floor(ch / lh)) : 1;
  const shift = multiline ? 0 : Math.max(0, (ch - lh) / 2);
  const disabled = el?.hasAttribute('disabled');
  const focused = el?.ownerDocument?.activeElement === el;

  ctx.font = fontString({ ...style, fontWeight: 400 });
  let offset = 0;
  if (!multiline && focused) {
    const caretX = ctx.measureText(String(value).slice(0, caretOffset(el, value))).width;
    offset = Math.max(0, caretX - (cw - 2));
    if (offset > caretX) offset = caretX;
  }
  el._paintScrollX = offset;

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  if (focused && value && el.selectionEnd > el.selectionStart) {
    paintSelection(ctx, el, value, multiline, lines, cx, cy, shift, lh, fs, cw, offset);
  }

  if (text) {
    ctx.fillStyle = cssColor(value && !disabled ? style.color : [117, 117, 117, 1]);
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
      ctx.fillText(lines[i], cx - offset, cy + shift + i * lh + fs);
    }
  }
  paintCaret(ctx, box, multiline, value, cx, cy, shift, lh, fs, offset);
  ctx.restore();
}

function caretOffset(el, value) {
  const end = Number.isInteger(el?.selectionEnd) ? el.selectionEnd : String(value ?? '').length;
  return Math.max(0, Math.min(String(value ?? '').length, end));
}

/* input[type=file]: solda "Dosya Seç" dugmesi, sagda secilen adlar. */
function paintFileControl(ctx, box) {
  const el = box.el;
  const style = box.style;
  const cx = box.contentX;
  const cy = box.contentY;
  const cw = Math.max(0, box.contentWidth);
  const ch = Math.max(0, box.contentHeight);
  if (cw <= 0 || ch <= 0) return;
  const disabled = el?.hasAttribute('disabled');
  const files = el?._files ?? [];
  const lh = controlLineHeight(style);
  const fs = style.fontSize || 16;

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();
  ctx.font = fontString({ ...style, fontWeight: 400 });

  const buttonLabel = 'Dosya Seç';
  const buttonW = Math.min(cw, Math.ceil(ctx.measureText(buttonLabel).width) + 18);
  const buttonH = Math.min(ch, Math.max(18, Math.round(lh + 2)));
  const by = cy + (ch - buttonH) / 2;
  ctx.fillStyle = disabled ? '#f2f2f2' : '#efefef';
  ctx.fillRect(cx, by, buttonW, buttonH);
  ctx.strokeStyle = disabled ? '#a9a9a9' : '#767676';
  ctx.lineWidth = 1;
  ctx.strokeRect(cx + 0.5, by + 0.5, Math.max(0, buttonW - 1), Math.max(0, buttonH - 1));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = disabled ? '#757575' : '#1b1f24';
  ctx.fillText(buttonLabel, cx + buttonW / 2, by + buttonH / 2 + 0.5);

  const label = files.length
    ? Array.from(files, (file) => String(file.name ?? '')).join(', ')
    : 'Dosya seçilmedi';
  const tx = cx + buttonW + 6;
  const maxW = cw - buttonW - 8;
  if (maxW > 4) {
    ctx.textAlign = 'left';
    ctx.fillStyle = disabled ? '#9b9b9b' : (files.length ? cssColor(style.color) : '#8a8175');
    ctx.fillText(ellipsize(ctx, label, maxW), tx, cy + ch / 2 + 0.5);
  }
  ctx.restore();
}

function paintSelection(ctx, el, value, multiline, lines, cx, cy, shift, lh, fs, cw, offset) {
  const start = Math.max(0, Math.min(value.length, el.selectionStart ?? 0));
  const end = Math.max(start, Math.min(value.length, el.selectionEnd ?? start));
  if (end <= start) return;
  ctx.fillStyle = 'rgba(90, 140, 220, 0.32)';
  const lineTop = (i) => cy + shift + i * lh;
  if (!multiline) {
    const x1 = cx + ctx.measureText(value.slice(0, start)).width - offset;
    const x2 = cx + ctx.measureText(value.slice(0, end)).width - offset;
    ctx.fillRect(Math.max(cx - offset, x1), lineTop(0) + (lh - fs) / 2, Math.max(0, x2 - x1), fs);
    return;
  }
  let lineStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineEnd = lineStart + line.length;
    const segStart = Math.max(start, lineStart);
    const segEnd = Math.min(end, lineEnd);
    if (segEnd > segStart) {
      const x1 = cx + ctx.measureText(line.slice(0, segStart - lineStart)).width;
      const x2 = cx + ctx.measureText(line.slice(0, segEnd - lineStart)).width;
      ctx.fillRect(x1, lineTop(i) + (lh - fs) / 2, Math.max(0, x2 - x1), fs);
    } else if (start <= lineStart && end > lineEnd) {
      /* Tamamen secili bos satir ya da satir sonu: ince bir iz birak. */
      ctx.fillRect(cx, lineTop(i) + (lh - fs) / 2, Math.min(cw, 4), fs);
    }
    lineStart = lineEnd + 1;
  }
}

function paintCaret(ctx, box, multiline, value, cx, cy, shift = 0, lh = 0, fs = 16, offset = 0) {
  const el = box.el;
  if (el?.ownerDocument?.activeElement !== el) return;
  const lines = multiline ? String(value).split('\n') : [String(value).replace(/\n/g, ' ')];
  const caret = caretOffset(el, value);
  let lineIndex = 0;
  let lineStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const end = lineStart + lines[i].length;
    lineIndex = i;
    if (caret <= end) break;
    lineStart = end + 1;
  }
  const line = lines[lineIndex] ?? '';
  const column = Math.max(0, Math.min(line.length, caret - lineStart));
  ctx.font = fontString({ ...box.style, fontWeight: 400 });
  const caretX = cx + ctx.measureText(line.slice(0, column)).width - (multiline ? 0 : offset);
  const lineTop = cy + shift + lineIndex * lh;
  const caretH = Math.min(fs, Math.max(0, box.contentHeight - lineIndex * lh));
  ctx.fillStyle = cssColor(box.style.color);
  ctx.fillRect(caretX, lineTop + (lh - fs) / 2, 1.2, caretH);
}

function paintSelectControl(ctx, box) {
  const el = box.el;
  if (el?.hasAttribute?.('multiple')) return paintMultiSelectControl(ctx, box);
  const style = box.style;
  const option = selectedOption(el);
  const text = option ? optionLabel(option) : '';
  const disabled = el?.hasAttribute('disabled');
  const cx = box.contentX;
  const cy = box.contentY;
  const cw = Math.max(0, box.contentWidth);
  const ch = Math.max(0, box.contentHeight);
  if (cw <= 0 || ch <= 0) return;
  const fs = style.fontSize || 16;
  const lh = controlLineHeight(style);
  const baseline = cy + Math.max(0, (ch - lh) / 2) + fs;
  ctx.save();
  ctx.font = fontString({ ...style, fontWeight: 400 });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();
  if (text) {
    ctx.fillStyle = cssColor(disabled ? [117, 117, 117, 1] : style.color);
    ctx.fillText(text, cx, baseline);
  }
  ctx.restore();

  const arrowX = box.x + box.width - box.border.right - 11;
  const arrowY = cy + ch / 2;
  ctx.beginPath();
  ctx.moveTo(arrowX - 3.5, arrowY - 1.5);
  ctx.lineTo(arrowX + 3.5, arrowY - 1.5);
  ctx.lineTo(arrowX, arrowY + 2.6);
  ctx.closePath();
  ctx.fillStyle = disabled ? '#9b9b9b' : '#4a4a4a';
  ctx.fill();
}

/* select[multiple]: satir satir liste; secili satir vurgulu. */
function paintMultiSelectControl(ctx, box) {
  const el = box.el;
  const style = box.style;
  const options = optionElements(el);
  const cx = box.contentX;
  const cy = box.contentY;
  const cw = Math.max(0, box.contentWidth);
  const ch = Math.max(0, box.contentHeight);
  if (cw <= 0 || ch <= 0 || !options.length) return;
  const fs = style.fontSize || 16;
  const rowH = multiSelectRowHeight(el);
  const disabled = el.hasAttribute('disabled');
  const focused = el.ownerDocument?.activeElement === el;
  const selected = new Set(selectedOptionIndexes(el));
  const focusIdx = Number.isInteger(el._multiFocus) ? el._multiFocus : -1;
  const visible = Math.max(1, Math.floor(ch / rowH));
  const maxScroll = Math.max(0, options.length - visible);
  const scroll = clampScrollForMulti(el, maxScroll);

  ctx.save();
  ctx.font = fontString({ ...style, fontWeight: 400 });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  ctx.rect(cx, cy, cw, ch);
  ctx.clip();
  const textMax = cw - 12;

  for (let row = 0; row < visible; row++) {
    const index = scroll + row;
    if (index >= options.length) break;
    const y = cy + row * rowH;
    if (selected.has(index)) {
      ctx.fillStyle = '#e2ecfb';
      ctx.fillRect(cx + 1, y, cw - 2, rowH);
    } else if (focused && index === focusIdx) {
      ctx.fillStyle = '#f1f5fb';
      ctx.fillRect(cx + 1, y, cw - 2, rowH);
    }
    const option = options[index];
    ctx.fillStyle = disabled || option.hasAttribute('disabled') ? [117, 117, 117, 1] : cssColor(style.color);
    ctx.fillText(ellipsize(ctx, optionLabel(option), textMax), cx + 6, y + rowH / 2 + 0.5);
  }

  if (options.length > visible) {
    const trackX = box.x + box.width - box.border.right - 7;
    const trackY = cy + 2;
    const trackH = Math.max(1, ch - 4);
    const thumbH = Math.max(16, trackH * (visible / options.length));
    const thumbY = trackY + (trackH - thumbH) * (scroll / Math.max(1, maxScroll));
    ctx.fillStyle = 'rgba(90, 104, 120, 0.22)';
    roundedRect(ctx, trackX, trackY, 4, trackH, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(90, 104, 120, 0.55)';
    roundedRect(ctx, trackX, thumbY, 4, thumbH, 2);
    ctx.fill();
  }
  ctx.restore();
}

function clampScrollForMulti(el, maxScroll) {
  let scroll = Number.isInteger(el._multiScroll) ? el._multiScroll : 0;
  scroll = Math.max(0, Math.min(maxScroll, scroll));
  el._multiScroll = scroll;
  return scroll;
}

/* ------------------------------------------------------------------ *
 * Etkilesim katmani: select listesi ve dogrulama balonu
 * ------------------------------------------------------------------ */

function ellipsize(ctx, text, maxWidth) {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function paintSelectPopup(ctx, popup, viewport) {
  if (!popup) return;
  const { x, y, width, height, rowHeight, padding, items, activeIndex, scrollIndex } = popup;
  if (width <= 0 || height <= 0 || !items?.length) return;
  const style = popup.style || {};
  const fs = style.fontSize || 14;
  const visibleRows = Math.max(1, Math.floor((height - padding * 2) / rowHeight));
  const total = items.length;
  const selected = popup.selectedIndex ?? -1;

  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.24)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, x, y, width, height, 4);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#767676';
  ctx.lineWidth = 1;
  roundedRect(ctx, x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1), 4);
  ctx.stroke();
  roundedRect(ctx, x, y, width, height, 4);
  ctx.clip();

  ctx.font = fontString({ ...style, fontSize: fs, fontWeight: 400 });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const scrollable = total > visibleRows;
  const textMax = width - padding * 2 - 22 - (scrollable ? 8 : 0);

  for (let row = 0; row < visibleRows; row++) {
    const index = scrollIndex + row;
    if (index >= total) break;
    const item = items[index];
    const rowY = y + padding + row * rowHeight;
    if (index === activeIndex) {
      ctx.fillStyle = '#e8f0fe';
      ctx.fillRect(x + 1, rowY, width - 2, rowHeight);
    } else if (index === selected) {
      ctx.fillStyle = '#f4f7fc';
      ctx.fillRect(x + 1, rowY, width - 2, rowHeight);
    }
    ctx.fillStyle = item.disabled ? '#9a9a9a' : cssColor(style.color || [27, 31, 36, 1]);
    ctx.fillText(ellipsize(ctx, String(item.label ?? ''), textMax), x + padding, rowY + rowHeight / 2 + 0.5);
    if (index === selected) {
      ctx.font = fontString({ ...style, fontSize: 12, fontWeight: 700 });
      ctx.fillStyle = '#2b4d86';
      ctx.textAlign = 'right';
      ctx.fillText('✓', x + width - padding - (scrollable ? 6 : 0), rowY + rowHeight / 2 + 0.5);
      ctx.textAlign = 'left';
      ctx.font = fontString({ ...style, fontSize: fs, fontWeight: 400 });
    }
  }

  if (scrollable) {
    const trackX = x + width - 7;
    const trackY = y + padding + 2;
    const trackH = Math.max(1, height - padding * 2 - 4);
    const thumbH = Math.max(18, trackH * (visibleRows / total));
    const maxScroll = Math.max(1, total - visibleRows);
    const thumbY = trackY + (trackH - thumbH) * (scrollIndex / maxScroll);
    ctx.fillStyle = 'rgba(90, 104, 120, 0.22)';
    roundedRect(ctx, trackX, trackY, 4, trackH, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(90, 104, 120, 0.55)';
    roundedRect(ctx, trackX, thumbY, 4, thumbH, 2);
    ctx.fill();
  }
  ctx.restore();
}

function wrapBubbleText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function paintValidationBubble(ctx, validation, env) {
  const el = validation?.el;
  const box = el?._box;
  if (!box) return;
  const viewport = env.viewport;
  const scrollX = env.scrollX ?? 0;
  const scrollY = env.scrollY ?? 0;
  const fs = 13;
  const lh = 18;
  const padX = 10;
  const padY = 8;
  const maxW = Math.max(120, Math.min(300, viewport.width - 16));
  const fontStyle = { fontSize: fs, fontWeight: 400, fontFamily: el._style?.fontFamily };

  ctx.save();
  ctx.font = fontString(fontStyle);
  const lines = wrapBubbleText(ctx, validation.message || 'Lütfen bu alanı kontrol edin.', maxW - padX * 2);
  const textW = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const w = Math.min(maxW, Math.max(130, Math.ceil(textW) + padX * 2));
  const h = lines.length * lh + padY * 2;
  const sx = box.x - scrollX;
  const sy = box.y - scrollY;
  let x = sx + box.width / 2 - w / 2;
  x = Math.max(4, Math.min(viewport.width - w - 4, x));
  let y = sy + box.height + 9;
  let above = false;
  if (y + h > viewport.height - 4 && sy - h - 9 >= 4) {
    y = sy - h - 9;
    above = true;
  }
  y = Math.max(4, Math.min(viewport.height - h - 4, y));

  /* Gecersiz kontrolun cevresi hafif kirmizi cizilir. */
  ctx.strokeStyle = 'rgba(198, 62, 52, 0.9)';
  ctx.lineWidth = 1.5;
  roundedRect(ctx, sx - 1.5, sy - 1.5, box.width + 3, box.height + 3, 3);
  ctx.stroke();

  ctx.shadowColor = 'rgba(15, 23, 42, 0.28)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(43, 47, 54, 0.97)';
  roundedRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  const arrowX = Math.max(x + 12, Math.min(x + w - 12, sx + box.width / 2));
  ctx.beginPath();
  if (above) {
    ctx.moveTo(arrowX - 6, y + h - 0.5);
    ctx.lineTo(arrowX + 6, y + h - 0.5);
    ctx.lineTo(arrowX, y + h + 7);
  } else {
    ctx.moveTo(arrowX - 6, y + 0.5);
    ctx.lineTo(arrowX + 6, y + 0.5);
    ctx.lineTo(arrowX, y - 7);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(43, 47, 54, 0.97)';
  ctx.fill();

  ctx.font = fontString(fontStyle);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    ctx.fillText(line, x + padX, y + padY + lh * index + lh / 2);
  });
  ctx.restore();
}

function paintButtonLabel(ctx, box) {
  const label = controlLabel(box.el);
  if (!label) return;
  const style = box.style;
  const disabled = box.el?.hasAttribute('disabled');
  ctx.font = fontString(style);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = cssColor(disabled ? [117, 117, 117, 1] : style.color);
  const cx = box.contentX + box.contentWidth / 2;
  const cy = box.contentY + box.contentHeight / 2;
  ctx.fillText(label, cx, cy + 0.5);
}

function paintTextFragment(ctx, frag) {
  const style = frag.style;
  if (!frag.text) return;
  ctx.font = fontString(style);
  ctx.fillStyle = cssColor(style.color);
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = `${style.letterSpacing || 0}px`;
  ctx.fillText(frag.text, frag.x, frag.baseline);
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

  const decoration = style.textDecorationLine || 'none';
  if (decoration !== 'none' && decoration.includes('underline')) {
    const thickness = Math.max(1, Math.min(2, style.fontSize / 14));
    ctx.fillRect(frag.x, frag.baseline + Math.max(1, style.fontSize * 0.1), frag.width, thickness);
  }
  if (decoration !== 'none' && decoration.includes('line-through')) {
    const thickness = Math.max(1, Math.min(2, style.fontSize / 14));
    ctx.fillRect(frag.x, frag.baseline - style.fontSize * 0.3, frag.width, thickness);
  }
}

function paintMarker(ctx, box, alpha) {
  const style = box.style;
  const type = style.listStyleType;
  if (!type || type === 'none') return;
  const parent = box.el?.parentElement;
  const siblings = parent ? parent.children.filter((e) => e.localName === 'li') : [];
  const index = Math.max(1, siblings.indexOf(box.el) + 1);
  let text;
  if (type === 'decimal' || type === 'decimal-leading-zero') text = `${index}.`;
  else if (type === 'lower-alpha') text = String.fromCharCode(96 + ((index - 1) % 26) + 1) + '.';
  else if (type === 'upper-alpha') text = String.fromCharCode(64 + ((index - 1) % 26) + 1) + '.';
  else if (type === 'circle') text = '\u25e6';
  else if (type === 'square') text = '\u25aa';
  else text = '\u2022';

  const line = box.lineBoxes?.[0];
  const baseline = line ? line.top + Math.min(line.height, style.lineHeight) / 2 + style.fontSize * 0.35 : box.contentY + style.fontSize;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = fontString({ ...style, fontWeight: 400 });
  ctx.fillStyle = cssColor(style.color);
  ctx.textAlign = 'right';
  ctx.fillText(text, box.contentX - 7, baseline);
  ctx.restore();
}

function paintInlineSegments(ctx, box, alpha) {
  if (!box._segments?.length) return;
  for (const seg of box._segments) {
    const pl = box.padding.left;
    const pr = box.padding.right;
    const pt = box.padding.top;
    const pb = box.padding.bottom;
    const bl = box.border.left;
    const br = box.border.right;
    const bt = box.border.top;
    const bb = box.border.bottom;
    const x = seg.x0 - pl - bl;
    const y = seg.y0 - pt - bt;
    const w = Math.max(0, seg.x1 - seg.x0 + pl + pr + bl + br);
    const h = Math.max(0, seg.y1 - seg.y0 + pt + pb + bt + bb);
    ctx.save();
    ctx.globalAlpha = alpha;
    paintBackgroundRect(ctx, box, x, y, w, h, 0);
    paintBorders(ctx, box, x, y, w, h, 0);
    ctx.restore();
  }
}

function paintBoxBackground(ctx, box, alpha) {
  const style = box.style;
  const w = box.width;
  const h = box.height;
  if (w <= 0 || h <= 0) return;
  const radii = resolveRadii(box);
  ctx.save();
  ctx.globalAlpha = alpha;

  if (style.boxShadow?.length) paintShadows(ctx, box, radii);

  const hasColor = Array.isArray(style.backgroundColor) && (style.backgroundColor[3] ?? 1) > 0;
  if (hasColor || style.backgroundImage) {
    paintBackgroundRect(ctx, box, box.x, box.y, w, h, radii);
  }
  paintBorders(ctx, box, box.x, box.y, w, h, radii);
  ctx.restore();
}

function paintShadows(ctx, box, radii) {
  for (const shadow of box.style.boxShadow) {
    if (shadow.inset) continue;
    const base = box.style.backgroundColor;
    if (!Array.isArray(base) || (base[3] ?? 1) <= 0) continue;
    ctx.save();
    ctx.shadowColor = cssColor(shadow.color);
    ctx.shadowBlur = shadow.blur;
    ctx.shadowOffsetX = shadow.x;
    ctx.shadowOffsetY = shadow.y;
    ctx.fillStyle = cssColor(base);
    const r = radii.map((v) => Math.max(0, v + shadow.spread));
    roundedRect(ctx, box.x - shadow.spread, box.y - shadow.spread, box.width + shadow.spread * 2, box.height + shadow.spread * 2, r);
    ctx.fill();
    ctx.restore();
  }
}

function paintBackgroundRect(ctx, box, x, y, w, h, radii) {
  const style = box.style;
  roundedRect(ctx, x, y, w, h, radii);
  if (style.backgroundImage) {
    const gradient = createGradient(ctx, style.backgroundImage, x, y, w, h);
    if (gradient) {
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }
  if (Array.isArray(style.backgroundColor) && (style.backgroundColor[3] ?? 1) > 0) {
    ctx.fillStyle = cssColor(style.backgroundColor);
    ctx.fill();
  }
}

function createGradient(ctx, grad, x, y, w, h) {
  if (!grad?.stops?.length) return null;
  const angle = ((grad.angle ?? 180) * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const length = Math.abs(w * dx) + Math.abs(h * dy);
  const g = ctx.createLinearGradient(cx - (dx * length) / 2, cy - (dy * length) / 2, cx + (dx * length) / 2, cy + (dy * length) / 2);
  for (const stop of grad.stops) {
    const p = typeof stop.position === 'number' ? stop.position : parseFloat(stop.position) || 0;
    g.addColorStop(Math.max(0, Math.min(1, p / 100)), cssColor(stop.color));
  }
  return g;
}

function resolveRadii(box) {
  const w = box.width;
  const h = box.height;
  const max = Math.max(0, Math.min(w, h) / 2);
  return box.radius.map((r) => {
    let value = r;
    if (isPct(value)) value = (Math.min(w, h) * value.pct) / 100;
    return Math.max(0, Math.min(max, value || 0));
  });
}

function roundedRect(ctx, x, y, w, h, radii) {
  const corners = typeof radii === 'number' ? [radii, radii, radii, radii] : (radii ?? [0, 0, 0, 0]);
  const [tlRaw, trRaw, brRaw, blRaw] = corners;
  const max = Math.max(0, Math.min(w, h) / 2);
  const tl = Math.min(tlRaw || 0, max);
  const tr = Math.min(trRaw || 0, max);
  const br = Math.min(brRaw || 0, max);
  const bl = Math.min(blRaw || 0, max);
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function sameColor(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && Math.abs((a[3] ?? 1) - (b[3] ?? 1)) < 0.01;
}

function paintBorders(ctx, box, x, y, w, h, radii) {
  const style = box.style;
  const corners = typeof radii === 'number' ? [radii, radii, radii, radii] : (Array.isArray(radii) ? radii : [0, 0, 0, 0]);
  const sides = ['top', 'right', 'bottom', 'left'];
  const widths = sides.map((s) => box.border[s] || 0);
  if (!widths.some((v) => v > 0)) return;

  const uniformWidth = widths.every((v) => Math.abs(v - widths[0]) < 0.01);
  const uniformColor = sides.every((s) => sameColor(style[`border${cap(s)}Color`], style.borderTopColor));
  const uniformStyle = sides.every((s) => (style[`border${cap(s)}Style`] || 'none') === (style.borderTopStyle || 'none'));
  const borderStyle = style.borderTopStyle || 'solid';

  if (uniformWidth && uniformColor && uniformStyle) {
    const bw = widths[0];
    if (!bw) return;
    const inset = bw / 2;
    const r = corners.map((v) => Math.max(0, v - inset));
    ctx.save();
    roundedRect(ctx, x + inset, y + inset, Math.max(0, w - bw), Math.max(0, h - bw), r);
    ctx.strokeStyle = cssColor(style.borderTopColor);
    ctx.lineWidth = bw;
    ctx.setLineDash(borderStyle === 'dashed' ? [bw * 3, bw * 2] : borderStyle === 'dotted' ? [bw, bw * 1.5] : []);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Farkli kenar genislikleri: yamuk dolgular
  const [bt, br, bb, bl] = widths;
  const color = (side) => cssColor(style[`border${cap(side)}Color`] || style.color);
  ctx.save();
  if (bt) {
    ctx.fillStyle = color('top');
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - Math.min(br, w / 2), y + bt); ctx.lineTo(x + Math.min(bl, w / 2), y + bt);
    ctx.closePath(); ctx.fill();
  }
  if (br) {
    ctx.fillStyle = color('right');
    ctx.beginPath();
    ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - br, y + h - Math.min(bb, h / 2)); ctx.lineTo(x + w - br, y + Math.min(bt, h / 2));
    ctx.closePath(); ctx.fill();
  }
  if (bb) {
    ctx.fillStyle = color('bottom');
    ctx.beginPath();
    ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - Math.min(br, w / 2), y + h - bb); ctx.lineTo(x + Math.min(bl, w / 2), y + h - bb);
    ctx.closePath(); ctx.fill();
  }
  if (bl) {
    ctx.fillStyle = color('left');
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x, y + h);
    ctx.lineTo(x + bl, y + h - Math.min(bb, h / 2)); ctx.lineTo(x + bl, y + Math.min(bt, h / 2));
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function cap(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function paintImage(ctx, box, alpha) {
  const entry = box.image;
  const cx = box.contentX;
  const cy = box.contentY;
  const cw = box.contentWidth;
  const ch = box.contentHeight;
  if (cw <= 0 || ch <= 0) return;
  if (!entry?.img || !entry.ready) {
    return;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  const radii = resolveRadii(box);
  roundedRect(ctx, box.x, box.y, box.width, box.height, radii);
  ctx.clip();

  const img = entry.img;
  const natW = img.naturalWidth || img.width || box.naturalWidth || 1;
  const natH = img.naturalHeight || img.height || box.naturalHeight || 1;
  const fit = box.style.objectFit || 'fill';
  if (fit === 'fill') {
    ctx.drawImage(img, cx, cy, cw, ch);
  } else {
    const scale = fit === 'cover' ? Math.max(cw / natW, ch / natH) : Math.min(cw / natW, ch / natH);
    const dw = natW * scale;
    const dh = natH * scale;
    const dx = cx + (cw - dw) / 2;
    const dy = cy + (ch - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  ctx.restore();
}
