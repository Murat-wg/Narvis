// Narvis kabuğu: sekmeli tarayıcı arayüzü. Her sekmenin kendi canvas'ı,
// motoru, geçmişi ve konsolu vardır; araç çubuğu/denetçi etkin sekmeyi izler.
// Motorun kendisi src/engine.js'te.

import { NarvisEngine } from './engine.js';
import { cssColor } from './css/values.js';

const $ = (id) => document.getElementById(id);

const stage = $('stage');
const stageWrap = $('stageWrap');
const selection = $('selection');
const hoverRing = $('hoverRing');
const scrollRail = $('scrollRail');
const scrollThumb = $('scrollThumb');

const tabStrip = $('tabStrip');
const newTabBtn = $('newTabBtn');
const bookmarksBar = $('bookmarksBar');
const bookmarkBtn = $('bookmarkBtn');

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

const HOME_PAGE = 'pages/demo.html';
const START_PAGE = 'pages/start.html';

/* ------------------------------------------------------------------ *
 * Sekme durumu
 * ------------------------------------------------------------------ */

function makeTabState() {
  return {
    page: '',
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
}

const tabs = [];
let activeTab = null;
let tabSeq = 0;

/* Etkin sekmenin alanları; kabuğun tamamı bu üçlü üzerinden çalışır. */
let canvas = null;
let engine = null;
let state = null;

let pendingFileInput = null; // { tab, input }
let treeRaf = 0;
let selectionRaf = 0;
let toastTimer = 0;

function createTab({ page = null, activate = true } = {}) {
  const tabCanvas = document.createElement('canvas');
  tabCanvas.className = 'viewport';
  tabCanvas.tabIndex = 0;
  tabCanvas.hidden = true; // yalnızca activateTab görünür yapar
  tabCanvas.setAttribute('aria-label', 'Narvis sayfa görünümü — tıklayıp klavyeyle formları kullanın');
  const size = desiredSizeFor('desktop');
  tabCanvas.width = size.width;
  tabCanvas.height = size.height;
  stage.insertBefore(tabCanvas, selection);

  const tab = {
    id: ++tabSeq,
    title: 'Yeni sekme',
    loading: false,
    loadToken: 0,
    closed: false,
    canvas: tabCanvas,
    engine: null,
    state: makeTabState(),
    consoleEntries: [],
    consoleTotal: 0,
    stats: null,
    el: null,
    titleEl: null,
    moveRaf: 0,
    lastPointer: { x: 0, y: 0 },
  };
  tab.state.viewport = { ...size };

  tab.engine = new NarvisEngine(tabCanvas, {
    width: size.width,
    height: size.height,
    onStats: (stats) => handleStats(stats, tab),
    onConsole: (entry) => appendConsole(entry.level, entry.text, entry.time, tab),
    onNavigation: (href, anchor, mods) => handleNavigation(href, anchor, mods, tab),
    onFormSubmit: () => { if (tab === activeTab) setStatus('gönderiliyor…', 'busy'); },
    onFileChoose: (input) => chooseFile(input, tab),
    onFormResponse: (result) => handleFormResponse(result, tab),
    onError: (entry) => {
      tab.state.errors += 1;
      renderTabs();
      if (tab !== activeTab) return;
      updateConsoleCount();
      setStatus('hata', 'error');
      toast(`Motor hatası: ${String(entry.text).split('\n')[0]}`, true);
    },
    onScroll: () => { if (tab === activeTab) updateScrollUI(); },
  });

  bindCanvasEvents(tab);
  buildTabElement(tab);
  tabs.push(tab);
  if (activate) activateTab(tab);
  else renderTabs();
  if (page) loadPage(page, { push: true }, tab);
  return tab;
}

function buildTabElement(tab) {
  const el = document.createElement('div');
  el.className = 'tab-item';
  el.setAttribute('role', 'tab');
  el.tabIndex = 0;

  const spinner = document.createElement('span');
  spinner.className = 'tab-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const favicon = document.createElement('span');
  favicon.className = 'tab-favicon';
  favicon.setAttribute('aria-hidden', 'true');

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tab-close';
  close.title = 'Sekmeyi kapat (Ctrl+W)';
  close.setAttribute('aria-label', 'Sekmeyi kapat');
  close.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>';
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeTab(tab);
  });

  el.append(spinner, favicon, title, close);
  el.addEventListener('click', () => activateTab(tab));
  el.addEventListener('auxclick', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      closeTab(tab);
    }
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateTab(tab);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      closeTab(tab);
    }
  });

  tab.el = el;
  tab.titleEl = title;
  tabStrip.append(el);
}

