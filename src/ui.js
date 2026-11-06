// Narvis kabuğu: motoru canvas'a bağlar, gezinme, kaynak düzenleyici,
// DOM/stil denetçisi ve konsolu yönetir. Motorun kendisi src/engine.js'te.

import { NarvisEngine } from './engine.js';
import { cssColor } from './css/values.js';

const $ = (id) => document.getElementById(id);

const canvas = $('viewport');
const stage = $('stage');
const stageWrap = $('stageWrap');
const selection = $('selection');
const hoverRing = $('hoverRing');
const scrollRail = $('scrollRail');
const scrollThumb = $('scrollThumb');

const addressForm = $('addressForm');
const addressInput = $('addressInput');
const backBtn = $('backBtn');
const forwardBtn = $('forwardBtn');
const reloadBtn = $('reloadBtn');
const brand = $('brand');
const viewports = $('viewports');
const inspectBtn = $('inspectBtn');
const editorBtn = $('editorBtn');
const devtoolsBtn = $('devtoolsBtn');

const editorPanel = $('editorPanel');
const editorText = $('editorText');
const editorFile = $('editorFile');
const editorRun = $('editorRun');
const editorReset = $('editorReset');
const editorClose = $('editorClose');
const devtools = $('devtools');
const devtoolsClose = $('devtoolsClose');
const domTree = $('domTree');
const styleList = $('styleList');
const styleListFull = $('styleListFull');
const styleFilter = $('styleFilter');
const styleElement = $('styleElement');
const selectionLabel = $('selectionLabel');
const consoleList = $('consoleList');
const consoleForm = $('consoleForm');
const consoleInput = $('consoleInput');
const consoleCount = $('consoleCount');
const clearConsole = $('clearConsole');
const openStyleTab = $('openStyleTab');
const boxModelSide = $('boxModelSide');
const boxModelFull = $('boxModelFull');

const statusText = $('statusText');
const statusDot = $('statusDot');
const statusPage = $('statusPage');
const statusViewport = $('statusViewport');
const statusScroll = $('statusScroll');
const statusNodes = $('statusNodes');
const statusPaint = $('statusPaint');

const infoNodes = $('infoNodes');
const infoBoxes = $('infoBoxes');
const infoStyle = $('infoStyle');
const infoLayout = $('infoLayout');
const infoPaint = $('infoPaint');
const infoViewport = $('infoViewport');

const toastEl = $('toast');
const filePicker = $('filePicker');

/* ------------------------------------------------------------------ *
 * Durum
 * ------------------------------------------------------------------ */

const state = {
  page: 'pages/demo.html',
  source: '',
  fetchedSource: '',
  history: [],
  historyIndex: -1,
  preset: 'desktop',
  inspect: false,
  selected: null,
  hoverEl: null,
  expanded: new Set(),
  lastNodes: -1,
  lastBoxes: -1,
  devtoolsOpen: true,
  editorOpen: false,
  filter: '',
  errors: 0,
  viewport: { width: 900, height: 640 },
};

let engine = null;
let pendingFileInput = null;
let treeRaf = 0;
let selectionRaf = 0;
let toastTimer = 0;
let moveRaf = 0;
let lastPointer = { x: 0, y: 0 };
let consoleTotal = 0;

/* ------------------------------------------------------------------ *
 * Motor
 * ------------------------------------------------------------------ */

const initial = desiredSize();
const engineOptions = {
  width: initial.width,
  height: initial.height,
  onStats: (stats) => handleStats(stats),
  onConsole: (entry) => appendConsole(entry.level, entry.text, entry.time),
  onNavigation: (href) => handleNavigation(href),
  onFormSubmit: () => setStatus('gönderiliyor…', 'busy'),
  onFileChoose: (input) => chooseFile(input),
  onFormResponse: (result) => handleFormResponse(result),
  onError: (entry) => {
    state.errors += 1;
    updateConsoleCount();
    setStatus('hata', 'error');
    toast(`Motor hatası: ${String(entry.text).split('\n')[0]}`, true);
  },
  onScroll: () => updateScrollUI(),
};

engine = new NarvisEngine(canvas, engineOptions);
engine.openEditor = openEditor;
state.viewport = { width: engine.viewport.width, height: engine.viewport.height };
window.NarvisShell = { engine, state };

/* Gizli yerel dosya secici: sayfadaki input[type=file] tiklamasi acar;
   secilen gercek File nesneleri motordaki input.files'a yazilir. */
function chooseFile(input) {
  if (!input || !filePicker) return;
  pendingFileInput = input;
  filePicker.multiple = input.hasAttribute('multiple');
  const accept = input.getAttribute('accept');
  if (accept) filePicker.setAttribute('accept', accept);
  else filePicker.removeAttribute('accept');
  filePicker.value = '';
  filePicker.click();
}

