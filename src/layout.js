// Narvis layout motoru: blok, satir ici (inline), flex, konumlandirma ve
// dokuman yuksekligi. Koordinatlar sayfa uzayindadir (scroll haric).

import { clamp } from './util.js';
import { fontString } from './font.js';
import { controlLabel, multiSelectRows, multiSelectRowHeight } from './form.js';

const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const isPct = (v) => v && typeof v === 'object' && 'pct' in v;

function resolvePct(v, basis) {
  if (typeof v === 'number') return v;
  if (isPct(v)) return basis == null ? null : (basis * v.pct) / 100;
  return null;
}

function isOutOfFlow(box) {
  return box.style.position === 'absolute' || box.style.position === 'fixed';
}

function isPre(style) {
  return style.whiteSpace === 'pre' || style.whiteSpace === 'pre-wrap' || style.whiteSpace === 'pre-line';
}

/* Kute duzeyinde float tespiti. Yalnizca GERCEK eleman kutulari sayilir:
   metin ve anonim kutular ust tarafnin stilini kopyalar, kotu etkilenmesin diye
   el.nodeType === 1 sarti konur. */
function isFloatBox(box) {
  if (!box || !box.el || box.el.nodeType !== 1) return false;
  return box.style.float === 'left' || box.style.float === 'right';
}

/* Yeni yuzme bolgesi (BFC) kuran kutular: flex/grid, inline-block/image,
   tasan overflow ve float kutularin kendileri. */
function establishesRegion(box) {
  if (box.isFlex || box.isGrid) return true;
  if (box.isTable) return true;
  if (box.kind === 'inline-block' || box.kind === 'image') return true;
  if (isFloatBox(box)) return true;
  if ((box.style.overflowX && box.style.overflowX !== 'visible') ||
      (box.style.overflowY && box.style.overflowY !== 'visible')) return true;
  return false;
}

/* Yuzen kutularin margin-box dikdortgen kaydi. Koordinatlar BFC tabaninin
   (anchor) icerik kutusuna goredir. Icerik: lineOffsets (satir kesimleri),
   insetsAt (genislik hesabi), clearBottom (clear: destegi) ve place
   (96 denemeli yigin yerlesim algoritmasi). */
class FloatRegion {
  constructor(anchor) {
    this.anchor = anchor;
    this.floats = []; // { box, side, top, bottom, left, right, width, height }
  }

  hasFloats() {
    return this.floats.length > 0;
  }

  /* Dikey araliga dokunan yuzenlerin insetleri: sol inset ve anchorun
     sag kenarindan (sag yuzenler icin) inset olarak doner. */
  lineOffsets(relTop, relHeight) {
    const anchorW = Math.max(0, this.anchor.contentWidth || 0);
    let left = 0;
    let right = 0;
    for (const f of this.floats) {
      if (f.bottom <= relTop + 0.01 || f.top >= relTop + relHeight - 0.01) continue;
      if (f.side === 'left') left = Math.max(left, f.right);
      else right = Math.max(right, anchorW - f.left);
    }
    return { left, right };
  }

  /* Dikey icerik bolgesi: float'larin yatay serbest bandi (anchor uzayinda). */
  cbBand(cbBox) {
    const anchorW = Math.max(0, this.anchor.contentWidth || 0);
    const left = Math.max(0, Math.min((cbBox?.contentX ?? this.anchor.contentX) - this.anchor.contentX, anchorW));
    const span = Math.max(0, Math.min(cbBox?.contentWidth ?? anchorW, anchorW - left));
    return { left, span, right: left + span };
  }

  /* relTop duzleminde ayni anda gecerli insetler (satir yuksekligi bilinmedigi
     durumda yuzen genisligini hesaplarken kullanilir). */
  insetsAt(relTop) {
    return this.lineOffsets(relTop, 0.01);
  }

  /* clear: left / right / both -> yuzenlerin en derin alt kenarlik. */
  clearBottom(side) {
    let bottom = 0;
    for (const f of this.floats) {
      if (side === 'both' || f.side === side) bottom = Math.max(bottom, f.bottom);
    }
    return bottom;
  }

  bottom() {
    let bottom = 0;
    for (const f of this.floats) bottom = Math.max(bottom, f.bottom);
    return bottom;
  }

  /* CSS kural 1-5'in sade modeli, icerik blogu bandinda: sol yuzenler
     onceki sol yuzenlerin sagina dizer; sag yuzenler aynali; karsit tarafin
     bandi kapatirsa ve yer yoksa bloke eden yuzenin altina iner. Taralama
     96 denemeyle sinirlidir. */
  place(relTop, width, height, side, band) {
    const anchorW = Math.max(0, this.anchor.contentWidth || 0);
    const b = band ?? { left: 0, right: anchorW };
    const EPS = 0.01;
    let top = Math.max(0, Math.max(relTop, this._maxTopCoordinate()));
    let guard = 0;
    while (guard++ < 96) {
      let left = b.left;
      let right = b.right;
      let blocked = null;
      for (const f of this.floats) {
        if (f.bottom <= top + EPS || f.top >= top + height - EPS) continue;
        if (side === 'left') {
          if (f.side === 'left') {
            if (f.right > left && f.left < right - EPS) {
              left = f.right;
              if (left + width > right + EPS) { blocked = f; break; }
            }
          } else if (left + width > f.left + EPS) {
            blocked = f;
            break;
          }
        } else if (f.side === 'right') {
          if (f.left < right - EPS && f.right > left + EPS) {
            right = f.left;
            if (right - width < left - EPS) { blocked = f; break; }
          }
        } else if (right - width < f.right - EPS) {
          blocked = f;
          break;
        }
      }
      if (!blocked) {
        return side === 'left' ? { top, left, right: left + width } : { top, left: right - width, right };
      }
      // yeterli yer yok: bloke eden yuzenin alt kenarina in
      top = Math.max(top, blocked.bottom);
    }
    // sonum (sinir asimi): banda sikistir, tasmaya izin ver
    return side === 'left'
      ? { top, left: b.left, right: b.left + width }
      : { top, left: Math.max(b.left, b.right - width), right: b.right };
  }

  _maxTopCoordinate() {
    let m = 0;
    for (const f of this.floats) m = Math.max(m, f.top);
    return m;
  }

  /* Bolgede kayit: place() sonrasi rectangle. Donen degerle cagiran,
     kutuyu nihai sayfa konumuna shiftSubtree ile tasir. */
  registerFloat(floatBox, relTop, band) {
    const side = floatBox.style.float === 'right' ? 'right' : 'left';
    const width = floatBox.width + num(floatBox.margin.left) + num(floatBox.margin.right);
    const height = floatBox.height + num(floatBox.margin.top) + num(floatBox.margin.bottom);
    const spot = this.place(Math.max(0, relTop), width, Math.max(1e-6, height), side, band);
    const entry = {
      box: floatBox, side, width, height,
      top: spot.top, bottom: spot.top + height,
      left: spot.left, right: spot.right,
    };
    this.floats.push(entry);
    return entry;
  }
}

function makeBox(kind, el, style) {
  return {
    kind,
    el,
    style,
    parentBox: null,
    inlineLevel: kind === 'text' || kind === 'inline' || kind === 'inline-block' || kind === 'image',
    isFlex: false,
    isGrid: false,
    isTable: false,
    isTableRow: false,
    isRowGroup: false,
    isCell: false,
    isCaption: false,
    isFormControl: false,
    formKind: null,
    x: 0, y: 0, width: 0, height: 0,
    contentX: 0, contentY: 0, contentWidth: 0, contentHeight: 0,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    border: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: [0, 0, 0, 0],
    children: [],
    lineBoxes: [],
    _segments: null,
    _fragments: null,
    text: '',
    listIndex: 0,
    fixed: false,
    absolute: false,
  };
}

class LayoutEngine {
  constructor({ viewport, measureText, getImage }) {
    this.width = Math.max(1, viewport?.width ?? 800);
    this.height = Math.max(1, viewport?.height ?? 600);
    this.viewport = { width: this.width, height: this.height };
    this.measureTextFn = measureText ?? ((text) => text.length * 8);
    this.getImage = getImage ?? (() => null);
    this.measureCache = new Map();
    this.boxes = [];
    this.sticky = [];
  }

  measure(text, style) {
    if (!text) return 0;
    const key = fontString(style) + '\u0000' + (style.letterSpacing ?? 0) + '\u0000' + text;
    let value = this.measureCache.get(key);
    if (value == null) {
      value = this.measureTextFn(text, style, fontString(style));
      this.measureCache.set(key, value);
    }
    return value;
  }

  run(document) {
    const rootEl = document.documentElement;
    const rootBox = this.buildElement(rootEl, null);
    if (!rootBox) throw new Error('Narvis: kok eleman icin kutu uretilemedi');
    document._box = rootBox;
    this.root = rootBox;
    this.resolveEdges(rootBox, this.width);
    this.layoutBlock(rootBox, 0, num(rootBox.margin.top), this.width, this.height, {});
    this.resolveRelative(rootBox);
    this.resolveAbsolutes(rootBox, null);
    this.finishSegments(rootBox);
    this.finalizeOverflow(rootBox);
    this.collectSticky(rootBox);
    const height = this.documentHeight(rootBox);
    return {
      root: rootBox,
      document,
      viewport: this.viewport,
      width: this.width,
      height,
      boxes: this.boxes,
      sticky: this.sticky,
      shiftSubtree: (box, dx, dy) => this.shiftSubtree(box, dx, dy),
    };
  }

  /* ------------------------------------------------------------------ *
   * Kutu agaci
   * ------------------------------------------------------------------ */

  buildElement(el, parentBox) {
    const style = el._style;
    if (!style || style.display === 'none') return null;

    let kind;
    const display = style.display;
    if (el.localName === 'img') kind = 'image';
    else if (display === 'inline') kind = 'inline';
    else if (display === 'inline-block') kind = 'inline-block';
    else if (display === 'flex') kind = 'block';
    else if (display === 'inline-flex') kind = 'inline-block';
    else if (display === 'grid') kind = 'block';
    else if (display === 'inline-grid') kind = 'inline-block';
    else if (display === 'inline-table') kind = 'inline-block';
    else if (display === 'list-item') kind = 'list-item';
    else if (display === 'none') return null;
    else kind = 'block';

    const box = makeBox(kind, el, style);
    box.isFlex = display === 'flex' || display === 'inline-flex';
    box.isGrid = display === 'grid' || display === 'inline-grid';
    box.isTable = display === 'table' || display === 'inline-table';
    box.isTableRow = display === 'table-row';
    box.isRowGroup = display === 'table-row-group' || display === 'table-header-group' || display === 'table-footer-group';
    box.isCell = display === 'table-cell';
    box.isCaption = display === 'table-caption';
    /* Form kontrol tanimi: input/button/textarea/select kunye bicimi. */
    if (el.localName === 'input' || el.localName === 'button' || el.localName === 'textarea' || el.localName === 'select') {
      box.isFormControl = true;
      const type = String(el.getAttribute('type') || 'text').toLowerCase();
      if (el.localName === 'select') box.formKind = 'select';
      else if (el.localName === 'button') box.formKind = 'button';
      else if (type === 'checkbox') box.formKind = 'checkbox';
      else if (type === 'radio') box.formKind = 'radio';
      else if (el.localName === 'textarea') box.formKind = 'textarea';
      else if (type === 'file') box.formKind = 'file';
      else if (['submit', 'reset', 'button'].includes(type)) box.formKind = 'button';
      else box.formKind = 'text';
    }
    box.parentBox = parentBox;
    if (el.localName === 'img') {
      box.src = el.getAttribute('src') || '';
      box.alt = el.getAttribute('alt') || '';
      box.image = this.getImage(box.src, el);
    }
    this.boxes.push(box);
    if (el.nodeType === 1) el._box = box;

    const children = this.buildChildren(el, box);
    box.children = children;
    for (const child of children) child.parentBox = box;
    return box;
  }

