// Narvis DOM - tarayici DOM'unun motorun ihtiyac duydugu alt kumesi.
// Element, Text, Comment, Document ve basit olay sistemi burada.

import { matchesSelector, parseSelectorList } from './css/selectors.js';
import { parseFragment } from './html/parser.js';
import { splitTopLevel, firstTopLevelColon, escapeHtml, escapeAttr } from './util.js';
import {
  controlType,
  defaultSelectIndex,
  findOptionIndexByValue,
  isTextControl,
  optionElements,
  selectedOption,
  selectedOptionIndex,
} from './form.js';
import { getValidationState } from './validation.js';

let uid = 0;
const selectorCache = new Map();

function cachedSelector(text) {
  let parsed = selectorCache.get(text);
  if (!parsed) {
    parsed = parseSelectorList(text);
    selectorCache.set(text, parsed);
  }
  return parsed;
}

export class Event {
  constructor(type, init = {}) {
    this.type = String(type);
    this.bubbles = init.bubbles ?? true;
    this.cancelable = init.cancelable ?? true;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.timeStamp = Date.now();
    this._stop = false;
    this._stopImmediate = false;
    this._dispatching = false;
    Object.assign(this, init);
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopImmediate = true; }
  composedPath() {
    const path = [];
    for (let n = this.target; n; n = n.parentNode) path.push(n);
    return path;
  }
}

export class CustomEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail ?? null;
  }
}

/* Klavye olayi: motor varsayilan davranislari tetiklemeden once sayfaya
   gercek bir keydown gonderir; sayfa preventDefault derse motor susar. */
export class KeyboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.key = init.key ?? '';
    this.code = init.code ?? '';
    this.location = init.location ?? 0;
    this.ctrlKey = !!init.ctrlKey;
    this.shiftKey = !!init.shiftKey;
    this.altKey = !!init.altKey;
    this.metaKey = !!init.metaKey;
    this.repeat = !!init.repeat;
    this.isComposing = !!init.isComposing;
    this.keyCode = init.keyCode ?? 0;
    this.which = init.which ?? this.keyCode;
  }
}

function invokeListeners(node, event, capture) {
  const list = node._listeners?.get(event.type);
  if (!list) return;
  for (const entry of [...list]) {
    if (entry.removed) continue;
    if (capture && !entry.capture) continue;
    if (!capture && entry.capture) continue;
    if (entry.once) entry.removed = true;
    event.currentTarget = node;
    try {
      if (typeof entry.listener === 'function') entry.listener.call(node, event);
      else if (entry.listener && typeof entry.listener.handleEvent === 'function') entry.listener.handleEvent(event);
    } catch (err) {
      reportListenerError(err, node, event);
    }
    if (event._stopImmediate) return;
  }
}

function reportListenerError(err, node, event) {
  const doc = node.nodeType === 9 ? node : node.ownerDocument;
  const handler = doc?._onError;
  if (handler) handler(err, { node, event });
  else if (typeof console !== 'undefined') console.error(err);
}

