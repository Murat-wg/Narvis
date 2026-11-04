// Narvis test koşucusu: mevcut duman testlerini çalıştırır ve gerçek demo
// sayfalarını Node içinde ayrıştırıp yerleştirir.

import './smoke.mjs';
import './layout-smoke.mjs';

import { readFile } from 'node:fs/promises';
import { parseDocument } from '../src/html/parser.js';
import { computeStyles } from '../src/style.js';
import { layoutDocument } from '../src/layout.js';
import { collectFormData, selectedOptionIndexes, multiSelectRowHeight, multiSelectRows } from '../src/form.js';
import { NarvisEngine } from '../src/engine.js';

let failures = 0;
const assert = (condition, message) => {
  if (condition) {
    console.log('ok -', message);
  } else {
    failures += 1;
    console.error('FAIL:', message);
  }
};

const pages = [
  { path: '../pages/demo.html', minHeight: 1800, minBoxes: 80 },
  { path: '../pages/about.html', minHeight: 900, minBoxes: 50 },
];

for (const page of pages) {
  const html = await readFile(new URL(page.path, import.meta.url), 'utf8');
  const doc = parseDocument(html, { url: page.path });
  const viewport = { width: 1200, height: 800 };
  computeStyles(doc, viewport);
  const layout = layoutDocument(doc, {
    viewport,
    measureText: (text, style) => text.length * (style.fontSize || 16) * 0.52,
  });

  assert(doc.title.includes('Narvis'), `${page.path}: başlık ayrıştırıldı`);
  assert(!!doc.body && !!doc.body._box, `${page.path}: body kutusu oluştu`);
  assert(layout.boxes.length >= page.minBoxes, `${page.path}: yeterli kutu üretildi (${layout.boxes.length})`);
  assert(layout.height >= page.minHeight, `${page.path}: belge yüksekliği (${Math.round(layout.height)}px)`);
  assert(doc.body._box.width > 1000, `${page.path}: body genişliği viewport'u doldurdu`);

  const invalid = layout.boxes.filter((box) => ![box.x, box.y, box.width, box.height].every(Number.isFinite));
  assert(invalid.length === 0, `${page.path}: tüm kutu koordinatları sonlu`);

  const negative = layout.boxes.filter((box) => box.width < 0 || box.height < 0);
  assert(negative.length === 0, `${page.path}: negatif kutu boyutu yok`);

  const paragraph = doc.querySelector('p');
  assert(!!paragraph?._box, `${page.path}: paragraf kutusu var`);
}

/* ------------------------------------------------------------------ *
 * Regresyon testleri
 * ------------------------------------------------------------------ */

function buildLayout(html, width = 800) {
  const doc = parseDocument(html, { url: 'test://regression' });
  computeStyles(doc, { width, height: 600 });
  const layout = layoutDocument(doc, {
    viewport: { width, height: 600 },
    measureText: (text, style) => text.length * (style.fontSize || 16) * 0.52,
  });
  return { doc, layout };
}

