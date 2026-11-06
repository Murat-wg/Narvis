// Kaskad + hesaplanmis stil. Desteklenen ozellikler icin CSS'in "used value"
// yaklasimina yakin bir model: uzunluklar px veya yuzde olarak saklanir.

import { parseStylesheet, parseDeclarations, mediaMatches } from './css/parser.js';
import { parseColor, resolveLength, parseLength, parseGradient, parseShadow, cssColor, substituteVars } from './css/values.js';
import { compareSpecificity, matchesSelector } from './css/selectors.js';
import { UA_CSS } from './css/ua.js';
import { camel, clamp, splitTopLevel, splitWhitespace } from './util.js';

const UA_RULES = parseStylesheet(UA_CSS, { orderStart: 0 });
let authorOrderSeed = 10000;

const INHERITED = new Set([
  'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textAlign', 'whiteSpace', 'textTransform', 'listStyleType',
  'visibility', 'cursor', 'wordBreak', 'textIndent',
]);

export function initialStyle() {
  return {
    display: 'inline',
    position: 'static',
    top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
    zIndex: 'auto',
    width: 'auto', height: 'auto',
    minWidth: 0, minHeight: 0, maxWidth: 'none', maxHeight: 'none',
    boxSizing: 'content-box',
    marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0,
    borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none',
    borderTopColor: 'currentColor', borderRightColor: 'currentColor', borderBottomColor: 'currentColor', borderLeftColor: 'currentColor',
    borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderBottomLeftRadius: 0,
    color: [27, 31, 36, 1],
    backgroundColor: [0, 0, 0, 0],
    backgroundImage: null,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: 16,
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: 24,
    _lineHeightFactor: 1.5,
    letterSpacing: 0,
    textAlign: 'left',
    textDecorationLine: 'none',
    textDecorationColor: null,
    textTransform: 'none',
    whiteSpace: 'normal',
    verticalAlign: 'baseline',
    listStyleType: 'disc',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    alignSelf: 'auto',
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    rowGap: 0,
    columnGap: 0,
    gridTemplateColumns: null,
    gridTemplateRows: null,
    gridColumnStart: 'auto',
    gridColumnSpan: 1,
    gridRowStart: 'auto',
    gridRowSpan: 1,
    justifyItems: 'stretch',
    alignContent: 'start',
    float: 'none',
    clear: 'none',
    opacity: 1,
    overflowX: 'visible',
    overflowY: 'visible',
    borderCollapse: 'separate',
    borderSpacingX: 2,
    borderSpacingY: 2,
    beforeContent: null,
    afterContent: null,
    visibility: 'visible',
    boxShadow: [],
    objectFit: 'fill',
    cursor: 'auto',
  };
}

function lengthValue(value, ctx, { allowPercent = true, allowAuto = false } = {}) {
  if (value == null) return allowAuto ? 'auto' : 0;
  const len = parseLength(value);
  if (!len) return allowAuto ? 'auto' : 0;
  if (len.u === 'auto') return allowAuto ? 'auto' : 0;
  if (len.u === 'none' || len.u === 'normal') return len.u;
  if (len.u === '%') return allowPercent ? { pct: len.n } : 0;
  if (['content', 'max-content', 'min-content', 'fit-content'].includes(len.u)) return len.u;
  const px = resolveLength(len, {
    fontSize: ctx.fontSize,
    rootFontSize: ctx.rootFontSize,
    vw: ctx.vw,
    vh: ctx.vh,
  });
  return px == null ? 0 : px;
}

function resolveColorValue(value, current) {
  if (value == null) return current;
  const c = parseColor(value);
  if (!c) return current;
  if (c === 'currentColor') return current;
  return c;
}

function fontWeightValue(value, parentWeight) {
  if (value == null) return 400;
  const s = String(value).trim().toLowerCase();
  if (s === 'normal') return 400;
  if (s === 'bold') return 700;
  if (s === 'bolder') return Math.min(900, parentWeight + 300);
  if (s === 'lighter') return Math.max(100, parentWeight - 300);
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 400;
}

