// CSS dosyasi ve bildirim blogu ayristirici.

import { splitTopLevel, firstTopLevelColon, stripComments } from '../util.js';
import { parseSelectorList } from './selectors.js';
import { expandDeclaration } from './values.js';

export function parseDeclarations(text) {
  const out = [];
  for (const chunk of splitTopLevel(String(text ?? ''), ';')) {
    const idx = firstTopLevelColon(chunk);
    if (idx === -1) continue;
    let prop = chunk.slice(0, idx).trim().toLowerCase();
    let value = chunk.slice(idx + 1).trim();
    if (!prop || !value) continue;
    let important = false;
    if (/!\s*important\s*$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important\s*$/i, '').trim();
    }
    if (!value) continue;
    for (const [p, v] of expandDeclaration(prop, value)) out.push({ prop: p, value: v, important });
  }
  return out;
}

function readBlock(css, openIndex) {
  let depth = 1;
  let quote = null;
  for (let i = openIndex + 1; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { content: css.slice(openIndex + 1, i), end: i + 1 };
    }
  }
  return { content: css.slice(openIndex + 1), end: css.length };
}

function findBrace(css, start) {
  let quote = null;
  let paren = 0;
  for (let i = start; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') paren++;
    else if (ch === ')') paren = Math.max(0, paren - 1);
    else if (ch === '{' && paren === 0) return i;
    else if (ch === '}' && paren === 0) return -1;
  }
  return -1;
}

export function parseStylesheet(css, options = {}) {
  const rules = [];
  let order = options.orderStart ?? 0;
  const nextOrder = () => ++order;
  parseRules(stripComments(String(css ?? '')), null, rules, nextOrder);
  return rules;
}

function parseRules(css, media, out, nextOrder) {
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    if (css[i] === '}') { i++; continue; }
    const brace = findBrace(css, i);
    if (brace === -1) break;
    const prelude = css.slice(i, brace).trim();
    const block = readBlock(css, brace);
    i = block.end;
    if (!prelude) continue;

    if (prelude.startsWith('@')) {
      const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase();
      if (name === 'media') {
        const condition = prelude.slice(6).trim();
        parseRules(block.content, { condition, parent: media }, out, nextOrder);
      } else if (name === 'supports') {
        parseRules(block.content, media, out, nextOrder);
      } else if (name === 'layer') {
        parseRules(block.content, media, out, nextOrder);
      }
      // @font-face, @keyframes, @import ... atlanir
      continue;
    }

    const selectors = parseSelectorList(prelude);
    if (!selectors.length) continue;
    const declarations = parseDeclarations(block.content);
    if (!declarations.length) continue;
    const ruleOrder = nextOrder();
    for (const selector of selectors) {
      out.push({
        selector,
        declarations,
        order: ruleOrder,
        media,
        source: prelude,
      });
    }
  }
}

export function mediaMatches(media, viewport) {
  if (!media) return true;
  const condition = media.condition ?? '';
  if (!condition) return true;
  return condition.split(',').some((part) => {
    let s = part.trim().toLowerCase();
    if (!s) return true;
    s = s.replace(/^only\s+/, '');
    if (s === 'all' || s === 'screen') return true;
    if (s === 'print' || s === 'speech') return false;
    return s.split(/\s+and\s+/).every((clause) => {
      clause = clause.trim();
      let m = clause.match(/^\(\s*(min|max)-(width|height)\s*:\s*([\d.]+)(px|em|rem)?\s*\)$/);
      if (m) {
        let value = parseFloat(m[3]);
        if (m[4] === 'em' || m[4] === 'rem') value *= 16;
        const actual = m[2] === 'width' ? viewport.width : viewport.height;
        return m[1] === 'min' ? actual >= value : actual <= value;
      }
      m = clause.match(/^\(\s*(orientation)\s*:\s*(portrait|landscape)\s*\)$/);
      if (m) return viewport.width > viewport.height ? m[2] === 'landscape' : m[2] === 'portrait';
      if (/^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/.test(clause)) return !!viewport.dark;
      if (/^\(\s*prefers-color-scheme\s*:\s*light\s*\)$/.test(clause)) return !viewport.dark;
      if (/^\(\s*(hover|pointer)\s*:/.test(clause)) return true;
      return true;
    });
  });
}