{
  const doc = parseDocument('<div id="a">eski metin</div>', { url: 'test://text' });
  const el = doc.getElementById('a');
  el.textContent = 'yeni metin';
  assert(el.textContent === 'yeni metin', 'Element.textContent yazma metni gunceller');
  assert(el.childNodes.length === 1 && el.childNodes[0].data === 'yeni metin', 'Element.textContent tek metin dugumu uretir');
  el.textContent = '';
  assert(el.textContent === '' && el.childNodes.length === 0, 'Element.textContent bosaltma dugumleri siler');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    .outer { font-family: Georgia, serif; font-size: 18px; color: #123456; }
    .inner { font-family: inherit; font-size: inherit; color: inherit; }
  </style><div class="outer"><span class="inner">kalıtım</span></div>`);
  const inner = doc.querySelector('.inner');
  assert(inner._style.fontFamily.includes('Georgia'), 'font-family: inherit ust degeri alir');
  assert(inner._style.fontSize === 18, 'font-size: inherit ust boyutu alir');
  assert(inner._style.color.join(',') === '18,52,86,1', 'color: inherit ust rengi alir');
}

{
  const { doc, layout } = buildLayout(`<!doctype html><style>
    h1 { font-size: 24px; line-height: 1.2; }
    .list { display: flex; flex-direction: column; gap: 10px; width: 220px; }
    .item { flex: 1; padding: 5px; }
  </style><h1>birinci<br>ikinci</h1>
  <div class="list"><div class="item">a</div><div class="item">b</div></div>`);
  const h1 = doc.querySelector('h1')._box;
  const lines = h1.children[0]?.lineBoxes ?? [];
  assert(lines.length === 2, '<br> iki satir uretir');

  const list = doc.querySelector('.list')._box;
  const [first, second] = list.children;
  assert(first.height > 10, 'kolon flex:1 belirsiz yukseklikte icerik boyu kullanir');
  assert(second.y >= first.y + first.height + 9, 'kolon flex ogeleri cakismadan yigilir');
  assert(layout.boxes.every((box) => Number.isFinite(box.y)), 'regresyon sayfasi sonlu koordinatlar uretir');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    .parent { font-size: 10px; line-height: 1.5; }
    .child { font-size: 20px; }
  </style><div class="parent"><span class="child">x</span></div>`)
  const child = doc.querySelector('.child')._style;
  assert(Math.abs(child.lineHeight - 30) < 0.01, 'birimsiz line-height alt ogede yeniden hesaplanir');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    .nowrap { white-space: nowrap; width: 200px; font-size: 16px; }
    .wrap { width: 200px; font-size: 16px; }
  </style>
  <div class="nowrap">bir iki uc dort bes alti yedi</div>
  <div class="wrap">bir iki uc dort bes alti yedi</div>`);
  const nowrap = doc.querySelector('.nowrap')._box.children[0];
  const wrap = doc.querySelector('.wrap')._box.children[0];
  assert(nowrap?.lineBoxes?.length === 1, 'white-space: nowrap tek satirda kalir');
  assert((wrap?.lineBoxes?.length ?? 0) > 1, 'white-space: normal metni satirlara böler');
}

{
  const { doc } = buildLayout(`<!doctype html>
  <div>satir
  sonu</div>`);
  const box = doc.querySelector('div')._box;
  const fragments = box.children[0]?.fragments ?? box.children[0]?.lineBoxes?.flatMap((line) => line.fragments) ?? [];
  assert(!fragments.some((frag) => frag.text?.includes('\n')), 'normal metin akisinda \\n yeni satir olarak kirilmiyor');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { --accent: #ff6b35; --m: 10px; }
    .box { color: var(--accent); margin-left: var(--m); background-color: var(--yok, rgb(18,52,86)); }
    .inherit-test { color: var(--redefine-koy, red); }
  </style>
  <div class="box" style="--redefine-koy: blue"><span class="inherit-test">icerde</span></div>`);
  const box = doc.querySelector('.box')._style;
  assert(JSON.stringify(box.color) === JSON.stringify([255, 107, 53, 1]), 'var() tanimli degiskeni cozer');
  assert(JSON.stringify(box.backgroundColor) === JSON.stringify([18, 52, 86, 1]), 'var() yedek degeri kullanir');
  assert(box.marginLeft === 10, 'degisken uzunluk bildirimlerine uygulanir');
  const inner = doc.querySelector('.inherit-test')._style;
  assert(JSON.stringify(inner.color) === JSON.stringify([0, 0, 255, 1]), 'degisken ust ogeden gecer (inline --)');

  const nelException = doc.querySelector('.box');
  assert(nelException._style._vars['--accent'] != null, 'hesaplanmis stil custom property tutar');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    .c { --a: var(--b); --b: var(--a); color: var(--a, green); margin-top: var(--a); margin-bottom: var(--yok-2, 4px); }
  </style><div class="c">x</div>`);
  const c = doc.querySelector('.c')._style;
  assert(JSON.stringify(c.color) === JSON.stringify([0, 128, 0, 1]), 'degisken dongusunde yedek kullanilir');
  assert(c.marginTop === 0 && c.marginBottom === 4, 'cozulemeyen var() bildirimleri dusup bastaki degere doner');
}

{
  const { doc, layout } = buildLayout(`<!doctype html><style>
    .g { display: grid; grid-template-columns: 1fr 1fr; column-gap: 20px; row-gap: 10px; width: 400px; }
    .g > div { padding: 10px; font-size: 16px; }
    .tall { height: 60px; }
  </style>
  <div class="g"><div id="a">a</div><div id="b">b</div><div id="c">c</div><div id="d" style="grid-column: span 2">d</div></div>`);
  const g = doc.querySelector('.g')._box;
  const items = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, doc.getElementById(id)._box]));
  assert(Math.abs(items.a.width - 190) < 1 && Math.abs(items.b.x - 218) < 1, 'grid 1fr kolonlar bolume paylasir (190, x=218)');
  assert(items.d.width >= 398, 'grid-column: span 2 iki kolonu kaplar');
  assert(Math.abs(items.c.y - 62) < 1, 'row-gap 10 ile ikinci satira gecer');
  assert(items.a.height >= items.b.height - 0.01, 'align-items stretch satir boyunu doldurur (yuksek ogeler korunur)');
  assert(layout.boxes.every((b) => Number.isFinite(b.width)), 'grid sonlu kutu olculeri uretir');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    .g2 { display: grid; grid-template-columns: 100px 200px; justify-content: center; width: 400px; height: 200px; }
    .g2 > div { font-size: 16px; }
  </style>
  <div class="g2"><div>x</div><div>y</div></div>`);
  const [x, y] = doc.querySelector('.g2')._box.children;
  assert(Math.abs(x.x - 58) < 1 && Math.abs(y.x - 158) < 1, 'justify-content: center izler arasinda paylasir');
  assert(Math.abs(x.height - 24) < 1, 'grid @items stretch satira esit Uzunluk alir');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    .ig { display: inline-grid; grid-template-columns: 80px 120px; font-size: 16px; }
  </style><div class="wrap"><span class="ig"><span>ic</span><span>dis</span></span></div>`);
  const ig = doc.querySelector('.ig')._box;
  assert(Math.abs(ig.width - 200) < 1, 'inline-grid icerik boyu iz toplamidir');
  assert(ig.children.map((c) => Math.round(c.width)).join(',') === '80,120', 'inline-grid kolon genislikleri uygulanir');
}

/* ------------------------------------------------------------------ *
 * Float / clear
 * ------------------------------------------------------------------ */

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .kutu { float: left; width: 100px; height: 60px; background-color: red; }
    p { margin: 0; font-size: 16px; }
  </style><div class="kutu"></div><p>lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor</p>`);
  const f = doc.querySelector('.kutu')._box;
  const p = doc.querySelector('p')._box;
  const lines = p.children[0]?.lineBoxes ?? [];
  const frag = lines[0]?.fragments?.[0];
  assert(Math.round(frag?.x) === 100, 'sol float metni sagina yazar (ilk satir x=100)');
  assert(Math.round(f.y) === 0 && f.width === 100, 'sol float sol ust kenarada');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .kutu { float: right; width: 100px; height: 50px; }
    p { margin: 0; font-size: 16px; }
  </style><div class="kutu"></div><p>lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore</p>`);
  const f = doc.querySelector('.kutu')._box;
  const p = doc.querySelector('p')._box;
  const lines = p.children[0]?.lineBoxes ?? [];
  const used = lines[0]?.fragments.reduce((a, fr) => a + fr.width, 0) ?? 0;
  assert(Math.round(f.x + f.width) === 800, 'sag float sag kenara yapisir');
  assert(used <= 700.5, 'satir sag float sınırını asamaz');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .k { float: left; width: 300px; height: 40px; }
  </style><div class="k" id="a"></div><div class="k" id="b"></div><div class="k" id="c"></div>`);
  const a = doc.getElementById('a')._box;
  const b = doc.getElementById('b')._box;
  const c = doc.getElementById('c')._box;
  assert(Math.round(a.x) === 0 && Math.round(b.x) === 300, 'iki sol float yan yana dizilir');
  assert(Math.round(c.x) === 0 && c.y >= a.y + a.height - 0.01, 'yer kalmazsa float asagi iner');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .fl { float: left; width: 200px; height: 16px; }
    .metin { margin: 0; font-size: 16px; line-height: 24px; }
  </style>
  <div class="fl"></div>
  <p class="metin">birinci blok lorem ipsum dolor sit amet consectetur adipiscing</p>
  <p class="metin">ikinci blok son</p>`);
  const p1 = doc.querySelectorAll('.metin')[0]._box;
  const p2 = doc.querySelectorAll('.metin')[1]._box;
  const firstOf = (box) => (box.children[0]?.lineBoxes ?? [])[0]?.fragments?.[0];
  assert(Math.round(firstOf(p1)?.x) === 200, 'float bandindaki satir float yanindan baslar');
  const p2Top = (p2.children[0]?.lineBoxes ?? [])[0]?.top;
  assert(p2Top >= 15.9, 'bant bittiginde satir tam genislikten akar');
  assert(Math.round(firstOf(p2)?.x) === 0, 'band altindaki paragraf icerik kenarindan baslar');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .fl { float: left; width: 100px; height: 70px; }
    .sonra { clear: both; margin: 0; font-size: 16px; }
  </style><div class="fl"></div><p class="sonra">temiz metin</p>`);
  const f = doc.querySelector('.fl')._box;
  const p = doc.querySelector('.sonra')._box;
  assert(p.y >= f.y + f.height - 0.01, 'clear: both float altina iner');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .L { float: left; width: 60px; height: 50px; }
    .R { float: right; width: 60px; height: 50px; }
    .cl { clear: left; margin: 0; font-size: 16px; }
    .cr { clear: right; margin: 0; font-size: 16px; }
  </style>
  <div class="L"></div><div class="R"></div>
  <p class="cl">clear left</p>
  <p class="cr">clear right</p>`);
  const pl = doc.querySelector('.cl')._box;
  const pr = doc.querySelector('.cr')._box;
  assert(pl.y >= 49.9, 'clear: left yalnizca sol floatin altina iner');
  assert(pr.y >= 49.9, 'clear: right yalnizca sag floatin altina iner');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    img.fl { float: left; width: 90px; height: 64px; }
    p { margin: 0; font-size: 16px; }
  </style><p><img class="fl">metin yuzen kutuyu sarar lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt</p>`);
  const img = doc.querySelector('img')._box;
  const p = doc.querySelector('p')._box;
  const frag = (p.children[0]?.lineBoxes ?? [])[0]?.fragments?.[0];
  assert(Math.round(img.x) === 0 && Math.round(img.y) === 0, 'satir ici img float sol uste yerlesir');
  assert(Math.round(frag?.x) === 90, 'img float ile satir img sagindan baslar');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .kap { padding: 6px; overflow: hidden; }
    .fl { float: left; width: 50px; height: 120px; }
  </style><div class="kap"><div class="fl"></div>metin</div>`);
  const kap = doc.querySelector('.kap')._box;
  assert(Math.round(kap.height) === 132, 'BFC konteyner (overflow: hidden) yuzeni icine alir');
}

{
  const { doc } = buildLayout(`<!doctype html><style>
    .row { display: flex; width: 400px; }
    .col { float: left; width: 100px; }
  </style>
  <div class="row"><div class="col">x</div><div class="col">y</div></div>`);
  const boxes = doc.querySelectorAll('.col');
  const a = boxes[0]._box;
  const b = boxes[1]._box;
  assert(Math.round(a.x) === 8 && Math.round(b.x) === 108, 'flex oge bglerken float yok sayilir');
}

/* ------------------------------------------------------------------ *
 * Tablo
 * ------------------------------------------------------------------ */

/* Parser: eksik tbody imali uretilir, td'ler ayni tr'ye dizilir. */
{
  const doc = parseDocument('<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr></table>', { url: 'test://table' });
  const table = doc.querySelector('table');
  const tbody = table.children[0];
  assert(tbody.localName === 'tbody', 'tablo: eksik tbody imali uretilir');
  assert(tbody.children.length === 2, 'tablo: iki satir ikinci tr elemanina ulasir');
  assert(tbody.children[0].children.length === 3, 'tablo: ilk satir uc hucre tutar');
  assert(doc.querySelectorAll('td').length === 6, 'tablo: alti hucre hepsi korunur');
}

/* Sabit genislik: uzun icerikli kolon fazla pay alir, satir ayni boyda. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    table { width: 400px; border-spacing: 0; }
    td { padding: 0; }
  </style>
  <table><tr><td>uzun metin akisini dar kutusuna sarar</td><td>kisa</td></tr></table>`);
  const table = doc.querySelector('table')._box;
  const cells = [...doc.querySelectorAll('td')].map((td) => td._box);
  assert(Math.round(table.width) === 400, 'tablo genisligi uygulanir');
  assert(cells[0].width > cells[1].width, 'uzun icerikli kolon fazla pay alir');
  assert(Math.abs(cells[0].height - cells[1].height) < 0.01, 'ayni satir hucrleri esit boyda');
  assert(table.height >= cells[0].height, 'tablo yuksekligi hucreleri kapsar');
}