tabStrip.addEventListener('mousedown', (event) => {
  if (event.button === 1) event.preventDefault(); // orta tık otomatik kaydırma
});

function renderTabs() {
  for (const tab of tabs) {
    tab.el.classList.toggle('is-active', tab === activeTab);
    tab.el.classList.toggle('is-loading', tab.loading);
    tab.el.classList.toggle('has-errors', tab.state.errors > 0);
    tab.el.setAttribute('aria-selected', String(tab === activeTab));
    tab.titleEl.textContent = tab.title;
    tab.el.title = tab.state.page ? `${tab.title}\n${tab.state.page}` : tab.title;
  }
  activeTab?.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function activateTab(tab) {
  if (!tab || tab.closed || tab === activeTab) return;
  if (activeTab) activeTab.canvas.hidden = true;
  activeTab = tab;
  canvas = tab.canvas;
  engine = tab.engine;
  state = tab.state;
  canvas.hidden = false;
  syncChrome();
  applyViewport();
  renderTabs();
}

function closeTab(tab) {
  if (!tab || tab.closed) return;
  tab.closed = true;
  const index = tabs.indexOf(tab);
  tab.engine.destroy();
  tab.canvas.remove();
  tab.el.remove();
  tabs.splice(index, 1);

  if (activeTab === tab) {
    activeTab = null;
    const next = tabs[Math.min(index, tabs.length - 1)];
    if (next) activateTab(next);
    else createTab({ page: START_PAGE });
  }
  renderTabs();
}

function cycleTab(delta) {
  if (tabs.length < 2) return;
  const index = tabs.indexOf(activeTab);
  activateTab(tabs[(index + delta + tabs.length) % tabs.length]);
}

/* Etkin sekmenin durumunu araç çubuğuna, denetçiye ve düzenleyiciye yansıt. */
function syncChrome() {
  addressInput.value = state.page;
  statusPage.textContent = state.page || '—';
  editorFile.textContent = state.page;
  editorPanel.hidden = !state.editorOpen;
  editorBtn.setAttribute('aria-pressed', String(state.editorOpen));
  if (state.editorOpen) editorText.value = state.source;

  devtools.hidden = !state.devtoolsOpen;
  devtoolsBtn.setAttribute('aria-pressed', String(state.devtoolsOpen));
  inspectBtn.setAttribute('aria-pressed', String(state.inspect));
  canvas.style.cursor = state.inspect ? 'crosshair' : 'auto';

  for (const btn of viewports.querySelectorAll('.view-btn')) {
    btn.classList.toggle('is-active', btn.dataset.preset === state.preset);
  }

  styleFilter.value = state.filter;
  selectionLabel.textContent = state.selected ? describe(state.selected) : 'öğe seçilmedi';
  styleElement.textContent = state.selected ? describe(state.selected) : 'Bir öğe seçilmedi';

  renderConsole(activeTab);
  rebuildTree();
  renderStyleLists();
  renderBoxModel();
  updateStats(activeTab.stats ?? engine.stats);
  updateScrollUI();
  updateHistoryButtons();
  positionSelection();
  positionHoverRing();
  updateBookmarkStar();
  document.title = state.page ? `${activeTab.title} — Narvis` : 'Narvis — kendi HTML/JS motoru';
  setStatus(activeTab.loading ? 'yükleniyor…' : 'hazır', activeTab.loading ? 'busy' : '');
}

window.NarvisShell = {
  get engine() { return engine; },
  get state() { return state; },
  get tabs() { return tabs; },
  get activeTab() { return activeTab; },
  createTab,
  closeTab,
  activateTab,
};

/* Gizli yerel dosya secici: sayfadaki input[type=file] tiklamasi acar;
   secilen gercek File nesneleri motordaki input.files'a yazilir. */
function chooseFile(input, tab) {
  if (!input || !filePicker) return;
  pendingFileInput = { tab, input };
  filePicker.multiple = input.hasAttribute('multiple');
  const accept = input.getAttribute('accept');
  if (accept) filePicker.setAttribute('accept', accept);
  else filePicker.removeAttribute('accept');
  filePicker.value = '';
  filePicker.click();
}

filePicker.addEventListener('change', () => {
  const pending = pendingFileInput;
  pendingFileInput = null;
  if (!pending || pending.tab.closed) return;
  const count = filePicker.files?.length ?? 0;
  pending.tab.engine.setFiles(pending.input, filePicker.files);
  if (count && pending.tab === activeTab) setStatus(`${count} dosya seçildi`, 'ok');
});

/* ------------------------------------------------------------------ *
 * Görünüm boyutu
 * ------------------------------------------------------------------ */

function desiredSizeFor(preset) {
  const availW = Math.max(320, stageWrap.clientWidth - 48);
  const availH = Math.max(280, stageWrap.clientHeight - 46);
  let width = availW;
  if (preset === 'tablet') width = Math.min(820, availW);
  else if (preset === 'mobile') width = Math.min(390, availW);
  return { width, height: availH };
}

function desiredSize() {
  return desiredSizeFor(state?.preset ?? 'desktop');
}

function applyViewport() {
  if (!engine || !state) return;
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

function resolvePage(raw, tab = activeTab) {
  let value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('#')) return { hash: value.slice(1) };

  value = value.replace(/^narvis:\/\//i, '');
  const base = tab?.state.page || HOME_PAGE;
  let url;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('pages/')) {
      url = new URL(value.startsWith('/') ? value : value.includes('://') ? value : '/' + value, location.href);
    } else {
      url = new URL(value, new URL(base, location.href));
    }
  } catch {
    return null;
  }

  if (url.origin !== location.origin) return { external: url.href };

  let path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!path || path.endsWith('/')) path += 'index.html';
  if (!path.includes('/') && !path.startsWith('pages/')) path = 'pages/' + path;
  if (!/\.[a-z0-9]+$/i.test(path)) path += '.html';
  return { path, search: url.search, hash: url.hash.slice(1) };
}