filePicker.addEventListener('change', () => {
  const target = pendingFileInput;
  pendingFileInput = null;
  if (!target) return;
  const count = filePicker.files?.length ?? 0;
  engine.setFiles(target, filePicker.files);
  if (count) setStatus(`${count} dosya seçildi`, 'ok');
});

/* ------------------------------------------------------------------ *
 * Görünüm boyutu
 * ------------------------------------------------------------------ */

function desiredSize() {
  const availW = Math.max(320, stageWrap.clientWidth - 48);
  const availH = Math.max(280, stageWrap.clientHeight - 46);
  let width = availW;
  if (state.preset === 'tablet') width = Math.min(820, availW);
  else if (state.preset === 'mobile') width = Math.min(390, availW);
  return { width, height: availH };
}

function applyViewport() {
  const next = desiredSize();
  if (next.width === state.viewport.width && next.height === state.viewport.height) return;
  state.viewport = next;
  engine.resize(next.width, next.height);
  updateScrollUI();
  scheduleSelection();
}

function setPreset(preset) {
  if (!['desktop', 'tablet', 'mobile'].includes(preset)) return;
  state.preset = preset;
  for (const btn of viewports.querySelectorAll('.view-btn')) {
    btn.classList.toggle('is-active', btn.dataset.preset === preset);
  }
  applyViewport();
}

const resizeObserver = new ResizeObserver(() => {
  // RO kendi zaten çerçeve başına birleştirir; doğrudan uygula ki arka
  // planda raf gecikmesi/bastırması görünümü takılı bırakmasın.
  applyViewport();
});
resizeObserver.observe(stageWrap);

/* ------------------------------------------------------------------ *
 * Sayfa yükleme / gezinme
 * ------------------------------------------------------------------ */

function resolvePage(raw) {
  let value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('#')) return { hash: value.slice(1) };

  value = value.replace(/^narvis:\/\//i, '');
  let url;
  try {
    if (value.startsWith('/') || value.startsWith('pages/')) {
      url = new URL(value.startsWith('/') ? value : '/' + value, location.href);
    } else {
      url = new URL(value, new URL(state.page, location.href));
    }
  } catch {
    return null;
  }

  if (url.origin !== location.origin) return { external: url.href };

  let path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!path || path.endsWith('/')) path += 'index.html';
  if (!path.startsWith('pages/')) path = 'pages/' + path;
  if (!/\.[a-z0-9]+$/i.test(path)) path += '.html';
  return { path, search: url.search, hash: url.hash.slice(1) };
}