/* border-spacing: komşu hucreler arasinda bosluk. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    table { width: 306px; border-spacing: 2px; }
    td { padding: 0; }
  </style><table><tr><td>a</td><td>b</td><td>c</td></tr></table>`);
  const cells = [...doc.querySelectorAll('td')].map((td) => td._box);
  assert(Math.abs((cells[1].x - (cells[0].x + cells[0].width)) - 2) < 0.6, 'border-spacing komşu arasiligda 2px');
}

/* colspan + rowspan. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    table { width: 300px; border-spacing: 0; }
    td { padding: 0; height: 20px; }
  </style>
  <table>
    <tr><td colspan="2">genis</td><td>sag</td></tr>
    <tr><td rowspan="2">dikey</td><td>r1c2</td><td>r1c3</td></tr>
    <tr><td>r2c2</td><td>r2c3</td></tr>
  </table>`);
  const cells = [...doc.querySelectorAll('td')].map((td) => td._box);
  assert(Math.abs((cells[1].x - cells[0].x) - cells[0].width) < 1.2, 'colspan iki kolonun genisligini alir');
  assert(Math.round(cells[2].height) === 40, 'rowspan iki satirin yuksekligini alir');
  assert(Math.round(doc.querySelector('table')._box.height) === 60, 'tablo yuksekligi 3 satir');
}

/* inline-table shrink-to-fit + th birlesik stil. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .it { display: inline-table; border-spacing: 0; }
    td, th { padding: 0; }
  </style><p>merhaba <span><table class="it"><tr><td>narvis</td></tr></table></span> son</p>`);
  const it = doc.querySelector('.it')._box;
  const textW = Math.round(6 * 16 * 0.52);
  assert(Math.abs(Math.round(it.width) - textW) < 3, 'inline-table icerik boyu shrink-to-fit');
  const th = doc.querySelector('th') ? doc.querySelector('th') : null;
  if (th) assert(th._style.fontWeight === 700 && th._style.textAlign === 'center', 'th kalin ve merkezde');
}

/* ------------------------------------------------------------------ *
 * Pseudo-element (::before / ::after content)
 * ------------------------------------------------------------------ */

/* Yardimci: kutu agacindaki metin kutularini belge sirasinda topla. */
function textList(box) {
  const out = [];
  const walk = (b) => {
    if (b.kind === 'text') out.push(b.text);
    for (const c of b.children || []) walk(c);
  };
  walk(box);
  return out;
}

/* ::before + ::after tirnaklari ve siralama (önce, icerik, sonra). */
{
  const { doc } = buildLayout(`<!doctype html><style>
    q::before { content: '"'; }
    q::after { content: '"'; }
  </style><p>metin <q>alisin</q> bitis</p>`);
  const texts = textList(doc.querySelector('q')._box);
  assert(texts.length === 3 && texts[0] === '"' && texts[1] === 'alisin' && texts[2] === '"',
    'pseudo: ::before/::after siralama ve icerik');
}

