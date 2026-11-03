// Deger ayristirma: uzunluklar, renkler, gradyanlar, golgeler ve CSS kisaltmalari.

import { splitTopLevel, splitWhitespace, clamp } from '../util.js';

const NAMED_COLORS = {
  transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [255, 255, 255, 1],
  red: [255, 0, 0, 1], green: [0, 128, 0, 1], lime: [0, 255, 0, 1],
  blue: [0, 0, 255, 1], yellow: [255, 255, 0, 1], orange: [255, 165, 0, 1],
  purple: [128, 0, 128, 1], gray: [128, 128, 128, 1], grey: [128, 128, 128, 1],
  silver: [192, 192, 192, 1], maroon: [128, 0, 0, 1], olive: [128, 128, 0, 1],
  aqua: [0, 255, 255, 1], teal: [0, 128, 128, 1], navy: [0, 0, 128, 1],
  fuchsia: [255, 0, 255, 1], magenta: [255, 0, 255, 1], cyan: [0, 255, 255, 1],
  pink: [255, 192, 203, 1], brown: [165, 42, 42, 1], gold: [255, 215, 0, 1],
  coral: [255, 127, 80, 1], salmon: [250, 128, 114, 1], tomato: [255, 99, 71, 1],
  crimson: [220, 20, 60, 1], indigo: [75, 0, 130, 1], violet: [238, 130, 238, 1],
  plum: [221, 160, 221, 1], beige: [245, 245, 220, 1], ivory: [255, 255, 240, 1],
  khaki: [240, 230, 140, 1], lavender: [230, 230, 250, 1], turquoise: [64, 224, 208, 1],
  skyblue: [135, 206, 235, 1], steelblue: [70, 130, 180, 1], slategray: [112, 128, 144, 1],
  whitesmoke: [245, 245, 245, 1], gainsboro: [220, 220, 220, 1], lightgray: [211, 211, 211, 1],
  lightgrey: [211, 211, 211, 1], darkgray: [169, 169, 169, 1], darkgrey: [169, 169, 169, 1],
  dimgray: [105, 105, 105, 1], midnightblue: [25, 25, 112, 1], royalblue: [65, 105, 225, 1],
  dodgerblue: [30, 144, 255, 1], seagreen: [46, 139, 87, 1], forestgreen: [34, 139, 34, 1],
  limegreen: [50, 205, 50, 1], darkgreen: [0, 100, 0, 1], chocolate: [210, 105, 30, 1],
  peru: [205, 133, 63, 1], tan: [210, 180, 140, 1], wheat: [245, 222, 179, 1],
  azure: [240, 255, 255, 1], aliceblue: [240, 248, 255, 1], ghostwhite: [248, 248, 255, 1],
  linen: [250, 240, 230, 1], snow: [255, 250, 250, 1], mintcream: [245, 255, 250, 1],
  honeydew: [240, 255, 240, 1], oldlace: [253, 245, 230, 1], floralwhite: [255, 250, 240, 1],
  seashell: [255, 245, 238, 1], cornsilk: [255, 248, 220, 1], lemonchiffon: [255, 250, 205, 1],
  papayawhip: [255, 239, 213, 1], mistyrose: [255, 228, 225, 1], antiquewhite: [250, 235, 215, 1],
  rebeccapurple: [102, 51, 153, 1], currentcolor: 'currentColor',
};

const LENGTH_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|em|rem|ex|ch|vw|vh|vmin|vmax|%|pt|pc|in|cm|mm|q)$/i;

