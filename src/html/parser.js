// Basit HTML agac kurucu. Tarayicidaki "adoption agency" gibi karmasik
// davranislari degil, pratik HTML'in buyuk kismini dogru kuran bir alt kume.

import { Document, Element, Text, Comment } from '../dom.js';
import { HTMLTokenizer } from './tokenizer.js';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);
const HEAD_TAGS = new Set(['base', 'link', 'meta', 'title', 'style', 'script', 'noscript', 'template']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_START = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'menu',
]);

class TreeBuilder {
  constructor(doc, root, fragment) {
    this.doc = doc;
    this.fragment = fragment;
    this.root = root;
    this.stack = [root];
    this.inBody = fragment;
    this.headElement = doc.head;
    this.bodyElement = doc.body;
    this.htmlElement = doc.documentElement;
  }

  current() {
    return this.stack[this.stack.length - 1];
  }

  run(html) {
    const tokenizer = new HTMLTokenizer(html);
    for (;;) {
      const token = tokenizer.nextToken();
      if (token.type === 'eof') break;
      this.handle(token, tokenizer);
    }
  }

  handle(token, tokenizer) {
    if (token.type === 'text') this.text(token.data);
    else if (token.type === 'comment') this.comment(token.data);
    else if (token.type === 'doctype') this.doc.doctype = token.name;
    else if (token.type === 'startTag') this.startTag(token, tokenizer);
    else if (token.type === 'endTag') this.endTag(token.name);
  }

  append(node) {
    this.current().appendChild(node);
    return node;
  }

  text(data) {
    if (!data) return;
    const curName = this.current()?.localName ?? '';
    if (curName === 'table' || curName === 'thead' || curName === 'tbody' || curName === 'tfoot' || curName === 'tr') {
      if (!data.trim()) return; // tablo etiketleri arasindaki bosluk kutu uretmez
      const foster = this.fosterSpot();
      if (foster) { foster(new Text(data)); return; }
    }
    if (!this.fragment && !this.inBody) {
      if (!data.trim()) return;
      this.enterBody();
    }
    this.append(new Text(data));
  }

  comment(data) {
    const curName = this.current()?.localName ?? '';
    if (curName === 'table' || curName === 'thead' || curName === 'tbody' || curName === 'tfoot' || curName === 'tr') {
      const foster = this.fosterSpot();
      if (foster) { foster(new Comment(data)); return; }
    }
    if (!this.fragment && !this.inBody) {
      this.headElement.appendChild(new Comment(data));
      return;
    }
    this.append(new Comment(data));
  }

  /* <table><tr> zincirinde eksik tbody'yi uret. */
  openImpliedSection(tableEl) {
    const tbody = this.doc.createElement('tbody');
    tableEl.appendChild(tbody);
    this.stack.push(tbody);
    return tbody;
  }

