import { parseDocument } from '../src/html/parser.js';
import { computeStyles } from '../src/style.js';

const html = `<!doctype html>
<html><head><title>Test</title>
<style>
  body { margin: 0; font-family: Arial; }
  .card { padding: 10px 20px; border: 2px solid #ff0000; width: 300px; border-radius: 8px; }
  .card h2 { color: rgb(0, 128, 255); font-size: 24px; }
  #x { display: none; }
  a { color: #123456; }
</style></head>
<body>
  <div class="card" id="c" style="background-color: #fafafa">
    <h2>Merhaba</h2>
    <p>Bu bir <a href="#">baglanti</a> ve <strong>kalin</strong> metin.</p>
    <span style="margin-left: 4px">span</span>
  </div>
</body></html>`;

const doc = parseDocument(html);
const styles = computeStyles(doc, { width: 800, height: 600 });
const card = doc.querySelector('.card');
console.log('title:', doc.title);
console.log('body fontSize:', styles.get(doc.body).fontSize);
const cs = styles.get(card);
console.log('card:', {
  display: cs.display, width: cs.width, padding: [cs.paddingTop, cs.paddingRight],
  border: [cs.borderTopWidth, cs.borderTopStyle, cs.borderTopColor],
  radius: cs.borderTopLeftRadius, bg: cs.backgroundColor,
});
console.log('h2:', styles.get(card.querySelector('h2')).fontSize, styles.get(card.querySelector('h2')).color);
console.log('link:', styles.get(doc.querySelector('a')).color, styles.get(doc.querySelector('a')).textDecorationLine);
console.log('p:', doc.querySelectorAll('p').length, 'li:');