export class Node {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
    this._listeners = null;
    this._uid = ++uid;
    this._data = null;
  }

  get ownerDocument() {
    let n = this;
    while (n && n.nodeType !== 9) n = n.parentNode;
    return n;
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.childNodes;
    return list[list.indexOf(this) + 1] ?? null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.childNodes;
    return list[list.indexOf(this) - 1] ?? null;
  }

  get isConnected() {
    let n = this;
    while (n) {
      if (n.nodeType === 9) return true;
      n = n.parentNode;
    }
    return false;
  }

  _markDirty() {
    const doc = this.nodeType === 9 ? this : this.ownerDocument;
    doc?._onMutation?.();
  }

  _adopt(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    if (node.ownerDocument && this.ownerDocument && node.ownerDocument !== this.ownerDocument) {
      // Basit sahiplik aktarimi; agac zaten tek dokumanda kullaniliyor.
    }
  }

  appendChild(node) {
    if (!node) throw new TypeError('appendChild: node gerekli');
    if (node === this) throw new Error('Bir dugum kendi alt dugumu olamaz');
    this._adopt(node);
    node.parentNode = this;
    this.childNodes.push(node);
    this._markDirty();
    return node;
  }

  insertBefore(node, reference) {
    if (!reference) return this.appendChild(node);
    const idx = this.childNodes.indexOf(reference);
    if (idx === -1) throw new Error('insertBefore: referans dugum bulunamadi');
    this._adopt(node);
    node.parentNode = this;
    this.childNodes.splice(idx, 0, node);
    this._markDirty();
    return node;
  }

  removeChild(node) {
    const idx = this.childNodes.indexOf(node);
    if (idx === -1) throw new Error('removeChild: dugum bulunamadi');
    this.childNodes.splice(idx, 1);
    node.parentNode = null;
    this._markDirty();
    return node;
  }

  replaceChild(newNode, oldNode) {
    const idx = this.childNodes.indexOf(oldNode);
    if (idx === -1) throw new Error('replaceChild: dugum bulunamadi');
    this._adopt(newNode);
    newNode.parentNode = this;
    oldNode.parentNode = null;
    this.childNodes[idx] = newNode;
    this._markDirty();
    return oldNode;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  getRootNode() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n;
  }

  get textContent() {
    let out = '';
    for (const child of this.childNodes) out += child.textContent;
    return out;
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value != null && String(value) !== '') {
      this.appendChild(new Text(String(value)));
    }
    this._markDirty();
  }

  get nodeValue() { return null; }
  set nodeValue(_) {}

  cloneNode(deep = false) {
    let copy;
    if (this.nodeType === 1) {
      copy = new Element(this.localName);
      for (const [k, v] of this._attrs) copy._attrs.set(k, v);
      copy._decl._load(this._attrs.get('style') ?? '');
    } else if (this.nodeType === 3) {
      copy = new Text(this.data);
    } else if (this.nodeType === 8) {
      copy = new Comment(this.data);
    } else {
      copy = new Document(this.url);
    }
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }

  addEventListener(type, listener, options = {}) {
    if (!listener) return;
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    const once = typeof options === 'object' && !!options.once;
    if (!this._listeners) this._listeners = new Map();
    let list = this._listeners.get(type);
    if (!list) { list = []; this._listeners.set(type, list); }
    if (list.some((e) => e.listener === listener && e.capture === capture && !e.removed)) return;
    list.push({ listener, capture, once, removed: false });
  }

  removeEventListener(type, listener, options = {}) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    const list = this._listeners?.get(type);
    if (!list) return;
    const entry = list.find((e) => e.listener === listener && e.capture === capture);
    if (entry) entry.removed = true;
    this._listeners.set(type, list.filter((e) => !e.removed));
  }

  dispatchEvent(event) {
    if (!(event instanceof Event)) throw new TypeError('dispatchEvent: Event gerekli');
    if (event._dispatching) throw new Error('Olay zaten dagitiliyor');
    event._dispatching = true;
    event.target = this;
    const path = [];
    for (let n = this; n; n = n.parentNode) path.push(n);

    event.eventPhase = 1;
    for (let i = path.length - 1; i >= 0 && !event._stop; i--) {
      invokeListeners(path[i], event, true);
    }
    if (!event._stop) {
      event.eventPhase = 2;
      invokeListeners(this, event, true);
      if (!event._stopImmediate) invokeListeners(this, event, false);
    }
    if (!event._stop) {
      event.eventPhase = 3;
      for (let i = 1; i < path.length && !event._stop; i++) invokeListeners(path[i], event, false);
    }

    // on<olay> ozellikleri
    const inline = this['on' + event.type];
    if (!event._stop && typeof inline === 'function') {
      try { inline.call(this, event); } catch (err) { reportListenerError(err, this, event); }
    }

    event.eventPhase = 0;
    event.currentTarget = null;
    event._dispatching = false;
    return !event.defaultPrevented;
  }
}

