// Narvis motoru: HTML -> DOM -> kaskad -> layout -> canvas.
// Ayrica kucuk bir window/script calistirma ortami ve olay yonlendirmesi.

import { parseDocument } from './html/parser.js';
import { computeStyles } from './style.js';
import { layoutDocument, hitTest } from './layout.js';
import { paintDocument } from './paint.js';
import { Event, CustomEvent, KeyboardEvent, FileList } from './dom.js';
import { clamp, camel } from './util.js';
import { fontString } from './font.js';
import { cssColor } from './css/values.js';
import {
  buildFormRequest,
  buttonAction,
  controlType,
  isDisabled,
  isTextControl,
  multiSelectRowHeight,
  optionElements,
  optionLabel,
  selectedOptionIndex,
  selectedOptionIndexes,
} from './form.js';
import { isValidatableFormControl } from './validation.js';

const MAX_LOG = 200;

/* Click/klavye araliklarinda kapanan aralik [start..end]. */
function range(start, end) {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export class NarvisEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = options.dpr ?? (typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1);
    this.viewport = { width: options.width ?? 900, height: options.height ?? 640 };
    this.measureCanvas = globalThis.document?.createElement?.('canvas') ?? null;
    this.measureCtx = this.measureCanvas?.getContext('2d') ?? null;
    this.imageCache = new Map();
    this.extraStyles = [];
    this.document = null;
    this.layout = null;
    this.window = null;
    this.url = 'narvis://demo';
    this.source = '';
    this.scrollX = 0;
    this.scrollY = 0;
    this.stats = { style: 0, layout: 0, paint: 0, nodes: 0, boxes: 0 };
    this.logs = [];
    this.errors = [];
    this._windowListeners = new Map();
    this._scheduled = false;
    this._hovered = null;
    this._raf = null;
    this.selectPopup = null;
    this.validation = null;
    this._typeahead = '';
    this._typeaheadTimer = null;
    this._drag = null;      // fare secim suruklemesi
    this._dragEnded = null; // su ana biten surukleme (click'imleci ezmesin diye)
    this._lastClick = null; // cift tik algilama
    this._undo = new Map(); // el -> onceki deger/caret anlik goruntuleri
    this._redo = new Map();
    this._fetch = options.fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    this.onStats = options.onStats ?? null;
    this.onConsole = options.onConsole ?? null;
    this.onNavigation = options.onNavigation ?? null;
    this.onError = options.onError ?? null;
    this.onScroll = options.onScroll ?? null;
    this.onFormSubmit = options.onFormSubmit ?? null;
    this.onFileChoose = options.onFileChoose ?? null;
    this.onFormResponse = options.onFormResponse ?? null;

    this.resize(this.viewport.width, this.viewport.height, { silent: true });
  }

  /* ---------------------------------------------------------------- *
   * Yükleme
   * ---------------------------------------------------------------- */

  load(html, options = {}) {
    cancelAnimationFrame?.(this._raf);
    this.source = String(html ?? '');
    this.url = options.url ?? this.url;
    this.extraStyles = options.styles ?? [];
    this.scrollX = 0;
    this.scrollY = 0;
    this.selectPopup = null;
    this.validation = null;
    this._typeahead = '';
    this._drag = null;
    this._dragEnded = null;
    this._lastClick = null;
    this._undo = new Map();
    this._redo = new Map();
    this.document = parseDocument(this.source, { url: this.url });
    this.document.defaultView = this.createWindow();
    this.window = this.document.defaultView;
    this.document._onMutation = () => this.invalidate();
    this.document._onError = (err, info) => this.reportError(err, info);
    this.snapshotFormDefaults();

    this.reflow();
    this.runScripts();
    this.document.readyState = 'complete';
    try {
      this.document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
      this.dispatchWindowEvent(new Event('load'));
    } catch (err) {
      this.reportError(err, { phase: 'load' });
    }
    this.reflow();
    return this;
  }

  /* HTML'deki ilk isaret durumu: form sifirlama bunlara doner. */
  snapshotFormDefaults() {
    for (const el of this.document.querySelectorAll('input')) {
      const type = String(el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') el._defaultChecked = el.hasAttribute('checked');
    }
  }

  runScripts() {
    const scripts = this.document.querySelectorAll('script');
    for (const script of scripts) {
      const src = script.getAttribute('src');
      if (src) {
        this.log('warn', `Harici script atlandi (ag yok): ${src}`);
        continue;
      }
      const code = script.textContent;
      if (!code.trim()) continue;
      this.executeScript(code);
    }
  }

  executeScript(code) {
    const win = this.window;
    try {
      const fn = new Function(
        'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame',
        `with (window) {\n${code}\n}`,
      );
      fn(
        win, this.document, win.console,
        (fn2, ms, ...args) => setTimeout(() => { try { fn2(...args); } catch (e) { this.reportError(e); } }, ms),
        (id) => clearTimeout(id),
        (fn2) => this.raf(fn2),
        (id) => cancelAnimationFrame(id),
      );
    } catch (err) {
      this.reportError(err, { phase: 'script' });
    }
  }

  raf(fn) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }

  /* ---------------------------------------------------------------- *
   * Stil / layout / boya
   * ---------------------------------------------------------------- */

  reflow() {
    if (!this.document) return;
    const t0 = performance.now();
    try {
      this.styles = computeStyles(this.document, {
        width: this.viewport.width,
        height: this.viewport.height,
        extraStyles: this.extraStyles,
      });
      const t1 = performance.now();
      this.layout = layoutDocument(this.document, {
        viewport: this.viewport,
        measureText: (text, style, font) => this.measureText(text, style, font),
        getImage: (src, el) => this.getImage(src, el),
      });
      const t2 = performance.now();
      this.clampScroll();
      this.paintNow();
      const t3 = performance.now();
      this.stats = {
        style: t1 - t0,
        layout: t2 - t1,
        paint: t3 - t2,
        nodes: countNodes(this.document),
        boxes: this.layout.boxes.length,
      };
      this.onStats?.(this.stats);
    } catch (err) {
      this.reportError(err, { phase: 'layout' });
      throw err;
    }
  }

  paintNow() {
    if (!this.layout) return;
    this._updateSticky();
    paintDocument(this.ctx, this.layout, {
      viewport: this.viewport,
      dpr: this.dpr,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      background: '#ffffff',
      validation: this.validation,
      selectPopup: this.selectPopup,
    });
  }

  /* Kaydirma sonrasi sticky kutulari taban konumlarindan yeniden hesaplar.
     Once onceki kaydirmalar geri alinir; boylece her kare birikim yapmaz. */
  _updateSticky() {
    const sticky = this.layout?.sticky;
    if (!sticky?.length) return;
    const shift = this.layout.shiftSubtree;
    if (typeof shift !== 'function') return;

    for (let i = sticky.length - 1; i >= 0; i--) {
      const record = sticky[i];
      if (record.offsetY) {
        shift(record.box, 0, -record.offsetY);
        record.offsetY = 0;
      }
    }

    for (const record of sticky) {
      const box = record.box;
      const marginTop = Number.isFinite(box.margin?.top) ? box.margin.top : 0;
      const marginBottom = Number.isFinite(box.margin?.bottom) ? box.margin.bottom : 0;
      /* Sticky gorunum alani: sayfa icin viewport, bir kaydirma kabi
         icin o kabin scrollport'u. Offsetler margin kutusuna uygulanir. */
      const viewTop = record.scrollport ? record.scrollport.top : this.scrollY;
      const viewHeight = record.scrollport ? record.scrollport.height : this.viewport.height;
      let targetY = record.baseY;
      if (record.top != null) {
        targetY = Math.max(targetY, viewTop + record.top + marginTop);
      }
      if (record.bottom != null) {
        targetY = Math.min(targetY,
          viewTop + viewHeight - record.bottom - box.height - marginBottom);
      }
      const minY = record.limitTop + marginTop;
      const maxY = Math.max(minY, record.limitBottom - box.height - marginBottom);
      targetY = Math.min(Math.max(targetY, minY), maxY);
      const dy = targetY - box.y;
      if (Math.abs(dy) > 0.01) {
        shift(box, 0, dy);
        record.offsetY += dy;
      }
    }
  }

  invalidate() {
    if (this._scheduled) return;
    this._scheduled = true;
    this._raf = this.raf(() => {
      this._scheduled = false;
      try { this.reflow(); } catch { /* hata rapora gitti */ }
    });
  }

  measureText(text, style, font) {
    if (!this.measureCtx) return text.length * (style.fontSize || 16) * 0.55;
    const f = font || fontString(style);
    if (this.measureCtx.font !== f) this.measureCtx.font = f;
    if ('letterSpacing' in this.measureCtx) this.measureCtx.letterSpacing = `${style.letterSpacing || 0}px`;
    const width = this.measureCtx.measureText(text).width;
    if ('letterSpacing' in this.measureCtx) this.measureCtx.letterSpacing = '0px';
    return width;
  }

  getImage(src, el) {
    if (!src) return null;
    let url = src;
    try { url = new URL(src, this.url).href; } catch { url = src; }
    let entry = this.imageCache.get(url);
    if (!entry) {
      const img = new Image();
      entry = { img, ready: false, width: 0, height: 0, url };
      img.onload = () => {
        entry.ready = true;
        entry.width = img.naturalWidth || img.width;
        entry.height = img.naturalHeight || img.height;
        this.invalidate();
      };
      img.onerror = () => {
        entry.failed = true;
        this.log('warn', `Resim yuklenemedi: ${url}`);
      };
      img.src = url;
      this.imageCache.set(url, entry);
    }
    return entry;
  }

  /* ---------------------------------------------------------------- *
   * Gorunum / scroll
   * ---------------------------------------------------------------- */

  resize(width, height, options = {}) {
    this.viewport = { width: Math.max(100, Math.round(width)), height: Math.max(100, Math.round(height)) };
    this.dpr = options.dpr ?? this.dpr;
    this.canvas.width = Math.round(this.viewport.width * this.dpr);
    this.canvas.height = Math.round(this.viewport.height * this.dpr);
    this.canvas.style.width = `${this.viewport.width}px`;
    this.canvas.style.height = `${this.viewport.height}px`;
    if (!options.silent && this.document) {
      this.reflow();
      this.dispatchWindowEvent(new Event('resize'));
    }
  }

  maxScroll() {
    const docHeight = this.layout?.height ?? 0;
    return {
      x: Math.max(0, (this.layout?.width ?? this.viewport.width) - this.viewport.width),
      y: Math.max(0, docHeight - this.viewport.height),
    };
  }

  clampScroll() {
    const max = this.maxScroll();
    this.scrollX = clamp(this.scrollX, 0, max.x);
    this.scrollY = clamp(this.scrollY, 0, max.y);
  }

  scrollBy(dx, dy) {
    if (this.selectPopup) this.closeSelect();
    this.scrollX += dx;
    this.scrollY += dy;
    this.clampScroll();
    this.paintNow();
    this.onScroll?.({ x: this.scrollX, y: this.scrollY, max: this.maxScroll() });
    this.dispatchWindowEvent(new Event('scroll'));
  }

  scrollTo(options = {}) {
    if (typeof options === 'number') {
      this.scrollBy(options - this.scrollY, 0);
      return;
    }
    if (this.selectPopup) this.closeSelect();
    if (options.left != null) this.scrollX = options.left;
    if (options.top != null) this.scrollY = options.top;
    this.clampScroll();
    this.paintNow();
    this.onScroll?.({ x: this.scrollX, y: this.scrollY, max: this.maxScroll() });
    this.dispatchWindowEvent(new Event('scroll'));
  }

  /* ---------------------------------------------------------------- *
   * Etkilesim
   * ---------------------------------------------------------------- */

  elementAt(x, y) {
    if (!this.layout) return null;
    return hitTest(this.layout, x + this.scrollX, y + this.scrollY);
  }

  pointerMove(x, y) {
    /* Surukleme secimi: odakli metin kontrolunde imlocu tasir. */
    if (this._drag?.selecting && isTextControl(this._drag.el)) {
      const el = this._drag.el;
      const anchor = this.selectionAnchor(el);
      const position = this.caretIndexAtPoint(el, x, y);
      const start = el.selectionStart ?? position;
      const end = el.selectionEnd ?? position;
      if (position !== start || position !== end) {
        this._drag.moved = position !== anchor;
        this.setCaretRange(el, Math.min(position, anchor), Math.max(position, anchor), anchor);
        this.invalidate();
      }
      this.canvas.style.cursor = 'text';
      return el;
    }

    if (this.selectPopup) {
      const hit = this.selectPopupHit(x, y);
      if (hit.inside) {
        const item = hit.item;
        if (item && !item.disabled && hit.index !== this.selectPopup.activeIndex) {
          this.selectPopup.activeIndex = hit.index;
          this.invalidate();
        }
        this.canvas.style.cursor = item && !item.disabled ? 'pointer' : 'default';
        if (this._hovered) this.setHover(null);
        return this.selectPopup.el;
      }
    }
    const el = this.elementAt(x, y);
    if (el !== this._hovered) {
      this.setHover(el);
    }
    let cursor = el?._style?.cursor ?? 'auto';
    if (cursor === 'auto' && isTextControl(el) && !isDisabled(el) && !el.hasAttribute('readonly')) {
      cursor = 'text';
    }
    if (cursor === 'auto') {
      const interactive = el?.closest?.('a[href], button, input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="reset"], input[type="button"], select, [role="button"]');
      if (interactive) cursor = 'pointer';
    }
    this.canvas.style.cursor = cursor;
    return el;
  }

  setHover(el) {
    if (this._hovered) {
      for (let n = this._hovered; n; n = n.parentElement) n._hover = false;
    }
    this._hovered = el;
    if (el) {
      for (let n = el; n; n = n.parentElement) n._hover = true;
    }
    if (this.layout) this.invalidate();
  }

  click(x, y, options = {}) {
    /* Surukleme seciminde tiklama imleci bastan kurmasin. */
    const dragEnded = this._dragEnded;
    this._dragEnded = null;

    /* Acik select listesi DOM'un ustunde bir katman: once onu dene. */
    const popup = this.selectPopup;
    if (popup) {
      const hit = this.selectPopupHit(x, y);
      if (hit.index >= 0) {
        if (!hit.item.disabled) this.chooseSelectIndex(popup.el, hit.index);
        return popup.el;
      }
      if (hit.inside) return popup.el;
      const sameSelect = this.elementAt(x, y) === popup.el;
      this.closeSelect();
      if (sameSelect) return popup.el;
    }

    const el = this.elementAt(x, y);
    if (!el) return null;
    if (this.validation && this.validation.el !== el) this.hideValidation();
    /* Baska yere tiklama odagi birakir (tarayicida mousedown gibi). */
    const active = this.document?.activeElement;
    if (active && active !== this.document.body && active !== el && !active.contains?.(el)) {
      active.blur();
    }
    const event = new Event('click', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pageX: x + this.scrollX,
      pageY: y + this.scrollY,
      button: 0,
    });
    el.dispatchEvent(event);
    if (!event.defaultPrevented) {
      const skipCaret = dragEnded && dragEnded.moved && dragEnded.el === el;
      this.applyFormDefaults(el, skipCaret ? null : {
        x, y, shiftKey: !!options.shiftKey, ctrlKey: !!options.ctrlKey,
      });
      const anchor = el.closest?.('a[href]');
      if (anchor) {
        const href = anchor.getAttribute('href');
        if (href && !href.startsWith('#')) this.onNavigation?.(href, anchor);
      }
    }
    return el;
  }

  pointerDown(x, y, options = {}) {
    if (!this.document) return null;
    const el = this.elementAt(x, y);
    const now = Date.now();
    const last = this._lastClick;
    const isDoubleClick = !!(last && last.el === el && now - last.time < 450
      && Math.abs(last.x - x) < 4 && Math.abs(last.y - y) < 4);
    this._lastClick = { el, x, y, time: now };
    this._dragEnded = null;

    if (this.selectPopup) {
      const hit = this.selectPopupHit(x, y);
      if (!hit.inside) this.closeSelect();
      this._drag = null;
      return el;
    }

    if (!el) {
      this._drag = null;
      return null;
    }

    if (isTextControl(el) && !isDisabled(el) && !el.hasAttribute('readonly')) {
      el.focus();
      if (isDoubleClick) {
        this.selectWordAtPoint(el, x, y);
        this._drag = { el, moved: true, selecting: true };
      } else {
        this.setCaretFromPoint(el, x, y, !!options.shiftKey);
        this._drag = { el, moved: false, selecting: true };
      }
      return el;
    }

    this._drag = { el, moved: false };
    return el;
  }

  pointerUp(x, y) {
    const drag = this._drag;
    this._drag = null;
    this._dragEnded = drag && drag.el ? drag : null;
    return drag?.el ?? this.elementAt(x, y);
  }

  isDragSelecting() {
    return !!this._drag?.selecting;
  }

  /* Form kontrollerinin tarayici varsayilan davranisi: checkbox/radio
     isaretleme (radio grubunda tek secim), metin imleci, select listesi,
     submit/reset ve odaklanma. Sayfa click'i iptal ederse calismaz. */
  applyFormDefaults(el, point = null) {
    const isControl = (node) => node && ['input', 'textarea', 'select', 'button'].includes(node.localName);
    let target = el;
    const original = el;
    /* label tiklamasi bagli kontrolu tetikler: for="id" ya da ic ice kontrol. */
    if (!isControl(target)) {
      const label = target.closest?.('label');
      if (label) {
        const forId = label.getAttribute('for');
        target = forId ? this.document.getElementById(forId) : label.querySelector('input, textarea, select, button');
      }
    }
    /* Butonun icindeki span/metin tiklamasi da butonu tetikler. */
    if (!isControl(target)) target = target.closest?.('button, input, select, textarea') ?? target;
    if (!isControl(target)) return;
    if (isDisabled(target)) return;
    const name = target.localName;
    const type = name === 'input' ? controlType(target) : '';

    if (name === 'select') {
      if (target.hasAttribute('multiple')) this.multiClick(target, point);
      else this.openSelect(target);
      this.invalidate();
      return;
    }

    /* input[type=file]: kabuk gizli yerel seciciyi acar; secim setFiles'a gelir. */
    if (name === 'input' && type === 'file') {
      target.focus();
      try { this.onFileChoose?.(target); } catch (err) { this.reportError(err, { phase: 'file-choose' }); }
      this.invalidate();
      return;
    }

    if (isTextControl(target)) {
      target.focus();
      if (point && original === target) {
        this.setCaretFromPoint(target, point.x, point.y, point.shiftKey);
      }
      this.invalidate();
      return;
    }

    if (name === 'input' && type === 'checkbox') {
      if (target._defaultChecked == null) target._defaultChecked = target.hasAttribute('checked');
      target.checked = !target.checked;
    } else if (name === 'input' && type === 'radio') {
      const group = target.getAttribute('name');
      if (group) {
        for (const other of this.document.querySelectorAll('input')) {
          if (other !== target
            && String(other.getAttribute('type') || '').toLowerCase() === 'radio'
            && other.getAttribute('name') === group) {
            if (other._defaultChecked == null) other._defaultChecked = other.hasAttribute('checked');
            other.checked = false;
          }
        }
      }
      if (target._defaultChecked == null) target._defaultChecked = target.hasAttribute('checked');
      target.checked = true;
    } else if (name === 'button' || (name === 'input' && ['submit', 'reset', 'button', 'image'].includes(type))) {
      const action = name === 'button' ? buttonAction(target) : (type === 'button' ? 'button' : type === 'reset' ? 'reset' : 'submit');
      const form = target.closest('form');
      if (action === 'reset' && form) this.resetForm(form);
      else if (action === 'submit' && form) this.submitForm(form, target);
    }
    if (typeof target.focus === 'function') target.focus();
    this.invalidate();
  }

  /* <form> sifirlama: metin degerleri nitelik/varsayilana, onay kutulari
     ilk isaret durumuna, select'ler ilk secili option'a doner. */
  resetForm(form) {
    if (!form) return false;
    if (this.validation?.el && form.contains?.(this.validation.el)) this.hideValidation();
    if (this.selectPopup && form.contains?.(this.selectPopup.el)) this.closeSelect();
    const event = new Event('reset', { bubbles: true, cancelable: true });
    if (!form.dispatchEvent(event)) return false;
    for (const control of form.querySelectorAll('input, textarea, select')) {
      const type = control.localName === 'input' ? controlType(control) : '';
      if (type === 'checkbox' || type === 'radio') {
        const def = control._defaultChecked ?? control.hasAttribute('checked');
        control.checked = def;
      } else if (control.localName === 'select') {
        control._selectedIndex = null;
        /* null: option'lardaki selected niteligi yeniden gecerli olur. */
        for (const option of optionElements(control)) option._selected = null;
        control._markDirty();
      } else if (type === 'file') {
        control._files = new FileList();
        control._markDirty();
      } else if (!['submit', 'reset', 'button', 'file'].includes(type)) {
        control._value = null;
        control._selStart = null;
        control._selEnd = null;
        control._selAnchor = null;
        control._markDirty();
      }
    }
    this.invalidate();
    return true;
  }

  /* input[type=file]: kabuk seciciyi acti, secilen dosyalar buraya yazilir. */
  setFiles(input, files) {
    if (!input || input.localName !== 'input' || controlType(input) !== 'file') return null;
    const list = new FileList(files);
    input._files = list;
    input._markDirty();
    if (this.validation?.el === input) this.hideValidation();
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: false, inputType: 'insertFromPaste' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    this.invalidate();
    return list;
  }

  /* ---------------------------------------------------------------- *
   * Klavye: odakli kontrole metin, imlec, Tab ve Enter
   * ---------------------------------------------------------------- */

  handleKeyDown(init = {}) {
    if (!this.document) return false;
    const active = this.document.activeElement;
    const target = active && active !== this.document.body ? active : this.document.body;
    const event = new KeyboardEvent('keydown', {
      ...init,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    let handled = event.defaultPrevented;

    if (!handled) {
      const windowEvent = new KeyboardEvent('keydown', { ...init, cancelable: true });
      this.dispatchWindowEvent(windowEvent);
      handled = windowEvent.defaultPrevented;
    }

    if (!handled) {
      handled = this.defaultKeyAction(active && active !== this.document.body ? active : null, init);
      if (handled) event.preventDefault();
    }
    return handled;
  }

  handleKeyUp(init = {}) {
    if (!this.document) return false;
    const active = this.document.activeElement;
    const target = active && active !== this.document.body ? active : this.document.body;
    const event = new KeyboardEvent('keyup', { ...init, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    this.dispatchWindowEvent(new KeyboardEvent('keyup', { ...init, cancelable: true }));
    return event.defaultPrevented;
  }

  defaultKeyAction(active, init) {
    const key = String(init.key ?? '');
    if (!active) return false;

    if (this.selectPopup) return this.selectPopupKey(active, init);
    if (key === 'Tab') {
      this.moveFocus(init.shiftKey ? -1 : 1);
      return true;
    }
    if (isTextControl(active)) {
      if (active.hasAttribute('readonly') || isDisabled(active)) return false;
      return this.textKey(active, init);
    }
    if (active.localName === 'select') {
      if (isDisabled(active)) return false;
      return this.selectKey(active, init);
    }
    if ((key === ' ' || key === 'Enter') && this.isActivatable(active)) {
      this.activateElement(active, init);
      return true;
    }
    return false;
  }

  isActivatable(el) {
    if (!el) return false;
    if (el.localName === 'button' || el.localName === 'a' && el.hasAttribute('href')) return true;
    if (el.localName === 'input') {
      return ['checkbox', 'radio', 'submit', 'reset', 'button', 'image', 'file'].includes(controlType(el));
    }
    return el.getAttribute?.('role') === 'button';
  }

  activateElement(el, init = {}) {
    const box = el._box;
    const x = box ? box.x + box.width / 2 - this.scrollX : 0;
    const y = box ? box.y + box.height / 2 - this.scrollY : 0;
    const event = new Event('click', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pageX: x + this.scrollX,
      pageY: y + this.scrollY,
      button: 0,
      shiftKey: !!init.shiftKey,
      ctrlKey: !!init.ctrlKey,
      altKey: !!init.altKey,
      metaKey: !!init.metaKey,
    });
    el.dispatchEvent(event);
    if (event.defaultPrevented) return;
    this.applyFormDefaults(el);
    if (el.localName === 'a' && el.hasAttribute('href')) {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('#')) this.onNavigation?.(href, el);
    }
  }

  focusableElements() {
    const out = [];
    for (const el of this.document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')) {
      if (el.getAttribute('tabindex') === '-1') continue;
      if (isDisabled(el)) continue;
      if (!el._box) continue;
      if (el._style?.visibility === 'hidden' || el._style?.display === 'none') continue;
      if (el.localName === 'input' && controlType(el) === 'hidden') continue;
      out.push(el);
    }
    return out;
  }

  moveFocus(delta) {
    const list = this.focusableElements();
    if (!list.length) {
      if (this.document.body) this.document.activeElement = this.document.body;
      this.invalidate();
      return null;
    }
    let index = list.indexOf(this.document.activeElement);
    if (index < 0) index = delta > 0 ? -1 : 0;
    const next = list[(index + delta + list.length) % list.length];
    next.focus();
    this.revealElement(next);
    this.invalidate();
    return next;
  }

  revealElement(el) {
    const box = el?._box;
    if (!box) return;
    const margin = 8;
    let top = this.scrollY;
    if (box.y - top < margin) top = box.y - margin;
    else if (box.y + box.height - top > this.viewport.height - margin) {
      top = box.y + box.height - this.viewport.height + margin;
    }
    if (Math.abs(top - this.scrollY) > 0.5) {
      this.scrollTo({ top, left: this.scrollX });
    }
  }

  textKey(el, init) {
    const key = String(init.key ?? '');
    const ctrl = !!(init.ctrlKey || init.metaKey);
    const value = String(el.value ?? '');

    if (ctrl) {
      if (key.toLowerCase() === 'z') {
        return init.shiftKey ? this.redoText(el) : this.undoText(el);
      }
      if (key.toLowerCase() === 'y') {
        return this.redoText(el);
      }
      if (key.toLowerCase() === 'a') {
        this.setCaretRange(el, 0, value.length, 0);
        this.invalidate();
        return true;
      }
      if (key === 'Home') {
        this.setCaretRange(el, 0, 0, 0);
        return true;
      }
      if (key === 'End') {
        this.setCaretRange(el, value.length, value.length, value.length);
        return true;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        this.moveCaret(el, key, init.shiftKey, true);
        return true;
      }
      return false;
    }

    if (key === 'Enter') {
      if (el.localName === 'textarea') {
        this.insertText(el, '\n');
        return true;
      }
      const form = el.closest('form');
      if (form) this.submitForm(form, this.defaultSubmitter(form));
      return true;
    }
    if (key === 'Escape') {
      el.blur();
      this.invalidate();
      return true;
    }
    if (key === 'Backspace') {
      this.deleteText(el, true);
      return true;
    }
    if (key === 'Delete') {
      this.deleteText(el, false);
      return true;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      this.moveCaret(el, key, init.shiftKey, false);
      return true;
    }
    if (key.length === 1 && !init.altKey) {
      this.insertText(el, key);
      return true;
    }
    return false;
  }

  caretPosition(el) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    if (start === end) return end;
    return this.selectionAnchor(el) === start ? end : start;
  }

  selectionAnchor(el) {
    const length = String(el.value ?? '').length;
    const raw = Number.isInteger(el._selAnchor) ? el._selAnchor : length;
    return Math.max(0, Math.min(length, raw));
  }

  setCaretRange(el, start, end, anchor = null) {
    if (!isTextControl(el)) return;
    const length = String(el.value ?? '').length;
    const a = Math.max(0, Math.min(length, Number(start) || 0));
    const b = Math.max(0, Math.min(length, Number(end) || 0));
    el._selStart = Math.min(a, b);
    el._selEnd = Math.max(a, b);
    const focus = Number.isInteger(anchor) ? anchor : b;
    el._selAnchor = Math.max(0, Math.min(length, focus));
    el._markDirty();
    this.invalidate();
  }

  lineBounds(value, position) {
    const lines = String(value).split('\n');
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
      const len = lines[i].length;
      if (position <= start + len) {
        return { index: i, start, end: start + len, text: lines[i] };
      }
      start += len + 1;
    }
    const last = lines.length - 1;
    return { index: last, start: start - (lines[last]?.length ?? 0), end: start, text: lines[last] ?? '' };
  }

  moveCaret(el, key, shift, word) {
    const value = String(el.value ?? '');
    const multiline = el.localName === 'textarea';
    let focus = shift ? this.caretPosition(el) : (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'Home' ? (el.selectionStart ?? 0) : (el.selectionEnd ?? 0));
    const anchor = shift ? this.selectionAnchor(el) : focus;

    if (key === 'Home') {
      focus = multiline ? this.lineBounds(value, focus).start : 0;
    } else if (key === 'End') {
      focus = multiline ? this.lineBounds(value, focus).end : value.length;
    } else if (key === 'ArrowLeft') {
      focus = word ? this.wordBoundary(value, focus, -1) : focus - 1;
    } else if (key === 'ArrowRight') {
      focus = word ? this.wordBoundary(value, focus, 1) : focus + 1;
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && multiline) {
      const line = this.lineBounds(value, focus);
      const column = Math.max(0, focus - line.start);
      if (key === 'ArrowUp' && line.index > 0) {
        const previous = this.lineBounds(value, Math.max(0, line.start - 1));
        focus = previous.start + Math.min(column, previous.end - previous.start);
      } else if (key === 'ArrowDown' && line.end < value.length) {
        const next = this.lineBounds(value, line.end + 1);
        focus = next.start + Math.min(column, next.end - next.start);
      }
    }
    focus = Math.max(0, Math.min(value.length, focus));
    if (shift) this.setCaretRange(el, Math.min(focus, anchor), Math.max(focus, anchor), anchor);
    else this.setCaretRange(el, focus, focus, focus);
  }

  wordBoundary(value, position, direction) {
    let i = Math.max(0, Math.min(value.length, position));
    if (direction < 0) {
      while (i > 0 && /\s/.test(value[i - 1])) i--;
      while (i > 0 && !/\s/.test(value[i - 1])) i--;
    } else {
      while (i < value.length && !/\s/.test(value[i])) i++;
      while (i < value.length && /\s/.test(value[i])) i++;
    }
    return i;
  }

  insertText(el, text) {
    if (!isTextControl(el) || isDisabled(el) || el.hasAttribute('readonly')) return false;
    let inserted = String(text ?? '');
    if (!inserted) return false;
    const value = String(el.value ?? '');
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const max = parseInt(el.getAttribute('maxlength'), 10);
    if (Number.isFinite(max) && max >= 0) {
      const room = max - (value.length - (end - start));
      if (room <= 0) return true;
      if (inserted.length > room) inserted = inserted.slice(0, room);
    }

    const before = new Event('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: inserted,
    });
    if (!el.dispatchEvent(before)) return false;

    this._recordUndo(el);
    const next = value.slice(0, start) + inserted + value.slice(end);
    el._value = next;
    el._selStart = start + inserted.length;
    el._selEnd = el._selStart;
    el._selAnchor = el._selStart;
    this.afterTextInput(el, 'insertText', inserted);
    return true;
  }

  deleteText(el, backward) {
    if (!isTextControl(el) || isDisabled(el) || el.hasAttribute('readonly')) return false;
    const value = String(el.value ?? '');
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    let nextStart = start;
    let nextValue;
    if (end > start) {
      nextValue = value.slice(0, start) + value.slice(end);
    } else if (backward && start > 0) {
      nextStart = start - 1;
      nextValue = value.slice(0, nextStart) + value.slice(start);
    } else if (!backward && start < value.length) {
      nextValue = value.slice(0, start) + value.slice(start + 1);
    } else {
      return true;
    }

    const inputType = backward ? 'deleteContentBackward' : 'deleteContentForward';
    const before = new Event('beforeinput', { bubbles: true, cancelable: true, inputType, data: null });
    if (!el.dispatchEvent(before)) return false;

    this._recordUndo(el);
    el._value = nextValue;
    el._selStart = nextStart;
    el._selEnd = nextStart;
    el._selAnchor = nextStart;
    this.afterTextInput(el, inputType, null);
    return true;
  }

  afterTextInput(el, inputType, data) {
    el._markDirty();
    if (this.validation?.el === el) this.hideValidation();
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: false, inputType, data }));
    this.invalidate();
  }

  /* ---------------------------------------------------------------- *
   * Geri al / yinele (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
   * ---------------------------------------------------------------- */

  textSnapshot(el) {
    return {
      value: String(el.value ?? ''),
      selStart: el.selectionStart ?? 0,
      selEnd: el.selectionEnd ?? 0,
      anchor: this.selectionAnchor(el),
    };
  }

  _recordUndo(el) {
    const stack = this._undo.get(el) ?? [];
    stack.push(this.textSnapshot(el));
    if (stack.length > 100) stack.shift();
    this._undo.set(el, stack);
    this._redo.delete(el);
  }

  restoreTextSnapshot(el, snapshot, inputType) {
    if (!snapshot) return;
    el._value = snapshot.value;
    el._selStart = Math.max(0, Math.min(snapshot.value.length, snapshot.selStart));
    el._selEnd = Math.max(el._selStart, Math.min(snapshot.value.length, snapshot.selEnd));
    el._selAnchor = Math.max(0, Math.min(snapshot.value.length, snapshot.anchor));
    this.afterTextInput(el, inputType, null);
  }

  undoText(el) {
    if (!isTextControl(el) || isDisabled(el) || el.hasAttribute('readonly')) return false;
    const stack = this._undo.get(el);
    if (!stack?.length) return false;
    const redo = this._redo.get(el) ?? [];
    redo.push(this.textSnapshot(el));
    this._redo.set(el, redo);
    const snapshot = stack.pop();
    this._undo.set(el, stack);
    this.restoreTextSnapshot(el, snapshot, 'historyUndo');
    return true;
  }

  redoText(el) {
    if (!isTextControl(el) || isDisabled(el) || el.hasAttribute('readonly')) return false;
    const stack = this._redo.get(el);
    if (!stack?.length) return false;
    const undo = this._undo.get(el) ?? [];
    undo.push(this.textSnapshot(el));
    this._undo.set(el, undo);
    const snapshot = stack.pop();
    this._redo.set(el, stack);
    this.restoreTextSnapshot(el, snapshot, 'historyRedo');
    return true;
  }

  insertClipboardText(text) {
    const el = this.document?.activeElement;
    if (!isTextControl(el) || isDisabled(el) || el.hasAttribute('readonly')) return false;
    let value = String(text ?? '').replace(/\r\n?/g, '\n');
    /* Tek satirli kontrollerde satir sonlari bosluga donusur; Enter
       formu gonderdigi icin metin kutusuna satir sonu yazilmaz. */
    if (el.localName !== 'textarea') value = value.replace(/\n/g, ' ');
    return this.insertText(el, value);
  }

  selectedText() {
    const el = this.document?.activeElement;
    if (!isTextControl(el)) return '';
    const value = String(el.value ?? '');
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    return value.slice(start, end);
  }

  cutSelectedText() {
    const el = this.document?.activeElement;
    const text = this.selectedText();
    if (text && el) this.deleteText(el, true);
    return text;
  }

  caretIndexAtPoint(el, x, y) {
    const box = el?._box;
    if (!box) return 0;
    const cx = box.contentX;
    const cy = box.contentY;
    const value = String(el.value ?? '');
    const style = { ...(el._style ?? {}), fontWeight: 400 };

    if (el.localName === 'textarea') {
      const lh = typeof el._style?.lineHeight === 'number' && el._style.lineHeight > 0
        ? el._style.lineHeight : (el._style?.fontSize || 16) * 1.4;
      const lines = value.split('\n');
      const localY = y + this.scrollY - cy;
      const lineIndex = Math.max(0, Math.min(lines.length - 1, Math.floor(localY / lh)));
      let lineStart = 0;
      for (let i = 0; i < lineIndex; i++) lineStart += lines[i].length + 1;
      return lineStart + this.nearestCaretIndex(lines[lineIndex], x + this.scrollX - cx, style);
    }
    return this.nearestCaretIndex(value, x + this.scrollX - cx + (el._paintScrollX || 0), style);
  }

  setCaretFromPoint(el, x, y, extend = false) {
    const box = el?._box;
    if (!box || !isTextControl(el)) return;
    const position = this.caretIndexAtPoint(el, x, y);

    if (extend) {
      const anchor = this.selectionAnchor(el);
      this.setCaretRange(el, Math.min(position, anchor), Math.max(position, anchor), anchor);
    } else {
      this.setCaretRange(el, position, position, position);
    }
    if (this.validation?.el === el) this.hideValidation();
    this.invalidate();
  }

  /* Cift tik kelime secimi: imlecin en yakin oldugu sozu secer. */
  selectWordAtPoint(el, x, y) {
    if (!isTextControl(el)) return null;
    const value = String(el.value ?? '');
    const position = this.caretIndexAtPoint(el, x, y);
    let start = this.wordBoundary(value, position, -1);
    let end = this.wordBoundary(value, position, 1);
    /* wordBoundary boşlukları kelime sonuna dahil eder; seçimde temizle. */
    while (end > start && /\s/.test(value[end - 1])) end--;
    if (el.localName === 'textarea') {
      const line = this.lineBounds(value, position);
      start = Math.max(start, line.start);
      end = Math.min(end, line.end);
    }
    if (end <= start) this.setCaretRange(el, position, position, position);
    else this.setCaretRange(el, start, end, start);
    this.invalidate();
    return { start, end };
  }

  nearestCaretIndex(text, x, style) {
    const value = String(text ?? '');
    if (x <= 0) return 0;
    let index = 0;
    for (let i = 1; i <= value.length; i++) {
      if (this.measureText(value.slice(0, i), style) <= x) index = i;
      else break;
    }
    if (index < value.length) {
      const before = this.measureText(value.slice(0, index), style);
      const after = this.measureText(value.slice(0, index + 1), style);
      if (after - x < x - before) index += 1;
    }
    return index;
  }

  /* ---------------------------------------------------------------- *
   * Select listesi
   * ---------------------------------------------------------------- */

  selectKey(select, init) {
    const key = String(init.key ?? '');
    const ctrl = !!(init.ctrlKey || init.metaKey);
    /* select[multiple]: acilir liste yerine yerinde liste. */
    if (select.hasAttribute('multiple')) return this.multiSelectKey(select, init);
    if (key === ' ' || key === 'Enter' || (init.altKey && key === 'ArrowDown')) {
      this.openSelect(select);
      return true;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      this.stepSelect(select, key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (key === 'Home' || key === 'End') {
      this.edgeSelect(select, key === 'End');
      return true;
    }
    if (key === 'Escape' && this.selectPopup) {
      this.closeSelect();
      return true;
    }
    if (key.length === 1 && !ctrl && !init.altKey) {
      this.selectTypeahead(select, key);
      return true;
    }
    return false;
  }

  openSelect(select, options = {}) {
    if (!select || select.localName !== 'select' || isDisabled(select)) return null;
    if (select.hasAttribute('multiple')) {
      select.focus();
      return null;
    }
    const items = optionElements(select).map((option) => ({
      label: optionLabel(option),
      value: option.getAttribute('value') ?? optionLabel(option),
      disabled: option.hasAttribute('disabled'),
    }));
    if (!items.some((item) => !item.disabled)) {
      select.focus();
      return null;
    }
    select.focus();
    let active = options.activeIndex ?? selectedOptionIndex(select);
    if (active < 0 || !items[active] || items[active].disabled) {
      active = items.findIndex((item) => !item.disabled);
    }
    this.selectPopup = this.buildSelectPopup(select, items, Math.max(0, active));
    this.invalidate();
    return this.selectPopup;
  }

  buildSelectPopup(select, items, activeIndex) {
    const style = select._style ?? {};
    const fs = style.fontSize || 14;
    const lh = typeof style.lineHeight === 'number' && style.lineHeight > 0 ? style.lineHeight : fs * 1.4;
    const rowHeight = Math.max(22, Math.round(lh + 8));
    const padding = 4;
    const visibleRows = Math.min(items.length, 10);
    const height = visibleRows * rowHeight + padding * 2;
    const box = select._box ?? { x: 0, y: 0, width: 100, height: 22 };
    const width = Math.max(80, Math.min(this.viewport.width - 8, box.width));
    const x = Math.max(4, Math.min(this.viewport.width - width - 4, box.x - this.scrollX));
    let y = box.y + box.height - this.scrollY + 2;
    if (y + height > this.viewport.height - 4) {
      const above = box.y - this.scrollY - height - 2;
      if (above >= 4) y = above;
    }
    y = Math.max(4, Math.min(this.viewport.height - height - 4, y));
    let scrollIndex = 0;
    if (activeIndex >= visibleRows) scrollIndex = activeIndex - visibleRows + 1;
    scrollIndex = clamp(scrollIndex, 0, Math.max(0, items.length - visibleRows));
    return {
      el: select,
      items,
      style,
      x,
      y,
      width,
      height,
      rowHeight,
      padding,
      activeIndex,
      scrollIndex,
      selectedIndex: selectedOptionIndex(select),
    };
  }

  selectPopupRows(popup = this.selectPopup) {
    if (!popup) return 1;
    return Math.max(1, Math.floor((popup.height - popup.padding * 2) / popup.rowHeight));
  }

  selectPopupHit(x, y) {
    const popup = this.selectPopup;
    if (!popup) return { index: -1, item: null, inside: false };
    if (x < popup.x || x > popup.x + popup.width || y < popup.y || y > popup.y + popup.height) {
      return { index: -1, item: null, inside: false };
    }
    const row = Math.floor((y - popup.y - popup.padding) / popup.rowHeight);
    const index = popup.scrollIndex + row;
    if (row < 0 || index < 0 || index >= popup.items.length) {
      return { index: -1, item: null, inside: true };
    }
    return { index, item: popup.items[index], inside: true };
  }

  selectPopupKey(active, init) {
    const popup = this.selectPopup;
    if (!popup) return false;
    const key = String(init.key ?? '');
    const ctrl = !!(init.ctrlKey || init.metaKey);
    if (key === 'Escape') {
      this.closeSelect();
      return true;
    }
    if (key === 'Tab') {
      this.closeSelect();
      this.moveFocus(init.shiftKey ? -1 : 1);
      return true;
    }
    if (key === 'Enter' || key === ' ') {
      if (popup.activeIndex >= 0) this.chooseSelectIndex(popup.el, popup.activeIndex);
      return true;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'PageDown' || key === 'PageUp') {
      const step = key === 'PageDown' ? this.selectPopupRows(popup)
        : key === 'PageUp' ? -this.selectPopupRows(popup)
          : key === 'ArrowDown' ? 1 : -1;
      this.moveSelectActive(popup, step);
      return true;
    }
    if (key === 'Home' || key === 'End') {
      const items = popup.items;
      let index = key === 'Home' ? 0 : items.length - 1;
      const step = key === 'Home' ? 1 : -1;
      while (index >= 0 && index < items.length && items[index].disabled) index += step;
      if (index >= 0 && index < items.length) {
        popup.activeIndex = index;
        this.ensureSelectPopupVisible(popup);
        this.invalidate();
      }
      return true;
    }
    if (key.length === 1 && !ctrl && !init.altKey) {
      this.selectTypeahead(popup.el, key, popup);
      return true;
    }
    return false;
  }

  moveSelectActive(popup, step) {
    let index = popup.activeIndex;
    for (let guard = 0; guard < popup.items.length; guard++) {
      index += step > 0 ? 1 : -1;
      if (index < 0 || index >= popup.items.length) return;
      if (popup.items[index].disabled) continue;
      popup.activeIndex = index;
      this.ensureSelectPopupVisible(popup);
      this.invalidate();
      return;
    }
  }

  ensureSelectPopupVisible(popup) {
    const rows = this.selectPopupRows(popup);
    if (popup.activeIndex < popup.scrollIndex) popup.scrollIndex = popup.activeIndex;
    else if (popup.activeIndex >= popup.scrollIndex + rows) popup.scrollIndex = popup.activeIndex - rows + 1;
    popup.scrollIndex = clamp(popup.scrollIndex, 0, Math.max(0, popup.items.length - rows));
  }

  closeSelect() {
    if (!this.selectPopup) return;
    this.selectPopup = null;
    this.invalidate();
  }

  chooseSelectIndex(select, index) {
    this.closeSelect();
    return this.setSelectIndex(select, index);
  }

  setSelectIndex(select, index) {
    const options = optionElements(select);
    if (index < 0 || index >= options.length || options[index].hasAttribute('disabled')) return false;
    select.selectedIndex = index;
    select._valueAtFocus = select.value;
    if (this.validation?.el === select) this.hideValidation();
    select.dispatchEvent(new Event('input', { bubbles: true, cancelable: false, inputType: 'insertReplacementText' }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    this.invalidate();
    return true;
  }

  stepSelect(select, delta) {
    const options = optionElements(select);
    if (!options.length) return false;
    let index = selectedOptionIndex(select);
    if (index < 0) index = delta > 0 ? -1 : options.length;
    for (let i = index + delta; i >= 0 && i < options.length; i += delta) {
      if (!options[i].hasAttribute('disabled')) return this.setSelectIndex(select, i);
    }
    return false;
  }

  edgeSelect(select, last) {
    const options = optionElements(select);
    for (let i = last ? options.length - 1 : 0; i >= 0 && i < options.length; i += last ? -1 : 1) {
      if (!options[i].hasAttribute('disabled')) return this.setSelectIndex(select, i);
    }
    return false;
  }

  selectTypeahead(select, char, popup = null) {
    const text = String(char ?? '');
    if (!text) return;
    this._typeahead += text.toLowerCase();
    clearTimeout(this._typeaheadTimer);
    this._typeaheadTimer = setTimeout(() => { this._typeahead = ''; }, 700);
    const needle = this._typeahead;
    const options = optionElements(select);
    const start = popup ? popup.activeIndex : Math.max(0, selectedOptionIndex(select));
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset) % options.length;
      const option = options[index];
      if (option.hasAttribute('disabled')) continue;
      if (optionLabel(option).toLowerCase().startsWith(needle)) {
        if (popup) {
          popup.activeIndex = index;
          this.ensureSelectPopupVisible(popup);
          this.invalidate();
        } else {
          this.setSelectIndex(select, index);
        }
        return;
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * select[multiple]: yerinde liste; tik / Ctrl+tik / Shift+tik ve
   * ok tuslari ile coklu secim. Secim durumu option._selected uzerinde.
   * ---------------------------------------------------------------- */

  multiMetrics(select) {
    const box = select._box;
    const rowH = multiSelectRowHeight(select);
    const options = optionElements(select);
    const visible = Math.max(1, Math.floor((box?.contentHeight ?? 0) / rowH));
    const maxScroll = Math.max(0, options.length - visible);
    let scroll = Number.isInteger(select._multiScroll) ? select._multiScroll : 0;
    select._multiScroll = scroll = Math.max(0, Math.min(maxScroll, scroll));
    return { box, rowH, options, visible, maxScroll, scroll };
  }

  multiIndexAtPoint(select, x, y) {
    const { box, rowH, options, scroll } = this.multiMetrics(select);
    if (!box) return -1;
    const row = Math.floor((y + this.scrollY - box.contentY) / rowH);
    const index = scroll + row;
    if (x + this.scrollX < box.contentX || x + this.scrollX > box.contentX + box.contentWidth) return -1;
    if (row < 0 || index < 0 || index >= options.length) return -1;
    return index;
  }

  multiEnsureVisible(select, index) {
    const { visible, maxScroll } = this.multiMetrics(select);
    if (index == null || index < 0) return;
    let scroll = select._multiScroll ?? 0;
    if (index < scroll) scroll = index;
    else if (index >= scroll + visible) scroll = index - visible + 1;
    select._multiScroll = Math.max(0, Math.min(maxScroll, scroll));
  }

  multiFocusIndex(select) {
    const { options } = this.multiMetrics(select);
    let focus = Number.isInteger(select._multiFocus) ? select._multiFocus : -1;
    if (focus < 0 || focus >= options.length) {
      const selected = selectedOptionIndexes(select);
      focus = selected.length ? selected[0] : -1;
    }
    if (focus < 0 || focus >= options.length || options[focus].hasAttribute('disabled')) {
      focus = options.findIndex((option) => !option.hasAttribute('disabled'));
    }
    select._multiFocus = focus;
    if (focus >= 0) this.multiEnsureVisible(select, focus);
    return focus;
  }

  /* Secim birligi: sadece bu fonksiyon option._selected yazar ve olay yayar. */
  setMultiSelection(select, indexes) {
    const options = optionElements(select);
    const valid = new Set((indexes ?? []).filter((i) => Number.isInteger(i)
      && i >= 0 && i < options.length && !options[i].hasAttribute('disabled')));
    for (let i = 0; i < options.length; i++) {
      options[i]._selected = valid.has(i);
      options[i]._markDirty?.();
    }
    if (valid.size) {
      const first = [...valid].sort((a, b) => a - b)[0];
      select._selectedIndex = first;
    } else {
      select._selectedIndex = null;
    }
    select._valueAtFocus = select.value;
    if (this.validation?.el === select) this.hideValidation();
    select.dispatchEvent(new Event('input', { bubbles: true, cancelable: false, inputType: 'insertReplacementText' }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    this.invalidate();
    return [...valid];
  }

  /* Odagi tasi; select/extend/caret modlarinda secimi guncelle. */
  multiMoveFocus(select, index, mode = 0) {
    const options = optionElements(select);
    if (index < 0 || index >= options.length || options[index].hasAttribute('disabled')) return false;
    const prev = select._multiFocus;
    const anchor = Number.isInteger(select._multiAnchor) ? select._multiAnchor : prev;
    select._multiFocus = index;
    select._multiAnchor = mode === 2 ? Math.max(0, anchor ?? 0) : index;
    this.multiEnsureVisible(select, index);
    if (mode === 2) {
      /* Shift+ok: cipa sabit araligi genislet. */
      if (Number.isInteger(anchor) && anchor >= 0) {
        this.setMultiSelection(select, range(anchor, index));
      }
    } else if (mode === 0) {
      /* Ok tuslari (Ctrl'siz): tek satir sec. */
      this.setMultiSelection(select, [index]);
    } else {
      /* Ctrl+ok: yalniz odak. */
      this.invalidate();
    }
    return true;
  }

  multiStep(select, delta, shift, ctrl) {
    const { options } = this.multiMetrics(select);
    let index = Number.isInteger(select._multiFocus) ? select._multiFocus : this.multiFocusIndex(select);
    if (index < 0) index = delta > 0 ? options.length : -1;
    for (let i = index + delta; i >= 0 && i < options.length; i += delta) {
      if (!options[i].hasAttribute('disabled')) {
        return this.multiMoveFocus(select, i, ctrl ? 1 : shift ? 2 : 0);
      }
    }
    return false;
  }

  multiEdge(select, last, shift, ctrl) {
    const { options } = this.multiMetrics(select);
    const start = last ? options.length - 1 : 0;
    const step = last ? -1 : 1;
    for (let i = start; i >= 0 && i < options.length; i += step) {
      if (!options[i].hasAttribute('disabled')) {
        return this.multiMoveFocus(select, i, ctrl ? 1 : shift ? 2 : 0);
      }
    }
    return false;
  }

  multiPage(select, down, shift, ctrl) {
    const { options, visible } = this.multiMetrics(select);
    const step = Math.max(1, visible - 1);
    const focus = Number.isInteger(select._multiFocus) ? select._multiFocus : this.multiFocusIndex(select);
    const target = down
      ? Math.min(options.length - 1, (focus < 0 ? -1 : focus) + step)
      : Math.max(0, Math.max(0, focus) - step);
    return this.multiMoveFocus(select, target, ctrl ? 1 : shift ? 2 : 0);
  }

  multiSelectKey(select, init) {
    const key = String(init.key ?? '');
    const ctrl = !!(init.ctrlKey || init.metaKey);
    const shift = !!init.shiftKey;
    this.multiFocusIndex(select);
    if (key === ' ' || key === 'Enter') {
      const focus = select._multiFocus;
      const options = optionElements(select);
      if (focus < 0 || options[focus].hasAttribute('disabled')) return true;
      const selected = selectedOptionIndexes(select);
      const next = selected.includes(focus)
        ? selected.filter((i) => i !== focus)
        : [...selected, focus];
      select._multiAnchor = focus;
      this.setMultiSelection(select, next);
      return true;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      this.multiStep(select, key === 'ArrowDown' ? 1 : -1, shift, ctrl);
      return true;
    }
    if (key === 'PageDown' || key === 'PageUp') {
      this.multiPage(select, key === 'PageDown', shift, ctrl);
      return true;
    }
    if (key === 'Home' || key === 'End') {
      this.multiEdge(select, key === 'End', shift, ctrl);
      return true;
    }
    if (key.length === 1 && !ctrl && !init.altKey) {
      /* Yazarak odak tasi: secim degismez. */
      const text = String(key);
      this._typeahead += text.toLowerCase();
      clearTimeout(this._typeaheadTimer);
      this._typeaheadTimer = setTimeout(() => { this._typeahead = ''; }, 700);
      const { options } = this.multiMetrics(select);
      const start = Math.max(0, select._multiFocus);
      for (let offset = 0; offset < options.length; offset++) {
        const index = (start + offset) % options.length;
        const option = options[index];
        if (option.hasAttribute('disabled')) continue;
        if (optionLabel(option).toLowerCase().startsWith(this._typeahead)) {
          return this.multiMoveFocus(select, index, 0);
        }
      }
      return true;
    }
    return false;
  }

  multiClick(select, point = null) {
    select.focus();
    this.multiFocusIndex(select);
    if (!point) {
      this.invalidate();
      return select;
    }
    const index = this.multiIndexAtPoint(select, point.x, point.y);
    if (index < 0) {
      this.invalidate();
      return select;
    }
    const options = optionElements(select);
    const option = options[index];
    if (option.hasAttribute('disabled')) {
      this.invalidate();
      return select;
    }
    const anchor = select._multiAnchor;
    select._multiFocus = index;
    select._multiAnchor = index;
    if (point.ctrlKey) {
      /* Ctrl+tik: o satiri isaretle/isaretini kaldir. */
      const selected = selectedOptionIndexes(select);
      this.setMultiSelection(select, selected.includes(index)
        ? selected.filter((i) => i !== index)
        : [...selected, index]);
    } else if (point.shiftKey && Number.isInteger(anchor) && anchor >= 0) {
      this.setMultiSelection(select, range(anchor, index));
    } else {
      this.setMultiSelection(select, [index]);
    }
    this.invalidate();
    return select;
  }

  /* ---------------------------------------------------------------- *
   * Dogrulama ve form gonderimi
   * ---------------------------------------------------------------- */

  showValidation(el, message) {
    if (!el) return;
    if (this.validation?.el && this.validation.el !== el) this.validation.el._invalid = false;
    el._invalid = true;
    this.validation = { el, message: String(message || 'Lütfen bu alanı kontrol edin.') };
    this.invalidate();
  }

  hideValidation() {
    if (this.validation?.el) this.validation.el._invalid = false;
    const had = !!this.validation;
    this.validation = null;
    if (had) this.invalidate();
  }

  validateForm(form) {
    let first = null;
    for (const control of form.querySelectorAll('input, textarea, select')) {
      if (!isValidatableFormControl(control)) continue;
      if (!control.checkValidity()) first ??= control;
    }
    return first;
  }

  defaultSubmitter(form) {
    for (const control of form.querySelectorAll('button, input')) {
      if (isDisabled(control)) continue;
      if (control.localName === 'button') {
        if (buttonAction(control) === 'submit') return control;
      } else if (['submit', 'image'].includes(controlType(control))) {
        return control;
      }
    }
    return null;
  }

  async submitForm(form, submitter = null, settings = {}) {
    if (!form || form.localName !== 'form') return { submitted: false };
    this.closeSelect();
    if (!settings.direct) {
      if (!form.hasAttribute('novalidate')) {
        const invalid = this.validateForm(form);
        if (invalid) {
          invalid.focus?.();
          this.revealElement(invalid);
          this.showValidation(invalid, invalid.validationMessage);
          return { submitted: false, invalid };
        }
      }
      this.hideValidation();
      const event = new Event('submit', { bubbles: true, cancelable: true, submitter });
      if (!form.dispatchEvent(event)) return { submitted: false, prevented: true };
    } else {
      this.hideValidation();
    }

    let request;
    try {
      request = buildFormRequest(form, submitter, this.url);
    } catch (err) {
      this.reportError(err, { phase: 'form-request' });
      return { submitted: false, error: err };
    }
    try { this.onFormSubmit?.(request, form, submitter); } catch (err) { this.reportError(err, { phase: 'form-submit' }); }

    if (!this._fetch) {
      this.log('warn', `Form gonderilemedi (ag yok): ${request.method} ${request.url}`);
      return { submitted: true, request, offline: true };
    }

    try {
      const response = await this._fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const html = await response.text();
      const result = {
        request,
        response,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url || request.url,
        html,
      };
      this.log(response.ok ? 'info' : 'warn', `${request.method} ${request.url} → ${response.status}`);
      try {
        await this.onFormResponse?.(result, form, submitter);
      } catch (err) {
        this.reportError(err, { phase: 'form-response' });
      }
      return { submitted: true, ...result };
    } catch (err) {
      this.reportError(err, { phase: 'submit', url: request.url });
      return { submitted: false, request, error: err };
    }
  }

  /* ---------------------------------------------------------------- *
   * window
   * ---------------------------------------------------------------- */

  createWindow() {
    const engine = this;
    const win = {
      document: this.document,
      devicePixelRatio: this.dpr,
      location: {
        href: this.url,
        get pathname() { try { return new URL(engine.url).pathname; } catch { return engine.url; } },
        get origin() { try { return new URL(engine.url).origin; } catch { return 'narvis://'; } },
      },
      console: this.createConsole(),
      Event,
      CustomEvent,
      Image: typeof Image !== 'undefined' ? Image : class {},
      addEventListener: (type, listener) => this.addWindowListener(type, listener),
      removeEventListener: (type, listener) => this.removeWindowListener(type, listener),
      dispatchEvent: (event) => this.dispatchWindowEvent(event),
      requestAnimationFrame: (fn) => this.raf(fn),
      cancelAnimationFrame: (id) => cancelAnimationFrame?.(id),
      setTimeout: (fn, ms, ...args) => setTimeout(() => { try { fn(...args); } catch (err) { engine.reportError(err); } }, ms),
      clearTimeout: (id) => clearTimeout(id),
      scrollTo: (options, y) => this.scrollTo(typeof options === 'number' ? { left: options, top: y } : options),
      scrollBy: (options, y) => this.scrollBy(typeof options === 'number' ? options : options.left ?? 0, typeof options === 'number' ? y ?? 0 : options.top ?? 0),
      getComputedStyle: (el) => this.getComputedStyle(el),
      matchMedia: (query) => ({
        matches: this.mediaQuery(query),
        media: query,
        addEventListener() {}, removeEventListener() {},
      }),
      alert: (message) => this.log('warn', `alert: ${message}`),
      Narvis: { version: '0.1.0', engine: this },
    };
    Object.defineProperty(win, 'scrollX', { get: () => this.scrollX });
    Object.defineProperty(win, 'scrollY', { get: () => this.scrollY });
    Object.defineProperty(win, 'innerWidth', { get: () => this.viewport.width });
    Object.defineProperty(win, 'innerHeight', { get: () => this.viewport.height });
    win.window = win;
    win.self = win;
    win.globalThis = win;
    win.top = win;
    win.parent = win;
    win.console = this.createConsole();
    return win;
  }

  createConsole() {
    const make = (level) => (...args) => this.log(level, ...args.map(formatArg));
    return { log: make('log'), info: make('info'), warn: make('warn'), error: make('error'), debug: make('debug') };
  }

  addWindowListener(type, listener) {
    let list = this._windowListeners.get(type);
    if (!list) { list = []; this._windowListeners.set(type, list); }
    if (!list.includes(listener)) list.push(listener);
  }

  removeWindowListener(type, listener) {
    const list = this._windowListeners.get(type);
    if (list) this._windowListeners.set(type, list.filter((fn) => fn !== listener));
  }

  dispatchWindowEvent(event) {
    event.target = this.window;
    event.currentTarget = this.window;
    const list = this._windowListeners.get(event.type);
    if (list) {
      for (const listener of [...list]) {
        try { listener.call(this.window, event); } catch (err) { this.reportError(err); }
      }
    }
    const handler = this.window?.['on' + event.type];
    if (typeof handler === 'function') {
      try { handler.call(this.window, event); } catch (err) { this.reportError(err); }
    }
    return !event.defaultPrevented;
  }

  mediaQuery(query) {
    const width = this.viewport.width;
    return /min-width/.test(query) ? width >= parseFloat(query.match(/min-width\s*:\s*([\d.]+)/)?.[1] ?? 0) : true;
  }

  /* ---------------------------------------------------------------- *
   * Gozlem / hata
   * ---------------------------------------------------------------- */

  log(level, ...args) {
    const text = args.map(formatArg).join(' ');
    const entry = { level, text, time: new Date() };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOG) this.logs.shift();
    this.onConsole?.(entry);
    if (level === 'error' && this.onError) this.onError(entry);
  }

  reportError(err, info = {}) {
    const message = err?.stack ? `${err.name || 'Hata'}: ${err.message}\n${err.stack}` : String(err);
    this.errors.push({ message, info, time: new Date() });
    this.log('error', message);
    this.onError?.({ level: 'error', text: message, info });
  }

  getComputedStyle(el) {
    const style = el?._style;
    const out = {};
    if (style) {
      for (const [key, value] of Object.entries(style)) {
        if (key.startsWith('_')) continue;
        out[key] = formatComputedValue(key, value);
      }
    }
    out.getPropertyValue = (name) => {
      const key = camel(String(name));
      if (key in out) return out[key];
      if (style && key === 'borderWidth') return `${style.borderTopWidth}px`;
      return '';
    };
    return out;
  }

  getSelection() {
    return this._hovered;
  }

  destroy() {
    cancelAnimationFrame?.(this._raf);
    this.imageCache.clear();
  }
}

function formatComputedValue(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 4 && typeof value[0] === 'number' && typeof value[3] === 'number') return cssColor(value);
    return value.map((v) => (v && typeof v === 'object' ? formatComputedValue(key, v) : v)).join(', ');
  }
  if (value && typeof value === 'object') {
    if ('pct' in value) return `${value.pct}%`;
    if ('angle' in value) return `linear-gradient(${value.angle}deg, ...)`;
    if (key === 'boxShadow') return 'shadow';
    return JSON.stringify(value);
  }
  return String(value);
}

function formatArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  if (value == null) return String(value);
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function countNodes(doc) {
  let n = 1;
  const walk = (el) => {
    for (const child of el.childNodes) {
      n++;
      if (child.nodeType === 1) walk(child);
    }
  };
  if (doc.documentElement) walk(doc.documentElement);
  return n;
}