  /* Tablo baglaminin yeni dugumleri (foster parenting) isaret land fonksiyonu:
     tabloyu yiginda bulur; tablonun onceki kardes konumuna asar. Hucre veya
     caption acikken tablo baglamina girilmez, bu yuzden yalnizca yiginin
     ustundeki tablo/bolum/satir etiketlerinde cagrilir. */
  fosterSpot() {
    let table = null;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].localName === 'table') { table = this.stack[i]; break; }
    }
    if (!table) return null;
    const parent = table.parentNode;
    return (node) => {
      if (parent) parent.insertBefore(node, table);
      else table.appendChild(node); // fragment koku tabloya esitse
    };
  }

  enterBody() {
    this.inBody = true;
    this.stack = [this.htmlElement, this.bodyElement];
  }

  startTag(token, tokenizer) {
    const tag = token.name;
    if (!this.fragment) {
      if (tag === 'html') {
        this.applyAttrs(this.htmlElement, token.attrs);
        return;
      }
      if (tag === 'head' && !this.inBody) {
        this.stack = [this.htmlElement, this.headElement];
        return;
      }
      if (tag === 'body') {
        this.inBody = true;
        this.applyAttrs(this.bodyElement, token.attrs);
        this.stack = [this.htmlElement, this.bodyElement];
        return;
      }
      if (!this.inBody) {
        if (HEAD_TAGS.has(tag)) {
          const el = this.doc.createElement(tag);
          this.applyAttrs(el, token.attrs);
          this.headElement.appendChild(el);
          if (RAW_TEXT.has(tag)) {
            const raw = tokenizer.readRawText(tag);
            if (raw.data) el.appendChild(new Text(raw.data));
          } else if (tag === 'noscript' || tag === 'template') {
            this.stack.push(el);
          }
          return;
        }
        if (tag === 'title') {
          const el = this.doc.createElement(tag);
          this.applyAttrs(el, token.attrs);
          this.headElement.appendChild(el);
          const raw = tokenizer.readRawText(tag);
          if (raw.data) el.appendChild(new Text(raw.data));
          return;
        }
        this.enterBody();
      }
    }

    if (!this.fragment && (tag === 'html' || tag === 'head' || tag === 'body')) return;

    this.autoClose(tag);

    const curName = this.current()?.localName ?? '';
    const tctx = curName === 'table' || curName === 'thead' || curName === 'tbody' || curName === 'tfoot' || curName === 'tr';

    const el = this.doc.createElement(tag);
    this.applyAttrs(el, token.attrs);

    /* Tablo baglami: imali tbody/tr uretimi ve foster parenting.
       <table><tr> yazarken tbody, <tbody><td> yazarken tr otomatik acilir;
       tablo etiketleri arasina sikisan yabanci icerik tablonun onune tasinir. */
    if (tctx) {
      if (tag === 'tr') {
        if (curName === 'table') this.openImpliedSection(this.current());
      } else if (tag === 'td' || tag === 'th') {
        if (curName === 'table') this.openImpliedSection(this.current());
        const host = this.current();
        if (host.localName === 'tbody' || host.localName === 'thead' || host.localName === 'tfoot') {
          const tr = this.doc.createElement('tr');
          host.appendChild(tr);
          this.stack.push(tr);
        }
      } else if (tag !== 'caption' && tag !== 'col' && tag !== 'colgroup') {
        const foster = this.fosterSpot();
        if (foster) {
          foster(el);
          if (VOID.has(tag)) return;
          if (RAW_TEXT.has(tag)) {
            const raw = tokenizer.readRawText(tag);
            if (raw.data) el.appendChild(new Text(raw.data));
            return;
          }
          this.stack.push(el);
          return;
        }
      }
    }

    this.append(el);
    if (VOID.has(tag)) return;

    if (RAW_TEXT.has(tag)) {
      const raw = tokenizer.readRawText(tag);
      if (raw.data) el.appendChild(new Text(raw.data));
      return;
    }
    this.stack.push(el);
  }

  applyAttrs(el, attrs) {
    for (const attr of attrs) {
      if (el.hasAttribute(attr.name)) continue;
      el.setAttribute(attr.name, attr.value);
    }
  }

  autoClose(tag) {
    if (tag === 'li') this.closeUntil(['li'], ['ul', 'ol', 'menu', 'body', 'html']);
    else if (tag === 'dt' || tag === 'dd') this.closeUntil(['dt', 'dd'], ['dl', 'body', 'html']);
    else if (tag === 'option') this.closeUntil(['option'], ['select', 'body', 'html']);
    else if (tag === 'optgroup') this.closeUntil(['optgroup'], ['select', 'body', 'html']);
    else if (tag === 'tr') this.closeUntil(['td', 'th', 'tr'], ['table', 'thead', 'tbody', 'tfoot', 'body']);
    else if (tag === 'td' || tag === 'th') this.closeUntil(['td', 'th'], ['tr', 'table', 'body']);
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      this.closeUntil(['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'], ['table', 'body']);
    } else if (tag === 'a') {
      this.closeUntil(['a'], ['body', 'html']);
    } else if (tag === 'caption' || tag === 'colgroup' || tag === 'table') {
      // bu etiketlerden once acik kalan bolum/satir/hucre kapanir; table
      // baglamina cikilir (ic ice tabloda dis tablo kapanmis olur).
      for (let i = this.stack.length - 1; i > 0; i--) {
        if (this.stack[i].localName === 'table') {
          this.stack.length = i + 1;
          break;
        }
      }
    } else if (HEADINGS.has(tag)) {
      this.closeUntil([...HEADINGS], ['body', 'html']);
    }

    if (BLOCK_START.has(tag)) {
      for (let i = this.stack.length - 1; i > 0; i--) {
        if (this.stack[i].localName === 'p') {
          this.stack.length = i;
          break;
        }
        if (['div', 'li', 'td', 'th', 'body', 'html', 'section', 'article'].includes(this.stack[i].localName)) break;
      }
    }
  }

  closeUntil(tags, boundaries) {
    for (let i = this.stack.length - 1; i > 0; i--) {
      const name = this.stack[i].localName;
      if (tags.includes(name)) {
        this.stack.length = i;
        return;
      }
      if (boundaries.includes(name)) return;
    }
  }

  endTag(tag) {
    if (tag === 'br') {
      this.startTag({ type: 'startTag', name: 'br', attrs: [], selfClosing: true }, null);
      return;
    }
    if (!this.fragment && (tag === 'html' || tag === 'body')) return;
    if (!this.fragment && tag === 'head') {
      this.stack = [this.htmlElement];
      return;
    }
    for (let i = this.stack.length - 1; i > 0; i--) {
      if (this.stack[i].localName === tag) {
        this.stack.length = i;
        return;
      }
    }
  }
}

export function parseDocument(html, options = {}) {
  const doc = new Document(options.url ?? 'about:blank');
  const htmlEl = doc.createElement('html');
  const head = doc.createElement('head');
  const body = doc.createElement('body');
  htmlEl.appendChild(head);
  htmlEl.appendChild(body);
  doc.appendChild(htmlEl);
  doc.documentElement = htmlEl;
  doc.head = head;
  doc.body = body;

  const builder = new TreeBuilder(doc, htmlEl, false);
  builder.run(String(html ?? ''));

  const titleEl = head.querySelector('title');
  if (titleEl) doc.title = titleEl.textContent.trim().replace(/\s+/g, ' ');
  doc.readyState = 'complete';
  return doc;
}

export function parseFragment(root, html) {
  const doc = root.ownerDocument ?? root;
  const builder = new TreeBuilder(doc, root, true);
  builder.run(String(html ?? ''));
  root._markDirty();
  return root;
}