/* :before takma adi (tek iki nokta) calisir. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    .m:before { content: '>>'; }
  </style><div class="m">icerik</div>`);
  assert(textList(doc.querySelector('.m')._box)[0] === '>>', 'pseudo: :before takma adi');
}

/* content: none kutu uretmez. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    .n::before { content: none; }
  </style><div class="n">temiz</div>`);
  const texts = textList(doc.querySelector('.n')._box);
  assert(texts.length === 1 && texts[0] === 'temiz', 'pseudo: content none kutu uretmez');
}

/* Spesifite: daha ozel kural kazanir. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    .a::before { content: 'A'; }
    .b::before { content: 'B'; }
    .a.b::before { content: 'AB'; }
  </style><div class="a b">x</div>`);
  assert(textList(doc.querySelector('.a.b')._box)[0] === 'AB', 'pseudo: spesifite kazananin icerigi');
}

/* var() icerikli content. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    :root { --mark: '>'; }
    .v::after { content: var(--mark); }
  </style><div class="v">icerik</div>`);
  const texts = textList(doc.querySelector('.v')._box);
  assert(texts.length === 2 && texts[1] === '>', 'pseudo: var() icerigi cozulur');
}

/* Blok akisinda pseudo metin anonim satir grubuna girer, sirasi korunur. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    .p::before { content: 'bas ile acik'; }
  </style><div class="p" style="font-size: 16px;">govde</div>`);
  const anon = doc.querySelector('.p')._box.children[0];
  const frags = anon.lineBoxes[0].fragments.map((f) => f.text);
  assert(frags.slice(0, 3).join(' ') === 'bas ile acik' && frags[3] === 'govde',
    'pseudo: satir akisi pseudo metinle baslar');
}

/* Desteklenmeyen fonksiyonlu content (counter) kutu uretmez. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    .c::before { content: counter(x); }
  </style><div class="c">metin</div>`);
  const texts = textList(doc.querySelector('.c')._box);
  assert(texts.length === 1 && texts[0] === 'metin', 'pseudo: counter() desteklenmez (bos)');
}

/* ------------------------------------------------------------------ *
 * Tablo faz 2: border-collapse catisma cozumu + col genislikleri
 * ------------------------------------------------------------------ */

/* Collapse: bitisik dikey cizgide kalin kenar + rengi kazanir. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    table { border-collapse: collapse; border-spacing: 4px; }
    td { padding: 0; }
    .narrow { border-right: 1px solid #111; }
    .thick { border-left: 4px solid #333; }
  </style><table><tr><td class="narrow">a</td><td class="thick">b</td></tr></table>`);
  const cells = [...doc.querySelectorAll('td')].map((td) => td._box);
  assert(Math.abs((cells[1].x - (cells[0].x + cells[0].width))) < 0.01, 'collapse: hucreler bitisik (spacing sifir)');
  assert(cells[0].style.borderRightWidth === 4, 'collapse: kalin dikey kenar kazanir');
  assert(JSON.stringify(cells[0].style.borderRightColor) === JSON.stringify([51, 51, 51, 1]), 'collapse: kenar rengi kazananindan');
  assert(cells[1].style.borderLeftWidth === 0, 'collapse: karsi kenar sifirlanir');
}

/* Collapse: dikey cizgide kalin kenar yukari hucreye yazilir. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    table { border-collapse: collapse; }
    td { padding: 0; }
    .bot { border-bottom: 3px solid #111; }
    .top { border-top: 5px solid #222; }
  </style><table><tr><td class="bot">üst</td></tr><tr><td class="top">alt</td></tr></table>`);
  const cells = [...doc.querySelectorAll('td')].map((td) => td._box);
  assert(cells[0].style.borderBottomWidth === 5, 'collapse: kalin yatay kenar kazanir');
  assert(cells[1].style.borderTopWidth === 0, 'collapse: alt hucrenin üst kenari sifirlanir');
}

/* col genislikleri: px + yuzde karisik dagitim. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    table { width: 500px; border-spacing: 0; }
    td { padding: 0; }
  </style>
  <table>
    <colgroup><col style="width: 120px"><col style="width: 40%"><col></colgroup>
    <tr><td>a</td><td>b</td><td>c</td></tr>
  </table>`);
  const cells = [...doc.querySelectorAll('td')].map((td) => td._box);
  assert(Math.round(cells[0].width) === 120, 'col: sabit px kolon tam degerinde');
  assert(Math.round(cells[1].width) === 200, 'col: yuzde kolon tablo genisliginden');
  assert(Math.round(cells[2].width) === 180, 'col: belirtilmemis kolon kalan butceyi alir');
}

/* col span genisletme ve col'suz davranis korunumu. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    table { width: 400px; border-spacing: 0; }
    td { padding: 0; }
  </style>
  <table>
    <colgroup><col span="2" style="width: 50px"><col></colgroup>
    <tr><td>a</td><td>b</td><td>c</td></tr>
  </table>`);
  const cells = [...doc.querySelectorAll('td')].map((td) => td._box);
  assert(Math.round(cells[0].width) === 50 && Math.round(cells[1].width) === 50, 'col: span="2" iki kolona uygulanir');
  assert(Math.round(cells[2].width) === 300, 'col: son kolon kalan butceyi alir');
}

/* col tanimi yoksa eski dagitim korunur. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    table { width: 400px; border-spacing: 0; }
    td { padding: 0; }
  </style>
  <table><tr><td>uzun metin akisini dar kutusuna sarar</td><td>kisa</td></tr></table>`);
  const cells = [...doc.querySelectorAll('td')].map((td) => td._box);
  assert(cells[0].width > cells[1].width && Math.round(doc.querySelector('table')._box.width) === 400,
    'col yok: kolon dagitimi degismez');
}

/* ------------------------------------------------------------------ *
 * Form kontrolleri: olculer, deger API'si, tikla/odak/sifirla
 * ------------------------------------------------------------------ */

{
  const { doc } = buildLayout(`<!doctype html><style>body { margin: 0; }</style>
    <form>
      <p><input id="name" type="text" placeholder="Ad"></p>
      <p><input id="cb" type="checkbox"> <input id="r1" type="radio" name="g"> <input id="r2" type="radio" name="g" checked></p>
      <p><textarea id="ta" rows="3" cols="10">a
b</textarea></p>
      <p><input id="sub" type="submit"><input id="rst" type="reset"></p>
      <input id="hid" type="hidden">
    </form>`);
  const box = (id) => doc.getElementById(id)._box;
  assert(Math.round(box('name').width) === 164 && Math.round(box('name').height) === 27,
    'form: metin girdisi size=20 olcusunde');
  assert(Math.round(box('cb').width) === 13 && Math.round(box('cb').height) === 13,
    'form: checkbox 13x13');
  assert(Math.round(box('r1').width) === 13 && Math.round(box('r1').height) === 13,
    'form: radio 13x13');
  assert(Math.round(box('ta').width) === 87 && Math.round(box('ta').height) === 69,
    'form: textarea cols/rows olcusunde');
  assert(box('hid') == null, 'form: hidden girdi kutu uretmez');
  assert(Math.round(box('sub').width) === 77 && Math.round(box('rst').width) === 84,
    'form: submit/reset varsayilan etiketleri olculur');

  const nameEl = doc.getElementById('name');
  nameEl.value = 'Murat';
  assert(nameEl.value === 'Murat', 'form: value setter okunur');
  const cbEl = doc.getElementById('cb');
  cbEl.checked = true;
  cbEl.disabled = true;
  assert(cbEl.hasAttribute('checked') && cbEl.hasAttribute('disabled'), 'form: checked/disabled nitelige yazar');
  assert(doc.getElementById('ta').value.includes('a'), 'form: textarea degeri icerikten gelir');
}

