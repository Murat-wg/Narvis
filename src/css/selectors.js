// CSS secici ayristirici ve eslestirici.
// Desteklenenler: tur, *, #id, .sinif, [attr], [attr=...], :first-child,
// :nth-child(), :not(), :is(), :where(), :hover, :focus, ... ve > + ~ bosluk.

import { splitTopLevel } from '../util.js';

const COMBINATORS = new Set(['>', '+', '~']);

export function parseSelectorList(text) {
  const out = [];
  for (const raw of splitTopLevel(String(text ?? ''), ',')) {
    const s = raw.trim();
    if (!s) continue;
    const parsed = parseComplex(s);
    if (parsed) out.push(parsed);
  }
  return out;
}

function findMatching(text, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseComplex(text) {
  let i = 0;
  const parts = [];
  let combinator = null;
  while (i < text.length) {
    let sawSpace = false;
    while (i < text.length && /\s/.test(text[i])) { i++; sawSpace = true; }
    if (i >= text.length) break;
    if (parts.length > 0) {
      if (COMBINATORS.has(text[i])) {
        combinator = text[i];
        i++;
        while (i < text.length && /\s/.test(text[i])) i++;
      } else if (sawSpace) {
        combinator = ' ';
      } else {
        return null;
      }
    }
    const start = i;
    let depth = 0;
    let quote = null;
    while (i < text.length) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
      if (ch === '[' || ch === '(') { depth++; i++; continue; }
      if (ch === ']' || ch === ')') { depth = Math.max(0, depth - 1); i++; continue; }
      if (depth === 0 && (/\s/.test(ch) || COMBINATORS.has(ch))) break;
      i++;
    }
    if (i === start) return null;
    const compound = parseCompound(text.slice(start, i));
    if (!compound) return null;
    parts.push({ compound, combinator: parts.length ? combinator : null });
  }
  if (!parts.length) return null;
  const specificity = [0, 0, 0];
  for (const part of parts) {
    const sp = part.compound.specificity;
    specificity[0] += sp[0];
    specificity[1] += sp[1];
    specificity[2] += sp[2];
  }
  return { text: text.trim(), parts, specificity };
}

function readIdent(text, state) {
  let out = '';
  while (state.i < text.length) {
    const ch = text[state.i];
    if (ch === '\\') {
      out += text[state.i + 1] ?? '';
      state.i += 2;
      continue;
    }
    if (/[-\w]/.test(ch) || ch.charCodeAt(0) > 127) {
      out += ch;
      state.i++;
      continue;
    }
    break;
  }
  return out;
}

function parseCompound(text) {
  const c = {
    tag: null, id: null, classes: [], attrs: [], pseudos: [], pseudoElement: null,
    specificity: [0, 0, 0],
  };
  const state = { i: 0 };
  while (state.i < text.length) {
    const ch = text[state.i];
    if (ch === '*') {
      c.tag = '*';
      state.i++;
    } else if (ch === '#') {
      state.i++;
      const id = readIdent(text, state);
      if (!id) return null;
      c.id = id;
      c.specificity[0]++;
    } else if (ch === '.') {
      state.i++;
      const cls = readIdent(text, state);
      if (!cls) return null;
      c.classes.push(cls);
      c.specificity[1]++;
    } else if (ch === '[') {
      const end = findMatching(text, state.i, '[', ']');
      if (end === -1) return null;
      const attr = parseAttr(text.slice(state.i + 1, end));
      if (!attr) return null;
      c.attrs.push(attr);
      c.specificity[1]++;
      state.i = end + 1;
    } else if (ch === ':') {
      state.i++;
      let pseudoElement = false;
      if (text[state.i] === ':') { pseudoElement = true; state.i++; }
      const name = readIdent(text, state).toLowerCase();
      if (!name) return null;
      let args = null;
      if (text[state.i] === '(') {
        const end = findMatching(text, state.i, '(', ')');
        if (end === -1) return null;
        args = text.slice(state.i + 1, end);
        state.i = end + 1;
      }
      if (pseudoElement || ['before', 'after', 'first-line', 'first-letter'].includes(name)) {
        c.pseudoElement = name;
        c.specificity[2]++;
      } else {
        const pseudo = { name, args };
        if (['not', 'is', 'where', 'has'].includes(name)) {
          pseudo.selectorList = parseSelectorList(args ?? '');
          if (name !== 'where') {
            let best = [0, 0, 0];
            for (const sel of pseudo.selectorList) {
              if (compareSpecificity(sel.specificity, best) > 0) best = sel.specificity;
            }
            c.specificity[0] += best[0];
            c.specificity[1] += best[1];
            c.specificity[2] += best[2];
          }
        } else {
          c.specificity[1]++;
          if (name.startsWith('nth-')) pseudo.nth = parseNth(args ?? '');
        }
        c.pseudos.push(pseudo);
      }
    } else {
      const tag = readIdent(text, state);
      if (!tag) return null;
      if (c.tag) return null;
      c.tag = tag.toLowerCase();
      c.specificity[2]++;
    }
  }
  if (!c.tag && !c.id && c.classes.length === 0 && c.attrs.length === 0 && c.pseudos.length === 0) return null;
  return c;
}

function parseAttr(text) {
  const m = text.match(/^\s*([^\s~|^$*=\]]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([iIsS])?)?\s*$/);
  if (!m) return null;
  return {
    name: m[1].toLowerCase(),
    operator: m[2] || null,
    value: m[3] ?? m[4] ?? m[5] ?? null,
    insensitive: (m[6] ?? '').toLowerCase() === 'i',
  };
}