async function loadPage(raw, options = {}, tab = activeTab) {
  if (!tab || tab.closed) return false;
  const target = resolvePage(raw, tab);
  if (!target) return false;
  if (target.external) {
    openExternal(target.external);
    return false;
  }
  if (target.hash && !target.path) {
    scrollToHash(target.hash, tab);
    return true;
  }

  const path = target.path;
  const requestPath = path + (target.search || '');
  const token = ++tab.loadToken;
  tab.loading = true;
  renderTabs();
  if (tab === activeTab) setStatus('getiriliyor…', 'busy');
  try {
    const response = await fetch(requestPath, { cache: 'no-store' });
    if (tab.closed || tab.loadToken !== token) return false;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const html = await response.text();
    if (tab.closed || tab.loadToken !== token) return false;

    tab.state.page = requestPath;
    tab.state.source = html;
    tab.state.fetchedSource = html;
    tab.engine.load(html, { url: new URL(requestPath, location.href).href });
    afterLoad(tab, options.hash ?? target.hash);

    if (options.historyIndex != null) {
      tab.state.historyIndex = options.historyIndex;
    } else if (options.push) {
      pushHistory(requestPath, tab);
    }

    tab.loading = false;
    renderTabs();
    if (tab === activeTab) {
      updateHistoryButtons();
      setStatus('hazır');
    }
    return true;
  } catch (err) {
    if (tab.closed || tab.loadToken !== token) return false;
    tab.loading = false;
    renderTabs();
    appendConsole('error', `fetch ${path}: ${err.message}`, undefined, tab);
    if (tab === activeTab) {
      setStatus('yüklenemedi', 'error');
      toast(`Sayfa yüklenemedi: ${path}`, true);
    }
    return false;
  }
}

