import { parseDocument } from '../src/html/parser.js';
import { computeStyles } from '../src/style.js';
import { layoutDocument } from '../src/layout.js';
import { fontString } from '../src/font.js';

const html = `<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.5 Arial; }
  header { display: flex; align-items: center; padding: 16px 32px; gap: 16px; border-bottom: 1px solid #eee; }
  .logo { font-weight: 700; font-size: 20px; }
  nav { display: flex; gap: 12px; margin-left: auto; }
  main { max-width: 720px; margin: 0 auto; padding: 32px; }
  h1 { margin-top: 0; font-size: 40px; }
  .cards { display: flex; gap: 12px; }
  .card { flex: 1; padding: 16px; border: 1px solid #ddd; }
  .wide { flex: 2; }
</style></head><body>
  <header>
    <div class="logo">Narvis</div>
    <nav><a href="#">Dokumanlar</a><a href="#">Demo</a></nav>
  </header>
  <main>
    <h1>Baslik</h1>
    <p>Bu bir deneme paragrafidir ve satir kirma davranisini gormek icin yeterince uzundur. Narvis kendi layout motorunu kullanir.</p>
    <div class="cards">
      <div class="card">A karti</div>
      <div class="card wide">B karti daha genis</div>
    </div>
  </main>
</body></html>`;

const doc = parseDocument(html);
computeStyles(doc, { width: 1000, height: 700 });
const layout = layoutDocument(doc, {
  viewport: { width: 1000, height: 700 },
  measureText: (text, style) => text.length * (style.fontSize || 16) * 0.52,
});

function find(el) {
  let box = el._box;
  return box;
}
function dump(box, depth = 0, max = 4) {
  const st = box.style;
  console.log('  '.repeat(depth) + `${box.kind}${box.el ? ' <' + box.el.localName + '>' : ''} x=${box.x.toFixed(1)} y=${box.y.toFixed(1)} w=${box.width.toFixed(1)} h=${box.height.toFixed(1)} ${st.display}${box.isFlex ? ' flex' : ''}`);
  if (depth < max) for (const c of box.children) dump(c, depth + 1, max);
}
dump(layout.root, 0, 5);
console.log('doc height', layout.height);

const header = doc.querySelector('header')._box;
const main = doc.querySelector('main')._box;
const nav = doc.querySelector('nav')._box;
const cardA = doc.querySelectorAll('.card')[0]._box;
const cardB = doc.querySelectorAll('.card')[1]._box;
const paragraph = doc.querySelector('p')._box;
console.log({ header: [header.x, header.y, header.width, header.height], main: [main.x, main.y, main.width], nav: [nav.x, nav.y, nav.width], cardA: [cardA.x, cardA.width], cardB: [cardB.x, cardB.width], p: [paragraph.x, paragraph.width, paragraph.height, paragraph.lineBoxes.length] });

const assert = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); };
assert(Math.abs(main.width - 720) < 1, 'main max-width 720');
assert(Math.abs(main.x - 140) < 1, 'main auto margin centers');
assert(Math.abs(header.width - 1000) < 1, 'header full width');
assert(nav.x > 600, 'nav pushed right by margin-left auto');
assert(Math.abs(cardA.contentWidth - cardB.contentWidth / 2) < 2, 'flex grow ratio 1:2 on content widths');
const anon = paragraph.children[0];
assert(anon.lineBoxes.length >= 2, 'paragraph wrapped into multiple lines');
assert(layout.height > 300, 'document height');