export function parseNth(text) {
  const s = String(text).replace(/\s+/g, '').toLowerCase();
  if (!s) return { a: 0, b: 0 };
  if (s === 'odd') return { a: 2, b: 1 };
  if (s === 'even') return { a: 2, b: 0 };
  if (/^[+-]?\d+$/.test(s)) return { a: 0, b: Number(s) };
  const m = s.match(/^([+-]?\d*)n([+-]\d+)?$/);
  if (!m) return { a: 0, b: 0 };
  let a = 1;
  if (m[1] === '-') a = -1;
  else if (m[1] !== '' && m[1] !== '+') a = Number(m[1]);
  return { a, b: m[2] ? Number(m[2]) : 0 };
}

export function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function elementSiblings(el) {
  return el.parentElement ? el.parentElement.children : [el];
}

function typeSiblings(el) {
  const all = elementSiblings(el);
  return all.filter((x) => x.localName === el.localName);
}

function nthMatches(index, nth) {
  if (!nth) return false;
  if (nth.a === 0) return index === nth.b;
  const n = (index - nth.b) / nth.a;
  return Number.isInteger(n) && n >= 0;
}

function matchPseudo(el, pseudo) {
  const name = pseudo.name;
  switch (name) {
    case 'first-child': return elementSiblings(el)[0] === el;
    case 'last-child': {
      const s = elementSiblings(el);
      return s[s.length - 1] === el;
    }
    case 'only-child': return elementSiblings(el).length === 1;
    case 'first-of-type': return typeSiblings(el)[0] === el;
    case 'last-of-type': {
      const s = typeSiblings(el);
      return s[s.length - 1] === el;
    }
    case 'only-of-type': return typeSiblings(el).length === 1;
    case 'nth-child': return nthMatches(elementSiblings(el).indexOf(el) + 1, pseudo.nth);
    case 'nth-last-child': {
      const s = elementSiblings(el);
      return nthMatches(s.length - s.indexOf(el), pseudo.nth);
    }
    case 'nth-of-type': return nthMatches(typeSiblings(el).indexOf(el) + 1, pseudo.nth);
    case 'nth-last-of-type': {
      const s = typeSiblings(el);
      return nthMatches(s.length - s.indexOf(el), pseudo.nth);
    }
    case 'not': return !pseudo.selectorList.some((sel) => matchesSelector(el, sel));
    case 'is':
    case 'where': return pseudo.selectorList.some((sel) => matchesSelector(el, sel));
    case 'has': return false;
    case 'root': return el.ownerDocument?.documentElement === el;
    case 'empty': return !el.childNodes.some((n) => n.nodeType === 1 || (n.nodeType === 3 && n.data.length > 0));
    case 'hover': return !!el._hover;
    case 'active': return !!el._active;
    case 'focus': return el.ownerDocument?.activeElement === el;
    case 'focus-visible': return el.ownerDocument?.activeElement === el;
    case 'focus-within': {
      let n = el.ownerDocument?.activeElement;
      while (n) { if (n === el) return true; n = n.parentElement; }
      return false;
    }
    case 'checked': return !!(el.checked ?? el.hasAttribute('checked'));
    case 'disabled': return el.hasAttribute('disabled');
    case 'enabled': return !el.hasAttribute('disabled');
    case 'link':
    case 'any-link': return (el.localName === 'a' || el.localName === 'area') && el.hasAttribute('href');
    case 'visited': return false;
    case 'target': return false;
    default: return false;
  }
}

function matchCompound(el, compound) {
  if (compound.tag && compound.tag !== '*' && el.localName !== compound.tag) return false;
  if (compound.id && el.getAttribute('id') !== compound.id) return false;
  for (const cls of compound.classes) {
    if (!el.classList.contains(cls)) return false;
  }
  for (const attr of compound.attrs) {
    let value = el.getAttribute(attr.name);
    if (value == null) return false;
    if (!attr.operator) continue;
    let expected = attr.value ?? '';
    if (attr.insensitive) { value = value.toLowerCase(); expected = expected.toLowerCase(); }
    switch (attr.operator) {
      case '=': if (value !== expected) return false; break;
      case '~=': if (!value.split(/\s+/).includes(expected)) return false; break;
      case '|=': if (value !== expected && !value.startsWith(expected + '-')) return false; break;
      case '^=': if (!value.startsWith(expected)) return false; break;
      case '$=': if (!value.endsWith(expected)) return false; break;
      case '*=': if (!value.includes(expected)) return false; break;
      default: return false;
    }
  }
  for (const pseudo of compound.pseudos) {
    if (!matchPseudo(el, pseudo)) return false;
  }
  return true;
}

function matchComplex(el, parts, index) {
  if (!matchCompound(el, parts[index].compound)) return false;
  if (index === 0) return true;
  const combinator = parts[index].combinator;
  if (combinator === ' ') {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (matchComplex(p, parts, index - 1)) return true;
    }
    return false;
  }
  if (combinator === '>') {
    return !!el.parentElement && matchComplex(el.parentElement, parts, index - 1);
  }
  if (combinator === '+') {
    const prev = el.previousElementSibling;
    return !!prev && matchComplex(prev, parts, index - 1);
  }
  if (combinator === '~') {
    for (let prev = el.previousElementSibling; prev; prev = prev.previousElementSibling) {
      if (matchComplex(prev, parts, index - 1)) return true;
    }
    return false;
  }
  return false;
}

export function matchesSelector(el, selector) {
  if (!selector || !selector.parts?.length) return false;
  return matchComplex(el, selector.parts, selector.parts.length - 1);
}