export function parseLength(value) {
  if (value == null) return null;
  if (typeof value === 'number') return { n: value, u: 'px' };
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (s === 'auto' || s === 'none' || s === 'normal' || s === 'content' || s === 'max-content' || s === 'min-content' || s === 'fit-content') {
    return { n: 0, u: s };
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { n: parseFloat(s), u: 'px' };
  const m = s.match(LENGTH_RE);
  if (m) return { n: parseFloat(m[1]), u: m[2].toLowerCase() };
  return null;
}

export function resolveLength(value, ctx = {}) {
  if (value == null) return null;
  const len = typeof value === 'object' && 'u' in value ? value : parseLength(value);
  if (!len) return null;
  const u = len.u;
  const n = len.n;
  const fontSize = ctx.fontSize ?? 16;
  const rootFontSize = ctx.rootFontSize ?? 16;
  switch (u) {
    case 'px': return n;
    case 'pt': return n * 96 / 72;
    case 'pc': return n * 16;
    case 'in': return n * 96;
    case 'cm': return n * 96 / 2.54;
    case 'mm': return n * 96 / 25.4;
    case 'q': return n * 96 / 101.6;
    case 'em': return n * fontSize;
    case 'rem': return n * rootFontSize;
    case 'ex':
    case 'ch': return n * fontSize * 0.5;
    case '%': return ctx.percentBasis == null ? null : n * ctx.percentBasis / 100;
    case 'vw': return n * (ctx.vw ?? 0) / 100;
    case 'vh': return n * (ctx.vh ?? 0) / 100;
    case 'vmin': return n * Math.min(ctx.vw ?? 0, ctx.vh ?? 0) / 100;
    case 'vmax': return n * Math.max(ctx.vw ?? 0, ctx.vh ?? 0) / 100;
    default: return null;
  }
}

export function resolveAngle(value) {
  const s = String(value).trim().toLowerCase();
  if (s === 'to right') return 90;
  if (s === 'to left') return 270;
  if (s === 'to bottom') return 180;
  if (s === 'to top') return 0;
  if (s === 'to bottom right' || s === 'to right bottom') return 135;
  if (s === 'to bottom left' || s === 'to left bottom') return 225;
  if (s === 'to top right' || s === 'to right top') return 45;
  if (s === 'to top left' || s === 'to left top') return 315;
  const m = s.match(/^([+-]?[\d.]+)(deg|rad|grad|turn)$/);
  if (!m) return 180;
  const n = parseFloat(m[1]);
  if (m[2] === 'rad') return n * 180 / Math.PI;
  if (m[2] === 'grad') return n * 0.9;
  if (m[2] === 'turn') return n * 360;
  return n;
}

export function parseColor(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  if (s === 'currentcolor') return 'currentColor';
  if (NAMED_COLORS[s]) return [...NAMED_COLORS[s]];
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length === 6) hex += 'ff';
    if (hex.length !== 8 || !/^[0-9a-f]+$/.test(hex)) return null;
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16) / 255];
  }
  const fn = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!fn) return null;
  const parts = splitTopLevel(fn[2], ',').map((p) => p.trim());
  if (fn[1].startsWith('rgb')) {
    if (parts.length < 3) return null;
    const ch = (p) => p.endsWith('%') ? clamp(parseFloat(p) * 255 / 100, 0, 255) : clamp(parseFloat(p), 0, 255);
    const alpha = parts[3] === undefined ? 1 : clamp(parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]), 0, 1);
    return [ch(parts[0]), ch(parts[1]), ch(parts[2]), alpha];
  }
  if (parts.length < 3) return null;
  const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
  const sat = clamp(parseFloat(parts[1]) / 100, 0, 1);
  const light = clamp(parseFloat(parts[2]) / 100, 0, 1);
  const alpha = parts[3] === undefined ? 1 : clamp(parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]), 0, 1);
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((v) => Math.round((v + m) * 255)).concat(alpha);
}

