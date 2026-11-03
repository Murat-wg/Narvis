// HTML karakter varliklari (entity) cozumleyici - kucuk ama islevsel bir alt kume.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', laquo: '\u00ab', raquo: '\u00bb',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  times: '\u00d7', divide: '\u00f7', middot: '\u00b7', bull: '\u2022',
  deg: '\u00b0', plusmn: '\u00b1', frac12: '\u00bd', frac14: '\u00bc',
  frac34: '\u00be', sup2: '\u00b2', sup3: '\u00b3', micro: '\u00b5',
  para: '\u00b6', sect: '\u00a7', dagger: '\u2020', Dagger: '\u2021',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
  larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193',
  harr: '\u2194', infin: '\u221e', ne: '\u2260', le: '\u2264', ge: '\u2265',
  shy: '\u00ad', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  check: '\u2713', cross: '\u2717', star: '\u2606', starf: '\u2605',
};

export function decodeEntities(input) {
  if (!input || input.indexOf('&') === -1) return input;
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch { return match; }
    }
    if (Object.prototype.hasOwnProperty.call(NAMED, body)) return NAMED[body];
    return match;
  });
}