async function loadPage(raw, options = {}) {
  const target = resolvePage(raw);
  if (!target) return false;
  if (target.external) {
    openExternal(target.external);
    return false;
  }
  if (target.hash && !target.path) {
    scrollToHash(target.hash);
    return true;
  }

  const path = target.path;
  const requestPath = path + (target.search || '');
  setStatus('getiriliyor…', 'busy');
  try {
    const response = await fetch(requestPath, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const html = await response.text();

    state.page = requestPath;
    state.source = html;
    state.fetchedSource = html;
    engine.load(html, { url: new URL(requestPath, location.href).href });
    afterLoad(target.hash);

    if (options.historyIndex != null) {
      state.historyIndex = options.historyIndex;
    } else if (options.push) {
      pushHistory(requestPath);
    }

    updateHistoryButtons();
    setStatus('hazır');
    return true;
  } catch (err) {
    setStatus('yüklenemedi', 'error');
    toast(`Sayfa yüklenemedi: ${path}`, true);
    appendConsole('error', `fetch ${path}: ${err.message}`);
    return false;
  }
}

function afterLoad(hash) {
  state.selected = null;
  state.expanded = new Set();
  state.lastNodes = -1;
  state.filter = '';
  styleFilter.value = '';

  const doc = engine.document;
  if (doc?.documentElement) state.expanded.add(doc.documentElement);
  if (doc?.body) state.expanded.add(doc.body);

  addressInput.value = state.page;
  statusPage.textContent = state.page;
  editorFile.textContent = state.page;
  if (state.editorOpen) editorText.value = state.source;

  const title = doc?.title ? `${doc.title} — Narvis` : 'Narvis — kendi HTML/JS motoru';
  document.title = title;

  clearSelection();
  rebuildTree();
  renderStyleLists();
  handleStats(engine.stats);
  updateScrollUI();
  updateHistoryButtons();

  if (hash) scrollToHash(hash);
}

function pushHistory(path) {
  if (state.history[state.historyIndex] === path) {
    updateHistoryButtons();
    return;
  }
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(path);
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

async function goHistory(delta) {
  const index = state.historyIndex + delta;
  if (index < 0 || index >= state.history.length) return;
  await loadPage(state.history[index], { historyIndex: index });
}

function updateHistoryButtons() {
  backBtn.disabled = state.historyIndex <= 0;
  forwardBtn.disabled = state.historyIndex >= state.history.length - 1;
}

function reloadPage() {
  loadPage(state.page, { push: false });
}

function handleNavigation(href) {
  const target = resolvePage(href);
  if (!target) return;
  if (target.external) {
    openExternal(target.external);
    return;
  }
  if (target.hash && !target.path) {
    scrollToHash(target.hash);
    return;
  }
  if (target.path) loadPage(target.path, { push: true, hash: target.hash });
}

/* Form yaniti: sunucudan donen HTML'i motorun yeni belgesi yapar.
   POST sonrasi URL adres cubuguna ve gecmise yazilir. */
function handleFormResponse(result) {
  if (!result) return false;
  const requestUrl = result.url || result.request?.url || state.page;
  const url = new URL(requestUrl, location.href);
  if (url.origin !== location.origin) {
    openExternal(url.href);
    return false;
  }
  if (!result.ok) {
    setStatus(`form ${result.status}`, 'error');
    toast(`Form yanıtı: ${result.status} ${result.statusText || ''}`.trim(), true);
    appendConsole('error', `${result.request?.method || 'GET'} ${url.pathname} → ${result.status}`);
    return false;
  }
  const type = result.response?.headers?.get?.('content-type') || '';
  if (type && !/text\/html/i.test(type)) {
    setStatus('hazır');
    toast(`Form yanıtı ${type} — sayfa olarak yüklenmedi.`);
    appendConsole('info', `Form yanıtı: ${type} (${result.status})`);
    return false;
  }

  const display = url.pathname + url.search;
  state.page = display;
  state.source = result.html;
  state.fetchedSource = result.html;
  engine.load(result.html, { url: url.href });
  afterLoad();
  pushHistory(display);
  setStatus('hazır');
  toast('Form gönderildi — yanıt sayfası yüklendi.');
  return true;
}

function openExternal(url) {
  toast('Harici bağlantı ana tarayıcıda açılıyor…');
  window.open(url, '_blank', 'noopener');
}

function scrollToHash(id) {
  if (!engine.document) return;
  const el = id ? engine.document.getElementById(id) : engine.document.body;
  if (!el) {
    toast(`Hedef bulunamadı: #${id}`, true);
    return;
  }
  const box = el._box;
  if (!box) return;
  engine.scrollTo({ left: 0, top: Math.max(0, box.y - 12) });
  updateScrollUI();
}

/* ------------------------------------------------------------------ *
 * Olay yönlendirme
 * ------------------------------------------------------------------ */

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/* Sürükleyerek metin seçerken imleç her harekette anında uygulanır; normal
   hover kontrolünde frame başına bir kez hareket ettirilir. */
canvas.addEventListener('mousemove', (event) => {
  const point = canvasPoint(event);
  lastPointer = point;
  if (engine.isDragSelecting()) {
    if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = 0; }
    engine.pointerMove(point.x, point.y);
    if (state.inspect) canvas.style.cursor = 'crosshair';
    return;
  }
  if (moveRaf) return;
  moveRaf = requestAnimationFrame(() => {
    moveRaf = 0;
    engine.pointerMove(lastPointer.x, lastPointer.y);
    if (state.inspect) canvas.style.cursor = 'crosshair';
  });
});

canvas.addEventListener('mouseleave', () => {
  engine.setHover(null);
});

/* Fare asagi/yukari: motor surukleme secimini ve cift tigi yonetir. */
canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  const point = canvasPoint(event);
  engine.pointerDown(point.x, point.y, { shiftKey: event.shiftKey });
});

canvas.addEventListener('mouseup', (event) => {
  if (event.button !== 0) return;
  const point = canvasPoint(event);
  engine.pointerUp(point.x, point.y);
});

canvas.addEventListener('click', (event) => {
  const point = canvasPoint(event);
  canvas.focus({ preventScroll: true });

  if (state.inspect) {
    const el = engine.elementAt(point.x, point.y);
    selectElement(el);
    return;
  }

  const el = engine.click(point.x, point.y, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey });
  const anchor = el?.closest?.('a[href]');
  if (anchor) {
    const href = anchor.getAttribute('href');
    if (href && href.startsWith('#')) scrollToHash(href.slice(1));
  }
});

/* Klavye ve pano olaylari canvas'a baglanir; motor odakli forma uygular. */
canvas.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  const handled = engine.handleKeyDown({
    key: event.key,
    code: event.code,
    location: event.location,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
    keyCode: event.keyCode,
    which: event.which,
  });
  if (handled) event.preventDefault();
});

canvas.addEventListener('keyup', (event) => {
  engine.handleKeyUp({
    key: event.key,
    code: event.code,
    location: event.location,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    keyCode: event.keyCode,
    which: event.which,
  });
});

canvas.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (engine.insertClipboardText(text)) event.preventDefault();
});

canvas.addEventListener('copy', (event) => {
  const text = engine.selectedText();
  if (!text) return;
  event.clipboardData?.setData('text/plain', text);
  event.preventDefault();
});