export function cssColor(color) {  if (!color) return 'rgba(0,0,0,0)';
  if (color === 'currentColor') return 'currentColor';
  const [r, g, b, a = 1] = color;
  if (a >= 1) return `rgb(${r | 0},${g | 0},${b | 0})`;
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

function extractFunction(text, name) {
  const start = text.toLowerCase().indexOf(name + '(');  if (start === -1) return null;
  let depth = 0;
  let quote = null;
  for (let i = start + name.length; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// var(...) ikamesi: dengelemeli parantez taramasi, yuvalanmis var() ve
// yedek (fallback) destekli. Cozulemeyen referansta null doner — cagiran,
// bildirimi "hesaplanan degerde gecersiz" kabul edip dusurur.
export function substituteVars(value, vars) {
  const s = String(value ?? '').trim();
  if (!/var\s*\(\s*--/i.test(s)) return s;
  let out = '';
  let cursor = 0;
  while (cursor < s.length) {
    const m = s.slice(cursor).match(/var\(/i);
    if (!m) { out += s.slice(cursor); break; }
    const start = cursor + m.index;
    if (start > cursor && /[-\w]/.test(s[start - 1])) {
      // kelime icindeki yanlis eslesme (orn. notavar() -> var( degil): atla
      out += s.slice(cursor, start + 4);
      cursor = start + 4;
      continue;
    }
    let j = start + 4;
    let depth = 1;
    let quote = null;
    while (j < s.length && depth > 0) {
      const ch = s[j];
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      j++;
    }
    if (depth > 0) return null;
    const inner = s.slice(start + 4, j - 1);
    const parts = splitTopLevel(inner, ',');
    const name = (parts[0] ?? '').trim();
    let resolved;
    if (/^--[\w-]+$/.test(name) && Object.prototype.hasOwnProperty.call(vars, name)) {
      resolved = substituteVars(vars[name], vars);
    } else {
      const fallback = parts.slice(1).join(',').trim();
      resolved = fallback ? substituteVars(fallback, vars) : null;
    }
    if (resolved == null) return null;
    out += s.slice(cursor, start) + resolved;
    cursor = j;
  }
  return out;
}

export function parseGradient(value) {
  if (!value) return null;
  const s = String(value).trim();
  const lower = s.toLowerCase();
  if (!lower.startsWith('linear-gradient(') && !lower.startsWith('repeating-linear-gradient(')) return null;
  const fn = extractFunction(s, lower.startsWith('repeating') ? 'repeating-linear-gradient' : 'linear-gradient');
  if (!fn) return null;
  const inner = fn.slice(fn.indexOf('(') + 1, -1);
  const args = splitTopLevel(inner, ',').map((a) => a.trim()).filter(Boolean);
  if (!args.length) return null;
  let angle = 180;
  let index = 0;
  if (!parseColor(args[0])) {
    angle = resolveAngle(args[0]);
    index = 1;
  }
  const stops = [];
  for (; index < args.length; index++) {
    const tokens = splitWhitespace(args[index]);
    let color = null;
    let pos = null;
    for (const token of tokens) {
      const c = parseColor(token);
      if (c && c !== 'currentColor') color = c;
      else if (/^[+-]?[\d.]+%$/.test(token)) pos = parseFloat(token);
      else if (/^[+-]?[\d.]+(px|em|rem)$/.test(token)) pos = token;
    }
    if (color) stops.push({ color, position: pos });
  }
  if (stops.length < 2) return null;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].position == null) {
      if (i === 0) stops[i].position = 0;
      else if (i === stops.length - 1) stops[i].position = 100;
      else stops[i].position = (i / (stops.length - 1)) * 100;
    }
  }
  return { angle, stops };
}

export function parseShadow(value) {
  if (!value || value === 'none') return [];
  const out = [];
  for (const part of splitTopLevel(value, ',')) {
    const tokens = splitWhitespace(part);
    const lengths = [];
    let color = null;
    let inset = false;
    for (const token of tokens) {
      if (token === 'inset') { inset = true; continue; }
      const c = parseColor(token);
      if (c && c !== 'currentColor') { color = c; continue; }
      const len = parseLength(token);
      if (len && len.u !== 'auto') lengths.push(resolveLength(len, { fontSize: 16 }));
    }
    if (lengths.length >= 2) {
      out.push({ x: lengths[0], y: lengths[1], blur: lengths[2] ?? 0, spread: lengths[3] ?? 0, color: color ?? [0, 0, 0, 0.25], inset });
    }
  }
  return out;
}

function expand4(values) {
  const v = values.length ? values : ['0'];
  if (v.length === 1) return [v[0], v[0], v[0], v[0]];
  if (v.length === 2) return [v[0], v[1], v[0], v[1]];
  if (v.length === 3) return [v[0], v[1], v[2], v[1]];
  return [v[0], v[1], v[2], v[3]];
}

const BORDER_STYLES = new Set(['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset']);
const SIZE_KEYWORDS = { 'xx-small': '9px', 'x-small': '10px', small: '13px', medium: '16px', large: '18px', 'x-large': '24px', 'xx-large': '32px', 'xxx-large': '48px' };

function borderParts(value) {
  let width = null;
  let style = null;
  let color = null;
  for (const token of splitWhitespace(value)) {
    if (BORDER_STYLES.has(token)) style = token;
    else if (parseColor(token)) color = token;
    else if (parseLength(token)) width = token;
  }
  return { width, style, color };
}

function addBorderSide(out, side, parts) {
  if (parts.width) out.push([`border-${side}-width`, parts.width]);
  if (parts.style) out.push([`border-${side}-style`, parts.style]);
  if (parts.color) out.push([`border-${side}-color`, parts.color]);
}

function stripVendor(prop) {
  const map = {
    '-webkit-box-shadow': 'box-shadow', '-moz-box-shadow': 'box-shadow',
    '-webkit-border-radius': 'border-radius', '-moz-border-radius': 'border-radius',
    '-webkit-user-select': 'user-select',
  };
  return map[prop] ?? prop;
}

export function expandDeclaration(rawProp, rawValue) {
  let prop = stripVendor(String(rawProp).toLowerCase().trim());
  const value = String(rawValue).trim();
  if (!prop || !value) return [];
  if (prop.startsWith('--')) return [[prop, value]];

  if (prop === 'margin' || prop === 'padding') {
    const [t, r, b, l] = expand4(splitWhitespace(value));
    return [[`${prop}-top`, t], [`${prop}-right`, r], [`${prop}-bottom`, b], [`${prop}-left`, l]];
  }
  if (prop === 'inset') {
    const [t, r, b, l] = expand4(splitWhitespace(value));
    return [['top', t], ['right', r], ['bottom', b], ['left', l]];
  }
  if (prop === 'border-width' || prop === 'border-style' || prop === 'border-color') {
    const kind = prop.split('-')[1];
    const [t, r, b, l] = expand4(splitWhitespace(value));
    return [['top', t], ['right', r], ['bottom', b], ['left', l]].map(([side, v]) => [`border-${side}-${kind}`, v]);
  }
  if (prop === 'border') {
    const parts = borderParts(value);
    const out = [];
    for (const side of ['top', 'right', 'bottom', 'left']) addBorderSide(out, side, parts);
    return out;
  }
  if (/^border-(top|right|bottom|left)$/.test(prop)) {
    const side = prop.split('-')[1];
    const out = [];
    addBorderSide(out, side, borderParts(value));
    return out;
  }
  if (prop === 'border-radius') {
    const [horizontal] = splitTopLevel(value, '/');
    const [tl, tr, br, bl] = expand4(splitWhitespace(horizontal));
    return [['border-top-left-radius', tl], ['border-top-right-radius', tr], ['border-bottom-right-radius', br], ['border-bottom-left-radius', bl]];
  }
  if (prop === 'background') {
    const out = [];
    const gradient = extractFunction(value, 'linear-gradient') ?? extractFunction(value, 'repeating-linear-gradient');
    if (gradient) out.push(['background-image', gradient]);
    else out.push(['background-image', 'none']);
    let color = null;
    for (const token of splitWhitespace(value)) {
      const c = parseColor(token);
      if (c) { color = token; break; }
    }
    out.push(['background-color', color ?? 'transparent']);
    return out;
  }
  if (prop === 'background-image') return [['background-image', value]];
  if (prop === 'font') {
    const out = [];
    const tokens = splitWhitespace(value);
    let index = 0;
    for (; index < tokens.length; index++) {
      const t = tokens[index].toLowerCase();
      if (SIZE_KEYWORDS[t] || /^[\d.]+(px|em|rem|pt|%|vw|vh)(\/[\d.]+(px|em|rem|%)?)?$/i.test(t)) break;
    }
    if (index >= tokens.length) return [];
    for (let i = 0; i < index; i++) {
      const t = tokens[i].toLowerCase();
      if (t === 'italic' || t === 'oblique') out.push(['font-style', t]);
      else if (t === 'normal') continue;
      else if (/^(bold|bolder|lighter|[1-9]00)$/.test(t)) out.push(['font-weight', t]);
      else if (t === 'small-caps') out.push(['font-variant', t]);
    }
    const sizeToken = tokens[index];
    const [size, lineHeight] = sizeToken.split('/');
    out.push(['font-size', SIZE_KEYWORDS[size.toLowerCase()] ?? size]);
    if (lineHeight) out.push(['line-height', lineHeight]);
    const family = tokens.slice(index + 1).join(' ').trim();
    if (family) out.push(['font-family', family]);
    return out;
  }
  if (prop === 'flex') {
    const tokens = splitWhitespace(value);
    const first = tokens[0]?.toLowerCase();
    if (first === 'none') return [['flex-grow', '0'], ['flex-shrink', '0'], ['flex-basis', 'auto']];
    if (first === 'auto') return [['flex-grow', '1'], ['flex-shrink', '1'], ['flex-basis', 'auto']];
    if (first === 'initial') return [['flex-grow', '0'], ['flex-shrink', '1'], ['flex-basis', 'auto']];
    if (tokens.length === 1) {
      if (/^[\d.]+$/.test(tokens[0])) return [['flex-grow', tokens[0]], ['flex-shrink', '1'], ['flex-basis', '0%']];
      return [['flex-grow', '1'], ['flex-shrink', '1'], ['flex-basis', tokens[0]]];
    }
    if (tokens.length === 2) {
      if (/^[\d.]+$/.test(tokens[0]) && /^[\d.]+$/.test(tokens[1])) {
        return [['flex-grow', tokens[0]], ['flex-shrink', tokens[1]], ['flex-basis', '0%']];
      }
      return [['flex-grow', tokens[0]], ['flex-shrink', '1'], ['flex-basis', tokens[1]]];
    }
    return [['flex-grow', tokens[0]], ['flex-shrink', tokens[1]], ['flex-basis', tokens[2]]];
  }
  if (prop === 'flex-flow') {
    const tokens = splitWhitespace(value);
    const out = [];
    for (const t of tokens) {
      if (/^(row|row-reverse|column|column-reverse)$/.test(t)) out.push(['flex-direction', t]);
      else if (/^(nowrap|wrap|wrap-reverse)$/.test(t)) out.push(['flex-wrap', t]);
    }
    return out;
  }
  if (prop === 'gap') {
    const [row, column] = splitWhitespace(value);
    return [['row-gap', row], ['column-gap', column ?? row]];
  }
  if (prop === 'overflow') {
    const [x, y] = splitWhitespace(value);
    return [['overflow-x', x], ['overflow-y', y ?? x]];
  }
  if (prop === 'text-decoration') {
    const out = [];
    const line = [];
    let color = null;
    for (const token of splitWhitespace(value)) {
      if (['none', 'underline', 'overline', 'line-through'].includes(token)) line.push(token);
      else if (parseColor(token)) color = token;
    }
    out.push(['text-decoration-line', line.length ? line.join(' ') : 'none']);
    if (color) out.push(['text-decoration-color', color]);
    return out;
  }
  if (prop === 'list-style') {
    let type = null;
    for (const token of splitWhitespace(value)) {
      if (/^(none|disc|circle|square|decimal|decimal-leading-zero|lower-alpha|upper-alpha|lower-roman|upper-roman)$/.test(token)) {
        if (token === 'none' || type === null) type = token;
      }
    }
    return type ? [['list-style-type', type]] : [];
  }
  if (prop === 'outline') return [];
  // Grid: temel destek — template ve yerlesim bildirimleri gecer, diger grid
  // kisaltmalari (grid, grid-area, place-*, grid-auto-*) yok sayilir.
  if (['transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'animation', 'animation-name', 'animation-duration', 'transform', 'transform-origin', 'grid', 'grid-area', 'grid-auto-flow', 'grid-auto-rows', 'grid-auto-columns', 'place-items', 'place-content', 'place-self', 'grid-template-areas', 'will-change', 'filter', 'backdrop-filter'].includes(prop)) {
    if (prop === 'transform' || prop === 'filter') return [[prop, value]];
    return [];
  }
  return [[prop, value]];
}

export const COLORS = NAMED_COLORS;