function computeRootFontSize(root, rules, viewport) {
  if (!root) return 16;
  const decls = cascadeFor(root, rules, viewport, null);
  const fs = decls.get('font-size');
  if (!fs) return 16;
  // var() iceren kok font boyutu: kok kapsaminda degiske cozumsuzse yedegini kullan
  const resolved = substituteVars(fs.value, () => undefined) ?? fs.value;
  if (/^inherit$/i.test(String(resolved).trim())) return 16;
  const px = resolveLength(resolved, { fontSize: 16, rootFontSize: 16, vw: viewport.width, vh: viewport.height, percentBasis: 16 });
  return px && px > 0 ? px : 16;
}

function cascadeFor(el, rules, viewport, inlineDecls) {
  const matched = [];
  for (const rule of rules) {
    if (rule.media && !mediaMatches(rule.media, viewport)) continue;
    const parts = rule.selector.parts ?? [];
    // Pseudo-element kurallari (::before/::after) elementin kendisiyle eslesmez;
    // icerikleri pseudoContentValue icinde ayristirilir.
    if (parts.length && parts[parts.length - 1].compound.pseudoElement) continue;
    if (!selectorMatches(el, rule.selector)) continue;
    for (const decl of rule.declarations) {
      matched.push({ ...decl, specificity: rule.selector.specificity, order: rule.order, inline: false });
    }
  }
  if (inlineDecls) {
    for (const decl of inlineDecls) {
      matched.push({ ...decl, specificity: [0, 0, 0], order: Number.MAX_SAFE_INTEGER, inline: true });
    }
  }
  matched.sort((a, b) => {
    if (a.important !== b.important) return a.important ? 1 : -1;
    if (a.inline !== b.inline) return a.inline ? 1 : -1;
    const sp = compareSpecificity(a.specificity, b.specificity);
    if (sp) return sp;
    return a.order - b.order;
  });
  const winners = new Map();
  for (const decl of matched) winners.set(decl.prop, decl);
  return winners;
}

function selectorMatches(el, selector) {
  return matchesSelector(el, selector);
}

/* Pseudo-element (::before / ::after) icerigi: yalnizca content bildirimi
   okunur; coklu bildirimleri kaskad (important > spesifite > siralanır)
   kuralıyla cözer. */