export class Text extends Node {
  constructor(data = '') {
    super();
    this._data = String(data);
  }
  get nodeType() { return 3; }
  get nodeName() { return '#text'; }
  get data() { return this._data; }
  set data(v) { this._data = String(v); this._markDirty(); }
  get nodeValue() { return this._data; }
  set nodeValue(v) { this.data = v; }
  get textContent() { return this._data; }
  set textContent(v) { this.data = v; }
  get length() { return this._data.length; }
  splitText(offset) {
    const rest = new Text(this._data.slice(offset));
    this._data = this._data.slice(0, offset);
    if (this.parentNode) this.parentNode.insertBefore(rest, this.nextSibling);
    return rest;
  }
}

export class Comment extends Node {
  constructor(data = '') {
    super();
    this._data = String(data);
  }
  get nodeType() { return 8; }
  get nodeName() { return '#comment'; }
  get data() { return this._data; }
  set data(v) { this._data = String(v); this._markDirty(); }
  get textContent() { return this._data; }
  set textContent(v) { this._data = String(v); }
}

class ClassList {
  constructor(owner) { this._owner = owner; }
  _list() { return (this._owner.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _save(list) { this._owner.setAttribute('class', [...new Set(list)].join(' ')); }
  get length() { return this._list().length; }
  get value() { return this._owner.getAttribute('class') || ''; }
  set value(v) { this._owner.setAttribute('class', String(v)); }
  contains(name) { return this._list().includes(name); }
  add(...names) { const list = this._list(); for (const n of names) if (!list.includes(n)) list.push(n); this._save(list); }
  remove(...names) { this._save(this._list().filter((n) => !names.includes(n))); }
  toggle(name, force) {
    const has = this.contains(name);
    const should = force === undefined ? !has : !!force;
    if (should) this.add(name); else this.remove(name);
    return should;
  }
  replace(a, b) {
    const list = this._list();
    const idx = list.indexOf(a);
    if (idx === -1) return false;
    list[idx] = b;
    this._save(list);
    return true;
  }
  item(i) { return this._list()[i] ?? null; }
  forEach(cb, thisArg) { this._list().forEach(cb, thisArg); }
  *[Symbol.iterator]() { yield* this._list(); }
  toString() { return this.value; }
}

// Inline stil nesnesi: el.style.color = 'red' gibi kullanimlari destekler.
class StyleDeclaration {
  constructor(owner) {
    this._owner = owner;
    this._props = new Map();
    this._loading = false;
  }

  _load(text) {
    this._loading = true;
    this._props.clear();
    for (const chunk of splitTopLevel(String(text ?? ''), ';')) {
      const idx = firstTopLevelColon(chunk);
      if (idx === -1) continue;
      const prop = chunk.slice(0, idx).trim().toLowerCase();
      const value = chunk.slice(idx + 1).trim();
      if (prop && value) this._props.set(prop, value);
    }
    this._loading = false;
  }

  _write() {
    if (this._loading) return;
    const css = this.cssText;
    this._owner._attrs.set('style', css);
    this._owner._markDirty();
  }

  get cssText() {
    let out = '';
    for (const [k, v] of this._props) out += `${k}: ${v}; `;
    return out.trim();
  }

  set cssText(v) {
    this._load(v);
    this._write();
  }

  get length() { return this._props.size; }

  item(i) { return [...this._props.keys()][i] ?? ''; }

  getPropertyValue(name) {
    return this._props.get(String(name).toLowerCase()) ?? '';
  }

  setProperty(name, value, priority) {
    const prop = String(name).toLowerCase();
    if (value == null || value === '') {
      this._props.delete(prop);
    } else {
      this._props.set(prop, priority ? `${value} !important` : String(value));
    }
    this._write();
  }

  removeProperty(name) {
    const prop = String(name).toLowerCase();
    const old = this._props.get(prop) ?? '';
    this._props.delete(prop);
    this._write();
    return old;
  }
}

const STYLE_METHODS = new Set(['cssText', 'length', 'item', 'getPropertyValue', 'setProperty', 'removeProperty']);
const PROP_ALIASES = { cssFloat: 'float', styleFloat: 'float' };

function makeStyleProxy(decl) {
  return new Proxy(decl, {
    get(target, prop, receiver) {
      if (prop === 'cssText') return target.cssText;
      if (prop === 'length') return target.length;
      if (prop === 'item') return (i) => target.item(i);
      if (prop === 'getPropertyValue') return (n) => target.getPropertyValue(n);
      if (prop === 'setProperty') return (n, v, p) => target.setProperty(n, v, p);
      if (prop === 'removeProperty') return (n) => target.removeProperty(n);
      if (prop === 'toString') return () => target.cssText;
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (STYLE_METHODS.has(prop)) return Reflect.get(target, prop, receiver);
      const name = PROP_ALIASES[prop] || prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      return target.getPropertyValue(name);
    },
    set(target, prop, value) {
      if (prop === 'cssText') { target.cssText = value; return true; }
      if (typeof prop !== 'string') return false;
      const name = PROP_ALIASES[prop] || prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      target.setProperty(name, value);
      return true;
    },
  });
}

function serializeNode(node) {
  if (node.nodeType === 3) return escapeHtml(node.data);
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  if (node.nodeType !== 1) {
    return node.childNodes.map(serializeNode).join('');
  }
  let out = `<${node.localName}`;
  for (const [k, v] of node._attrs) out += v === '' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`;
  out += '>';
  if (VOID_TAGS.has(node.localName)) return out;
  out += node.childNodes.map(serializeNode).join('');
  return `${out}</${node.localName}>`;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

export class Element extends Node {
  constructor(localName) {
    super();
    this.localName = String(localName).toLowerCase();
    this._attrs = new Map();
    this._decl = new StyleDeclaration(this);
    this._classList = null;
    this._dataset = null;
    this._box = null;
    this._hover = false;
    this._active = false;
  }

  get nodeType() { return 1; }
  get tagName() { return this.localName.toUpperCase(); }
  get nodeName() { return this.tagName; }
  get namespaceURI() { return 'http://www.w3.org/1999/xhtml'; }

  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }

  get classList() {
    return this._classList ??= new ClassList(this);
  }

  get style() {
    return this._styleProxy ??= makeStyleProxy(this._decl);
  }
  set style(v) {
    this.setAttribute('style', v);
  }

  get dataset() {
    if (!this._dataset) {
      const el = this;
      this._dataset = new Proxy({}, {
        get(_, prop) {
          if (typeof prop !== 'string') return undefined;
          return el.getAttribute('data-' + prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())) ?? undefined;
        },
        set(_, prop, value) {
          el.setAttribute('data-' + prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), value);
          return true;
        },
        deleteProperty(_, prop) {
          el.removeAttribute('data-' + prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
          return true;
        },
        ownKeys() {
          return [...el._attrs.keys()].filter((k) => k.startsWith('data-')).map((k) => k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
        },
        getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
      });
    }
    return this._dataset;
  }

  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) {
    if (v) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }

  /* Form degerleri: value niteligi + yazma icin _value; checked niteligi.
     select/option icin secim durumu _selectedIndex uzerinden tutulur. */
  get value() {
    if (this.localName === 'select') {
      if (this.multiple) {
        const selected = this.options.find((option) => option.selected);
        return selected ? (selected.getAttribute('value') ?? String(selected.textContent ?? '')) : '';
      }
      const option = selectedOption(this);
      return option ? (option.getAttribute('value') ?? String(option.textContent ?? '')) : '';
    }
    if (this.localName === 'option') {
      const attr = this.getAttribute('value');
      return attr != null ? attr : String(this.textContent ?? '');
    }
    if (this._value != null) return this._value;
    if (this.localName === 'textarea') return this.textContent;
    if (this.localName === 'button') {
      const attr = this.getAttribute('value');
      return attr != null ? attr : this.textContent;
    }
    return this.getAttribute('value') ?? '';
  }
  set value(v) {
    if (this.localName === 'select') {
      const index = findOptionIndexByValue(this, v);
      if (this.multiple) {
        const options = this.options;
        for (let i = 0; i < options.length; i++) {
          options[i]._selected = i === index && !options[i].disabled;
        }
        this._selectedIndex = index >= 0 ? index : -1;
      } else {
        this._selectedIndex = index;
      }
      this._markDirty();
      return;
    }
    if (this.localName === 'option') {
      this.setAttribute('value', v);
      return;
    }
    this._value = v == null ? '' : String(v);
    this._selStart = null;
    this._selEnd = null;
    this._selAnchor = null;
    this._markDirty();
  }

  get checked() { return this.hasAttribute('checked'); }
  set checked(v) {
    if (v) this.setAttribute('checked', '');
    else this.removeAttribute('checked');
  }

  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get readOnly() { return this.hasAttribute('readonly'); }
  set readOnly(v) {
    if (v) this.setAttribute('readonly', '');
    else this.removeAttribute('readonly');
  }

  get required() { return this.hasAttribute('required'); }
  set required(v) {
    if (v) this.setAttribute('required', '');
    else this.removeAttribute('required');
  }

  get type() {
    if (this.localName === 'input') return controlType(this);
    if (this.localName === 'button') return String(this.getAttribute('type') || 'submit').toLowerCase();
    return this.localName;
  }

  /* --- select / option ------------------------------------------------- */

  get options() { return optionElements(this); }
  get length() { return this.localName === 'select' ? this.options.length : 0; }
  get multiple() { return this.localName === 'select' && this.hasAttribute('multiple'); }

  get selectedIndex() {
    if (this.localName === 'select') {
      if (this.multiple) return this.options.findIndex((option) => option.selected);
      return selectedOptionIndex(this);
    }
    return -1;
  }
  set selectedIndex(v) {
    if (this.localName !== 'select') return;
    const count = this.options.length;
    const index = Number(v);
    this._selectedIndex = Number.isInteger(index) && index >= 0 && index < count ? index : -1;
    /* Coklu listede selectedIndex tek basina dilim secimi belirler. */
    if (this.multiple) {
      this.options.forEach((option, i) => { option._selected = i === this._selectedIndex; });
    }
    this._markDirty();
  }

  get selectedOptions() {
    if (this.localName !== 'select') return [];
    const options = this.options;
    if (this.multiple) {
      return options.filter((option) => option.selected);
    }
    const index = this.selectedIndex;
    return index >= 0 ? [options[index]] : [];
  }

  get selected() {
    if (this.localName !== 'option') return false;
    const select = this.closest?.('select');
    if (!select) return this.hasAttribute('selected');
    if (select.multiple) return this._selected ?? this.hasAttribute('selected');
    return select.options.indexOf(this) === select.selectedIndex;
  }
  set selected(v) {
    if (this.localName !== 'option') return;
    const select = this.closest?.('select');
    if (!select) {
      if (v) this.setAttribute('selected', '');
      else this.removeAttribute('selected');
      return;
    }
    if (select.multiple) {
      this._selected = !!v;
      this._markDirty();
      return;
    }
    if (v) select.selectedIndex = select.options.indexOf(this);
  }

  get defaultSelected() { return this.localName === 'option' && this.hasAttribute('selected'); }

  /* --- metin secimi / imlec ------------------------------------------- */

  get selectionStart() {
    if (!isTextControl(this)) return null;
    const length = String(this.value ?? '').length;
    return Math.min(length, Math.max(0, Number.isInteger(this._selStart) ? this._selStart : length));
  }
  set selectionStart(v) {
    if (!isTextControl(this)) return;
    const value = String(this.value ?? '');
    const start = Math.min(value.length, Math.max(0, Number(v) || 0));
    const end = Number.isInteger(this._selEnd) ? Math.max(start, Math.min(value.length, this._selEnd)) : start;
    this._selStart = start;
    this._selEnd = end;
    this._markDirty();
  }

  get selectionEnd() {
    if (!isTextControl(this)) return null;
    const length = String(this.value ?? '').length;
    return Math.min(length, Math.max(0, Number.isInteger(this._selEnd) ? this._selEnd : length));
  }
  set selectionEnd(v) {
    if (!isTextControl(this)) return;
    const value = String(this.value ?? '');
    const end = Math.min(value.length, Math.max(0, Number(v) || 0));
    const start = Number.isInteger(this._selStart) ? Math.min(end, Math.max(0, this._selStart)) : end;
    this._selStart = start;
    this._selEnd = end;
    this._markDirty();
  }

  setSelectionRange(start, end, direction = 'none') {
    if (!isTextControl(this)) return;
    const length = String(this.value ?? '').length;
    const a = Math.min(length, Math.max(0, Number(start) || 0));
    const b = Math.min(length, Math.max(0, Number(end) || 0));
    this._selStart = Math.min(a, b);
    this._selEnd = Math.max(a, b);
    this._selAnchor = direction === 'backward' ? this._selEnd : this._selStart;
    this._markDirty();
  }

  select() {
    if (!isTextControl(this)) return;
    this.setSelectionRange(0, String(this.value ?? '').length);
    this._selAnchor = 0;
  }

  get selectionDirection() {
    return this._selAnchor === this._selEnd && this._selStart !== this._selEnd ? 'backward' : 'forward';
  }

  /* --- dogrulama ------------------------------------------------------- */

  get validity() {
    const state = getValidationState(this);
    return {
      valueMissing: state.valueMissing,
      typeMismatch: state.typeMismatch,
      patternMismatch: state.patternMismatch,
      tooShort: state.tooShort,
      tooLong: state.tooLong,
      rangeUnderflow: state.rangeUnderflow,
      rangeOverflow: state.rangeOverflow,
      stepMismatch: state.stepMismatch,
      badInput: state.badInput,
      customError: state.customError,
      valid: state.valid,
    };
  }

  get validationMessage() { return getValidationState(this).message; }

  setCustomValidity(message) {
    this._customValidity = String(message ?? '');
    this._markDirty();
  }

  checkValidity() {
    if (this.localName === 'form') return this._checkFormValidity();
    const state = getValidationState(this);
    if (!state.valid) {
      this.dispatchEvent(new Event('invalid', { bubbles: false, cancelable: true }));
    }
    return state.valid;
  }

  reportValidity() {
    if (this.localName === 'form') {
      const invalid = this._firstInvalidControl();
      if (!invalid) return true;
      invalid.reportValidity();
      return false;
    }
    if (this.checkValidity()) return true;
    const engine = this.ownerDocument?.defaultView?.Narvis?.engine;
    engine?.showValidation?.(this, getValidationState(this).message);
    return false;
  }

  _controlList() {
    return this.querySelectorAll('input, textarea, select').filter((el) => !el.hasAttribute('disabled'));
  }

  _firstInvalidControl() {
    for (const control of this._controlList()) {
      if (!getValidationState(control).valid) return control;
    }
    return null;
  }

  _checkFormValidity() {
    let valid = true;
    for (const control of this._controlList()) {
      if (!control.checkValidity()) valid = false;
    }
    return valid;
  }

  submit() {
    const engine = this.ownerDocument?.defaultView?.Narvis?.engine;
    engine?.submitForm?.(this, null, { direct: true });
  }

  requestSubmit(submitter = null) {
    const engine = this.ownerDocument?.defaultView?.Narvis?.engine;
    engine?.submitForm?.(this, submitter, { direct: false });
  }

  reset() {
    const engine = this.ownerDocument?.defaultView?.Narvis?.engine;
    engine?.resetForm?.(this);
  }

  getAttribute(name) {
    return this._attrs.has(String(name).toLowerCase()) ? this._attrs.get(String(name).toLowerCase()) : null;
  }

  getAttributeNames() { return [...this._attrs.keys()]; }

  hasAttribute(name) { return this._attrs.has(String(name).toLowerCase()); }
  hasAttributes() { return this._attrs.size > 0; }

  setAttribute(name, value) {
    name = String(name).toLowerCase();
    value = String(value ?? '');
    if (name === 'style') {
      this._attrs.set('style', value);
      this._decl._load(value);
      this._markDirty();
      return;
    }
    this._attrs.set(name, value);
    this._markDirty();
  }

  removeAttribute(name) {
    name = String(name).toLowerCase();
    if (name === 'style') this._decl._load('');
    this._attrs.delete(name);
    this._markDirty();
  }

  toggleAttribute(name, force) {
    const has = this.hasAttribute(name);
    const next = force === undefined ? !has : !!force;
    if (next) this.setAttribute(name, '');
    else this.removeAttribute(name);
    return next;
  }

  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] ?? null; }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.children;
    return list[list.indexOf(this) + 1] ?? null;
  }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.children;
    return list[list.indexOf(this) - 1] ?? null;
  }

  append(...nodes) {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new Text(n) : n);
  }
  prepend(...nodes) {
    const first = this.firstChild;
    for (const n of nodes) {
      const node = typeof n === 'string' ? new Text(n) : n;
      this.insertBefore(node, first);
    }
  }
  before(...nodes) {
    if (!this.parentNode) return;
    for (const n of nodes) this.parentNode.insertBefore(typeof n === 'string' ? new Text(n) : n, this);
  }
  after(...nodes) {
    if (!this.parentNode) return;
    const ref = this.nextSibling;
    for (const n of nodes) this.parentNode.insertBefore(typeof n === 'string' ? new Text(n) : n, ref);
  }
  replaceWith(...nodes) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const ref = this.nextSibling;
    const frag = nodes.map((n) => (typeof n === 'string' ? new Text(n) : n));
    parent.removeChild(this);
    for (const n of frag) parent.insertBefore(n, ref);
  }
  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this._markDirty();
    this.append(...nodes);
  }

  querySelectorAll(selector) {
    const parsed = cachedSelector(String(selector));
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (parsed.some((sel) => matchesSelector(child, sel))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    const parsed = cachedSelector(String(selector));
    const walk = (el) => {
      for (const child of el.children) {
        if (parsed.some((sel) => matchesSelector(child, sel))) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }

  getElementsByTagName(tag) {
    const name = String(tag).toLowerCase();
    return this.querySelectorAll(name === '*' ? '*' : name);
  }

  getElementsByClassName(cls) {
    return this.querySelectorAll(String(cls).split(/\s+/).filter(Boolean).map((c) => '.' + c).join(''));
  }

  matches(selector) {
    return cachedSelector(String(selector)).some((sel) => matchesSelector(this, sel));
  }

  closest(selector) {
    const parsed = cachedSelector(String(selector));
    for (let el = this; el && el.nodeType === 1; el = el.parentElement) {
      if (parsed.some((sel) => matchesSelector(el, sel))) return el;
    }
    return null;
  }

  get innerHTML() {
    return this.childNodes.map(serializeNode).join('');
  }

  set innerHTML(html) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    parseFragment(this, String(html ?? ''));
    this._markDirty();
  }

  get outerHTML() { return serializeNode(this); }
  set outerHTML(html) {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const temp = new Element('div');
    parseFragment(temp, String(html ?? ''));
    const ref = this.nextSibling;
    parent.removeChild(this);
    for (const child of [...temp.childNodes]) parent.insertBefore(child, ref);
  }

  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }

  get textContent() {
    let out = '';
    for (const child of this.childNodes) {
      if (child.nodeType === 1 && child.localName === 'script') continue;
      out += child.textContent;
    }
    return out;
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value != null && String(value) !== '') {
      this.appendChild(new Text(String(value)));
    }
    this._markDirty();
  }

  getBoundingClientRect() {
    const box = this._box;
    if (!box) return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    const view = this.ownerDocument?.defaultView;
    const sx = view?.scrollX ?? 0;
    const sy = view?.scrollY ?? 0;
    const x = box.x - sx;
    const y = box.y - sy;
    return { x, y, width: box.width, height: box.height, top: y, left: x, right: x + box.width, bottom: y + box.height };
  }

  getClientRects() {
    if (this._fragments?.length) return this._fragments.map((f) => ({ x: f.x, y: f.y, width: f.width, height: f.height, top: f.y, left: f.x, right: f.x + f.width, bottom: f.y + f.height }));
    const r = this.getBoundingClientRect();
    return r.width || r.height ? [r] : [];
  }

  get offsetWidth() { return Math.round(this._box?.width ?? 0); }
  get offsetHeight() { return Math.round(this._box?.height ?? 0); }
  get clientWidth() { return Math.round(this._box?.contentWidth ?? 0); }
  get clientHeight() { return Math.round(this._box?.contentHeight ?? 0); }
  get scrollWidth() { return this.clientWidth; }
  get scrollHeight() { return this.clientHeight; }
  scrollTop = 0;
  scrollLeft = 0;

  scrollIntoView(options = true) {
    const view = this.ownerDocument?.defaultView;
    if (!view) return;
    const rect = this.getBoundingClientRect();
    const block = options === true ? 'start' : options?.block ?? 'start';
    let next = view.scrollY;
    if (block === 'start') next += rect.top;
    else if (block === 'end') next += rect.bottom - view.innerHeight;
    else if (block === 'center') next += rect.top + rect.height / 2 - view.innerHeight / 2;
    view.scrollTo({ top: next });
  }

  _ensureCaret() {
    if (!isTextControl(this)) return;
    const length = String(this.value ?? '').length;
    if (!Number.isInteger(this._selStart)) this._selStart = length;
    if (!Number.isInteger(this._selEnd)) this._selEnd = this._selStart;
    if (this._selStart > length) this._selStart = length;
    if (this._selEnd > length) this._selEnd = length;
    if (!Number.isInteger(this._selAnchor)) this._selAnchor = this._selStart;
  }

  focus() {
    const doc = this.ownerDocument;
    if (!doc || this.hasAttribute('disabled')) return;
    if (doc.activeElement === this) return;
    const previous = doc.activeElement;
    if (previous && previous !== this && previous !== doc.body) previous.blur();
    doc.activeElement = this;
    this._ensureCaret();
    this._valueAtFocus = this.value;
    /* select[multiple]: liste odagi seciliya ya da ilk etkin satira kurulur. */
    if (this.multiple && !Number.isInteger(this._multiFocus)) {
      const selected = this.selectedOptions;
      const options = this.options;
      this._multiFocus = selected.length
        ? options.indexOf(selected[0])
        : options.findIndex((option) => !option.disabled);
    }
    this._markDirty();
    this.dispatchEvent(new Event('focus'));
  }

  blur() {
    const doc = this.ownerDocument;
    if (!doc) return;
    if (doc.activeElement === this) {
      const tracked = isTextControl(this) || this.localName === 'select';
      if (tracked && this._valueAtFocus != null && this._valueAtFocus !== this.value) {
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }
      doc.activeElement = doc.body;
    }
    this._valueAtFocus = null;
    this._markDirty();
    this.dispatchEvent(new Event('blur'));
  }

  click() {
    this.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
  }
}

export class Document extends Node {
  constructor(url = 'about:blank') {
    super();
    this.url = url;
    this.documentElement = null;
    this.head = null;
    this.body = null;
    this.activeElement = null;
    this.defaultView = null;
    this.readyState = 'loading';
    this.title = '';
    this._onMutation = null;
    this._onError = null;
  }

  get nodeType() { return 9; }
  get nodeName() { return '#document'; }
  get ownerDocument() { return this; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

  createElement(tag) {
    return new Element(tag);
  }
  createElementNS(_ns, tag) {
    return new Element(tag);
  }
  createTextNode(text) {
    return new Text(text);
  }
  createComment(text) {
    return new Comment(text);
  }

  getElementById(id) {
    let found = null;
    const walk = (el) => {
      if (found) return;
      if (el.id === id) { found = el; return; }
      for (const child of el.children) walk(child);
    };
    if (this.documentElement) walk(this.documentElement);
    return found;
  }

  querySelector(selector) {
    return this.documentElement?.querySelector(selector) ?? null;
  }
  querySelectorAll(selector) {
    return this.documentElement?.querySelectorAll(selector) ?? [];
  }
  getElementsByTagName(tag) {
    return this.documentElement?.getElementsByTagName(tag) ?? [];
  }
  getElementsByClassName(cls) {
    return this.documentElement?.getElementsByClassName(cls) ?? [];
  }

  get textContent() {
    return this.documentElement?.textContent ?? '';
  }
  set textContent(v) {
    if (!this.documentElement) return;
    this.documentElement.textContent = v;
  }
}

export { StyleDeclaration, serializeNode, VOID_TAGS };