/* Flex icinde form kontrolleri intrinsic olculerini korur. */
{
  const { doc } = buildLayout(`<!doctype html><style>
    body { margin: 0; }
    .row { display: flex; align-items: center; gap: 8px; }
    .row input, .row button { flex-shrink: 0; }
  </style>
  <div class="row">
    <input id="fcb" type="checkbox">
    <input id="fsb" type="submit">
    <span>etiket</span>
  </div>`);
  assert(Math.round(doc.getElementById('fcb')._box.width) === 13, 'form: flex icinde checkbox 13px');
  assert(Math.round(doc.getElementById('fsb')._box.width) === 77, 'form: flex icinde submit etiket genisligi');
}

/* Tarayici benzeri etkilesim: label, radyo grubu, odak, submit, reset. */
{
  globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
  globalThis.cancelAnimationFrame = () => {};
  const drawn = [];
  const fakeCtx = () => ({
    setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {},
    fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, moveTo() {},
    lineTo() {}, arc() {}, stroke() {}, fill() {}, rect() {}, clip() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, ellipse() {}, setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fillText(text) { drawn.push(String(text)); },
    measureText(text) { return { width: String(text).length * 7 }; },
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left',
    textBaseline: 'alphabetic', globalAlpha: 1, letterSpacing: '0px',
  });
  const canvas = { width: 0, height: 0, style: {}, getContext: fakeCtx };
  const engine = new NarvisEngine(canvas, { width: 800, height: 600 });
  engine.load(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f">
      <label id="lab" for="cb" style="display: block; width: 140px">Onay</label>
      <input id="cb" type="checkbox">
      <input id="r1" type="radio" name="g" value="1">
      <input id="r2" type="radio" name="g" value="2" checked>
      <input id="txt" type="text" value="deger">
      <textarea id="ta" rows="2" cols="10">abc</textarea>
      <input id="sub" type="submit" value="Gönder">
      <input id="rst" type="reset" value="Sıfırla">
      <div id="empty" style="height: 40px"></div>
    </form>`, { url: 'test://form-engine' });
  const doc = engine.document;
  assert(drawn.includes('deger') && drawn.includes('abc') && drawn.includes('Gönder') && drawn.includes('Sıfırla'),
    'form: deger ve etiketler canvas metni olarak cizilir');
  const click = (id, dx = 3, dy = 3) => {
    const b = doc.getElementById(id)._box;
    engine.click(b.x + dx, b.y + dy);
  };
  click('lab');
  assert(doc.getElementById('cb').checked && doc.activeElement === doc.getElementById('cb'),
    'form: label tiklamasi checkbox isaretler ve odaklar');
  click('r1');
  assert(doc.getElementById('r1').checked && !doc.getElementById('r2').checked,
    'form: radyo grubunda tek secim');
  click('txt', 10, 10);
  assert(doc.activeElement === doc.getElementById('txt'), 'form: metin kutusu odaklanir');
  click('empty', 10, 10);
  assert(doc.activeElement === doc.body, 'form: disari tiklama odagi birakir');

  let submits = 0;
  doc.getElementById('f').addEventListener('submit', () => { submits += 1; });
  click('sub');
  assert(submits === 1, 'form: submit olayi yayilir');

  doc.getElementById('txt').value = 'yeni';
  doc.getElementById('cb').checked = true;
  click('rst');
  assert(doc.getElementById('txt').value === 'deger' && !doc.getElementById('cb').checked,
    'form: reset deger ve isareti ilk duruma dondurur');
}

/* ------------------------------------------------------------------ *
 * Klavye, select listesi, dogrulama ve ag uzerinden form gonderimi
 * ------------------------------------------------------------------ */

function makeEngineHarness(html, options = {}) {
  globalThis.requestAnimationFrame = (fn) => { fn(0); return 0; };
  globalThis.cancelAnimationFrame = () => {};
  const drawn = [];
  const fakeCtx = () => ({
    setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {},
    fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, moveTo() {},
    lineTo() {}, arc() {}, stroke() {}, fill() {}, rect() {}, clip() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, ellipse() {}, setLineDash() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fillText(text) { drawn.push(String(text)); },
    measureText(text) { return { width: String(text).length * 7 }; },
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left',
    textBaseline: 'alphabetic', globalAlpha: 1, letterSpacing: '0px',
    shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
  });
  const canvas = { width: 0, height: 0, style: {}, getContext: fakeCtx };
  const engine = new NarvisEngine(canvas, { width: 800, height: 600, ...options });
  engine.load(html, { url: 'test://form-engine' });
  return { engine, drawn };
}

/* select API'si + olculer. */
{
  const { doc } = buildLayout(`<!doctype html><style>body { margin: 0; }</style>
    <select id="s">
      <option value="a">Kısa</option>
      <option value="b" selected>Daha uzun seçenek</option>
      <option value="c">Orta</option>
    </select>`);
  const select = doc.getElementById('s');
  assert(select.options.length === 3, 'select: options listesi option ogelerini verir');
  assert(select.length === 3, 'select: length option sayisidir');
  assert(select.selectedIndex === 1 && select.value === 'b',
    'select: selected option niteliginden ilk secim gelir');
  assert(select.selectedOptions.length === 1 && select.selectedOptions[0].value === 'b',
    'select: selectedOptions tek secimi dondurur');
  select.selectedIndex = 2;
  assert(select.value === 'c', 'select: selectedIndex degeri gunceller');
  select.value = 'a';
  assert(select.selectedIndex === 0, 'select: value setter option degerini bulur');
  select.options[2].selected = true;
  assert(select.value === 'c', 'option: selected=true select secimini degistirir');
  assert(select._box.width > 52, 'select: intrinsic genislik en uzun option etiketini kapsar');
}

/* Klavye ile metin, silme, secim, Tab, metin alani ve checkbox. */
{
  const { engine, drawn } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f" action="/gonder" method="post">
      <input id="name" name="ad" type="text" required minlength="2">
      <input id="mail" name="eposta" type="email">
      <select id="sel" name="konu" required>
        <option value="">Seç…</option>
        <option value="a">Alfa</option>
        <option value="b">Beta</option>
      </select>
      <textarea id="ta" name="mesaj" rows="2" cols="12"></textarea>
      <input id="cb" name="onay" type="checkbox" value="evet">
      <input id="sub" type="submit" value="Gönder">
    </form>`);
  const doc = engine.document;
  const name = doc.getElementById('name');
  const mail = doc.getElementById('mail');
  const select = doc.getElementById('sel');
  const textarea = doc.getElementById('ta');
  const checkbox = doc.getElementById('cb');
  const form = doc.getElementById('f');
  const submit = doc.getElementById('sub');

  const box = name._box;
  engine.click(box.x + 6, box.y + 6);
  assert(doc.activeElement === name, 'klavye: metin kutusu tiklamayla odaklanir');
  for (const key of ['M', 'u', 'r', 'a', 't']) engine.handleKeyDown({ key });
  assert(name.value === 'Murat', 'klavye: harfler metin kutusuna yazilir');
  assert(name.selectionStart === 5 && name.selectionEnd === 5, 'klavye: imlec yazilan metnin sonundadir');

  engine.handleKeyDown({ key: 'Backspace' });
  assert(name.value === 'Mura', 'klavye: Backspace son karakteri siler');
  name.setSelectionRange(0, 2);
  engine.handleKeyDown({ key: 'Backspace' });
  assert(name.value === 'ra', 'klavye: secili aralik tek Backspace ile silinir');
  name.value = 'Murat';
  name.focus();
  engine.handleKeyDown({ key: 'a', ctrlKey: true });
  assert(name.selectionStart === 0 && name.selectionEnd === 5, 'klavye: Ctrl+A tum metni secer');
  engine.handleKeyDown({ key: 'Z' });
  assert(name.value === 'Z', 'klavye: secim uzerine yazma metni degistirir');

  name.focus();
  engine.handleKeyDown({ key: 'ArrowLeft', shiftKey: true });
  assert(name.selectionStart === 0 && name.selectionEnd === 1,
    'klavye: Shift+Ok secimi imlecin soluna dogru genisletir');
  engine.handleKeyDown({ key: 'Tab' });
  assert(doc.activeElement === mail, 'klavye: Tab bir sonraki kontrole gecer');
  engine.handleKeyDown({ key: 'Tab', shiftKey: true });
  assert(doc.activeElement === name, 'klavye: Shift+Tab onceki kontrole doner');

  textarea.focus();
  engine.handleKeyDown({ key: 'Enter' });
  engine.handleKeyDown({ key: 'a' });
  assert(textarea.value === '\na', 'klavye: textarea Enter ile yeni satir alir');
  textarea.setSelectionRange(0, 0);
  engine.handleKeyDown({ key: 'ArrowDown' });
  assert(textarea.selectionStart === 1, 'klavye: textarea asagi ok sonraki satira gecer');

  checkbox.focus();
  engine.handleKeyDown({ key: ' ' });
  assert(checkbox.checked, 'klavye: Space checkbox isaretini degistirir');

  assert(drawn.includes('Gönder'), 'boya: form dugmesi etiketi cizilir');
}