  buildChildren(el, box) {
    const kids = [];
    /* textarea'nin metni degeri olarak cizilir, select'in secenekleri ise
       bu alt kumede yer almaz: cocuk kutusu uretme. */
    if (el.localName === 'textarea' || el.localName === 'select') return kids;
    /* ::before / ::after icin uretilen metin kutulari: satir ici akisin
       basina/sonuna girer ( seri akinin bir parcasi olur). */
    const makePseudo = (content) => {
      if (!content) return;
      const node = { nodeType: 3, data: content, ownerDocument: el.ownerDocument ?? null };
      const tb = makeBox('text', node, box.style);
      tb.text = content;
      tb.parentElement = el;
      tb.parentBox = box;
      tb.inlineLevel = true;
      kids.push(tb);
    };
    makePseudo(box.style.beforeContent);
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        if (!node.data) continue;
        const textBox = makeBox('text', node, box.style);
        textBox.text = node.data;
        textBox.parentElement = el;
        textBox.parentBox = box;
        textBox.inlineLevel = true;
        kids.push(textBox);
      } else if (node.nodeType === 1) {
        const child = this.buildElement(node, box);
        if (child) kids.push(child);
      }
    }
    makePseudo(box.style.afterContent);
    if (box.isFlex || box.isGrid) return this.flexItems(kids, box.style);
    if (box.isTable) return this.fixupTableLevel('table', kids, box.style);
    if (box.isRowGroup) return this.fixupTableLevel('group', kids, box.style);
    if (box.isTableRow) return this.fixupTableLevel('row', kids, box.style);
    if (box.kind === 'inline' || box.kind === 'inline-block' || box.kind === 'image') {
      return kids;
    }
    return this.groupRuns(kids, box.style);
  }

  groupRuns(kids, parentStyle) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const meaningful = run.some((b) => !(b.kind === 'text' && !b.text.trim()));
      if (meaningful) out.push(this.makeAnonymous(run, parentStyle));
      run = [];
    };
    for (const child of kids) {
      if (child.inlineLevel) run.push(child);
      else {
        flush();
        out.push(child);
      }
    }
    flush();
    return out;
  }

  flexItems(kids, parentStyle) {
    const out = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const meaningful = run.some((box) => box.kind !== 'text' || box.text.trim());
      if (meaningful) out.push(this.makeAnonymous(run, parentStyle));
      run = [];
    };
    for (const child of kids) {
      if (child.kind === 'text') {
        run.push(child);
      } else {
        flush();
        out.push(child);
      }
    }
    flush();
    return out;
  }

  makeAnonymous(children, parentStyle) {
    const style = {
      ...parentStyle,
      display: 'block',
      position: 'static',
      marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0,
      backgroundColor: [0, 0, 0, 0],
      backgroundImage: null,
      boxShadow: [],
      opacity: 1,
      width: 'auto',
      height: 'auto',
      minWidth: 0, minHeight: 0, maxWidth: 'none', maxHeight: 'none',
      left: 'auto', right: 'auto', top: 'auto', bottom: 'auto',
      listStyleType: 'none',
    };
    const box = makeBox('anonymous', null, style);
    box.children = children;
    for (const child of children) child.parentBox = box;
    this.boxes.push(box);
    return box;
  }

  /* Anonim tablo yapisalari: makeAnonymous uzerine display/flag yamasi. */
  makeStructural(children, parentStyle, kind, display) {
    const box = this.makeAnonymous(children, parentStyle);
    box.kind = kind;
    box.style = { ...box.style, display };
    if (display === 'table-row-group' || display === 'table-header-group' || display === 'table-footer-group') box.isRowGroup = true;
    else if (display === 'table-row') box.isTableRow = true;
    else if (display === 'table-cell') box.isCell = true;
    else if (display === 'table') box.isTable = true;
    return box;
  }

  /* Tablo agaci seviyelendirme (CSS tablo modeli, pratik alt kume):
     table: gecerli cocuklar row-group / row / caption; yabanci akis
            tek anonim satir + hucere icine girer; dogrudan tr'ler
            anonim row-group'a sarilir.
     group: gecerli cocuk tablo-row; hucre ve yabanci akis tek anonim
            satira gider (hucreler satira dogrudan, yabancilar hucrede).
     row:   gecerli cocuk tablo-cell; yabanci akis tek anonim hucreye.
     Ard arda gecerli olmayanlar TEK yapisal kutuda toplanir. */
  fixupTableLevel(level, kids, parentStyle) {
    const valid = {
      table: new Set(['group', 'row', 'caption']),
      group: new Set(['row', 'cell']),
      row: new Set(['cell']),
    }[level];
    const mark = (child) => {
      if (child.isTable) return 'table';
      if (child.isRowGroup) return 'group';
      if (child.isTableRow) return 'row';
      if (child.isCell) return 'cell';
      if (child.isCaption) return 'caption';
      return 'other';
    };
    const out = [];
    let stray = [];
    const flush = () => {
      if (!stray.length) return;
      const meaningful = stray.some((b) => b.kind !== 'text' || b.text.trim());
      if (meaningful) {
        const rest = stray.filter((b) => !isOutOfFlow(b));
        const abs = stray.filter(isOutOfFlow);
        if (level === 'group') {
          // hucreler dogrudan anonim satira; digerleri tek anonim hucreye
          const cells = rest.filter((b) => b.isCell);
          const rest2 = rest.filter((b) => !b.isCell);
          const rowChildren = [];
          if (rest2.length) rowChildren.push(this.makeStructural(rest2, parentStyle, 'block', 'table-cell'));
          rowChildren.push(...cells);
          const row = this.makeStructural(rowChildren, parentStyle, 'block', 'table-row');
          for (const c of rowChildren) c.parentBox = row;
          out.push(row);
        } else if (level === 'row') {
          const cell = this.makeStructural(rest, parentStyle, 'block', 'table-cell');
          out.push(cell);
        } else {
          // table: sevimsiz akis tek anonim satir + hucre
          const cell = this.makeStructural(rest, parentStyle, 'block', 'table-cell');
          const row = this.makeStructural([cell], parentStyle, 'block', 'table-row');
          cell.parentBox = row;
          const group = this.makeStructural([row], parentStyle, 'block', 'table-row-group');
          row.parentBox = group;
          out.push(group);
        }
        for (const a of abs) out.push(a);
      }
      stray = [];
    };
    for (const child of kids) {
      if (valid.has(mark(child))) {
        flush();
        // tablo altinda dogrudan satirlar anonim row-group'a sarilir;
        // grup altinda dogrudan hucreler kendi satirine sarilir.
        if (level === 'table' && mark(child) === 'row') {
          const group = this.makeStructural([child], parentStyle, 'block', 'table-row-group');
          child.parentBox = group;
          out.push(group);
        } else if (level === 'group' && mark(child) === 'cell') {
          const row = this.makeStructural([child], parentStyle, 'block', 'table-row');
          child.parentBox = row;
          out.push(row);
        } else {
          out.push(child);
        }
      } else {
        stray.push(child);
      }
    }
    flush();
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Kenarlar ve olcu cozumleme
   * ------------------------------------------------------------------ */

  resolveEdges(box, cbWidth) {
    const s = box.style;
    const basis = cbWidth ?? this.width;
    const margin = (v) => {
      if (v === 'auto') return 'auto';
      return resolvePct(v, basis) ?? 0;
    };
    box.margin = {
      top: margin(s.marginTop),
      right: margin(s.marginRight),
      bottom: margin(s.marginBottom),
      left: margin(s.marginLeft),
    };
    box.padding = {
      top: Math.max(0, resolvePct(s.paddingTop, basis) ?? 0),
      right: Math.max(0, resolvePct(s.paddingRight, basis) ?? 0),
      bottom: Math.max(0, resolvePct(s.paddingBottom, basis) ?? 0),
      left: Math.max(0, resolvePct(s.paddingLeft, basis) ?? 0),
    };
    box.border = {
      top: num(s.borderTopWidth), right: num(s.borderRightWidth),
      bottom: num(s.borderBottomWidth), left: num(s.borderLeftWidth),
    };
    box.radius = [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]
      .map((r) => (isPct(r) ? r : num(r)));
  }

  horizontalExtra(box) {
    return box.padding.left + box.padding.right + box.border.left + box.border.right;
  }

  verticalExtra(box) {
    return box.padding.top + box.padding.bottom + box.border.top + box.border.bottom;
  }

  marginV(box) {
    return { top: num(box.margin.top), bottom: num(box.margin.bottom) };
  }

  marginH(box) {
    return { left: num(box.margin.left), right: num(box.margin.right) };
  }

  /* ------------------------------------------------------------------ *
   * Blok yerlesim
   * ------------------------------------------------------------------ */

  layoutBlock(box, cbX, borderY, cbWidth, cbHeight, opts = {}) {
    this.resolveEdges(box, cbWidth);
    const s = box.style;
    const horizontalExtra = this.horizontalExtra(box);
    const verticalExtra = this.verticalExtra(box);

    /* Yuzme bolgesi: ustten gelen bolgeyi koru; yeni bir BFC kuran kutu
       (flex/grid/inline-block/float/overflow) kendi bolgesini acar. */
    let region = opts.region ?? null;
    if (!region || establishesRegion(box)) region = new FloatRegion(box);

    let ml = box.margin.left;
    let mr = box.margin.right;
    const autoLeft = !opts.ignoreAutoMargins && ml === 'auto';
    const autoRight = !opts.ignoreAutoMargins && mr === 'auto';
    if (autoLeft) ml = 0;
    if (autoRight) mr = 0;

    let contentWidth;
    if (opts.widthOverride != null) {
      contentWidth = Math.max(0, opts.widthOverride - horizontalExtra);
    } else if (s.width !== 'auto') {
      let declared = resolvePct(s.width, cbWidth);
      if (declared == null) declared = 0;
      if (s.boxSizing === 'border-box') declared -= horizontalExtra;
      contentWidth = declared;
    } else {
      contentWidth = cbWidth - num(ml) - num(mr) - horizontalExtra;
    }
    contentWidth = this.clampContentWidth(box, contentWidth, cbWidth, horizontalExtra);

    box.width = Math.max(0, contentWidth) + horizontalExtra;

    if (autoLeft || autoRight) {
      const free = cbWidth - box.width - num(ml) - num(mr);
      if (free > 0) {
        if (autoLeft && autoRight) { ml = free / 2; mr = free / 2; }
        else if (autoLeft) ml = free;
        else mr = free;
      }
    }
    box.margin.left = ml;
    box.margin.right = mr;
    box.x = cbX + num(ml);
    box.y = borderY;
    box.contentX = box.x + box.border.left + box.padding.left;
    box.contentY = box.y + box.border.top + box.padding.top;
    box.contentWidth = contentWidth;

    let contentHeight = null;
    if (opts.heightOverride != null) {
      contentHeight = Math.max(0, opts.heightOverride - verticalExtra);
    } else if (s.height !== 'auto') {
      const resolved = resolvePct(s.height, cbHeight);
      if (resolved != null) {
        contentHeight = s.boxSizing === 'border-box' ? resolved - verticalExtra : resolved;
        contentHeight = Math.max(0, contentHeight);
      }
    }

    const kids = box.children;
    if (box.isTable) {
      const tableHeight = this.layoutTable(box, contentWidth, contentHeight, cbHeight);
      if (contentHeight == null) contentHeight = tableHeight;
    } else if (box.isFlex) {
      const flexHeight = this.layoutFlex(box, contentWidth, contentHeight, cbHeight);
      if (contentHeight == null) contentHeight = flexHeight;
    } else if (box.isGrid) {
      const gridHeight = this.layoutGrid(box, contentWidth, contentHeight, cbHeight);
      if (contentHeight == null) contentHeight = gridHeight;
    } else if (kids.length) {
      const allInline = kids.every((k) => k.inlineLevel);
      if (allInline) {
        const inlineHeight = this.layoutInline(box, contentWidth, region);
        if (contentHeight == null) contentHeight = inlineHeight;
      } else {
        const blockHeight = this.layoutBlockChildren(box, contentWidth, contentHeight, cbHeight, region);
        if (contentHeight == null) contentHeight = blockHeight;
      }
    }

    /* Form kontrolleri (input/textarea/button): buton satir icerigi olarak
       dogal boylanir; input/textarea'nin DOM cocugu yoktur, yukseklik
       kontrol tipinin standardina (satir sayisi/tek satir) gore kurulur. */
    if (box.isFormControl && contentHeight == null) {
      contentHeight = Math.max(0, this.formControlHeight(box));
    }

    /* Bolge tabani bu kutuysa (BFC), yuzenler icerigi asmasin:
       konteyner yuksekligi en az yuzenlerin alt kenarina kadar uzar. */
    if (region && region.anchor === box && region.hasFloats()) {
      contentHeight = Math.max(contentHeight ?? 0, region.bottom());
    }

    if (contentHeight == null) contentHeight = 0;
    const minH = this.resolveHeightLimit(s.minHeight, cbHeight, verticalExtra);
    const maxH = s.maxHeight === 'none' ? Infinity : (this.resolveHeightLimit(s.maxHeight, cbHeight, verticalExtra) ?? Infinity);
    contentHeight = clamp(contentHeight, Math.max(0, minH), maxH);

    box.contentHeight = contentHeight;
    box.height = contentHeight + verticalExtra;
    return box.height;
  }

  clampContentWidth(box, contentWidth, cbWidth, horizontalExtra) {
    const s = box.style;
    let min = resolvePct(s.minWidth, cbWidth) ?? 0;
    let max = s.maxWidth === 'none' ? Infinity : (resolvePct(s.maxWidth, cbWidth) ?? Infinity);
    if (s.boxSizing === 'border-box') {
      min -= horizontalExtra;
      if (max !== Infinity) max -= horizontalExtra;
    }
    return clamp(contentWidth, Math.max(0, min), Math.max(0, max));
  }

  resolveHeightLimit(value, cbHeight, verticalExtra) {
    if (value == null || value === 'none') return null;
    const resolved = resolvePct(value, cbHeight);
    if (resolved == null) return 0;
    return value && typeof value === 'object' && 'pct' in value && cbHeight == null ? null : Math.max(0, resolved);
  }

  layoutBlockChildren(box, contentWidth, contentHeight, cbHeight, region = null) {
    const kids = box.children;
    let cursor = box.contentY;
    let prevBottom = 0;
    let first = true;
    let last = null;

    for (const child of kids) {
      if (child.inlineLevel) continue;
      if (isOutOfFlow(child)) continue;

      /* float: none olmayan blok cocuklar akis simgesi olusturmaz; bolgeye
         kaydedilir, imlec (cursor) yerinde kalir. */
      if (isFloatBox(child)) {
        if (region) {
          const relTop = Math.max(0, cursor - region.anchor.contentY);
          this.placeFloatBox(child, region, relTop, box);
        }
        continue;
      }

      this.resolveEdges(child, contentWidth);
      const margins = this.marginV(child);
      let y = first ? cursor + margins.top : cursor + Math.max(prevBottom, margins.top);

      /* clear: sol/sag/both -> yuzenlerin alt kenarina kadar in. */
      const clear = child.style.clear;
      if (region && region.hasFloats() && clear !== 'none') {
        const cleared = region.anchor.contentY + region.clearBottom(clear);
        if (cleared > y) y = cleared;
      }

      this.layoutBlock(child, box.contentX, y, contentWidth, contentHeight ?? cbHeight ?? null, { region });
      cursor = child.y + child.height;
      prevBottom = margins.bottom;
      first = false;
      last = child;
    }

    let height = cursor - box.contentY;
    if (last) height += prevBottom;
    return Math.max(0, height);
  }

  /* Yuzen kutuyu olc, bolgeye yerlestir ve nihai sayfa konumuna tasi.
     Genislik: belirtilmisse o (yuzde tabani icerik blogu), degilse
     shrink-to-fit = min(max-content, icerik blogundaki serbest genislik).
     Yatay sindirme yalnizca karsi yuzenLER banttan yersen uygulanir. */
  placeFloatBox(floatBox, region, relTop, cbBox) {
    const anchor = region.anchor;
    const anchorW = Math.max(0, anchor.contentWidth);
    const band = region.cbBand(cbBox);
    const spanW = band.span;
    relTop = Math.max(0, relTop);
    const bandInsets = region.lineOffsets(relTop, 0.01);
    const leftPush = Math.max(0, bandInsets.left - band.left);
    const rightPush = Math.max(0, bandInsets.right - (anchorW - band.right));
    const freeW = Math.max(0, spanW - leftPush - rightPush);

    const s = floatBox.style;
    this.resolveEdges(floatBox, spanW);
    if (floatBox.kind === 'image') {
      this.layoutImage(floatBox, freeW);
    } else {
      let borderW;
      if (s.width !== 'auto') {
        const w = resolvePct(s.width, spanW) ?? 0;
        borderW = s.boxSizing === 'border-box' ? w : w + this.horizontalExtra(floatBox);
      } else {
        borderW = Math.min(this.intrinsicBorderWidth(floatBox, spanW), freeW);
      }
      borderW = Math.max(0, borderW);
      this.layoutBlock(floatBox, 0, 0, spanW, null, { widthOverride: borderW, ignoreAutoMargins: true });
    }

    const entry = region.registerFloat(floatBox, relTop, band);
    const dx = anchor.contentX + entry.left + num(floatBox.margin.left) - floatBox.x;
    const dy = anchor.contentY + entry.top + num(floatBox.margin.top) - floatBox.y;
    this.shiftSubtree(floatBox, dx, dy);
    return entry;
  }

  /* ------------------------------------------------------------------ *
   * Satir ici yerlesim
   * ------------------------------------------------------------------ */

  collectAtoms(parent, chain, atoms, avail) {
    for (const child of parent.children) {
      if (child.el?.localName === 'br') {
        atoms.push({ type: 'br', style: child.style, chain, el: child.el });
        continue;
      }
      if (child.kind === 'text') {
        this.textAtoms(child, chain, atoms);
      } else if (child.kind === 'inline') {
        this.resolveEdges(child, avail);
        const nextChain = chain.concat(child);
        this.collectAtoms(child, nextChain, atoms, avail);
      } else if (child.inlineLevel || child.kind === 'block' || child.kind === 'list-item') {
        const floatSide = isFloatBox(child) ? child.style.float : null;
        if (!floatSide) this.prepareAtomic(child, avail);
        atoms.push({
          type: floatSide ? 'float' : 'atomic',
          box: child, chain,
          width: floatSide ? 0 : child.width + num(child.margin.left) + num(child.margin.right),
          height: floatSide ? 0 : child.height + num(child.margin.top) + num(child.margin.bottom),
        });
      }
    }
  }

  textAtoms(textBox, chain, atoms) {
    let text = textBox.text;
    if (!text) return;
    const style = textBox.style;
    const ws = style.whiteSpace;
    const pre = ws === 'pre' || ws === 'pre-wrap';
    const preLine = ws === 'pre-line';
    if (style.textTransform === 'uppercase') text = text.toUpperCase();
    else if (style.textTransform === 'lowercase') text = text.toLowerCase();
    else if (style.textTransform === 'capitalize') text = text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

    if (!pre) text = text.replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ');
    else text = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');

    const el = textBox.parentElement;
    let buffer = '';
    const flush = () => {
      if (!buffer) return;
      atoms.push({ type: 'text', text: buffer, style, chain, el });
      buffer = '';
    };

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\n' && (pre || preLine)) {
        flush();
        atoms.push({ type: 'br', style, chain, el });
        continue;
      }
      if (ch === '\n') {
        flush();
        atoms.push({ type: 'space', style, chain, el, count: 1 });
        continue;
      }
      if (ch === ' ') {
        flush();
        const count = pre ? 1 : 1;
        atoms.push({ type: 'space', style, chain, el, count });
        continue;
      }
      buffer += ch;
    }
    flush();
  }

  prepareAtomic(box, avail) {
    this.resolveEdges(box, avail);
    if (box.kind === 'image') {
      this.layoutImage(box, avail);
      return;
    }
    let width;
    if (box.style.width !== 'auto') {
      const resolved = resolvePct(box.style.width, avail) ?? 0;
      width = box.style.boxSizing === 'border-box' ? resolved : resolved + this.horizontalExtra(box);
    } else {
      width = this.intrinsicBorderWidth(box, avail);
    }
    width = Math.min(width, Math.max(avail, 0));
    width = Math.max(width, 0);
    this.layoutBlock(box, 0, 0, avail, null, { widthOverride: width, ignoreAutoMargins: true });
    if (box.style.height !== 'auto') {
      const h = resolvePct(box.style.height, null);
      if (h != null) {
        const target = box.style.boxSizing === 'border-box' ? h : h + this.verticalExtra(box);
        this.layoutBlock(box, 0, 0, avail, null, { widthOverride: width, heightOverride: target, ignoreAutoMargins: true });
      }
    }
  }

  layoutImage(box, avail) {
    const entry = box.image;
    const naturalW = entry?.width || 150;
    const naturalH = entry?.height || 100;
    const s = box.style;
    let cssW = null;
    let cssH = null;
    if (s.width !== 'auto') cssW = resolvePct(s.width, avail);
    else if (box.el?.getAttribute('width')) cssW = parseFloat(box.el.getAttribute('width'));
    if (s.height !== 'auto') cssH = resolvePct(s.height, null);
    else if (box.el?.getAttribute('height')) cssH = parseFloat(box.el.getAttribute('height'));

    let w = cssW;
    let h = cssH;
    if (w == null && h == null) { w = naturalW; h = naturalH; }
    else if (w == null) w = h * naturalW / naturalH;
    else if (h == null) h = w * naturalH / naturalW;

    if (s.boxSizing === 'content-box') {
      w += box.padding.left + box.padding.right;
      h += box.padding.top + box.padding.bottom;
    }
    box.width = Math.max(0, w) + box.border.left + box.border.right;
    box.height = Math.max(0, h) + box.border.top + box.border.bottom;
    box.x = 0;
    box.y = 0;
    box.contentX = box.x + box.border.left + box.padding.left;
    box.contentY = box.y + box.border.top + box.padding.top;
    box.contentWidth = Math.max(0, box.width - this.horizontalExtra(box));
    box.contentHeight = Math.max(0, box.height - this.verticalExtra(box));
    box.naturalWidth = naturalW;
    box.naturalHeight = naturalH;
  }

  layoutInline(box, avail, region = null) {
    const atoms = [];
    this.collectAtoms(box, [], atoms, avail);
    const nowrap = box.style.whiteSpace === 'nowrap';

    const baseLineHeight = box.style.lineHeight || box.style.fontSize * 1.2;
    const anchor = region?.anchor ?? box;

    /* Bolge (float) icerik kutusuna gore kesimleri bu kutunun kendi
       icerik kutusuna cevirir. Her satir ustunden sorgulanir. */
    const insetsAt = (topPageY) => {
      if (!region || !region.hasFloats()) return { left: 0, right: 0 };
      const relTop = Math.max(0, topPageY - anchor.contentY);
      const rel = region.lineOffsets(relTop, Math.max(1, baseLineHeight));
      const anchorL = anchor.contentX;
      const anchorR = anchorL + Math.max(0, anchor.contentWidth || 0);
      const left = anchorL + rel.left - box.contentX;
      const right = (box.contentX + avail) - (anchorR - rel.right);
      return {
        left: left > 0 ? left : 0,
        right: right > 0 ? Math.min(right, avail) : 0,
      };
    };

    const lines = [];
    let cursorY = box.contentY;
    let line = null;
    let pendingSpace = 0;

    const newLine = () => {
      line = { fragments: [], width: 0, ascent: 0, descent: 0, top: cursorY, insets: insetsAt(cursorY) };
    };
    const usable = () => Math.max(0, avail - line.insets.left - line.insets.right);

    const pushLine = (empty) => {
      const ascent = empty ? 0 : line.ascent;
      const descent = empty ? 0 : line.descent;
      const height = Math.max(ascent + descent, baseLineHeight);
      lines.push({ ...line, ascent, descent, height });
      cursorY = line.top + height;
      newLine();
      pendingSpace = 0;
    };

    const flushLine = (force = false) => {
      if (!line) newLine();
      if (!line.fragments.length) {
        pendingSpace = 0;
        if (force) pushLine(true);
        return;
      }
      pushLine(false);
    };

    const placeText = (text, style, el, chain, width) => {
      const fs = style.fontSize;
      const lh = style.lineHeight || fs * 1.2;
      const ascent = (lh - fs) / 2 + fs * 0.8;
      const descent = (lh - fs) / 2 + fs * 0.2;
      const frag = {
        type: 'text', text, style, el, chain, width,
        x: line.width + pendingSpace, ascent, descent, baseOffset: ascent, lineHeight: lh,
      };
      line.fragments.push(frag);
      line.width += pendingSpace + width;
      line.ascent = Math.max(line.ascent, ascent);
      line.descent = Math.max(line.descent, descent);
      pendingSpace = 0;
    };

    newLine();
    for (const atom of atoms) {
      /* Satir ici float: satira parca koymaz; bulundugu satirin ustunden
         bolgeye kaydolur, kesimler (insets) guncellenir. Icerik blogu bu kutu. */
      if (atom.type === 'float') {
        if (region) {
          this.placeFloatBox(atom.box, region, Math.max(0, line.top - anchor.contentY), box);
          line.insets = insetsAt(line.top);
        }
        continue;
      }
      if (atom.type === 'br') {
        flushLine(true);
        continue;
      }
      if (atom.type === 'space') {
        if (line.fragments.length) pendingSpace += this.measure(' ', atom.style);
        continue;
      }
      if (atom.type === 'text') {
        const width = this.measure(atom.text, atom.style);
        const usableW = usable();
        if (!nowrap && line.fragments.length && line.width + pendingSpace + width > usableW) flushLine();
        if (nowrap) {
          placeText(atom.text, atom.style, atom.el, atom.chain, width);
        } else if (width <= usable() || line.fragments.length === 0) {
          if (width > usable()) {
            // Uzun kelimeyi karakter karakter kir.
            let remaining = atom.text;
            while (remaining.length) {
              let take = remaining.length;
              while (take > 1 && this.measure(remaining.slice(0, take), atom.style) > usable()) take--;
              const chunk = remaining.slice(0, take);
              const chunkWidth = this.measure(chunk, atom.style);
              if (line.fragments.length && line.width + pendingSpace + chunkWidth > usable()) flushLine();
              placeText(chunk, atom.style, atom.el, atom.chain, chunkWidth);
              remaining = remaining.slice(take);
              if (remaining.length) flushLine();
            }
          } else {
            placeText(atom.text, atom.style, atom.el, atom.chain, width);
          }
        } else {
          placeText(atom.text, atom.style, atom.el, atom.chain, width);
        }
        continue;
      }
      if (atom.type === 'atomic') {
        if (!nowrap && line.fragments.length && line.width + pendingSpace + atom.width > usable()) flushLine();
        const childBox = atom.box;
        const mt = num(childBox.margin.top);
        const mb = num(childBox.margin.bottom);
        const ml = num(childBox.margin.left);
        const mr = num(childBox.margin.right);
        const outerH = childBox.height + mt + mb;
        const align = childBox.style.verticalAlign;
        let ascent;
        let descent;
        if (align === 'middle') {
          ascent = outerH / 2 + childBox.style.fontSize * 0.3;
          descent = Math.max(0, outerH - ascent);
        } else if (align === 'top' || align === 'text-top') {
          ascent = outerH;
          descent = 0;
        } else if (align === 'bottom' || align === 'text-bottom') {
          ascent = 0;
          descent = outerH;
        } else {
          ascent = outerH;
          descent = 0;
        }
        const frag = {
          type: 'atomic', box: childBox, el: childBox.el, chain: atom.chain,
          x: line.width + pendingSpace, width: atom.width, ascent, descent,
          marginTop: mt, marginLeft: ml,
        };
        line.fragments.push(frag);
        line.width += pendingSpace + atom.width;
        line.ascent = Math.max(line.ascent, ascent);
        line.descent = Math.max(line.descent, descent);
        pendingSpace = 0;
      }
    }
    flushLine();

    const ta = box.style.textAlign;
    const lineIndex = new Map();
    lines.forEach((ln, index) => lineIndex.set(ln, index));

    for (const ln of lines) {
      const usableW = Math.max(0, avail - ln.insets.left - ln.insets.right);
      const free = usableW - ln.width;
      /* Sol kesimden taban; hizalama kalan serbest alanda oynar. */
      let offset = ln.insets.left;
      if (ta === 'center') offset = ln.insets.left + Math.max(0, free) / 2;
      else if (ta === 'right' || ta === 'end') offset = ln.insets.left + Math.max(0, free);
      const y = ln.top;

      for (const frag of ln.fragments) {
        frag.x += box.contentX + offset;
        const top = y + (ln.ascent - frag.ascent);
        frag.y = top;
        frag.lineTop = y;
        frag.lineHeight = ln.height;
        let rect;
        if (frag.type === 'text') {
          frag.baseline = top + frag.baseOffset;
          rect = { x: frag.x, y: top, width: frag.width, height: frag.lineHeight };
        } else {
          const bx = frag.box;
          const targetX = frag.x + frag.marginLeft;
          const targetY = top + frag.marginTop;
          this.shiftSubtree(bx, targetX - bx.x, targetY - bx.y);
          rect = { x: bx.x, y: bx.y, width: bx.width, height: bx.height };
          frag.rect = rect;
          frag.el = bx.el;
        }
        for (const inline of frag.chain) {
          if (!inline._segments) inline._segments = [];
          inline._segments.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, line: lineIndex.get(ln) });
          if (!inline._fragments) inline._fragments = [];
          inline._fragments.push({ ...rect, line: lineIndex.get(ln) });
        }
        if (frag.type === 'text' && frag.el) {
          if (!frag.el._fragments) frag.el._fragments = [];
          frag.el._fragments.push({ ...rect, line: lineIndex.get(ln) });
        }
      }
    }

    box.lineBoxes = lines;
    return cursorY - box.contentY;
  }

  /* ------------------------------------------------------------------ *
   * Flex
   * ------------------------------------------------------------------ */

  layoutFlex(box, contentWidth, contentHeight, cbHeight) {
    const s = box.style;
    const isRow = s.flexDirection === 'row' || s.flexDirection === 'row-reverse';
    const reverse = s.flexDirection.endsWith('reverse');
    const items = box.children.filter((c) => !isOutOfFlow(c));
    if (!items.length) return 0;

    for (const item of items) this.resolveEdges(item, contentWidth);
    if (reverse) items.reverse();
    if (isRow) return this.flexRow(box, items, contentWidth, contentHeight);
    return this.flexColumn(box, items, contentWidth, contentHeight, cbHeight);
  }

  flexRow(box, items, contentWidth, contentHeight) {
    const s = box.style;
    const gap = s.columnGap || 0;
    const infos = items.map((item) => {
      const inner = this.horizontalExtra(item);
      const margins = this.marginH(item);
      const vertical = this.marginV(item);
      let base;
      const fb = item.style.flexBasis;
      if (typeof fb === 'number') base = fb;
      else if (isPct(fb)) base = (contentWidth * fb.pct) / 100;
      else if (item.style.width !== 'auto') {
        let w = resolvePct(item.style.width, contentWidth) ?? 0;
        if (item.style.boxSizing === 'border-box') w -= inner;
        base = w;
      } else {
        base = this.intrinsicContentWidth(item, contentWidth);
      }
      return {
        item, inner, margins, mt: vertical.top, mb: vertical.bottom, base: Math.max(0, base),
        grow: Math.max(0, item.style.flexGrow || 0),
        shrink: Math.max(0, item.style.flexShrink ?? 1),
        borderW: 0,
        autoL: item.margin.left === 'auto',
        autoR: item.margin.right === 'auto',
        leadAuto: 0,
        trailAuto: 0,
      };
    });

    const gaps = gap * (infos.length - 1);
    const available = contentWidth - gaps;
    let sumBase = 0;
    let sumOuter = 0;
    for (const info of infos) {
      sumBase += info.base;
      sumOuter += info.base + info.inner + info.margins.left + info.margins.right;
    }
    let free = available - sumOuter;
    if (free > 0) {
      const sumGrow = infos.reduce((a, i) => a + i.grow, 0);
      if (sumGrow > 0) {
        for (const info of infos) info.base += (free * info.grow) / sumGrow;
      }
    } else if (free < 0) {
      let scaled = 0;
      for (const info of infos) scaled += info.base * info.shrink;
      if (scaled > 0) {
        for (const info of infos) {
          info.base = Math.max(0, info.base + (free * (info.base * info.shrink)) / scaled);
        }
      } else {
        for (const info of infos) info.base = Math.max(0, info.base + free / infos.length);
      }
    }

    // Yeniden hesapla
    let used = gaps;
    for (const info of infos) {
      info.outer = info.base + info.inner + info.margins.left + info.margins.right;
      used += info.outer;
    }
    let leftover = contentWidth - used;
    let startOffset = 0;
    let extraGap = 0;
    const autoCount = infos.reduce((a, i) => a + (i.autoL ? 1 : 0) + (i.autoR ? 1 : 0), 0);
    if (autoCount && leftover > 0) {
      const share = leftover / autoCount;
      for (const info of infos) {
        if (info.autoL) info.leadAuto = share;
        if (info.autoR) info.trailAuto = share;
      }
      leftover = 0;
    }
    const justify = s.justifyContent;
    if (justify === 'flex-end' || justify === 'right') startOffset = leftover;
    else if (justify === 'center') startOffset = leftover / 2;
    else if (justify === 'space-between' && infos.length > 1) extraGap = leftover / (infos.length - 1);
    else if (justify === 'space-around') {
      extraGap = leftover / infos.length;
      startOffset = extraGap / 2;
    } else if (justify === 'space-evenly') {
      extraGap = leftover / (infos.length + 1);
      startOffset = extraGap;
    }

    let x = box.contentX + startOffset;
    let maxOuterHeight = 0;
    for (const info of infos) {
      const item = info.item;
      info.borderW = info.base + info.inner;
      x += info.leadAuto;
      this.layoutBlock(item, x, box.contentY + info.mt, contentWidth, null, {
        widthOverride: info.borderW,
        ignoreAutoMargins: true,
      });
      maxOuterHeight = Math.max(maxOuterHeight, item.height + info.mt + info.mb);
      x += info.outer + info.trailAuto + gap + extraGap;
    }

    const crossHeight = contentHeight ?? maxOuterHeight;
    for (const info of infos) {
      const item = info.item;
      const align = item.style.alignSelf !== 'auto' ? item.style.alignSelf : s.alignItems;
      const marginTop = info.mt;
      const marginBottom = info.mb;
      let targetY = item.y;
      if (align === 'stretch' && item.style.height === 'auto' && contentHeight != null) {
        const h = Math.max(0, crossHeight - marginTop - marginBottom);
        this.layoutBlock(item, item.x - num(item.margin.left), item.y, contentWidth, null, {
          widthOverride: info.borderW,
          heightOverride: h,
          ignoreAutoMargins: true,
        });
        targetY = box.contentY + marginTop;
      } else if (align === 'center') {
        targetY = box.contentY + marginTop + (crossHeight - (item.height + marginTop + marginBottom)) / 2;
      } else if (align === 'flex-end' || align === 'end') {
        targetY = box.contentY + crossHeight - marginBottom - item.height;
      } else {
        targetY = box.contentY + marginTop;
      }
      this.shiftSubtree(item, 0, targetY - item.y);
    }

    return crossHeight;
  }

  flexColumn(box, items, contentWidth, contentHeight, cbHeight) {
    const s = box.style;
    const gap = s.rowGap || 0;
    const infos = items.map((item) => {
      const innerX = this.horizontalExtra(item);
      const margins = this.marginH(item);
      const maxW = Math.max(0, contentWidth - margins.left - margins.right);
      let borderW;
      const align = item.style.alignSelf !== 'auto' ? item.style.alignSelf : s.alignItems;
      if (align === 'stretch' && item.style.width === 'auto') {
        borderW = maxW;
      } else if (item.style.width !== 'auto') {
        const w = resolvePct(item.style.width, contentWidth) ?? 0;
        borderW = item.style.boxSizing === 'border-box' ? w : w + innerX;
      } else {
        borderW = Math.min(this.intrinsicBorderWidth(item, contentWidth), maxW);
      }
      return { item, borderW, margins };
    });

    // Yükseklikleri ölç
    const indefinite = contentHeight == null;
    for (const info of infos) {
      this.layoutBlock(info.item, box.contentX, 0, contentWidth, null, {
        widthOverride: info.borderW,
        ignoreAutoMargins: true,
      });
      const fb = info.item.style.flexBasis;
      if (typeof fb === 'number') info.base = fb;
      else if (isPct(fb)) {
        // Yüzde taban, belirsiz yükseklikte içerik boyuna düşer (CSS flexbox).
        info.base = indefinite ? info.item.height : (contentHeight * fb.pct) / 100;
      } else if (info.item.style.height !== 'auto') {
        const h = resolvePct(info.item.style.height, contentHeight) ?? info.item.height;
        info.base = info.item.style.boxSizing === 'border-box' ? h : h + this.verticalExtra(info.item);
      } else info.base = info.item.height;
      info.grow = Math.max(0, info.item.style.flexGrow || 0);
      info.shrink = Math.max(0, info.item.style.flexShrink ?? 1);
    }

    const gaps = gap * (infos.length - 1);
    let available = contentHeight;
    if (available != null) {
      let used = gaps;
      for (const info of infos) used += info.base + num(info.margins.top) + num(info.margins.bottom);
      let free = available - used;
      if (free > 0) {
        const sumGrow = infos.reduce((a, i) => a + i.grow, 0);
        if (sumGrow) for (const info of infos) info.base += (free * info.grow) / sumGrow;
      } else if (free < 0) {
        let scaled = 0;
        for (const info of infos) scaled += info.base * info.shrink;
        if (scaled) for (const info of infos) info.base = Math.max(0, info.base + free * (info.base * info.shrink) / scaled);
      }
    }

    let total = gaps;
    for (const info of infos) total += info.base + num(info.margins.top) + num(info.margins.bottom);
    const crossHeight = contentHeight ?? total;
    let leftover = (contentHeight ?? total) - total;
    let startOffset = 0;
    let extraGap = 0;
    const justify = s.justifyContent;
    if (justify === 'flex-end') startOffset = leftover;
    else if (justify === 'center') startOffset = leftover / 2;
    else if (justify === 'space-between' && infos.length > 1) extraGap = leftover / (infos.length - 1);
    else if (justify === 'space-around') { extraGap = leftover / infos.length; startOffset = extraGap / 2; }
    else if (justify === 'space-evenly') { extraGap = leftover / (infos.length + 1); startOffset = extraGap; }

    let y = box.contentY + startOffset;
    for (const info of infos) {
      const item = info.item;
      const align = item.style.alignSelf !== 'auto' ? item.style.alignSelf : s.alignItems;
      let targetX = box.contentX + info.margins.left;
      if (align === 'center') targetX = box.contentX + info.margins.left + (contentWidth - info.margins.left - info.margins.right - info.borderW) / 2;
      else if (align === 'flex-end' || align === 'end') targetX = box.contentX + contentWidth - info.margins.right - info.borderW;
      const borderH = info.base;
      y += num(info.margins.top);
      this.layoutBlock(item, targetX, y, contentWidth, null, {
        widthOverride: info.borderW,
        heightOverride: borderH,
        ignoreAutoMargins: true,
      });
      y += borderH + num(info.margins.bottom) + gap + extraGap;
    }

    return crossHeight;
  }

  /* ------------------------------------------------------------------ *
   * Intrinsic genislik
   * ------------------------------------------------------------------ */

  /* Form kontrollerinin dogal olculeri (pratik alt kume):
     checkbox/radio 13x13, text size, textarea cols/rows, select en uzun
     option etiketi, buton etiket olcusuyle. */
  formControlWidth(box) {
    const el = box.el;
    const charW = (box.style.fontSize || 16) * 0.55;
    if (box.formKind === 'checkbox' || box.formKind === 'radio') return 13;
    if (box.formKind === 'textarea') return Math.min(999, Math.max(1, parseInt(el.getAttribute('cols'), 10) || 20)) * charW;
    if (box.formKind === 'button') {
      return this.measure(String(controlLabel(el)), box.style) + charW * 2;
    }
    if (box.formKind === 'select') {
      let widest = 0;
      for (const option of el.options) widest = Math.max(widest, this.measure(String(option.textContent ?? '').trim(), box.style));
      const multiExtra = el.hasAttribute?.('multiple') ? charW * 3 + 12 : 0;
      return Math.max(52, widest + charW * 2.4 + multiExtra);
    }
    // text: size niteligi (on tanimli 20); deger uzasa da kutu sabit kalir
    const size = Math.min(999, Math.max(1, parseInt(el.getAttribute('size'), 10) || 20));
    return size * charW;
  }

  formControlHeight(box) {
    const fs = box.style.fontSize || 16;
    const lh = typeof box.style.lineHeight === 'number' && box.style.lineHeight > 0 ? box.style.lineHeight : fs * 1.4;
    if (box.formKind === 'checkbox' || box.formKind === 'radio') return 13;
    if (box.formKind === 'textarea') {
      const rows = Math.min(999, Math.max(1, parseInt(box.el.getAttribute('rows'), 10) || 2));
      return rows * lh;
    }
    /* select[multiple]: size niteligi (varsayilan 4) satir kadar liste. */
    if (box.formKind === 'select' && box.el?.hasAttribute?.('multiple')) {
      return multiSelectRows(box.el) * multiSelectRowHeight(box.el);
    }
    return lh;
  }

  intrinsicBorderWidth(box, avail) {
    this.resolveEdges(box, avail);
    const extra = this.horizontalExtra(box);
    if (box.kind === 'image') {
      const entry = box.image;
      const w = entry?.width || parseInt(box.el?.getAttribute('width'), 10) || 150;
      return w + extra;
    }
    if (box.isTable) {
      // tablo: max-content (kolon toplami + bosluklar); cagiran sinirlar
      const m = this.measureTableColumns(box, avail);
      return Math.max(0, m.maxTotal) + extra;
    }
    if (box.isFormControl && box.style.width === 'auto') {
      return this.formControlWidth(box) + extra;
    }
    if (box.style.width !== 'auto') {
      const w = resolvePct(box.style.width, avail) ?? 0;
      return (box.style.boxSizing === 'border-box' ? w : w + extra);
    }
    return this.intrinsicContentWidth(box, avail) + extra;
  }

  /* Hucre icerik min-content olcumu: en uzun kirilmaz parcacik. */
  intrinsicMinBorderWidth(box, avail) {
    this.resolveEdges(box, avail);
    const extra = this.horizontalExtra(box);
    if (box.kind === 'image') {
      const entry = box.image;
      const w = entry?.width || parseInt(box.el?.getAttribute('width'), 10) || 150;
      return w + extra;
    }
    if (box.isTable) {
      const m = this.measureTableColumns(box, avail);
      return Math.max(0, m.minTotal) + extra;
    }
    if (box.isFormControl && box.style.width === 'auto') {
      return this.formControlWidth(box) + extra;
    }
    if (box.style.width !== 'auto') {
      const w = resolvePct(box.style.width, avail) ?? 0;
      return (box.style.boxSizing === 'border-box' ? w : w + extra);
    }
    return this.intrinsicMinContentWidth(box, avail) + extra;
  }

  intrinsicMinTextWidth(text, style) {
    let value = String(text ?? '').replace(/\r\n?/g, '\n');
    const ws = style.whiteSpace;
    if (style.textTransform === 'uppercase') value = value.toUpperCase();
    else if (style.textTransform === 'lowercase') value = value.toLowerCase();
    if (ws === 'pre') {
      // pre: satir sonu-kirilmasi yok
      let max = 0;
      for (const line of value.split('\n')) max = Math.max(max, this.measure(line, style));
      return max;
    }
    if (ws !== 'pre-wrap') value = value.replace(/[ \t\f\v]+/g, ' ');
    let max = 0;
    for (const token of value.split(/[\s]+/)) {
      if (token) max = Math.max(max, this.measure(token, style));
    }
    return max;
  }

  intrinsicMinContentWidth(box, avail) {
    if (box.kind === 'text') return this.intrinsicMinTextWidth(box.text, box.style);
    if (box.kind === 'image') return box.image?.width || parseInt(box.el?.getAttribute('width'), 10) || 150;
    if (box.isTable) return Math.max(0, this.measureTableColumns(box, avail).minTotal);
    if (box.isGrid) return this.intrinsicGridWidth(box, avail);
    if (box.isFlex) {
      const row = box.style.flexDirection.startsWith('row');
      let max = 0;
      let total = 0;
      for (const child of box.children) {
        if (isOutOfFlow(child)) continue;
        const w = this.intrinsicMinBorderWidth(child, avail);
        if (row) total += w; else max = Math.max(max, w);
      }
      if (row) total += Math.max(0, num(box.style.columnGap)) * Math.max(0, box.children.length - 1);
      return row ? total : max;
    }
    let max = 0;
    let inlineMin = 0;
    for (const child of box.children) {
      if (isOutOfFlow(child)) continue;
      if (isFloatBox(child)) {
        max = Math.max(max, this.intrinsicMinBorderWidth(child, avail));
        continue;
      }
      if (child.inlineLevel) {
        if (child.kind === 'text') inlineMin = Math.max(inlineMin, this.intrinsicMinTextWidth(child.text, child.style));
        else inlineMin = Math.max(inlineMin, this.intrinsicMinBorderWidth(child, avail));
      } else {
        max = Math.max(max, this.intrinsicMinBorderWidth(child, avail));
      }
    }
    return Math.max(max, inlineMin);
  }

  intrinsicTextWidth(text, style) {
    let value = String(text ?? '').replace(/\r\n?/g, '\n');
    const ws = style.whiteSpace;
    if (ws !== 'pre' && ws !== 'pre-wrap') value = value.replace(/[ \t\f\v]+/g, ' ');
    if (style.textTransform === 'uppercase') value = value.toUpperCase();
    else if (style.textTransform === 'lowercase') value = value.toLowerCase();
    else if (style.textTransform === 'capitalize') value = value.replace(/\b\p{L}/gu, (char) => char.toUpperCase());
    if (ws === 'normal' || ws === 'nowrap') {
      // Normal/nowrap metin akışında satır sonu boşluk gibi davranır: max-content tek satırdır.
      return this.measure(value.replace(/\n/g, ' ').trim(), style);
    }
    let max = 0;
    for (const line of value.split('\n')) {
      max = Math.max(max, this.measure(line.trim(), style));
    }
    return max;
  }

  intrinsicContentWidth(box, avail) {
    const s = box.style;
    if (box.kind === 'text') return this.intrinsicTextWidth(box.text, box.style);
    if (box.kind === 'image') return box.image?.width || parseInt(box.el?.getAttribute('width'), 10) || 150;
    if (box.isFormControl && s.width === 'auto') return this.formControlWidth(box);
    if (box.isGrid) return this.intrinsicGridWidth(box, avail);
    if (box.isFlex) {
      const row = s.flexDirection.startsWith('row');
      let total = 0;
      let max = 0;
      const gap = row ? s.columnGap : s.rowGap;
      for (const child of box.children) {
        if (isOutOfFlow(child)) continue;
        const w = this.intrinsicBorderWidth(child, avail);
        if (row) total += w; else max = Math.max(max, w);
      }
      if (row) total += gap * Math.max(0, box.children.length - 1);
      return row ? total : max;
    }
    let max = 0;
    let inlineRun = 0;
    for (const child of box.children) {
      if (isOutOfFlow(child)) continue;
      /* float atomlar satir akisini doldurmadigindan blok gibi katki verir. */
      if (isFloatBox(child)) {
        max = Math.max(max, this.intrinsicBorderWidth(child, avail));
        continue;
      }
      if (child.inlineLevel) {
        if (child.kind === 'text') inlineRun += this.intrinsicTextWidth(child.text, child.style);
        else inlineRun += this.intrinsicBorderWidth(child, avail);
      } else {
        max = Math.max(max, this.intrinsicBorderWidth(child, avail));
      }
    }
    return Math.max(max, inlineRun);
  }

  /* ------------------------------------------------------------------ *
   * Tablo
   * ------------------------------------------------------------------ */

  /* Satirlari topla: row-group'lardan (ayni sira ile) veya tablo altindaki
     anonim gruplardan gelen tr kutularindan. */
  tableRows(box) {
    const rows = [];
    const groups = box.children.filter((c) => c.isRowGroup && !isOutOfFlow(c));
    if (groups.length) {
      for (const g of groups) {
        for (const child of g.children) if (child.isTableRow && !isOutOfFlow(child)) rows.push(child);
      }
    } else {
      for (const child of box.children) if (child.isTableRow && !isOutOfFlow(child)) rows.push(child);
    }
    return rows;
  }

  /* Tablo plani: satir/hucre dizilimi (colspan-rowspan dolu matris) ve
     kolon min/max yogunlasmalari. */
  measureTableColumns(box, avail) {
    const s = box.style;
    const collapsed = s.borderCollapse === 'collapse';
    const spacingX = collapsed ? 0 : Math.max(0, num(s.borderSpacingX));
    const spacingY = collapsed ? 0 : Math.max(0, num(s.borderSpacingY));
    const rows = this.tableRows(box);

    let colCount = 0;
    const placements = [];
    const occupied = new Set();
    rows.forEach((row, r) => {
      let c = 0;
      for (const cell of row.children) {
        if (!cell.isCell) continue;
        while (occupied.has(r + ':' + c)) c++;
        const el = cell.el && cell.el.nodeType === 1 ? cell.el : null;
        let colSpan = Math.min(1000, Math.max(1, parseInt(el?.getAttribute?.('colspan'), 10) || 1));
        let rowSpan = Math.min(1000, Math.max(1, parseInt(el?.getAttribute?.('rowspan'), 10) || 1));
        rowSpan = Math.min(rowSpan, Math.max(1, rows.length - r));
        for (let rr = r; rr < r + rowSpan; rr++) {
          for (let cc = c; cc < c + colSpan; cc++) occupied.add(rr + ':' + cc);
        }
        placements.push({ cell, row: r, col: c, colSpan, rowSpan });
        c += colSpan;
        colCount = Math.max(colCount, c);
      }
    });
    colCount = Math.max(1, colCount);

    /* Collapse modeli: bitisik hücre kenarlarinda kalin olan kazanir;
       etkin genislik olcumden once owner hücrenin style'ina yazilir. */
    if (collapsed) this.resolveCollapsedBorders(placements);

    let colPin = new Array(colCount).fill(null);
    const colDefs = this.collectColumnDefs(box.el);
    for (let c = 0; c < Math.min(colDefs.length, colCount); c++) {
      const spec = colDefs[c];
      if (spec == null) continue;
      const px = spec.kind === 'pct'
        ? (avail * spec.value) / 100
        : spec.value;
      if (px > 0) colPin[c] = px;
    }

    const colMin = new Array(colCount).fill(0);
    const colMax = new Array(colCount).fill(0);
    const wideSpans = [];
    for (const p of placements) {
      const cell = p.cell;
      this.resolveEdges(cell, avail);
      let minW;
      let maxW;
      if (cell.kind === 'image') {
        const w = (cell.image?.width || parseInt(cell.el?.getAttribute('width'), 10) || 150) + this.horizontalExtra(cell);
        minW = maxW = w;
      } else {
        minW = this.intrinsicMinBorderWidth(cell, avail);
        maxW = Math.max(minW, this.intrinsicBorderWidth(cell, avail));
      }
      if (cell.style.width !== 'auto') {
        const spec = resolvePct(cell.style.width, avail) ?? 0;
        const specW = cell.style.boxSizing === 'border-box' ? spec : spec + this.horizontalExtra(cell);
        minW = Math.max(minW, specW);
        maxW = Math.max(maxW, specW);
      }
      if (p.colSpan === 1) {
        colMin[p.col] = Math.max(colMin[p.col], Math.max(0, minW));
        colMax[p.col] = Math.max(colMax[p.col], Math.max(0, maxW));
      } else {
        wideSpans.push({ p, minW: Math.max(0, minW), maxW: Math.max(0, maxW) });
      }
    }
    /* Tek kolonu asan hucreler: min eksiigi son kolona eklenir; max eksiigi
       kapsanan kolonlara esit payla dagitilir (pratik da gitim). */
    for (const sc of wideSpans) {
      let sumMin = 0;
      let sumMax = 0;
      for (let c = sc.p.col; c < sc.p.col + sc.p.colSpan; c++) {
        sumMin += colMin[c];
        sumMax += colMax[c];
      }
      if (sumMin < sc.minW) colMin[sc.p.col + sc.p.colSpan - 1] += sc.minW - sumMin;
      if (sumMax < sc.maxW) {
        const per = (sc.maxW - sumMax) / sc.p.colSpan;
        for (let c = sc.p.col; c < sc.p.col + sc.p.colSpan; c++) colMax[c] += per;
      }
    }
    for (let c = 0; c < colCount; c++) colMax[c] = Math.max(colMax[c], colMin[c]);
    /* col genislikleri: sabit belirtim min/max'i martdir (kolon bunun
       altina inmez; tablo genisligi yettigince tam degerinde durur). */
    for (let c = 0; c < colPin.length; c++) {
      if (colPin[c] == null) continue;
      colMin[c] = Math.max(colMin[c], Math.min(colPin[c], avail));
      colMax[c] = Math.max(colMax[c], Math.min(colPin[c], avail));
    }
    const colMinTotal = spacingX * (colCount + 1) + colMin.reduce((a, b) => a + b, 0);
    const colMaxTotal = spacingX * (colCount + 1) + colMax.reduce((a, b) => a + b, 0);
    return { rows, colCount, colMin, colMax, colPin, placements, spacingX, spacingY, minTotal: colMinTotal, maxTotal: colMaxTotal };
  }

  /* col/colgroup elemanlarindan kolon tanimlarini topla: her girdi
     {kind:'px'|'pct', value} ya da null (belirtilmemis). span genisletilir. */
  collectColumnDefs(tableEl) {
    const defs = [];
    if (!tableEl || tableEl.nodeType !== 1) return defs;
    const colWidthOf = (el) => {
      const attr = String(el.getAttribute('width') ?? '').trim();
      const styleW = el.style && el.style.width !== 'auto' ? String(el.style.width) : '';
      const raw = attr || styleW;
      if (!raw) return null;
      const pct = raw.match(/^([+\d.]+)%$/);
      if (pct) {
        const v = parseFloat(pct[1]);
        return Number.isFinite(v) && v > 0 ? { kind: 'pct', value: v } : null;
      }
      const n = parseFloat(raw);
      return Number.isFinite(n) && n > 0 ? { kind: 'px', value: n } : null;
    };
    const spanEntries = (el) => {
      const count = Math.min(999, Math.max(1, parseInt(el.getAttribute('span'), 10) || 1));
      const width = colWidthOf(el);
      const out = [];
      for (let i = 0; i < count; i++) out.push(width);
      return out;
    };
    for (const node of tableEl.children) {
      if (node.localName === 'col') {
        defs.push(...spanEntries(node));
      } else if (node.localName === 'colgroup') {
        const cols = node.children.filter((c) => c.localName === 'col');
        let covered = 0;
        for (const col of cols) {
          const entries = spanEntries(col);
          defs.push(...entries);
          covered += entries.length;
        }
        const groupSpan = Math.min(999, Math.max(0, parseInt(node.getAttribute('span'), 10) || 0));
        if (groupSpan > covered) {
          for (let i = 0; i < groupSpan - covered; i++) defs.push(colWidthOf(node));
        } else if (!cols.length && !groupSpan && colWidthOf(node)) {
          defs.push(colWidthOf(node)); // span yok: tek kolona uygula (pratik)
        }
      }
    }
    return defs;
  }

  /* border-collapse: collapse icin bitisik kenarlar: kalin kenar kazanir;
     genislik ve renk owner hücreye yazilir, karsi hücrenin kenari sifir.
     Taban degerler hücrede bir kez saklanir; her olcude sifirdan kurulur. */
  resolveCollapsedBorders(placements) {
    for (const p of placements) {
      const cell = p.cell;
      const s = cell.style;
      if (!cell._collapseBase) {
        cell._collapseBase = {
          top: num(s.borderTopWidth), right: num(s.borderRightWidth),
          bottom: num(s.borderBottomWidth), left: num(s.borderLeftWidth),
          topColor: s.borderTopColor, rightColor: s.borderRightColor,
          bottomColor: s.borderBottomColor, leftColor: s.borderLeftColor,
        };
      }
      const b = cell._collapseBase;
      s.borderTopWidth = b.top; s.borderRightWidth = b.right;
      s.borderBottomWidth = b.bottom; s.borderLeftWidth = b.left;
      s.borderTopColor = b.topColor; s.borderRightColor = b.rightColor;
      s.borderBottomColor = b.bottomColor; s.borderLeftColor = b.leftColor;
    }
    const rowCells = new Map();
    for (const p of placements) {
      if (!rowCells.has(p.row)) rowCells.set(p.row, []);
      rowCells.get(p.row).push(p);
    }
    for (const list of rowCells.values()) {
      list.sort((x, y) => x.col - y.col);
      /* Yatay: ayni satirda bitisik hücreler ayni dikey cizgiyi paylasir;
         kalin (veya renkli) kenar sahibi a'da toplaniyor. */
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1];
        const b = list[i];
        if (a.col + a.colSpan !== b.col) continue;
        const aW = a.cell._collapseBase.right;
        const bW = b.cell._collapseBase.left;
        if (bW > aW) {
          a.cell.style.borderRightWidth = bW;
          a.cell.style.borderRightColor = b.cell._collapseBase.leftColor;
        }
        b.cell.style.borderLeftWidth = 0;
      }
    }
    /* Dikey: satir r ile r+1 arasindaki yatay cizgi: a'nin son satiri
       r iken (rowspan'in adi yok), a'nin alt = b'nin üst kenarindan kalin. */
    for (const [r, list] of rowCells) {
      const below = rowCells.get(r + 1);
      if (!below) continue;
      for (const a of list) {
        if (a.row + a.rowSpan - 1 !== r) continue;
        for (const b of below) {
          const lo = Math.max(a.col, b.col);
          const hi = Math.min(a.col + a.colSpan - 1, b.col + b.colSpan - 1);
          if (lo > hi) continue;
          const aW = a.cell._collapseBase.bottom;
          const bW = b.cell._collapseBase.top;
          if (bW > aW && bW > num(a.cell.style.borderBottomWidth)) {
            a.cell.style.borderBottomWidth = bW;
            a.cell.style.borderBottomColor = b.cell._collapseBase.topColor;
          }
          b.cell.style.borderTopWidth = 0;
        }
      }
    }
  }

  layoutTable(box, availW, contentHeight, cbHeight) {
    availW = Math.max(0, availW);
    const plan = this.measureTableColumns(box, availW);
    const { rows, colCount, colMin, colMax, colPin, placements, spacingX, spacingY, minTotal, maxTotal } = plan;
    const s = box.style;
    const extra = this.horizontalExtra(box);

    /* Tablo genisligi: belirtilmisse o; degilse shrink-to-fit. */
    let tableW;
    if (s.width !== 'auto') {
      const w = resolvePct(s.width, availW) ?? 0;
      tableW = s.boxSizing === 'border-box' ? w - extra : w;
      tableW = Math.max(0, tableW);
    } else {
      let base = Math.min(maxTotal, availW);
      if (base < minTotal) base = Math.min(minTotal, availW);
      tableW = base;
    }

    /* Kolon dagitimi: col ile sabitlenen kolonlar once ayarlanir; kalan
       butce serbest kolonlara min tabanli oransal buyutmeyle paylasilir
       (kolon max'ini asmadan), artar ise esit, yetmez ise olceklenir. */
    let colW = colPin.map((pin, c) => (pin != null ? Math.max(colMin[c], pin) : colMin[c]));
    const budget = tableW - spacingX * (colCount + 1);
    let pinnedSum = 0;
    const freeCols = [];
    for (let c = 0; c < colCount; c++) {
      if (colPin[c] != null) pinnedSum += colW[c];
      else freeCols.push(c);
    }
    const freeSum = Math.max(0, budget - pinnedSum); // serbest kolonlara bütce
    /* Serbest kolon taban genislikleri colMin'den; pin etkisi colMin'e
       eklenmedi (colMin[pin] pin'i icerir) — bütce asimi olmasin diye
       serbestlarda orijinal min kullanama yerine mevcut colMin kullanilir. */
    const minFree = freeCols.reduce((a, c) => a + colW[c], 0);
    if (freeCols.length && freeSum > minFree) {
      let rem = freeSum - minFree;
      for (let guard = 0; guard < freeCols.length * 2 && rem > 0.01; guard++) {
        let room = 0;
        for (const c of freeCols) room += Math.max(0, colMax[c] - colW[c]);
        if (room <= 1e-6) break; // serbest her kolon max'inda: esit pay
        const need = Math.min(rem, room);
        let assigned = 0;
        for (const c of freeCols) {
          const g = colMax[c] - colW[c];
          if (g <= 0) continue;
          const share = need * g / room;
          colW[c] += share;
          assigned += share;
        }
        rem -= assigned;
      }
      if (rem > 0.01) {
        const per = rem / freeCols.length;
        for (const c of freeCols) colW[c] += per;
      }
    } else if (freeCols.length && freeSum < minFree && minFree > 0) {
      const factor = freeSum / minFree;
      for (const c of freeCols) colW[c] *= factor;
    }
    colW = colW.map((w) => Math.max(0, w));
    tableW = colW.reduce((a, b) => a + b, 0) + spacingX * (colCount + 1);

    /* Kutu boyutunu nihai tablo genisligi kullanır (shrink-to-fit). */
    box.width = tableW + extra;
    box.contentWidth = Math.max(0, tableW);

    /* Caption: dusulu satirlarin uzerinde blok akisi olarak. */
    let cursorY = box.contentY;
    for (const child of box.children) {
      if (isOutOfFlow(child) || !child.isCaption) continue;
      this.layoutBlock(child, box.contentX, cursorY + Math.max(0, num(child.margin.top)), tableW, cbHeight ?? null);
      cursorY = child.y + child.height + num(child.margin.bottom);
    }

    /* 1. gecis: hucreleri son kolon genisliklerinde yerlestir (geçici Y). */
    const rowH = rows.map(() => 0);
    const cellInfos = new Map();
    for (const p of placements) {
      let w = 0;
      for (let c = p.col; c < p.col + p.colSpan; c++) w += colW[c];
      w += spacingX * Math.max(0, p.colSpan - 1);
      let x = spacingX;
      for (let c = 0; c < p.col; c++) x += colW[c] + spacingX;
      this.layoutBlock(p.cell, box.contentX + x, box.contentY + spacingY, Math.max(0, w), cbHeight ?? null, { ignoreAutoMargins: true });
      let contentBottom = 0;
      for (const child of p.cell.children) contentBottom = Math.max(contentBottom, child.y + child.height + num(child.margin.bottom));
      contentBottom -= p.cell.contentY;
      cellInfos.set(p, { p, x, w, contentBottom, contentX: p.cell.contentX, contentY: p.cell.contentY });
    }

    /* Satir yukseklikleri: baslattiklari hucreler; rowspan noksanlari son
       kapsanan satira eklenir. */
    for (const info of cellInfos.values()) {
      if (info.p.rowSpan === 1) {
        rowH[info.p.row] = Math.max(rowH[info.p.row], info.p.cell.height);
      } else {
        continue;
      }
    }
    for (const info of cellInfos.values()) {
      const p = info.p;
      if (p.rowSpan <= 1) continue;
      let covered = spacingY * (p.rowSpan - 1);
      for (let r = p.row; r < p.row + p.rowSpan; r++) covered += rowH[r];
      const need = p.cell.height - covered;
      if (need > 0) {
        const last = Math.min(rows.length - 1, p.row + p.rowSpan - 1);
        rowH[last] += need;
      }
    }
    rows.forEach((tr, r) => {
      if (tr.style.height !== 'auto') {
        const h = resolvePct(tr.style.height, cbHeight) ?? 0;
        rowH[r] = Math.max(rowH[r], h);
      }
    });

    /* 2. gecis: nihai konumlar + dikey hizalama (satir ustleri sabit). */
    let y = cursorY + spacingY;
    rows.forEach((tr, r) => {
      tr.x = box.contentX;
      tr.y = y;
      tr.width = tableW;
      tr.height = rowH[r];
      tr.contentX = tr.x;
      tr.contentY = tr.y;
      tr.contentWidth = tr.width;
      tr.contentHeight = tr.height;
      y += rowH[r] + spacingY;
    });
    const allBottom = y;

    for (const info of cellInfos.values()) {
      const { p } = info;
      let areaH = spacingY * Math.max(0, p.rowSpan - 1);
      for (let r = p.row; r < p.row + p.rowSpan; r++) areaH += rowH[r];
      const cell = p.cell;
      const topY = rows[p.row].y;
      cell.x = box.contentX + info.x;
      cell.y = topY;
      cell.width = info.w;
      cell.height = areaH;
      cell.contentX = cell.x + cell.border.left + cell.padding.left;
      cell.contentY = cell.y + cell.border.top + cell.padding.top;
      cell.contentWidth = Math.max(0, info.w - this.horizontalExtra(cell));
      cell.contentHeight = Math.max(0, areaH - this.verticalExtra(cell));

      /* valign: hücre içerik yüksekliği bilindikten sonra içerik kayar. */
      let valignOffset = 0;
      const va = cell.style.verticalAlign;
      if (va === 'middle' || va === 'bottom') {
        const gap = Math.max(0, cell.contentHeight - Math.max(0, info.contentBottom));
        valignOffset = va === 'middle' ? gap / 2 : gap;
      }
      const dx = cell.contentX - info.contentX;
      const dy = cell.contentY + valignOffset - info.contentY;
      if (dx || dy) for (const child of cell.children) this.shiftSubtree(child, dx, dy);
    }

    /* Satir gruplarina konum/boyut (transparan passthrough). */
    for (const group of box.children) {
      if (isOutOfFlow(group) || !group.isRowGroup) continue;
      const gRows = rows.filter((r) => r.parentBox === group);
      if (!gRows.length) continue;
      const g0 = gRows[0];
      const gl = gRows[gRows.length - 1];
      group.x = box.contentX;
      group.width = tableW;
      group.y = g0.y;
      group.height = gl.y + gl.height - g0.y;
      group.contentX = group.x;
      group.contentY = group.y;
      group.contentWidth = group.width;
      group.contentHeight = group.height;
    }

    return Math.max(0, allBottom - box.contentY);
  }

  /* ------------------------------------------------------------------ *
   * Grid
   * ------------------------------------------------------------------ */

  /* Iz listesi (style.gridTemplateColumns) -> [(px|pct|fr|auto) ...] */
  parseTracks(template, availBasis) {
    if (!template || !template.length) return null;
    return template.map((token) => {
      if (typeof token === 'string') return { kind: 'auto' };
      if ('fr' in token) return { kind: 'fr', value: Math.max(0, token.fr) };
      if ('pct' in token) return { kind: 'px', value: availBasis == null ? 0 : Math.max(0, (availBasis * token.pct) / 100) };
      return { kind: 'px', value: Math.max(0, Number(token.n) || 0) };
    });
  }

  gridRangeFree(occupied, row, col, rowSpan, colSpan) {
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) {
        if (occupied.has(r + ':' + c)) return false;
      }
    }
    return true;
  }

  /* Satir-temelli otomatik yerlesim: her ogeyi bos hücreye yerlestirir,
     span'leri ve acik kolon baslangicini korur. */
  placeGridItems(items, colCount) {
    const occupied = new Set();
    const placements = [];
    let cursorRow = 0;
    for (const item of items) {
      const style = item.style ?? {};
      const colSpan = Math.min(colCount, Math.max(1, style.gridColumnSpan ?? 1));
      const rowSpan = Math.min(32, Math.max(1, style.gridRowSpan ?? 1));
      const colStart = typeof style.gridColumnStart === 'number' ? style.gridColumnStart : null;
      let row = cursorRow;
      let col = 0;
      if (colStart != null) {
        // acik kolon: kurulmus satirlara geri donup uyan ilk satiri arar
        col = Math.min(colCount - colSpan, Math.max(0, colStart - 1));
        let found = -1;
        for (let r = 0; r < 256; r++) {
          if (this.gridRangeFree(occupied, r, col, rowSpan, colSpan)) { found = r; break; }
        }
        row = Math.min(255, found);
      } else {
        while (true) {
          let spot = -1;
          for (let c = 0; c <= colCount - colSpan; c++) {
            if (this.gridRangeFree(occupied, row, c, rowSpan, colSpan)) { spot = c; break; }
          }
          if (spot !== -1) { col = spot; break; }
          row++;
        }
      }
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = col; c < col + colSpan; c++) occupied.add(r + ':' + c);
      }
      placements.push({ item, row, col, colSpan, rowSpan });
      cursorRow = Math.max(cursorRow, row);
    }
    const rowCount = Math.max(1, placements.reduce((m, p) => Math.max(m, p.row + p.rowSpan), 0));
    return { list: placements, rowCount };
  }

  layoutGrid(box, contentWidth, contentHeight, cbHeight) {
    const s = box.style;
    const gapC = Math.max(0, num(s.columnGap));
    const gapR = Math.max(0, num(s.rowGap));
    const items = box.children.filter((c) => !isOutOfFlow(c));
    if (!items.length) return 0;

    const tracks = this.parseTracks(s.gridTemplateColumns, contentWidth) ?? [{ kind: 'auto' }];
    const colCount = tracks.length;
    const placement = this.placeGridItems(items, colCount);
    const rowCount = placement.rowCount;
    const rows = this.parseTracks(s.gridTemplateRows, contentHeight ?? this.height) ?? [];

    /* 1) Oge olculeri: genislikler icin kenarlar cozulur */
    for (const p of placement.list) {
      const item = p.item;
      this.resolveEdges(item, contentWidth);
      const ml = num(item.margin.left);
      const mr = num(item.margin.right);
      const mt = num(item.margin.top);
      const mb = num(item.margin.bottom);
      p.mt = mt; p.mb = mb; p.ml = ml; p.mr = mr;
    }

    /* 2) Kolon boyutlari
       - px/percent: kesin
       - auto: kolonun tek-span ogelerinin genisligi (yayilan ogeler esit dagilir)
       - fr: kalan bolumden pay */
    const autoBase = new Array(colCount).fill(0);
    const frList = [];
    let definite = 0;
    for (const p of placement.list) {
      const item = p.item;
      let w;
      if (item.style.width !== 'auto') {
        const resolved = resolvePct(item.style.width, contentWidth) ?? 0;
        w = item.style.boxSizing === 'border-box' ? resolved : resolved + this.horizontalExtra(item);
      } else if (item.kind === 'image') {
        const entry = item.image;
        w = (entry?.width || parseInt(item.el?.getAttribute('width'), 10) || 150) + item.border.left + item.border.right;
      } else {
        w = this.intrinsicBorderWidth(item, contentWidth);
      }
      w += p.ml + p.mr;
      p.w = w;
      if (p.colSpan === 1) autoBase[p.col] = Math.max(autoBase[p.col], w);
      else {
        const share = w / p.colSpan;
        for (let c = p.col; c < p.col + p.colSpan; c++) autoBase[c] = Math.max(autoBase[c], share);
      }
    }
    const trackW = new Array(colCount).fill(0);
    for (let i = 0; i < colCount; i++) {
      const t = tracks[i];
      if (t.kind === 'px') { trackW[i] = t.value; definite += t.value; }
      else if (t.kind === 'fr') { trackW[i] = null; frList.push(i); }
      else trackW[i] = autoBase[i];
    }
    const gapsTotal = gapC * Math.max(0, colCount - 1);
    if (frList.length) {
      // Spesifikasyona uygun fr cozumu: kalan hacim yalnizca esnek olmayan
      // (px/%/auto) izlerin boyutundan dusulur; fr izleri min-content tabanli.
      let used = definite + gapsTotal;
      let sumFr = 0;
      for (let i = 0; i < colCount; i++) {
        if (tracks[i].kind === 'fr') { sumFr += tracks[i].value; continue; }
        used += trackW[i];
      }
      const remaining = contentWidth - used;
      const sumFrSafe = sumFr || 1;
      for (const i of frList) {
        const share = remaining > 0 ? (remaining * tracks[i].value) / sumFrSafe : 0;
        trackW[i] = Math.max(trackW[i], share);
      }
      // remaining <= 0 -> fr izleri min-content boyutunda kalir (tasma olur)
    }

    /* 3) Satir yukseklikleri (ogeler gecici olarak yerlestirilir) */
    const measure = new Map();
    let rowH = new Array(rowCount).fill(0);
    for (const p of placement.list) {
      const item = p.item;
      const spanW = this.trackSpanWidth(trackW, gapC, p.col, p.colSpan);
      p.spanW = spanW;
      let borderW;
      if (s.justifyItems === 'stretch' && item.style.width === 'auto') {
        borderW = Math.max(0, spanW - p.ml - p.mr);
      } else if (item.style.width !== 'auto') {
        const resolved = resolvePct(item.style.width, contentWidth) ?? 0;
        borderW = item.style.boxSizing === 'border-box' ? resolved : resolved + this.horizontalExtra(item);
      } else {
        borderW = Math.min(this.intrinsicBorderWidth(item, contentWidth), spanW);
      }
      p.borderW = borderW;
      this.layoutBlock(item, 0, 0, contentWidth, contentHeight ?? cbHeight, {
        widthOverride: borderW,
        ignoreAutoMargins: true,
      });
      measure.set(item, item.height);
      const outer = item.height + p.mt + p.mb;
      if (p.rowSpan === 1) rowH[p.row] = Math.max(rowH[p.row], outer);
    }
    // Yayilan ogeler: kucuk olan satirlari buyuterek ihtiyaci esit dagit
    for (const p of placement.list) {
      if (p.rowSpan === 1) continue;
      const item = p.item;
      const outer = measure.get(item) + p.mt + p.mb;
      let sum = gapR * Math.max(0, p.rowSpan - 1);
      for (let r = p.row; r < p.row + p.rowSpan; r++) sum += rowH[r];
      if (outer > sum) {
        const deficit = outer - sum;
        const per = deficit / p.rowSpan;
        for (let r = p.row; r < p.row + p.rowSpan; r++) rowH[r] += per;
      }
    }
    // kesin satir sablonlari en az yukseklik olarak uygulanir
    for (let r = 0; r < Math.min(rowCount, rows.length); r++) {
      const t = rows[r];
      if (t.kind === 'px') rowH[r] = Math.max(rowH[r], t.value);
    }

    /* 4) Konum dagitimi (justify/align-content) */
    let colOffset = [];
    {
      let total = gapsTotal;
      for (let i = 0; i < colCount; i++) total += num(trackW[i]);
      let x = 0;
      let extra = 0;
      const leftover = contentWidth - total;
      const jc = s.justifyContent;
      if (leftover > 0) {
        if (jc === 'center') x = leftover / 2;
        else if (jc === 'flex-end' || jc === 'right' || jc === 'end') x = leftover;
        else if (jc === 'space-between' && colCount > 1) extra = leftover / (colCount - 1);
        else if (jc === 'space-around') { extra = leftover / colCount; x = extra / 2; }
        else if (jc === 'space-evenly') { extra = leftover / (colCount + 1); x = extra; }
      }
      colOffset = new Array(colCount).fill(0);
      for (let i = 0; i < colCount; i++) {
        colOffset[i] = x;
        x += num(trackW[i]) + gapC + extra;
      }
    }

    let rowY = new Array(rowCount).fill(0);
    {
      let total = gapR * Math.max(0, rowCount - 1);
      for (let r = 0; r < rowCount; r++) total += rowH[r];
      let y = 0;
      let extra = 0;
      if (contentHeight != null) {
        const leftover = Math.max(0, contentHeight - total);
        const ac = s.alignContent;
        if (ac === 'center') y = leftover / 2;
        else if (ac === 'end') y = leftover;
        else if (ac === 'space-between' && rowCount > 1) extra = leftover / (rowCount - 1);
        else if (ac === 'space-around') { extra = leftover / rowCount; y = extra / 2; }
        else if (ac === 'space-evenly') { extra = leftover / (rowCount + 1); y = extra; }
      }
      for (let r = 0; r < rowCount; r++) {
        rowY[r] = y;
        y += rowH[r] + gapR + extra;
      }
    }

    /* 5) Ogeleri nihai konumda yerlestir */
    const alignOf = (subj) => {
      const a = subj.style.alignSelf !== 'auto' ? subj.style.alignSelf : s.alignItems;
      if (a === 'stretch' || a === 'normal') return 'stretch';
      if (a === 'flex-start' || a === 'start') return 'start';
      if (a === 'flex-end' || a === 'end') return 'end';
      if (a === 'center') return 'center';
      return 'start';
    };
    for (const p of placement.list) {
      const item = p.item;
      const lastRow = p.row + p.rowSpan - 1;
      const spanTop = rowY[p.row];
      const spanBottom = rowY[lastRow] + rowH[lastRow];
      const blockH = Math.max(0, spanBottom - spanTop);
      const startX = colOffset[p.col];
      const spanX = this.trackSpanWidth(trackW, gapC, p.col, p.colSpan);
      const baseX = box.contentX + startX;
      // yatay hizalama
      let targetX = baseX; // stretch/start: ogemargin kenari izde
      if (s.justifyItems === 'center') {
        targetX = baseX + (spanX - p.borderW) / 2 - p.ml;
      } else if (s.justifyItems === 'end') {
        targetX = baseX + spanX - p.borderW - p.ml;
      }
      const vAlign = alignOf(item);
      let targetY;
      if (vAlign === 'stretch' && item.style.height === 'auto' && p.rowSpan === 1) {
        const h = Math.max(0, rowH[p.row] - p.mt - p.mb);
        this.layoutBlock(item, targetX, box.contentY + spanTop + p.mt, contentWidth, contentHeight ?? cbHeight, {
          widthOverride: p.borderW,
          heightOverride: h,
          ignoreAutoMargins: true,
        });
        targetY = box.contentY + spanTop + p.mt;
      } else if (vAlign === 'stretch' && item.style.height === 'auto') {
        const h = Math.max(0, blockH - p.mt - p.mb);
        this.layoutBlock(item, targetX, box.contentY + spanTop + p.mt, contentWidth, contentHeight ?? cbHeight, {
          widthOverride: p.borderW,
          heightOverride: h,
          ignoreAutoMargins: true,
        });
        targetY = box.contentY + spanTop + p.mt;
      } else {
        this.layoutBlock(item, targetX, box.contentY + spanTop + p.mt, contentWidth, contentHeight ?? cbHeight, {
          widthOverride: p.borderW,
          ignoreAutoMargins: true,
        });
        if (vAlign === 'center') targetY = box.contentY + spanTop + p.mt + (blockH - p.mt - p.mb - item.height) / 2;
        else if (vAlign === 'end') targetY = box.contentY + spanBottom - p.mb - item.height;
        else targetY = box.contentY + spanTop + p.mt;
      }
      this.shiftSubtree(item, 0, targetY - item.y);
    }

    return Math.max(0, gapR * Math.max(0, rowCount - 1) + rowH.reduce((a, v) => a + v, 0));
  }

  trackSpanWidth(trackW, gap, col, span) {
    let total = gap * Math.max(0, span - 1);
    for (let c = col; c < Math.min(col + span, trackW.length); c++) total += num(trackW[c]);
    return Math.max(0, total);
  }

  intrinsicGridWidth(box, avail) {
    const gap = Math.max(0, num(box.style.columnGap));
    const items = box.children.filter((c) => !isOutOfFlow(c));
    if (!items.length) return 0;
    const tracks = this.parseTracks(box.style.gridTemplateColumns, avail) ?? [{ kind: 'auto' }];
    const colCount = tracks.length;
    // placeGridItems yalnizca style.gridColumnSpan/Start okudugu icin
    // hafif sarmalayicilar yerlesim surer; olcumler gercek kutulara yapilir.
    const wrappers = items.map((item) => ({
      style: {
        gridColumnSpan: item.style.gridColumnSpan ?? 1,
        gridColumnStart: item.style.gridColumnStart,
      },
    }));
    const placement = this.placeGridItems(wrappers, colCount);
    const contributions = new Array(colCount).fill(0);
    for (let i = 0; i < placement.list.length; i++) {
      const p = placement.list[i];
      const item = items[i];
      let w;
      this.resolveEdges(item, avail);
      if (item.style.width !== 'auto') {
        const resolved = resolvePct(item.style.width, avail) ?? 0;
        w = item.style.boxSizing === 'border-box' ? resolved : resolved + this.horizontalExtra(item);
      } else if (item.kind === 'image') {
        const entry = item.image;
        w = (entry?.width || parseInt(item.el?.getAttribute('width'), 10) || 150) + item.border.left + item.border.right;
      } else {
        w = this.intrinsicBorderWidth(item, avail);
      }
      w += num(item.margin.left) + num(item.margin.right);
      if (p.colSpan === 1) contributions[p.col] = Math.max(contributions[p.col], w);
      else {
        const share = w / p.colSpan;
        for (let c = p.col; c < p.col + p.colSpan; c++) contributions[c] = Math.max(contributions[c], share);
      }
    }
    let total = gap * Math.max(0, colCount - 1);
    tracks.forEach((t, i) => {
      if (t.kind === 'px') total += t.value;
      else total += contributions[i] ?? 0;
    });
    return Math.max(0, total);
  }

  /* ------------------------------------------------------------------ *
   * Konumlandirma
   * ------------------------------------------------------------------ */

  resolveRelative(root) {
    const walk = (box) => {
      if (box.style.position === 'relative') {
        let dx = 0;
        let dy = 0;
        if (box.style.left !== 'auto') dx = resolvePct(box.style.left, box.parentBox?.contentWidth ?? this.width) ?? 0;
        else if (box.style.right !== 'auto') dx = -(resolvePct(box.style.right, box.parentBox?.contentWidth ?? this.width) ?? 0);
        if (box.style.top !== 'auto') dy = resolvePct(box.style.top, box.parentBox?.contentHeight ?? this.height) ?? 0;
        else if (box.style.bottom !== 'auto') dy = -(resolvePct(box.style.bottom, box.parentBox?.contentHeight ?? this.height) ?? 0);
        if (dx || dy) this.shiftSubtree(box, dx, dy);
      }
      for (const child of box.children) walk(child);
    };
    walk(root);
  }

  resolveAbsolutes(root) {
    const walk = (box) => {
      for (const child of box.children) {
        if (child.style.position === 'absolute' || child.style.position === 'fixed') {
          this.layoutAbsolute(child, box);
        }
        walk(child);
      }
    };
    walk(root);
  }

  containingBlock(box, parent) {
    if (box.style.position === 'fixed') {
      return { x: 0, y: 0, width: this.width, height: this.height, fixed: true };
    }
    let p = parent;
    while (p) {
      if (p.style.position !== 'static') {
        return {
          x: p.x + p.border.left,
          y: p.y + p.border.top,
          width: Math.max(0, p.width - p.border.left - p.border.right),
          height: Math.max(0, p.height - p.border.top - p.border.bottom),
        };
      }
      p = p.parentBox;
    }
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  layoutAbsolute(box, parent) {
    const cb = this.containingBlock(box, parent);
    const s = box.style;
    this.resolveEdges(box, cb.width);
    const left = resolvePct(s.left, cb.width);
    const right = resolvePct(s.right, cb.width);
    const top = resolvePct(s.top, cb.height);
    const bottom = resolvePct(s.bottom, cb.height);
    const margins = this.marginH(box);
    let borderW = null;
    if (s.width !== 'auto') {
      const w = resolvePct(s.width, cb.width) ?? 0;
      borderW = s.boxSizing === 'border-box' ? w : w + this.horizontalExtra(box);
    } else if (left != null && right != null) {
      borderW = Math.max(0, cb.width - left - right - margins.left - margins.right);
    } else {
      borderW = Math.min(this.intrinsicBorderWidth(box, cb.width), cb.width);
    }

    const x = cb.x + (left ?? margins.left);
    let y = cb.y + (top ?? 0);
    this.layoutBlock(box, x - margins.left, y, cb.width, cb.height, {
      widthOverride: borderW,
      heightOverride: this.absoluteHeight(box, s, cb, top, bottom),
    });

    if (left == null && right != null) {
      const targetX = cb.x + cb.width - right - box.width;
      this.shiftSubtree(box, targetX - box.x, 0);
    }
    if (top == null && bottom != null) {
      const targetY = cb.y + cb.height - bottom - box.height;
      this.shiftSubtree(box, 0, targetY - box.y);
    }
    box.absolute = true;
    box.fixed = !!cb.fixed;
    if (cb.fixed) box.fixed = true;
  }

  absoluteHeight(box, s, cb, top, bottom) {
    if (s.height !== 'auto') {
      const h = resolvePct(s.height, cb.height);
      return h == null ? null : (s.boxSizing === 'border-box' ? h : h + this.verticalExtra(box));
    }
    if (top != null && bottom != null) {
      return Math.max(0, cb.height - top - bottom);
    }
    return null;
  }

  shiftSubtree(box, dx, dy) {
    if (!dx && !dy) return;
    const walk = (b) => {
      b.x += dx;
      b.y += dy;
      b.contentX += dx;
      b.contentY += dy;
      if (b.lineBoxes?.length) {
        for (const line of b.lineBoxes) {
          line.top += dy;
          for (const frag of line.fragments) {
            frag.x += dx;
            frag.y += dy;
            frag.lineTop += dy;
            if (frag.baseline != null) frag.baseline += dy;
            if (frag.rect) { frag.rect.x += dx; frag.rect.y += dy; }
          }
        }
      }
      if (b._segments) for (const seg of b._segments) { seg.x += dx; seg.y += dy; }
      if (b._fragments) for (const f of b._fragments) { f.x += dx; f.y += dy; }
      for (const child of b.children) walk(child);
    };
    walk(box);
  }

  finishSegments(root) {
    const walk = (box) => {
      if (box._segments?.length) {
        const byLine = new Map();
        for (const seg of box._segments) {
          let entry = byLine.get(seg.line);
          if (!entry) { entry = { x0: seg.x, x1: seg.x + seg.width, y0: seg.y, y1: seg.y + seg.height, line: seg.line }; byLine.set(seg.line, entry); }
          else {
            entry.x0 = Math.min(entry.x0, seg.x);
            entry.x1 = Math.max(entry.x1, seg.x + seg.width);
            entry.y0 = Math.min(entry.y0, seg.y);
            entry.y1 = Math.max(entry.y1, seg.y + seg.height);
          }
        }
        box._segments = [...byLine.values()].sort((a, b) => a.line - b.line);
      }
      for (const child of box.children) walk(child);
    };
    walk(root);
  }

  /* Her kutu icin kirpma dikdortgeni (padding box) ve kaydirilabilir
     icerik olculerini hesaplar. Kutu alt agacina girmeden once cocuklarin
     kendi tasma bilgisi hazir olur; boylece ic ice kirpma dogru kalir. */
  finalizeOverflow(root) {
    const walk = (box) => {
      for (const child of box.children) walk(child);
      const ox = box.style.overflowX;
      const oy = box.style.overflowY;
      const clipsX = ox && ox !== 'visible';
      const clipsY = oy && oy !== 'visible';
      if (!clipsX && !clipsY) return;

      const clipRect = {
        x: box.x + box.border.left,
        y: box.y + box.border.top,
        width: Math.max(0, box.width - box.border.left - box.border.right),
        height: Math.max(0, box.height - box.border.top - box.border.bottom),
      };
      let maxRight = 0;
      let maxBottom = 0;
      /* Yalniz sonlu olculer kaydirma alanina girer; yarim kalmis bir
         olcum NaN ile tum tasma degerini bozmasin. */
      const include = (right, bottom) => {
        if (Number.isFinite(right)) maxRight = Math.max(maxRight, right - clipRect.x);
        if (Number.isFinite(bottom)) maxBottom = Math.max(maxBottom, bottom - clipRect.y);
      };
      const scan = (node, isRoot) => {
        if (node.fixed) return;
        if (!isRoot) {
          include(node.x + node.width + num(node.margin.right),
            node.y + node.height + num(node.margin.bottom));
          /* Ic ice kirpan kutu: kendi disina tasan torunlari ust kutunun
             kaydirma alanina ekleme. */
          if (node._overflow) return;
        }
        for (const line of node.lineBoxes ?? []) {
          for (const frag of line.fragments) {
            if (frag.type === 'atomic' && frag.rect) {
              include(frag.rect.x + frag.rect.width, frag.rect.y + frag.rect.height);
            } else {
              include(frag.x + frag.width, frag.lineTop + frag.lineHeight);
            }
          }
        }
        for (const child of node.children) scan(child, false);
      };
      scan(box, true);

      box._overflow = {
        clipRect,
        scrollWidth: Math.max(clipRect.width, maxRight),
        scrollHeight: Math.max(clipRect.height, maxBottom),
      };
    };
    walk(root);
  }

  /* position: sticky kutularini normal akistaki taban konumlariyla toplar.
     Kaydirma sirasinda motor bu kayitlari kullanarak alt agaci kaydirir. */
  collectSticky(root) {
    const list = [];
    const walk = (box) => {
      /* Metin ve anonim kutular boyama icin ust tarafin stilini kopyalar;
         yalnizca gercek eleman kutusu sticky katmana girer. */
      if (box.style.position === 'sticky' && box.el?.nodeType === 1) {
        const parent = box.parentBox;
        const basis = parent?.contentHeight ?? this.height;
        const top = box.style.top === 'auto' ? null : resolvePct(box.style.top, basis);
        const bottom = box.style.bottom === 'auto' ? null : resolvePct(box.style.bottom, basis);
        list.push({
          box,
          baseY: box.y,
          top,
          bottom,
          limitTop: parent ? parent.contentY : 0,
          limitBottom: parent ? parent.contentY + parent.contentHeight : this.height,
          offsetY: 0,
        });
      }
      for (const child of box.children) walk(child);
    };
    walk(root);
    this.sticky = list;
  }

  documentHeight(root) {
    let max = 0;
    const walk = (box) => {
      if (box.fixed) return;
      max = Math.max(max, box.y + box.height + num(box.margin.bottom));
      /* Kirpan kutunun disina tasan icerik sayfayi buyutmez. */
      if (box._overflow) return;
      for (const child of box.children) walk(child);
    };
    walk(root);
    return Math.max(0, Math.ceil(max));
  }
}

