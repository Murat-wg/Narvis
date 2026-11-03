import { parseDocument } from '../src/html/parser.js';
import { computeStyles } from '../src/style.js';
import { layoutDocument } from '../src/layout.js';

const html = `<html><body style="margin:0;font:16px/1.5 Arial">
<header style="display:flex;align-items:center;padding:16px 32px;gap:16px;border-bottom:1px solid #eee">
  <div style="font-weight:700;font-size:20px">Narvis</div>
  <nav style="display:flex;gap:12px;margin-left:auto"><a>Docs</a><a>Demo</a></nav>
</header>
<main style="padding:32px"><h1>Baslik</h1></main>
</body></html>`;
const doc = parseDocument(html);
const styles = computeStyles(doc, { width: 1000, height: 700 });
for (const sel of ['body', 'header', 'header div', 'nav']) {
  const el = doc.querySelector(sel);
  const s = styles.get(el);
  console.log(sel, {
    display: s.display, fontSize: s.fontSize, lineHeight: s.lineHeight, width: s.width, height: s.height,
    padding: [s.paddingTop, s.paddingRight], margin: [s.marginTop, s.marginLeft], gap: [s.rowGap, s.columnGap],
    alignItems: s.alignItems, justify: s.justifyContent, flexGrow: s.flexGrow, flexBasis: s.flexBasis,
  });
}
for (const sel of ['h1']) {
  const s = styles.get(doc.querySelector(sel));
  console.log(sel, { display: s.display, fontSize: s.fontSize, marginTop: s.marginTop, lineHeight: s.lineHeight });
}
const layout = layoutDocument(doc, { viewport: { width: 1000, height: 700 }, measureText: (t, s) => t.length * s.fontSize * 0.52 });
const header = doc.querySelector('header')._box;
console.log('header box', { x: header.x, y: header.y, w: header.width, h: header.height, cy: header.contentY, pad: header.padding, bord: header.border });
const logo = doc.querySelector('header div')._box;
console.log('logo box', { x: logo.x, y: logo.y, w: logo.width, h: logo.height, cy: logo.contentY, cx: logo.contentX });
console.log('logo lineboxes', logo.children[0]?.lineBoxes);
console.log('logo anonymous', logo.children[0] && { x: logo.children[0].x, y: logo.children[0].y, w: logo.children[0].width, h: logo.children[0].height, cw: logo.children[0].contentWidth });