/* Select listesi: acma, vurgu, tikla secme, klavye secme, cizim. */
{
  const { engine, drawn } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f"><select id="sel" name="konu">
      <option value="">Seç…</option>
      <option value="a">Alfa</option>
      <option value="b">Beta</option>
      <option value="c" disabled>Pasif</option>
    </select></form>`);
  const doc = engine.document;
  const select = doc.getElementById('sel');
  let changes = 0;
  select.addEventListener('change', () => { changes += 1; });

  select.focus();
  engine.handleKeyDown({ key: ' ' });
  assert(engine.selectPopup && engine.selectPopup.items.length === 4,
    'select: Space listeyi acar');
  const popup = engine.selectPopup;
  engine.paintNow();
  assert(drawn.includes('Alfa') && drawn.includes('Beta') && drawn.includes('Pasif'),
    'select: acik liste tum option etiketlerini cizer');
  const hit = engine.selectPopupHit(popup.x + 12, popup.y + popup.padding + popup.rowHeight * 1.5);
  assert(hit.index === 1 && hit.item.label === 'Alfa', 'select: liste satiri tiklamayla eslesir');
  engine.click(popup.x + 12, popup.y + popup.padding + popup.rowHeight * 1.5);
  assert(!engine.selectPopup && select.value === 'a', 'select: option tiklamasi secimi uygular');
  assert(changes >= 1, 'select: secim change olayi yayar');

  select.focus();
  engine.handleKeyDown({ key: ' ' });
  engine.handleKeyDown({ key: 'ArrowDown' });
  assert(engine.selectPopup.activeIndex === 2, 'select: oklar vurguyu pasif optioni atlayarak tasir');
  engine.handleKeyDown({ key: 'Enter' });
  assert(select.value === 'b', 'select: Enter vurgulanan optionu secer');
  assert(!engine.selectPopup, 'select: secimden sonra liste kapanir');

  engine.handleKeyDown({ key: 'ArrowUp' });
  assert(select.value === 'a', 'select: kapali listede ok tusu secimi degistirir');
}

/* select[multiple]: yerinde liste — olculer, tik/kombinasyon, klavye ve form verisi. */
{
  const { engine } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f"><select id="m" name="konular" multiple size="4">
      <option value="a">Alfa</option>
      <option value="b" selected>Beta</option>
      <option value="c">Gama</option>
      <option value="d">Delta</option>
      <option value="e" disabled>Pasif</option>
      <option value="f">Epsilon</option>
    </select></form>`);
  const doc = engine.document;
  const select = doc.getElementById('m');
  const rowH = multiSelectRowHeight(select); /* UA satiri: fontSize * 1.4 */
  const rows = multiSelectRows(select);

  assert(rows === 4, 'multiple: size niteligi 4 satir sayisini verir');
  assert(Math.abs(select._box.contentHeight - 4 * rowH) < 0.5,
    'multiple: icerik yuksekligi size niteligi kadar satirdir');
  assert(selectedOptionIndexes(select).join(',') === '1',
    'multiple: baslangic secimi selected niteliginden gelir');

  let changes = 0;
  let inputs = 0;
  select.addEventListener('change', () => { changes += 1; });
  select.addEventListener('input', () => { inputs += 1; });

  /* Tiklamalar motor click hattindan: point {x,y,ctrlKey,shiftKey}. */
  const b = select._box;
  const rowX = b.contentX + 12;
  const rowY = (row) => b.contentY + row * rowH + rowH / 2;

  engine.click(rowX, rowY(2));
  assert(selectedOptionIndexes(select).join(',') === '2' && select._multiFocus === 2,
    'multiple: tiklama o satiri tek basina secer ve odaklar');
  assert(changes === 1 && inputs === 1, 'multiple: tiklama input+change yayar');

  /* API: value ve selectedIndex tek option secer. */
  select.value = 'a';
  assert(selectedOptionIndexes(select).join(',') === '0',
    'multiple: value setter yalniz eslesen optioni secer');
  select.selectedIndex = 2;
  assert(selectedOptionIndexes(select).join(',') === '2',
    'multiple: selectedIndex setter tek option secer');

  engine.click(rowX, rowY(0), { ctrlKey: true });
  assert(selectedOptionIndexes(select).join(',') === '0,2',
    'multiple: Ctrl+tik mevcut secime ekler');

  engine.click(rowX, rowY(3), { shiftKey: true });
  assert(selectedOptionIndexes(select).join(',') === '0,1,2,3',
    'multiple: Shift+tik son tik kelimesinden aralik secer');

  /* End: son satira odak + liste kaydirma. */
  engine.handleKeyDown({ key: 'End' });
  assert(selectedOptionIndexes(select).join(',') === '5' && select._multiScroll === 2,
    'multiple: End son satiri secer ve listeyi kaydirir');

  /* Kaydirma sonrasi gorunen pasif satira tiklama secimi degistirmez. */
  engine.click(rowX, rowY(2));
  assert(selectedOptionIndexes(select).join(',') === '5',
    'multiple: pasif satira tiklama secimi degistirmez');

  /* Form sifirlama, selected niteligindeki baslangic secimini geri getirir. */
  engine.resetForm(doc.getElementById('f'));
  assert(selectedOptionIndexes(select).join(',') === '1',
    'multiple: form sifirlama nitelikteki baslangic secimini geri getirir');
}