function afterLoad(tab, hash) {
  const s = tab.state;
  s.selected = null;
  s.hoverEl = null;
  s.expanded = new Set();
  s.lastNodes = -1;
  s.lastBoxes = -1;
  s.filter = '';

  const doc = tab.engine.document;
  if (doc?.documentElement) s.expanded.add(doc.documentElement);
  if (doc?.body) s.expanded.add(doc.body);

  tab.title = doc?.title?.trim() || s.page.split('/').pop() || 'Yeni sekme';
  renderTabs();

  if (tab !== activeTab) return;

  styleFilter.value = '';
  addressInput.value = s.page;
  statusPage.textContent = s.page;
  editorFile.textContent = s.page;
  if (s.editorOpen) editorText.value = s.source;
  document.title = `${tab.title} — Narvis`;

  clearSelection();
  rebuildTree();
  renderStyleLists();
  handleStats(tab.engine.stats, tab);
  updateScrollUI();
  updateHistoryButtons();
  updateBookmarkStar();

  if (hash) scrollToHash(hash, tab);
}

function pushHistory(path, tab = activeTab) {
  const s = tab.state;
  if (s.history[s.historyIndex] === path) {
    if (tab === activeTab) updateHistoryButtons();
    return;
  }
  s.history = s.history.slice(0, s.historyIndex + 1);
  s.history.push(path);
  s.historyIndex = s.history.length - 1;
  if (tab === activeTab) updateHistoryButtons();
}

async function goHistory(delta, tab = activeTab) {
  if (!tab) return;
  const index = tab.state.historyIndex + delta;
  if (index < 0 || index >= tab.state.history.length) return;
  await loadPage(tab.state.history[index], { historyIndex: index }, tab);
}

function updateHistoryButtons() {
  if (!state) return;
  backBtn.disabled = state.historyIndex <= 0;
  forwardBtn.disabled = state.historyIndex >= state.history.length - 1;
}

function reloadPage(tab = activeTab) {
  if (tab?.state.page) loadPage(tab.state.page, { push: false }, tab);
}

function handleNavigation(href, anchor, mods = {}, tab = activeTab) {
  const target = resolvePage(href, tab);
  if (!target) return;
  if (target.external) {
    openExternal(target.external);
    return;
  }
  if (target.hash && !target.path) {
    scrollToHash(target.hash, tab);
    return;
  }
  if (!target.path) return;

  const request = target.path + (target.search || '') + (target.hash ? '#' + target.hash : '');
  const wantsNewTab = mods.ctrlKey || mods.metaKey || anchor?.getAttribute?.('target') === '_blank';
  if (wantsNewTab) {
    createTab({ page: request, activate: false });
    toast('Bağlantı arka planda yeni sekmede açıldı.');
    return;
  }
  loadPage(request, { push: true }, tab);
}

/* Form yaniti: sunucudan donen HTML'i motorun yeni belgesi yapar.
   POST sonrasi URL adres cubuguna ve gecmise yazilir. */
function handleFormResponse(result, tab = activeTab) {
  if (!result || !tab || tab.closed) return false;
  const requestUrl = result.url || result.request?.url || tab.state.page;
  const url = new URL(requestUrl, location.href);
  if (url.origin !== location.origin) {
    openExternal(url.href);
    return false;
  }
  if (!result.ok) {
    appendConsole('error', `${result.request?.method || 'GET'} ${url.pathname} → ${result.status}`, undefined, tab);
    if (tab === activeTab) {
      setStatus(`form ${result.status}`, 'error');
      toast(`Form yanıtı: ${result.status} ${result.statusText || ''}`.trim(), true);
    }
    return false;
  }
  const type = result.response?.headers?.get?.('content-type') || '';
  if (type && !/text\/html/i.test(type)) {
    appendConsole('info', `Form yanıtı: ${type} (${result.status})`, undefined, tab);
    if (tab === activeTab) {
      setStatus('hazır');
      toast(`Form yanıtı ${type} — sayfa olarak yüklenmedi.`);
    }
    return false;
  }

  const display = url.pathname + url.search;
  tab.state.page = display;
  tab.state.source = result.html;
  tab.state.fetchedSource = result.html;
  tab.engine.load(result.html, { url: url.href });
  afterLoad(tab);
  pushHistory(display, tab);
  if (tab === activeTab) {
    setStatus('hazır');
    toast('Form gönderildi — yanıt sayfası yüklendi.');
  }
  return true;
}