canvas.addEventListener('cut', (event) => {
  const text = engine.cutSelectedText();
  if (!text) return;
  event.clipboardData?.setData('text/plain', text);
  event.preventDefault();
});

canvas.addEventListener('wheel', (event) => {
  if (event.ctrlKey) return;
  const point = canvasPoint(event);
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? engine.viewport.height : 1;
  if (engine.wheel(point.x, point.y, event.deltaX * scale, event.deltaY * scale)) {
    event.preventDefault();
  }
}, { passive: false });

/* ------------------------------------------------------------------ *
 * Öğe seçimi / vurgu
 * ------------------------------------------------------------------ */

function describe(el) {
  if (!el) return 'öğe seçilmedi';
  let text = el.localName || 'düğüm';
  if (el.id) text += `#${el.id}`;
  const classes = el.getAttribute?.('class');
  if (classes) text += '.' + classes.trim().split(/\s+/).slice(0, 2).join('.');
  return text;
}

function selectElement(el) {
  state.selected = el || null;
  if (el) {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) state.expanded.add(parent);
  }
  selectionLabel.textContent = el ? describe(el) : 'öğe seçilmedi';
  styleElement.textContent = el ? describe(el) : 'Bir öğe seçilmedi';
  positionSelection();
  renderBoxModel();
  renderStyleLists();
  rebuildTree();
  scheduleSelection();

  if (!state.devtoolsOpen) setDevtools(true);
  if (el) showPane('dom');
}

function clearSelection() {
  state.selected = null;
  selection.hidden = true;
  selectionLabel.textContent = 'öğe seçilmedi';
  styleElement.textContent = 'Bir öğe seçilmedi';
  renderBoxModel();
  renderStyleLists();
}

function scheduleSelection() {
  if (selectionRaf) return;
  selectionRaf = requestAnimationFrame(() => {
    selectionRaf = 0;
    positionSelection();
  });
}

function positionSelection() {
  const el = state.selected;
  const box = el?._box;
  if (!el || !box) {
    selection.hidden = true;
    return;
  }

  const x = box.x - engine.scrollX;
  const y = box.y - engine.scrollY;
  const { width, height } = engine.viewport;

  if (x + box.width < 0 || y + box.height < 0 || x > width || y > height) {
    selection.hidden = true;
    return;
  }

  selection.hidden = false;
  selection.style.left = `${x}px`;
  selection.style.top = `${y}px`;
  selection.style.width = `${box.width}px`;
  selection.style.height = `${box.height}px`;
  selection.dataset.label = `${describe(el)}  ${Math.round(box.width)}×${Math.round(box.height)}`;
  selection.classList.toggle('flip', y < 24);
}

/* Kütük ağacında hover edilen öğeyi canvas'ta vurgula. */
function positionHoverRing() {
  const box = state.hoverEl?._box;
  if (!box) {
    hoverRing.hidden = true;
    return;
  }
  const a = { x: box.x - engine.scrollX, y: box.y - engine.scrollY };
  const view = engine.viewport;
  if (a.x + box.width < 0 || a.y + box.height < 0 || a.x > view.width || a.y > view.height) {
    hoverRing.hidden = true;
    return;
  }
  hoverRing.hidden = false;
  hoverRing.style.left = `${a.x}px`;
  hoverRing.style.top = `${a.y}px`;
  hoverRing.style.width = `${box.width}px`;
  hoverRing.style.height = `${box.height}px`;
}

/* ------------------------------------------------------------------ *
 * Kutu modeli widget'i
 * ------------------------------------------------------------------ */

const BM_LAYERS = [
  { key: 'margin', label: 'margin', cls: 'is-margin' },
  { key: 'border', label: 'border', cls: 'is-border' },
  { key: 'padding', label: 'padding', cls: 'is-padding' },
];

function bmSides(obj) {
  const side = (v) => (typeof v === 'number' && Math.abs(v) > 0.005 ? String(round(v, 1)) : '');
  return [side(obj.top), side(obj.right), side(obj.bottom), side(obj.left)];
}