/* select[multiple] klavye: oklar tek secim, Ctrl+ok yalniz odak, Space toggle, Shift+ok aralik. */
{
  const { engine } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f"><select id="m" name="konular" multiple size="4">
      <option value="a" selected>Alfa</option>
      <option value="b">Beta</option>
      <option value="c" disabled>Pasif</option>
      <option value="d">Gama</option>
      <option value="e">Delta</option>
    </select></form>`);
  const doc = engine.document;
  const select = doc.getElementById('m');
  let changes = 0;
  select.addEventListener('change', () => { changes += 1; });

  select.focus();
  assert(select._multiFocus === 0, 'multiple klavye: odak ilk secili satirda kurulur');

  engine.handleKeyDown({ key: 'ArrowDown' });
  assert(selectedOptionIndexes(select).join(',') === '1' && select._multiFocus === 1,
    'multiple klavye: asagi ok odaqla birlikte tek satir secimini tasir');

  engine.handleKeyDown({ key: 'ArrowDown', ctrlKey: true });
  assert(select._multiFocus === 3, 'multiple klavye: Ctrl+ok pasif satiri atlayarak odagi tasir');
  assert(selectedOptionIndexes(select).join(',') === '1',
    'multiple klavye: Ctrl+ok secimi degistirmez');
  engine.handleKeyDown({ key: 'ArrowDown', ctrlKey: true });
  assert(select._multiFocus === 4 && selectedOptionIndexes(select).join(',') === '1',
    'multiple klavye: Ctrl+ok gidip pasif yolu atlar');

  engine.handleKeyDown({ key: ' ' });
  assert(selectedOptionIndexes(select).join(',') === '1,4',
    'multiple klavye: Space odak satirini toggle eder');
  engine.handleKeyDown({ key: ' ' });
  assert(selectedOptionIndexes(select).join(',') === '1',
    'multiple klavye: ikinci Space toggle kapatir');

  engine.handleKeyDown({ key: 'ArrowUp', shiftKey: true });
  assert(selectedOptionIndexes(select).join(',') === '3,4',
    'multiple klavye: Shift+ok cipadan araligi genisletir (pasif atlama)');
  engine.handleKeyDown({ key: 'ArrowUp', shiftKey: true });
  assert(selectedOptionIndexes(select).join(',') === '1,3,4',
    'multiple klavye: ikinci Shift+ok araligi Alfa'+"'ya uzatir");

  engine.handleKeyDown({ key: 'Home' });
  assert(selectedOptionIndexes(select).join(',') === '0',
    'multiple klavye: Home odak tek secime donusur');
  changes = 0;
  engine.handleKeyDown({ key: 'ArrowUp' });
  assert(select._multiFocus === 0 && changes === 0,
    'multiple klavye: sonda ok tusu degismiyorsa change yamaz');

  engine.handleKeyDown({ key: 'g' });
  assert(select._multiFocus === 3 && selectedOptionIndexes(select).join(',') === '3',
    'multiple klavye: yazarak odak eslesen satira tasir ve secimi gunceller');
}

/* select[multiple] form verisi ve dogrulama. */
{
  const { engine } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f" action="/gonder" method="get">
      <select id="m" name="konular" multiple required>
        <option value="a">Alfa</option>
        <option value="b">Beta</option>
      </select>
      <input type="submit" value="G" id="go">
    </form>`);
  const doc = engine.document;
  const select = doc.getElementById('m');
  const form = doc.getElementById('f');

  assert(form.checkValidity() === false, 'multiple dogrulama: bos coklu select gecersiz');
  select.options[0].selected = true;
  select.options[1].selected = true;
  const pairs = collectFormData(form);
  assert(pairs.some(([n, v]) => n === 'konular' && v === 'a')
    && pairs.some(([n, v]) => n === 'konular' && v === 'b'),
    'multiple form verisi: her secili option bir [ad, deger] ciftidir');
  assert(form.checkValidity() === true, 'multiple dogrulama: secim sonrasi gecerli');
}

/* Dogrulama, ozel mesaj ve form gonderim istegi (GET/POST). */
{
  const calls = [];
  let responseSeen = null;
  const { engine } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f" action="/gonder" method="post">
      <input id="name" name="ad" type="text" required minlength="2">
      <input id="mail" name="eposta" type="email" required>
      <select id="sel" name="konu" required>
        <option value="">Seç…</option>
        <option value="a">Alfa</option>
        <option value="b">Beta</option>
      </select>
      <textarea id="ta" name="mesaj" rows="2" cols="12"></textarea>
      <input id="cb" name="onay" type="checkbox" value="evet">
      <input id="sub" type="submit" value="Gönder">
    </form>`, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        url,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<!doctype html><body><p>sunucu yaniti</p></body>',
      };
    },
  });
  const doc = engine.document;
  const form = doc.getElementById('f');
  const name = doc.getElementById('name');
  const mail = doc.getElementById('mail');
  const select = doc.getElementById('sel');
  const textarea = doc.getElementById('ta');
  const checkbox = doc.getElementById('cb');
  const submit = doc.getElementById('sub');
  engine.onFormResponse = async (result) => { responseSeen = result; };

  name.value = '';
  mail.value = '';
  select.selectedIndex = 0;
  let result = await engine.submitForm(form, submit);
  assert(result.submitted === false && result.invalid === name,
    'dogrulama: bos zorunlu alan gonderimi durdurur');
  assert(engine.validation?.el === name && engine.validation.message.includes('doldurun'),
    'dogrulama: ilk gecersiz alan ve Turkce mesaj gosterilir');

  name.value = 'Murat';
  mail.value = 'gecersiz';
  result = await engine.submitForm(form, submit);
  assert(result.submitted === false && result.invalid === mail,
    'dogrulama: gecersiz e-posta gonderimi durdurur');
  assert(mail.validationMessage.includes('e-posta'), 'dogrulama: e-posta mesaji uretilir');
  assert(calls.length === 0, 'dogrulama: gecersiz form aga cikmaz');

  mail.setCustomValidity('Bu adres kullanılamaz.');
  assert(!mail.checkValidity() && mail.validationMessage === 'Bu adres kullanılamaz.',
    'dogrulama: setCustomValidity mesaji gecersiz kilar');
  mail.setCustomValidity('');

  name.value = 'Murat';
  mail.value = 'murat@example.com';
  select.value = 'b';
  textarea.value = 'merhaba';
  checkbox.checked = true;
  result = await engine.submitForm(form, submit);
  assert(result.submitted === true && result.status === 200,
    'ag: gecerli form fetch ile gonderilir');
  assert(calls.length === 1 && calls[0].init.method === 'POST',
    'ag: varsayilan yontem POST olarak kurulur');
  assert(calls[0].url.endsWith('/gonder'), 'ag: action adresi cozulur');
  assert(String(calls[0].init.body).includes('ad=Murat')
    && String(calls[0].init.body).includes('eposta=murat%40example.com')
    && String(calls[0].init.body).includes('konu=b')
    && String(calls[0].init.body).includes('onay=evet'),
    'ag: urlencoded govde tum basarili alanlari tasir');
  assert(responseSeen?.html.includes('sunucu yaniti'), 'ag: yanit HTML geri cagriya ulasir');

  form.setAttribute('method', 'get');
  result = await engine.submitForm(form, submit);
  assert(result.submitted === true && calls.length === 2 && calls[1].init.method === 'GET',
    'ag: method=get GET istegi uretir');
  assert(calls[1].url.includes('?ad=Murat') && calls[1].url.includes('konu=b'),
    'ag: GET verisi sorgu dizesine yazilir');
  form.setAttribute('method', 'post');

  select.selectedIndex = 2;
  checkbox.checked = true;
  form.reset();
  assert(select.selectedIndex === 0, 'form: reset select secimini ilk optiona dondurur');
  assert(!checkbox.checked, 'form: reset checkbox isaretini temizler');
  assert(name.value === '', 'form: reset metin degerini temizler');
}

/* Yapistirma normalizasyonu, odak ve gizleme etkilesimi. */
{
  const { engine } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f">
      <input id="name" name="ad" type="text">
      <textarea id="ta" name="mesaj" rows="2" cols="12"></textarea>
      <select id="sel" name="konu">
        <option value="">Seç…</option>
        <option value="a">Alfa</option>
        <option value="b">Beta</option>
      </select>
    </form>`);
  const doc = engine.document;
  const name = doc.getElementById('name');
  const textarea = doc.getElementById('ta');
  const select = doc.getElementById('sel');

  name.focus();
  engine.insertClipboardText('bir\r\niki\nüç');
  assert(name.value === 'bir iki üç', 'yapistirma: tek satirli kontrollerde satir sonlari bosluga doner');

  textarea.focus();
  engine.insertClipboardText('a\r\nb');
  assert(textarea.value === 'a\nb', 'yapistirma: textarea satir sonlarini korur');

  engine.showValidation(name, 'Bu alan zorunlu.');
  engine.insertText(name, 'm');
  assert(engine.validation === null && name.value === 'bir iki üçm',
    'yapistirma: yazarken dogrulama balonu gizlenir');
}