function openExternal(url) {
  toast('Harici bağlantı ana tarayıcıda açılıyor…');
  window.open(url, '_blank', 'noopener');
}

function scrollToHash(id, tab = activeTab) {
  if (!tab?.engine.document) return;
  const el = id ? tab.engine.document.getElementById(id) : tab.engine.document.body;
  if (!el) {
    if (tab === activeTab) toast(`Hedef bulunamadı: #${id}`, true);
    return;
  }
  const box = el._box;
  if (!box) return;
  tab.engine.scrollTo({ left: 0, top: Math.max(0, box.y - 12) });
  if (tab === activeTab) updateScrollUI();
}

/* ------------------------------------------------------------------ *
 * Olay yönlendirme (sekme başına bir kez bağlanır)
 * ------------------------------------------------------------------ */

function canvasPoint(event, targetCanvas) {
  const rect = targetCanvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function bindCanvasEvents(tab) {
  const c = tab.canvas;
  const eng = tab.engine;
  const s = tab.state;

  /* Sürükleyerek metin seçerken imleç her harekette anında uygulanır; normal
     hover kontrolünde frame başına bir kez hareket ettirilir. */
  c.addEventListener('mousemove', (event) => {
    const point = canvasPoint(event, c);
    tab.lastPointer = point;
    if (eng.isDragSelecting()) {
      if (tab.moveRaf) { cancelAnimationFrame(tab.moveRaf); tab.moveRaf = 0; }
      eng.pointerMove(point.x, point.y);
      if (s.inspect) c.style.cursor = 'crosshair';
      return;
    }
    if (tab.moveRaf) return;
    tab.moveRaf = requestAnimationFrame(() => {
      tab.moveRaf = 0;
      eng.pointerMove(tab.lastPointer.x, tab.lastPointer.y);
      if (s.inspect) c.style.cursor = 'crosshair';
    });
  });

  c.addEventListener('mouseleave', () => eng.setHover(null));

  c.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const point = canvasPoint(event, c);
    eng.pointerDown(point.x, point.y, { shiftKey: event.shiftKey });
  });

  c.addEventListener('mouseup', (event) => {
    if (event.button !== 0) return;
    const point = canvasPoint(event, c);
    eng.pointerUp(point.x, point.y);
  });

  c.addEventListener('click', (event) => {
    const point = canvasPoint(event, c);
    c.focus({ preventScroll: true });

    if (s.inspect) {
      selectElement(eng.elementAt(point.x, point.y));
      return;
    }

    const el = eng.click(point.x, point.y, {
      shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
    });
    const anchor = el?.closest?.('a[href]');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (href && href.startsWith('#')) scrollToHash(href.slice(1), tab);
    }
  });

  /* Klavye ve pano olaylari canvas'a baglanir; motor odakli forma uygular. */
  c.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const handled = eng.handleKeyDown({
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

  c.addEventListener('keyup', (event) => {
    eng.handleKeyUp({
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

  c.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (eng.insertClipboardText(text)) event.preventDefault();
  });

  c.addEventListener('copy', (event) => {
    const text = eng.selectedText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  });

  c.addEventListener('cut', (event) => {
    const text = eng.cutSelectedText();
    if (!text) return;
    event.clipboardData?.setData('text/plain', text);
    event.preventDefault();
  });

  c.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    const point = canvasPoint(event, c);
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? eng.viewport.height : 1;
    if (eng.wheel(point.x, point.y, event.deltaX * scale, event.deltaY * scale)) {
      event.preventDefault();
    }
  }, { passive: false });
}

/* ------------------------------------------------------------------ *
 * Yer imleri
 * ------------------------------------------------------------------ */

const BM_KEY = 'narvis.bookmarks.v1';

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BM_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list.filter((b) => b && typeof b.path === 'string' && typeof b.title === 'string');
    }
  } catch { /* bozuk kayıt varsayılanlara düşer */ }
  return [
    { title: 'Başlangıç', path: START_PAGE },
    { title: 'Demo', path: HOME_PAGE },
    { title: 'Hakkında', path: 'pages/about.html' },
  ];
}

let bookmarks = loadBookmarks();

function saveBookmarks() {
  try { localStorage.setItem(BM_KEY, JSON.stringify(bookmarks)); } catch { /* depolama kapalı olabilir */ }
}