export function layoutDocument(document, options) {
  const engine = new LayoutEngine(options);
  return engine.run(document);
}

export function hitTest(layout, pageX, pageY) {
  const visit = (box, allowSticky) => {
    if (box.style.display === 'none' || box.style.visibility === 'hidden') return null;
    if (box.kind === 'text') return null;

    /* Kirpilan alanin disindaki nokta alt agaca islemez; kutunun kendi
       cercevesi yine de hedef olabilir. */
    const clip = box._overflow?.clipRect;
    const clippedOut = clip && (pageX < clip.x || pageX > clip.x + clip.width
      || pageY < clip.y || pageY > clip.y + clip.height);

    if (!clippedOut) {
      for (let i = box.children.length - 1; i >= 0; i--) {
        const child = box.children[i];
        if (!allowSticky && child.style.position === 'sticky') continue;
        const found = visit(child, allowSticky);
        if (found) return found;
      }

      if (box.lineBoxes?.length) {
        for (const line of box.lineBoxes) {
          for (let i = line.fragments.length - 1; i >= 0; i--) {
            const frag = line.fragments[i];
            if (frag.type === 'atomic') {
              if (pageX >= frag.rect.x && pageX <= frag.rect.x + frag.rect.width && pageY >= frag.rect.y && pageY <= frag.rect.y + frag.rect.height) {
                return frag.el ?? box.el;
              }
            } else {
              const rect = { x: frag.x, y: frag.y, width: frag.width, height: frag.lineHeight };
              if (pageX >= rect.x && pageX <= rect.x + rect.width && pageY >= frag.lineTop && pageY <= frag.lineTop + rect.height) {
                return frag.el ?? box.el;
              }
            }
          }
        }
      }
    }

    if (pageX >= box.x && pageX <= box.x + box.width && pageY >= box.y && pageY <= box.y + box.height) {
      return box.el;
    }
    return null;
  };

  /* Sticky katman normal akisin ustunde cizildigi icin once denenir. */
  const stickyRoots = [];
  const collect = (box) => {
    if (box.fixed) return;
    if (box.style.position === 'sticky') { stickyRoots.push(box); return; }
    for (const child of box.children) collect(child);
  };
  collect(layout.root);
  for (let i = stickyRoots.length - 1; i >= 0; i--) {
    const box = stickyRoots[i];
    let outsideClip = false;
    for (let parent = box.parentBox; parent; parent = parent.parentBox) {
      const rect = parent._overflow?.clipRect;
      if (!rect) continue;
      if (pageX < rect.x || pageX > rect.x + rect.width
        || pageY < rect.y || pageY > rect.y + rect.height) {
        outsideClip = true;
        break;
      }
    }
    if (outsideClip) continue;
    const found = visit(box, true);
    if (found) return found;
  }
  return visit(layout.root, false);
}
