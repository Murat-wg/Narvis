import { parseDocument } from '../src/html/parser.js';
import { computeStyles } from '../src/style.js';
import { parseDeclarations } from '../src/css/parser.js';

console.log(parseDeclarations('flex: 1; flex: 2').map((d) => d.prop + '=' + d.value));
const doc = parseDocument(`<html><head><style>
.cards{display:flex;gap:12px}
.card{flex:1;padding:16px;border:1px solid #ddd}
.wide{flex:2}
</style></head><body><div class="cards"><div class="card">A</div><div class="card wide">B</div></div></body></html>`);
const s = computeStyles(doc, { width: 1000, height: 700 });
for (const el of doc.querySelectorAll('.card')) {
  const c = s.get(el);
  console.log(el.className, { grow: c.flexGrow, shrink: c.flexShrink, basis: c.flexBasis, padding: c.paddingLeft, border: c.borderLeftWidth });
}