function renderBookmarks() {
  bookmarksBar.textContent = '';
  if (!bookmarks.length) {
    const empty = document.createElement('span');
    empty.className = 'bm-empty';
    empty.textContent = 'Yer imi yok — adres çubuğundaki ☆ ile bu sayfayı ekleyebilirsin.';
    bookmarksBar.append(empty);
    return;
  }
  for (const bm of bookmarks) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'bm-chip' + (state?.page === bm.path ? ' is-current' : '');
    chip.title = `${bm.title} — ${bm.path}\nOrta tık: yeni sekmede aç`;
    chip.innerHTML = '<svg class="bm-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.8h8v12.4L8 11l-4 3.2V1.8z"/></svg>';
    const label = document.createElement('span');
    label.textContent = bm.title;
    chip.append(label);

    const remove = document.createElement('span');
    remove.className = 'bm-remove';
    remove.setAttribute('role', 'button');
    remove.setAttribute('aria-label', 'Yer imini kaldır');
    remove.title = 'Yer imini kaldır';
    remove.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      bookmarks = bookmarks.filter((b) => b !== bm);
      saveBookmarks();
      updateBookmarkStar();
      toast(`Yer imi kaldırıldı: ${bm.title}`);
    });
    chip.append(remove);

    chip.addEventListener('click', () => loadPage(bm.path, { push: true }));
    chip.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        createTab({ page: bm.path, activate: false });
      }
    });
    bookmarksBar.append(chip);
  }
}

function updateBookmarkStar() {
  const saved = !!state?.page && bookmarks.some((b) => b.path === state.page);
  bookmarkBtn.setAttribute('aria-pressed', String(saved));
  bookmarkBtn.title = saved ? 'Yer imlerinden çıkar (Ctrl+D)' : 'Yer imlerine ekle (Ctrl+D)';
  bookmarkBtn.setAttribute('aria-label', bookmarkBtn.title);
  renderBookmarks();
}

function toggleBookmark() {
  if (!state?.page || !activeTab) return;
  const existing = bookmarks.find((b) => b.path === state.page);
  if (existing) {
    bookmarks = bookmarks.filter((b) => b !== existing);
    toast(`Yer iminden çıkarıldı: ${existing.title}`);
  } else {
    bookmarks.push({ title: activeTab.title || state.page, path: state.page });
    toast(`Yer imlerine eklendi: ${activeTab.title}`);
  }
  saveBookmarks();
  updateBookmarkStar();
}