function renderBoxModel() {
  const el = state.selected;
  const box = el?._box;
  boxModelSide.hidden = !box;
  boxModelFull.hidden = !box;
  if (!box) {
    boxModelSide.textContent = '';
    boxModelFull.textContent = '';
    return;
  }

  const contentW = Math.round(box.contentWidth ?? box.width);
  const contentH = Math.round(box.contentHeight ?? box.height);

  const buildInto = (host) => {
    host.textContent = '';
    const sizing = box.style?.boxSizing === 'border-box'
      ? `border-box ${Math.round(box.width)} × ${Math.round(box.height)}`
      : `content-box ${Math.round(box.width)} × ${Math.round(box.height)}`;
    const contentCell = document.createElement('div');
    contentCell.className = 'bm-layer is-content';
    contentCell.innerHTML = `<span class="bm-c">${contentW} × ${contentH}</span>`;
    contentCell.title = `konum ${Math.round(box.x)}, ${Math.round(box.y)} · ${sizing}`;
    // icerikten disari doğru katmanlar: content <- padding <- border <- margin
    let inner = contentCell;
    for (let i = BM_LAYERS.length - 1; i >= 0; i--) {
      const layerSpec = BM_LAYERS[i];
      const src = box[layerSpec.key];
      if (!src) continue;
      const [top, right, bottom, left] = bmSides(src);
      const layer = document.createElement('div');
      layer.className = `bm-layer ${layerSpec.cls}`;
      const cell = (name, value) => {
        const span = document.createElement('span');
        span.className = `bm-${name}`;
        span.textContent = value;
        if (!value) span.classList.add('bm-zero');
        return span;
      };
      layer.append(cell('t', top), cell('l', left), cell('r', right), cell('b', bottom), inner);
      layer.title = `${layerSpec.label} üst/sağ/alt/sol: ${[top, right, bottom, left].join(' ') || '0'}`;
      inner = layer;
    }
    return inner;
  };
  boxModelSide.append(buildInto(box));
  boxModelFull.append(buildInto(box));
}

/* ------------------------------------------------------------------ *
 * DOM ağacı
 * ------------------------------------------------------------------ */

function scheduleTreeRefresh() {
  if (treeRaf) return;
  treeRaf = requestAnimationFrame(() => {
    treeRaf = 0;
    rebuildTree();
  });
}

function rebuildTree() {
  const doc = engine.document;
  if (!doc?.documentElement || !state.devtoolsOpen) return;

  domTree.textContent = '';
  const fragment = document.createDocumentFragment();
  walkTree(doc.documentElement, 0, fragment);
  domTree.append(fragment);

  const selectedRow = domTree.querySelector('.dom-row.is-selected');
  selectedRow?.scrollIntoView({ block: 'nearest' });
}

function walkTree(el, depth, fragment) {
  const kids = el.children || [];
  const row = document.createElement('div');
  row.className = 'dom-row' + (el === state.selected ? ' is-selected' : '');
  row.style.paddingLeft = `${7 + depth * 14}px`;
  row.title = describe(el);

  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'dom-caret' + (kids.length ? '' : ' is-empty') + (state.expanded.has(el) ? ' is-open' : '');
  caret.tabIndex = -1;
  caret.setAttribute('aria-label', 'Alt öğeleri aç/kapat');
  caret.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 7 5 3 8.5"/></svg>';
  caret.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!kids.length) return;
    if (state.expanded.has(el)) state.expanded.delete(el);
    else state.expanded.add(el);
    rebuildTree();
  });
  row.append(caret);

  const tag = document.createElement('span');
  tag.className = 'dom-tag';
  tag.textContent = el.localName;
  row.append(tag);

  if (el.id) {
    const id = document.createElement('span');
    id.className = 'dom-id';
    id.textContent = `#${el.id}`;
    row.append(id);
  }

  const classAttr = el.getAttribute('class');
  if (classAttr) {
    const classes = classAttr.trim().split(/\s+/).filter(Boolean).slice(0, 3);
    if (classes.length) {
      const cls = document.createElement('span');
      cls.className = 'dom-class';
      cls.textContent = '.' + classes.join('.');
      row.append(cls);
    }
  }

  if (!kids.length && el.localName !== 'script' && el.localName !== 'style') {
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) {
      const snippet = document.createElement('span');
      snippet.className = 'dom-text';
      snippet.textContent = `“${text.slice(0, 34)}${text.length > 34 ? '…' : ''}”`;
      row.append(snippet);
    }
  }

  row.addEventListener('click', () => selectElement(el));
  row.addEventListener('mouseenter', () => {
    state.hoverEl = el;
    positionHoverRing();
  });
  row.addEventListener('mouseleave', () => {
    if (state.hoverEl === el) state.hoverEl = null;
    hoverRing.hidden = true;
  });
  fragment.append(row);

  if (kids.length && state.expanded.has(el)) {
    for (const child of kids) walkTree(child, depth + 1, fragment);
  }
}

/* ------------------------------------------------------------------ *
 * Hesaplanmış stiller
 * ------------------------------------------------------------------ */

const STYLE_PRIORITY = [
  'display', 'position', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
  'backgroundColor', 'backgroundImage', 'boxShadow', 'opacity',
  'color', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textAlign', 'textDecorationLine', 'whiteSpace',
  'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf', 'flexGrow', 'flexShrink', 'flexBasis', 'gap',
  'top', 'right', 'bottom', 'left', 'zIndex', 'overflow',
];
const priorityIndex = new Map(STYLE_PRIORITY.map((key, index) => [key, index]));