function pseudoContentValue(el, rules, viewport, which) {
  const decls = [];
  for (const rule of rules) {
    if (rule.media && !mediaMatches(rule.media, viewport)) continue;
    const sel = rule.selector;
    const pe = sel && sel.parts?.length ? sel.parts[sel.parts.length - 1].compound.pseudoElement : null;
    if (!pe || pe !== which) continue;
    if (!selectorMatches(el, sel)) continue;
    for (const decl of rule.declarations) {
      if (decl.prop !== 'content') continue;
      decls.push({
        value: decl.value,
        important: !!decl.important,
        specificity: sel.specificity,
        order: rule.order,
      });
    }
  }
  if (!decls.length) return null;
  decls.sort((a, b) => {
    if (a.important !== b.important) return a.important ? 1 : -1;
    const sp = compareSpecificity(a.specificity, b.specificity);
    if (sp) return sp;
    return a.order - b.order;
  });
  const raw = String(decls[decls.length - 1].value ?? '').trim();
  const low = raw.toLowerCase();
  if (!low || low === 'none' || low === 'normal') return null;
  // counter()/attr()/open-quote/url() desteklenmez -> ic bostur (dost limit)
  if (/^(open-|close-|no-)/.test(low) || /^(counter|attr|url)\s*\(/i.test(low)) return null;
  return raw;
}

/* content degerini cümleye cevirir: 'ali' / "ali" kesitleri tırnağını
   siler, kaçışları cözer; tırnaksız tanımlayıcılar aynen sönümlenir. */
function unquoteContent(value) {
  const m = value.match(/^(['"])([\s\S]*)\1$/);
  if (!m) return value;
  return m[2].replace(/\\(['"\\])/g, '$1');
}

export function computeStyles(document, options = {}) {
  const viewport = {
    width: options.width ?? 800,
    height: options.height ?? 600,
    dark: !!options.dark,
  };

  const authorCSS = [];
  /* Sayfa sirasi onemli: harici stil sayfasi (link._cssText) bulundugu
     yerde kaskada girer. */
  for (const el of document.querySelectorAll('style, link')) {
    if (el.localName === 'style') authorCSS.push(el.textContent);
    else if (el._cssText != null
      && (el.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet')) {
      authorCSS.push(el._cssText);
    }
  }
  for (const extra of options.extraStyles ?? []) authorCSS.push(extra);
  const rules = [...UA_RULES];
  if (authorCSS.length) {
    rules.push(...parseStylesheet(authorCSS.join('\n'), { orderStart: authorOrderSeed }));
    authorOrderSeed += 100000;
  }

  const root = document.documentElement;
  const rootFontSize = computeRootFontSize(root, rules, viewport);
  const styles = new WeakMap();
  const walk = (el, parentStyle) => {
    const inlineDecls = el.hasAttribute('style') ? parseDeclarations(el.getAttribute('style')) : null;
    const winners = cascadeFor(el, rules, viewport, inlineDecls);
    const style = computeElementStyle(el, winners, parentStyle, viewport, rootFontSize);
    /* Pseudo-element icerikleri (::before / ::after): content bildirimi,
       element'in kendi var() cozumunden yararlanir. */
    for (const which of ['before', 'after']) {
      const raw = pseudoContentValue(el, rules, viewport, which);
      if (raw == null) { style[which + 'Content'] = null; continue; }
      const resolved = /var\s*\(/i.test(raw) ? substituteVars(raw, style._vars) : raw;
      style[which + 'Content'] = resolved == null ? null : unquoteContent(resolved);
    }
    styles.set(el, style);
    el._style = style;
    for (const child of el.children) walk(child, style);
  };
  if (root) walk(root, null);
  return styles;
}

const WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const EMPTY_VARS = {};

function cloneStyleValue(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function applyWideKeywords(winners, style, parent) {
  const initial = initialStyle();
  for (const [prop, decl] of winners) {
    if (prop.startsWith('--')) continue;
    const keyword = String(decl.value ?? '').trim().toLowerCase();
    if (!WIDE_KEYWORDS.has(keyword)) continue;
    const key = camel(prop);
    const inherits = keyword === 'inherit' || (keyword === 'unset' && INHERITED.has(key));
    const source = inherits ? (parent ?? initial) : initial;
    if (source && key in source) style[key] = cloneStyleValue(source[key]);
    if (key === 'fontSize') {
      style.fontSize = source?.fontSize ?? style.fontSize;
      const factor = source?._lineHeightFactor;
      if (factor != null) {
        style._lineHeightFactor = factor;
        style.lineHeight = style.fontSize * factor;
      } else if (source?.lineHeight != null) {
        style._lineHeightFactor = null;
        style.lineHeight = source.lineHeight;
      }
    }
  }
}

const OVERFLOW_KEYWORDS = new Set(['visible', 'hidden', 'clip', 'scroll', 'auto']);

function overflowKeyword(value) {
  const keyword = String(value ?? '').trim().toLowerCase();
  return OVERFLOW_KEYWORDS.has(keyword) ? keyword : null;
}

function computeElementStyle(el, winners, parent, viewport, rootFontSize) {
  const style = initialStyle();
  const get = (name) => winners.get(name)?.value;

  /* --- Custom property'ler (CSS degiskenleri) ------------------------ */
  // 1) Devralinan degiskenler (kendi bildirimi yoksa ust deger gecerli)
  // 2) Kendi kazanan -- bildirimleri uzerine yazilir; wide keywords de ok
  // 3) var() ikameleri dongo (döngü) korumali olarak cozulur
  const ownVars = new Map();
  for (const [name, decl] of winners) {
    if (!name.startsWith('--')) continue;
    const keyword = String(decl.value ?? '').trim().toLowerCase();
    if (keyword === 'initial') ownVars.set(name, null);
    else if (keyword === 'inherit' || keyword === 'unset') {
      ownVars.set(name, parent?._vars ? (parent._vars[name] ?? null) : null);
    } else ownVars.set(name, decl.value);
  }
  const inheritedVars = parent?._vars ?? EMPTY_VARS;
  const resolveVarName = (name, stack) => {
    if (stack.has(name)) return null; // döngü → gecersiz
    stack.add(name);
    if (ownVars.has(name)) {
      const raw = ownVars.get(name);
      if (raw == null) return null; // initial / gecersiz deger
      return substituteVars(raw, (n) => resolveVarName(n, stack));
    }
    const inh = inheritedVars[name];
    if (inh == null) return null;
    return substituteVars(inh, (n) => resolveVarName(n, stack));
  };
  const seenNames = new Set([...ownVars.keys(), ...Object.keys(inheritedVars)]);
  const varMap = {};
  for (const name of seenNames) {
    const resolved = resolveVarName(name, new Set());
    if (resolved != null) varMap[name] = resolved;
  }
  style._vars = varMap;

  // Duz bildirimlerdeki var() ikameleri: cozulemeyen referansta bildirim
  // "hesaplanmis degerde gecersiz" olur ve dusurulur (inherit/initial etki).
  for (const [name, decl] of [...winners]) {
    if (name.startsWith('--') || !/var\s*\(\s*--/i.test(String(decl.value))) continue;
    const resolved = substituteVars(decl.value, varMap);
    if (resolved == null) winners.delete(name);
    else decl.value = resolved;
  }

  // Devralinan ozellikler
  if (parent) {
    for (const key of INHERITED) {
      style[key] = parent[key];
    }
    style.lineHeight = parent.lineHeight;
    style._lineHeightFactor = parent._lineHeightFactor ?? null;
    style.fontSize = parent.fontSize;
    style.color = [...parent.color];
    style.backgroundImage = null;
  }

  // 1. Font boyutu (em/rem/% burada cozulur)
  const fsDecl = get('font-size');
  if (fsDecl) {
    const parentSize = parent?.fontSize ?? 16;
    const px = resolveLength(fsDecl, { fontSize: parentSize, rootFontSize, vw: viewport.width, vh: viewport.height, percentBasis: parentSize });
    if (px && px > 0) style.fontSize = clamp(px, 1, 800);
    else if (String(fsDecl).toLowerCase() === 'inherit' && parent) style.fontSize = parent.fontSize;
  }

  const ctx = { fontSize: style.fontSize, rootFontSize, vw: viewport.width, vh: viewport.height };

  if (get('font-family')) style.fontFamily = get('font-family');
  if (get('font-weight')) style.fontWeight = fontWeightValue(get('font-weight'), parent?.fontWeight ?? 400);
  if (get('font-style')) style.fontStyle = get('font-style');
  if (get('line-height')) {
    const lh = get('line-height');
    const s = String(lh).trim();
    if (s === 'normal') {
      style._lineHeightFactor = 1.5;
      style.lineHeight = Math.round(style.fontSize * 1.5);
    } else if (/^[\d.]+$/.test(s)) {
      const factor = parseFloat(s);
      style._lineHeightFactor = factor;
      style.lineHeight = style.fontSize * factor;
    } else {
      const px = resolveLength(s, { ...ctx, percentBasis: style.fontSize });
      style._lineHeightFactor = null;
      style.lineHeight = px ?? Math.round(style.fontSize * 1.5);
    }
  } else if (parent?._lineHeightFactor != null) {
    style.lineHeight = style.fontSize * parent._lineHeightFactor;
  } else if (!parent) {
    style._lineHeightFactor = 1.5;
    style.lineHeight = Math.round(style.fontSize * 1.5);
  }
  if (get('letter-spacing')) style.letterSpacing = lengthValue(get('letter-spacing'), ctx) || 0;

  // 2. Renk
  if (get('color')) style.color = resolveColorValue(get('color'), style.color);
  if (get('background-color')) style.backgroundColor = resolveColorValue(get('background-color'), [0, 0, 0, 0]);
  if (get('background-image')) {
    const v = get('background-image');
    style.backgroundImage = v === 'none' ? null : parseGradient(v);
  }

  // 3. Gorunum / akis
  if (get('display')) style.display = get('display');
  if (get('position')) style.position = get('position');
  if (get('box-sizing')) style.boxSizing = get('box-sizing');

  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const inset = get(side.toLowerCase());
    if (inset != null) style[side.toLowerCase()] = lengthValue(inset, ctx, { allowPercent: true, allowAuto: true });
    const m = get('margin-' + side.toLowerCase());
    if (m != null) style['margin' + side] = lengthValue(m, ctx, { allowPercent: true, allowAuto: true });
    const p = get('padding-' + side.toLowerCase());
    if (p != null) style['padding' + side] = Math.max(0, lengthValue(p, ctx, { allowPercent: true }));

    const bw = get('border-' + side.toLowerCase() + '-width');
    const bs = get('border-' + side.toLowerCase() + '-style');
    if (bs) style['border' + side + 'Style'] = bs;
    if (bw) style['border' + side + 'Width'] = Math.max(0, lengthValue(bw, ctx));
    if (bs && (bs === 'none' || bs === 'hidden')) style['border' + side + 'Width'] = 0;
    const bc = get('border-' + side.toLowerCase() + '-color');
    if (bc) style['border' + side + 'Color'] = resolveColorValue(bc, style.color);
  }

  const CORNER_KEYS = { TopLeft: 'top-left', TopRight: 'top-right', BottomRight: 'bottom-right', BottomLeft: 'bottom-left' };
  for (const [corner, cssName] of Object.entries(CORNER_KEYS)) {
    const v = get(`border-${cssName}-radius`);
    if (v != null) style['border' + corner + 'Radius'] = radiusValue(v, ctx);
  }

  if (get('width')) style.width = lengthValue(get('width'), ctx, { allowAuto: true });
  if (get('height')) style.height = lengthValue(get('height'), ctx, { allowAuto: true });
  if (get('min-width')) style.minWidth = lengthValue(get('min-width'), ctx, { allowPercent: true });
  if (get('min-height')) style.minHeight = lengthValue(get('min-height'), ctx, { allowPercent: true });
  if (get('max-width')) style.maxWidth = lengthValue(get('max-width'), ctx, { allowPercent: true, allowAuto: true });
  if (get('max-height')) style.maxHeight = lengthValue(get('max-height'), ctx, { allowPercent: true, allowAuto: true });

  // 4. Metin
  if (get('text-align')) {
    const ta = get('text-align');
    style.textAlign = ta === 'start' ? 'left' : ta === 'end' ? 'right' : ta;
  }
  if (get('text-decoration-line')) style.textDecorationLine = get('text-decoration-line');
  if (get('text-decoration-color')) style.textDecorationColor = resolveColorValue(get('text-decoration-color'), style.color);
  if (get('text-transform')) style.textTransform = get('text-transform');
  if (get('white-space')) style.whiteSpace = get('white-space');
  if (get('vertical-align')) style.verticalAlign = get('vertical-align');
  if (get('list-style-type')) style.listStyleType = get('list-style-type');
  if (get('word-break')) style.wordBreak = get('word-break');
  if (get('text-indent')) style.textIndent = lengthValue(get('text-indent'), ctx) || 0;

  // 5. Flex
  if (get('flex-direction')) style.flexDirection = get('flex-direction');
  if (get('flex-wrap')) style.flexWrap = get('flex-wrap');
  if (get('justify-content')) style.justifyContent = normalizeJustify(get('justify-content'));
  if (get('align-items')) style.alignItems = normalizeAlign(get('align-items'));
  if (get('align-self')) style.alignSelf = normalizeAlign(get('align-self'));
  if (get('flex-grow')) style.flexGrow = parseFloat(get('flex-grow')) || 0;
  if (get('flex-shrink')) style.flexShrink = parseFloat(get('flex-shrink'));
  if (Number.isNaN(style.flexShrink)) style.flexShrink = 1;
  if (get('flex-basis')) {
    const fb = get('flex-basis');
    style.flexBasis = String(fb).toLowerCase() === 'auto' ? 'auto'
      : String(fb).toLowerCase() === 'content' ? 'content'
      : lengthValue(fb, ctx, { allowPercent: true, allowAuto: true });
  }

  // 5b. Grid
  if (get('grid-template-columns')) style.gridTemplateColumns = parseGridTracks(get('grid-template-columns'), ctx);
  if (get('grid-template-rows')) style.gridTemplateRows = parseGridTracks(get('grid-template-rows'), ctx);
  if (get('grid-column')) {
    const p = parseGridPlacement(get('grid-column'));
    style.gridColumnStart = p.start;
    style.gridColumnSpan = p.span;
  }
  if (get('grid-row')) {
    const p = parseGridPlacement(get('grid-row'));
    style.gridRowStart = p.start;
    style.gridRowSpan = p.span;
  }
  if (get('justify-items')) {
    const v = String(get('justify-items')).trim().toLowerCase();
    style.justifyItems = v === 'start' || v === 'flex-start' || v === 'normal' ? 'start'
      : v === 'end' || v === 'flex-end' ? 'end'
      : v === 'center' ? 'center' : 'stretch';
  }
  if (get('align-content')) {
    const ac = String(get('align-content')).trim().toLowerCase();
    style.alignContent = ac === 'center' ? 'center'
      : ac === 'end' || ac === 'flex-end' ? 'end'
      : ac === 'space-between' ? 'space-between'
      : ac === 'space-around' ? 'space-around'
      : ac === 'space-evenly' ? 'space-evenly'
      : 'start';
  }

  // 5c. Float / clear
  if (get('float')) {
    const f = String(get('float')).trim().toLowerCase();
    style.float = f === 'left' || f === 'right' ? f : 'none';
  }
  if (get('clear')) {
    const c = String(get('clear')).trim().toLowerCase();
    style.clear = c === 'left' || c === 'right' || c === 'both' ? c : 'none';
  }

  // 5d. Tablo
  if (get('border-collapse')) {
    style.borderCollapse = String(get('border-collapse')).trim().toLowerCase() === 'collapse' ? 'collapse' : 'separate';
  }
  if (get('border-spacing')) {
    const parts = String(get('border-spacing')).trim().split(/\s+/);
    const a = lengthValue(parts[0], ctx);
    const b = parts.length > 1 ? lengthValue(parts[1], ctx) : a;
    style.borderSpacingX = Math.max(0, typeof a === 'number' && Number.isFinite(a) ? a : 0);
    style.borderSpacingY = Math.max(0, typeof b === 'number' && Number.isFinite(b) ? b : 0);
  }

  // 6. Diger
  if (get('row-gap')) style.rowGap = Math.max(0, lengthValue(get('row-gap'), ctx) || 0);  if (get('column-gap')) style.columnGap = Math.max(0, lengthValue(get('column-gap'), ctx) || 0);
  if (get('opacity')) style.opacity = clamp(parseFloat(get('opacity')), 0, 1);
  const overflowX = overflowKeyword(get('overflow-x'));
  if (overflowX) style.overflowX = overflowX;
  const overflowY = overflowKeyword(get('overflow-y'));
  if (overflowY) style.overflowY = overflowY;
  if (get('visibility')) style.visibility = get('visibility');
  if (get('box-shadow')) style.boxShadow = parseShadow(get('box-shadow'));
  if (get('object-fit')) style.objectFit = get('object-fit');
  if (get('cursor')) style.cursor = get('cursor');
  if (get('z-index')) {
    const z = get('z-index');
    style.zIndex = z === 'auto' ? 'auto' : parseInt(z, 10);
  }

  // CSS genis anahtar sozcukleri (inherit / initial / unset): kaskad
  // kazananini dogrudan hesaplanmis degere cevir.
  applyWideKeywords(winners, style, parent);

  // border rengi currentColor ise nihai renge cevir
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    if (style['border' + side + 'Color'] === 'currentColor') style['border' + side + 'Color'] = style.color;
  }
  if (style.textDecorationColor === 'currentColor' || !style.textDecorationColor) style.textDecorationColor = style.color;
  style.backgroundColor = style.backgroundColor === 'currentColor' ? style.color : style.backgroundColor;

  return style;
}

function radiusValue(value, ctx) {
  const len = parseLength(value);
  if (!len) return 0;
  if (len.u === '%') return { pct: len.n };
  return resolveLength(len, ctx) ?? 0;
}

function normalizeAlign(value) {
  if (!value) return 'stretch';
  if (value === 'normal' || value === 'stretch') return 'stretch';
  if (value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  return value;
}

function normalizeJustify(value) {
  if (!value) return 'flex-start';
  if (value === 'normal' || value === 'start') return 'flex-start';
  if (value === 'end') return 'flex-end';
  if (value === 'left') return 'flex-start';
  if (value === 'right') return 'flex-end';
  return value;
}

/* Grid iz (track) listesi: repeat() genisletilir, px/em/rem/vw/vh px'e,
   pct yuzdeye, fr fr'ye, auto/min-content/max-content 'auto'ya dockurulur. */
function parseGridTracks(raw, ctx) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'none') return null;
  const out = [];
  const clampCount = (v) => Math.min(64, Math.max(1, parseInt(v, 10) || 1));
  const push = (token) => {
    if (!token) return;
    const rep = token.match(/^repeat\s*\(\s*(\d+)\s*,\s*(.+)\s*\)$/s);
    if (rep) {
      const count = clampCount(rep[1]);
      for (const inner of splitWhitespace(rep[2])) {
        for (let i = 0; i < count; i++) push(inner);
      }
      return;
    }
    if (token === 'auto' || token === 'min-content' || token === 'max-content' ||
        token === 'fit-content' || token.startsWith('minmax(') || token === 'none') {
      out.push('auto');
      return;
    }
    const m = token.match(/^([\d.]+(?:e[+-]?\d+)?)fr$/);
    if (m) { out.push({ fr: Math.max(0, parseFloat(m[1])) }); return; }
    if (token.endsWith('[') ) return;
    const len = parseLength(token);
    if (len) {
      if (len.u === '%') { out.push({ pct: len.n }); return; }
      if (len.u === 'auto') { out.push('auto'); return; }
      const px = resolveLength(len, {
        fontSize: ctx.fontSize, rootFontSize: ctx.rootFontSize, vw: ctx.vw, vh: ctx.vh,
      });
      out.push(px == null ? 'auto' : { n: px });
      return;
    }
    out.push('auto');
  };
  for (const token of splitWhitespace(s)) push(token);
  return out.length ? out : null;
}

/* Yerlesim bildirimi: auto | span N | N | N / span M | N / M | span N / span M */
function parseGridPlacement(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || s === 'auto' || s === 'none') return { start: 'auto', span: 1 };
  const parts = splitTopLevel(s, '/').map((p) => p.trim()).filter(Boolean);
  const clampInt = (v) => Math.min(64, Math.max(1, parseInt(v, 10) || 1));
  const parseLine = (t) => {
    const m = t.match(/^span\s+(\d+)$/);
    if (m) return { spanOnly: true, span: clampInt(m[1]) };
    return { line: /^\d+$/.test(t) ? clampInt(t) : null };
  };
  const first = parts[0] ? parseLine(parts[0]) : { line: null };
  if (first.spanOnly) return { start: 'auto', span: first.span };
  if (first.line) {
    let span = 1;
    if (parts[1]) {
      const second = parseLine(parts[1]);
      if (second.line) span = Math.max(1, second.line - first.line);
      else if (second.spanOnly) span = second.span;
    }
    return { start: first.line, span };
  }
  return { start: 'auto', span: 1 };
}

export function styleToCSS(style) {
  const out = [];
  for (const [key, value] of Object.entries(style)) {
    if (key.startsWith('_')) continue;
    let v = value;
    if (Array.isArray(v)) {
      if (v.length === 4 && typeof v[0] === 'number' && typeof v[3] === 'number') v = cssColor(v);
      else v = v.map((x) => (typeof x === 'object' ? `${x.pct}%` : x)).join(' ');
    } else if (v && typeof v === 'object') {
      if ('pct' in v) v = `${v.pct}%`;
      else if ('angle' in v) v = 'linear-gradient(...)';
      else v = JSON.stringify(v);
    }
    out.push([key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v]);
  }
  return out;
}