bookmarkBtn.addEventListener('click', toggleBookmark);

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
  const el = state?.selected;
  const box = el?._box;
  if (!el || !box || !engine) {
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
  const box = state?.hoverEl?._box;
  if (!box || !engine) {
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
  const el = state?.selected;
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
  const doc = engine?.document;
  if (!doc?.documentElement || !state?.devtoolsOpen) return;

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
  const style = state?.selected?._style;
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

  if (!state?.selected || !entries.length) {
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
 * Konsol (sekme başına ayrı kayıt)
 * ------------------------------------------------------------------ */

function timeLabel(date) {
  const d = date instanceof Date ? date : new Date();
  return d.toLocaleTimeString('tr-TR', { hour12: false });
}

function appendConsole(level, text, time, tab = activeTab) {
  if (!tab || tab.closed) return;
  const entry = { level, text: String(text), time: time instanceof Date ? time : new Date() };
  tab.consoleEntries.push(entry);
  if (tab.consoleEntries.length > 400) tab.consoleEntries.shift();
  tab.consoleTotal += 1;
  if (tab !== activeTab) return;
  appendConsoleRow(entry);
  updateConsoleCount();
  consoleList.scrollTop = consoleList.scrollHeight;
}

function appendConsoleRow(entry) {
  const empty = consoleList.querySelector('.console-empty');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = `console-row ${entry.level}`;

  const stamp = document.createElement('span');
  stamp.className = 'console-time';
  stamp.textContent = timeLabel(entry.time);

  const badge = document.createElement('span');
  badge.className = 'console-level';
  badge.textContent = entry.level === 'log' ? 'log' : entry.level === 'input' ? '›' : entry.level === 'result' ? '←' : entry.level;

  const message = document.createElement('span');
  message.className = 'console-msg';
  message.textContent = entry.text;

  row.append(stamp, badge, message);
  consoleList.append(row);
}

function renderConsole(tab) {
  consoleList.textContent = '';
  if (!tab.consoleEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'console-empty';
    empty.textContent = 'Konsol temiz. Sayfadaki console.log çağrıları ve hatalar burada görünür.';
    consoleList.append(empty);
  } else {
    for (const entry of tab.consoleEntries) appendConsoleRow(entry);
  }
  updateConsoleCount();
  consoleList.scrollTop = consoleList.scrollHeight;
}

function updateConsoleCount() {
  consoleCount.textContent = String(activeTab?.consoleTotal ?? 0);
  consoleCount.classList.toggle('has-errors', (state?.errors ?? 0) > 0);
}

function clearConsoleEntries(tab = activeTab) {
  if (!tab) return;
  tab.consoleEntries = [];
  tab.consoleTotal = 0;
  tab.state.errors = 0;
  if (tab === activeTab) {
    renderConsole(tab);
    renderTabs();
  }
}

consoleForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = consoleInput.value.trim();
  if (!code) return;
  appendConsole('input', code);
  consoleInput.value = '';

  if (!engine?.window) return;
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

clearConsole.addEventListener('click', () => clearConsoleEntries());

/* ------------------------------------------------------------------ *
 * Durum / istatistik
 * ------------------------------------------------------------------ */

function setStatus(text, tone = '') {
  statusText.textContent = text;
  statusDot.className = 'status-dot' + (tone ? ` is-${tone}` : '');
}

function handleStats(stats, tab = activeTab) {
  if (!tab || tab.closed) return;
  tab.stats = stats;
  if (tab !== activeTab) return;
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
  if (!engine) return;
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
  if (!engine) return;
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
    engine.load(source, { url: new URL(state.page || HOME_PAGE, location.href).href });
    afterLoad(activeTab);
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
    loadPage(value, { push: true });
    addressInput.blur();
  }
});

addressInput.addEventListener('focus', () => addressInput.select());

backBtn.addEventListener('click', () => goHistory(-1));
forwardBtn.addEventListener('click', () => goHistory(1));
reloadBtn.addEventListener('click', () => reloadPage());
brand.addEventListener('click', (event) => {
  event.preventDefault();
  loadPage(HOME_PAGE, { push: true });
});
newTabBtn.addEventListener('click', () => createTab({ page: START_PAGE }));

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

  /* Sekme kısayolları: Ctrl kombinasyonları masaüstü paketinde geçerli;
     tarayıcı içinde bunları yakalayamadığı durumlar için Alt eşlenikleri var. */
  if ((mod && !event.shiftKey && key === 't') || (event.altKey && !mod && key === 't')) {
    event.preventDefault();
    createTab({ page: START_PAGE });
    return;
  }
  if ((mod && !event.shiftKey && key === 'w') || (event.altKey && !mod && key === 'w')) {
    event.preventDefault();
    closeTab(activeTab);
    return;
  }
  if (mod && event.key === 'Tab') {
    event.preventDefault();
    cycleTab(event.shiftKey ? -1 : 1);
    return;
  }
  if ((mod || event.altKey) && !event.shiftKey && /^[1-9]$/.test(event.key)) {
    const target = tabs[Number(event.key) - 1];
    if (target) {
      event.preventDefault();
      activateTab(target);
    }
    return;
  }
  if (mod && !event.shiftKey && key === 'l') {
    event.preventDefault();
    addressInput.focus();
    addressInput.select();
    return;
  }
  if (mod && !event.shiftKey && key === 'd') {
    event.preventDefault();
    toggleBookmark();
    return;
  }
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

renderBookmarks();
createTab({ page: HOME_PAGE });
appendConsole('info', 'Narvis 0.1 — HTML/CSS/JS motoru Canvas üzerinde çalışıyor.');
appendConsole('log', 'Ctrl+T yeni sekme · Ctrl+W kapat · Ctrl+D yer imi · Ctrl+Tab sekme değiştir (tarayıcı içinde Alt+T / Alt+W / Alt+1…9).');
applyViewport();