function styleEntries() {
  const style = state.selected?._style;
  if (!style) return [];
  const entries = Object.entries(style).filter(([key]) => !key.startsWith('_'));
  entries.sort((a, b) => {
    const ai = priorityIndex.has(a[0]) ? priorityIndex.get(a[0]) : 1000;
    const bi = priorityIndex.has(b[0]) ? priorityIndex.get(b[0]) : 1000;
    return ai - bi || a[0].localeCompare(b[0]);
  });
  return entries;
}

function formatStyleValue(key, value) {
  if (Array.isArray(value)) {
    if (value.length === 4 && value.every((n) => typeof n === 'number')) return cssColor(value);
    return value.map((item) => (item && typeof item === 'object' ? JSON.stringify(item) : item)).join(', ');
  }
  if (value && typeof value === 'object') {
    if ('pct' in value) return `${round(value.pct, 2)}%`;
    if ('angle' in value) return `linear-gradient(${round(value.angle, 2)}deg, …)`;
    if ('value' in value) return String(value.value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (/(opacity|lineHeight|flexGrow|flexShrink|zIndex|order|scale)$/i.test(key)) return String(round(value, 2));
    if (/(width|height|top|right|bottom|left|margin|padding|gap|radius|fontSize|letterSpacing|border.*Width|outlineWidth|flexBasis|textIndent|wordSpacing)$/i.test(key)) {
      return `${round(value, 2)}px`;
    }
    return String(round(value, 2));
  }
  return String(value);
}

function renderStyleLists() {
  const entries = styleEntries();
  styleList.textContent = '';
  styleListFull.textContent = '';

  if (!state.selected || !entries.length) {
    const hint = document.createElement('div');
    hint.className = 'style-hint';
    hint.innerHTML = 'Bir öğe seçmek için DOM ağacına tıklayın ya da araç çubuğundaki <code>öğe seç</code> düğmesini kullanın.';
    styleList.append(hint);
    styleListFull.append(hint.cloneNode(true));
    return;
  }

  const filter = state.filter.trim().toLowerCase();
  const filtered = filter ? entries.filter(([key, value]) => key.toLowerCase().includes(filter) || formatStyleValue(key, value).toLowerCase().includes(filter)) : entries;

  styleList.append(buildStyleFragment(filtered));
  styleListFull.append(buildStyleFragment(filtered));

  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'style-empty';
    empty.textContent = `“${state.filter}” ile eşleşen özellik yok.`;
    styleListFull.append(empty);
  }
}

function buildStyleFragment(entries) {
  const fragment = document.createDocumentFragment();
  for (const [key, value] of entries) {
    const row = document.createElement('div');
    row.className = 'style-row';

    const keyEl = document.createElement('span');
    keyEl.className = 'style-key';
    keyEl.textContent = key;

    const valEl = document.createElement('span');
    valEl.className = 'style-val';
    const formatted = formatStyleValue(key, value);
    valEl.textContent = formatted;
    if (/color$/i.test(key)) valEl.classList.add('is-color');
    else if (typeof value === 'number') valEl.classList.add('is-number');

    row.append(keyEl, valEl);
    fragment.append(row);
  }
  return fragment;
}

styleFilter.addEventListener('input', () => {
  state.filter = styleFilter.value;
  renderStyleLists();
});

openStyleTab.addEventListener('click', () => {
  showPane('styles');
  styleFilter.focus();
});

/* ------------------------------------------------------------------ *
 * Konsol
 * ------------------------------------------------------------------ */

function timeLabel(date) {
  const d = date instanceof Date ? date : new Date();
  return d.toLocaleTimeString('tr-TR', { hour12: false });
}

function appendConsole(level, text, time) {
  const empty = consoleList.querySelector('.console-empty');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = `console-row ${level}`;

  const stamp = document.createElement('span');
  stamp.className = 'console-time';
  stamp.textContent = timeLabel(time);

  const badge = document.createElement('span');
  badge.className = 'console-level';
  badge.textContent = level === 'log' ? 'log' : level === 'input' ? '›' : level === 'result' ? '←' : level;

  const message = document.createElement('span');
  message.className = 'console-msg';
  message.textContent = text;

  row.append(stamp, badge, message);
  consoleList.append(row);

  if (consoleList.childElementCount > 400) consoleList.firstElementChild?.remove();

  consoleTotal += 1;
  updateConsoleCount();
  consoleList.scrollTop = consoleList.scrollHeight;
}

function updateConsoleCount() {
  consoleCount.textContent = String(consoleTotal);
  consoleCount.classList.toggle('has-errors', state.errors > 0);
}

function clearConsoleEntries() {
  consoleList.textContent = '';
  consoleTotal = 0;
  state.errors = 0;
  updateConsoleCount();

  const empty = document.createElement('div');
  empty.className = 'console-empty';
  empty.textContent = 'Konsol temiz. Sayfadaki console.log çağrıları ve hatalar burada görünür.';
  consoleList.append(empty);
  consoleTotal = 0;
  updateConsoleCount();
}

consoleForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = consoleInput.value.trim();
  if (!code) return;
  appendConsole('input', code);
  consoleInput.value = '';

  if (!engine.window) return;
  try {
    let result;
    try {
      const expression = new Function('window', 'document', 'console', `with (window) { return (${code}); }`);
      result = expression(engine.window, engine.document, engine.window.console);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      const statement = new Function('window', 'document', 'console', `with (window) { ${code} }`);
      result = statement(engine.window, engine.document, engine.window.console);
    }
    if (result !== undefined) appendConsole('result', formatResult(result));
  } catch (err) {
    appendConsole('error', `${err.name || 'Hata'}: ${err.message}`);
  }
});

function formatResult(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return `ƒ ${value.name || 'anonim'}()`;
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}

clearConsole.addEventListener('click', clearConsoleEntries);

/* ------------------------------------------------------------------ *
 * Durum / istatistik
 * ------------------------------------------------------------------ */

function setStatus(text, tone = '') {
  statusText.textContent = text;
  statusDot.className = 'status-dot' + (tone ? ` is-${tone}` : '');
}

function handleStats(stats) {
  updateStats(stats);
  updateScrollUI();
  scheduleSelection();
  positionHoverRing();

  const countsChanged = stats.nodes !== state.lastNodes || stats.boxes !== state.lastBoxes;
  state.lastNodes = stats.nodes;
  state.lastBoxes = stats.boxes;
  if (countsChanged) {
    scheduleTreeRefresh();
    renderStyleLists();
    renderBoxModel();
  }
}

function updateStats(stats) {
  const { width, height } = engine.viewport;
  statusViewport.textContent = `${width} × ${height}`;
  statusNodes.textContent = `${stats.nodes} düğüm`;
  statusPaint.textContent = `${stats.paint.toFixed(1)} ms`;

  infoNodes.textContent = String(stats.nodes);
  infoBoxes.textContent = String(stats.boxes);
  infoStyle.textContent = `${stats.style.toFixed(1)} ms`;
  infoLayout.textContent = `${stats.layout.toFixed(1)} ms`;
  infoPaint.textContent = `${stats.paint.toFixed(1)} ms`;
  infoViewport.textContent = `${width} × ${height}`;
}

function updateScrollUI() {
  const max = engine.maxScroll();
  statusScroll.textContent = `${Math.round(engine.scrollY)} / ${Math.round(max.y)}`;
  scheduleSelection();
  positionHoverRing();

  const docHeight = engine.layout?.height ?? 0;
  if (max.y <= 1 || docHeight <= 0) {
    scrollRail.classList.remove('is-visible');
    return;
  }

  scrollRail.classList.add('is-visible');
  const track = scrollRail.clientHeight;
  const thumbHeight = Math.max(26, (engine.viewport.height / docHeight) * track);
  const top = (engine.scrollY / max.y) * Math.max(0, track - thumbHeight);
  scrollThumb.style.height = `${thumbHeight}px`;
  scrollThumb.style.transform = `translateY(${top}px)`;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/* ------------------------------------------------------------------ *
 * Geliştirici araçları
 * ------------------------------------------------------------------ */

function setDevtools(open) {
  state.devtoolsOpen = open;
  devtools.hidden = !open;
  devtoolsBtn.setAttribute('aria-pressed', String(open));
  if (open) {
    rebuildTree();
    renderStyleLists();
  }
  // Devtools workspace alanını genişletip daralttığı için rAF/ResizeObserver
  // ertelense bile (arka planda sekmeler) boyutu hemen senkron uygula.
  applyViewport();
}

function showPane(name) {
  for (const tab of devtools.querySelectorAll('.tab')) {
    const active = tab.dataset.pane === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const pane of devtools.querySelectorAll('.pane')) {
    pane.classList.toggle('is-active', pane.dataset.pane === name);
  }
  if (name === 'dom') rebuildTree();
  if (name === 'styles') {
    renderStyleLists();
    if (state.selected) styleFilter.focus();
  }
}

for (const tab of devtools.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showPane(tab.dataset.pane));
}

devtoolsClose.addEventListener('click', () => setDevtools(false));
devtoolsBtn.addEventListener('click', () => setDevtools(!state.devtoolsOpen));

/* ------------------------------------------------------------------ *
 * İnceleme modu
 * ------------------------------------------------------------------ */

function setInspect(on) {
  state.inspect = on;
  inspectBtn.setAttribute('aria-pressed', String(on));
  canvas.style.cursor = on ? 'crosshair' : 'auto';
  if (on) {
    setDevtools(true);
    showPane('dom');
    toast('İnceleme modu: canvas üzerinde bir öğeye tıkla. Çıkmak için Esc.');
  }
}

inspectBtn.addEventListener('click', () => setInspect(!state.inspect));

/* ------------------------------------------------------------------ *
 * Kaynak düzenleyici
 * ------------------------------------------------------------------ */