/* Fare secimi (surukleme + cift tik) ve geri al/yinele. */
{
  const { engine } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <form id="f">
      <input id="name" name="ad" type="text">
      <textarea id="ta" name="mesaj" rows="2" cols="14"></textarea>
    </form>`);
  const doc = engine.document;
  const name = doc.getElementById('name');
  const textarea = doc.getElementById('ta');

  /* Geri al / yinele zinciri. */
  name.focus();
  engine.insertText(name, 'abc');
  engine.insertText(name, 'def');
  assert(name.value === 'abcdef', 'duzenleme: ekleme kaydi tutulur');
  engine.handleKeyDown({ key: 'z', ctrlKey: true });
  assert(name.value === 'abc', 'duzenleme: Ctrl+Z son ekmeyi geri alir');
  engine.handleKeyDown({ key: 'z', ctrlKey: true });
  assert(name.value === '', 'duzenleme: ikinci Ctrl+Z bos duruma doner');
  engine.handleKeyDown({ key: 'y', ctrlKey: true });
  assert(name.value === 'abc' && name.selectionStart === 3,
    'duzenleme: Ctrl+Y degisikligi yeniden uygular');
  engine.handleKeyDown({ key: 'y', ctrlKey: true });
  assert(name.value === 'abcdef', 'duzenleme: yineleme tum zinciri kurtarir');
  engine.handleKeyDown({ key: 'z', ctrlKey: true });
  engine.handleKeyDown({ key: 'Z', shiftKey: true, ctrlKey: true });
  assert(name.value === 'abcdef', 'duzenleme: Ctrl+Shift+Z yineleme yapar');

  /* Cift tikla kelime secimi: input. */
  name.value = 'merhaba dunya';
  const box = name._box;
  const cx = box.contentX;
  const wordX = cx + 31; /* 'merhaba' kelimesinin ici */
  engine._lastClick = null;
  engine.pointerDown(wordX, box.y + 8);
  engine.pointerUp(wordX, box.y + 8);
  engine.pointerDown(wordX, box.y + 8);
  engine.pointerUp(wordX, box.y + 8);
  assert(name.selectionStart === 0 && name.selectionEnd === 7,
    'fare: cift tik kelimeyi secer');

  /* Surukleme secimi. */
  const dragEnd = cx + 100;
  engine.pointerDown(cx + 2, box.y + 8);
  engine.pointerMove(dragEnd, box.y + 8);
  engine.pointerUp(dragEnd, box.y + 8);
  assert(name.selectionStart === 0 && name.selectionEnd >= 10,
    'fare: surukleme secim araligi olusturur');
  /* Sürüklemeden sonra gelen click sekimi ezmez. */
  engine.click(wordX, box.y + 8);
  assert(name.selectionStart === 0 && name.selectionEnd >= 10,
    'fare: suruklemeden sonra gelen click secimi ezmez');

  /* Yeni tek tik secimi imlece daraltilir. */
  engine.pointerDown(wordX, box.y + 8);
  engine.pointerUp(wordX, box.y + 8);
  engine.click(wordX, box.y + 8);
  assert(name.selectionStart === name.selectionEnd,
    'fare: tek tik secimi imlece daraltilir');

  /* Textarea'da cift tik kelime secimi satir sinirli. */
  textarea.value = 'bir satir\nikinci';
  const tb = textarea._box;
  engine._lastClick = null;
  engine.pointerDown(tb.contentX + 53, tb.y + 10);
  engine.pointerUp(tb.contentX + 53, tb.y + 10);
  engine.pointerDown(tb.contentX + 53, tb.y + 10);
  engine.pointerUp(tb.contentX + 53, tb.y + 10);
  assert(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) === 'satir',
    'fare: textarea cift tigi ayni satirdaki kelimeyi secer');
}

/* Kaydirma ve ozel tuslar select listesini kapatir. */
{
  const { engine } = makeEngineHarness(`<!doctype html><style>body { margin: 0; }</style>
    <select id="sel">
      <option value="a">Alfa</option>
      <option value="b">Beta</option>
    </select>`);
  const doc = engine.document;
  const select = doc.getElementById('sel');

  select.focus();
  engine.handleKeyDown({ key: ' ' });
  assert(!!engine.selectPopup, 'kaydirma: liste acikken test baslangici gecerli');
  engine.handleKeyDown({ key: 'Escape' });
  assert(!engine.selectPopup, 'klavye: Escape acik listeyi kapatir');

  engine.handleKeyDown({ key: ' ' });
  engine.scrollTo({ top: 3 });
  assert(!engine.selectPopup, 'kaydirma: sayfa kaydirilinca liste kapanir');
}

if (failures > 0) {
  console.error(`\n${failures} test başarısız.`);
  process.exitCode = 1;
} else if (process.exitCode) {
  console.error('\nÖnceki duman testlerinde başarısız kontroller var.');
} else {
  console.log('\nTüm testler geçti.');
}