function openEditor() {
  state.editorOpen = true;
  editorPanel.hidden = false;
  editorFile.textContent = state.page;
  editorText.value = state.source;
  editorBtn.setAttribute('aria-pressed', 'true');
  applyViewport();
  requestAnimationFrame(() => editorText.focus());
}

function closeEditor() {
  state.editorOpen = false;
  editorPanel.hidden = true;
  editorBtn.setAttribute('aria-pressed', 'false');
  applyViewport();
}

function toggleEditor() {
  if (state.editorOpen) closeEditor();
  else openEditor();
}

function applyEditor() {
  const source = editorText.value;
  if (!source.trim()) {
    toast('Kaynak boş — çalıştırmak için biraz HTML yaz.', true);
    return;
  }
  try {
    state.source = source;
    engine.load(source, { url: new URL(state.page, location.href).href });
    afterLoad();
    setStatus('kaynak uygulandı');
    toast('Kaynak uygulandı — DOM, stiller ve pikseller yeniden üretildi.');
  } catch (err) {
    setStatus('hata', 'error');
    toast(`Kaynak çalıştırılamadı: ${err.message}`, true);
    appendConsole('error', err.stack || err.message);
  }
}

editorRun.addEventListener('click', applyEditor);
editorClose.addEventListener('click', closeEditor);
editorBtn.addEventListener('click', toggleEditor);

editorReset.addEventListener('click', () => {
  editorText.value = state.fetchedSource;
  state.source = state.fetchedSource;
  applyEditor();
  toast('Sayfa özgün kaynağından yeniden yüklendi.');
});

editorText.addEventListener('keydown', (event) => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = editorText.selectionStart;
    const end = editorText.selectionEnd;
    editorText.setRangeText('  ', start, end, 'end');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    applyEditor();
    return;
  }
  if (event.key === 'Escape') {
    event.stopPropagation();
    closeEditor();
  }
});

/* ------------------------------------------------------------------ *
 * Adres çubuğu / araç çubuğu
 * ------------------------------------------------------------------ */

addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = addressInput.value;
  if (!value.trim()) return;
  const target = resolvePage(value);
  if (target?.external) {
    openExternal(target.external);
    return;
  }
  if (target?.hash && !target.path) {
    scrollToHash(target.hash);
    return;
  }
  if (target?.path) {
    loadPage(target.path, { push: true, hash: target.hash });
    addressInput.blur();
  }
});

addressInput.addEventListener('focus', () => addressInput.select());

backBtn.addEventListener('click', () => goHistory(-1));
forwardBtn.addEventListener('click', () => goHistory(1));
reloadBtn.addEventListener('click', reloadPage);
brand.addEventListener('click', (event) => {
  event.preventDefault();
  loadPage('pages/demo.html', { push: true });
});

viewports.addEventListener('click', (event) => {
  const btn = event.target.closest('.view-btn');
  if (btn) setPreset(btn.dataset.preset);
});

/* ------------------------------------------------------------------ *
 * Bildirim
 * ------------------------------------------------------------------ */

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 3200);
}

/* ------------------------------------------------------------------ *
 * Klavye
 * ------------------------------------------------------------------ */

window.addEventListener('keydown', (event) => {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (mod && !event.shiftKey && key === 'e') {
    event.preventDefault();
    toggleEditor();
    return;
  }
  if ((mod && event.shiftKey && key === 'i') || event.key === 'F12') {
    event.preventDefault();
    setDevtools(!state.devtoolsOpen);
    return;
  }
  if (mod && !event.shiftKey && key === 'r') {
    event.preventDefault();
    reloadPage();
    return;
  }
  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    goHistory(-1);
    return;
  }
  if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault();
    goHistory(1);
    return;
  }
  if (event.key === 'Escape') {
    if (state.editorOpen) {
      closeEditor();
      return;
    }
    if (state.inspect) {
      setInspect(false);
      return;
    }
    if (state.selected) clearSelection();
  }
});

window.addEventListener('error', (event) => {
  if (event.message) appendConsole('error', `${event.message} (${event.filename}:${event.lineno})`);
});

/* ------------------------------------------------------------------ *
 * Başlangıç
 * ------------------------------------------------------------------ */

clearConsoleEntries();
appendConsole('info', 'Narvis 0.1 — HTML/CSS/JS motoru Canvas üzerinde çalışıyor.');
appendConsole('log', 'Konsola JavaScript yazabilir, DOM ağacını inceleyebilir ve kaynağı düzenleyebilirsin.');

updateStats(engine.stats);
setStatus('başlatılıyor…', 'busy');

loadPage('pages/demo.html', { push: true }).then((ok) => {
  if (ok) {
    appendConsole('info', `${state.page} yüklendi · ${engine.stats.nodes} düğüm · ${engine.stats.boxes} kutu.`);
  } else {
    setStatus('hata', 'error');
  }
});

applyViewport();
