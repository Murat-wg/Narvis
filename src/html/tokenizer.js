// Kucuk HTML tokenizer. Tarayici parser'larindaki tum durum makinesini degil,
// pratikte ise yarayan alt kumeyi uygular.

import { decodeEntities } from './entities.js';

const WS = /[\t\n\f\r ]/;

export class HTMLTokenizer {
  constructor(input) {
    this.input = String(input ?? '');
    this.pos = 0;
  }

  eof() {
    return this.pos >= this.input.length;
  }

  nextToken() {
    const s = this.input;
    if (this.pos >= s.length) return { type: 'eof' };

    if (s[this.pos] === '<') {
      // Yorum
      if (s.startsWith('<!--', this.pos)) {
        const end = s.indexOf('-->', this.pos + 4);
        const data = end === -1 ? s.slice(this.pos + 4) : s.slice(this.pos + 4, end);
        this.pos = end === -1 ? s.length : end + 3;
        return { type: 'comment', data };
      }
      // DOCTYPE / CDATA / isleme yonergesi
      if (s[this.pos + 1] === '!' || s[this.pos + 1] === '?') {
        const end = s.indexOf('>', this.pos + 2);
        const raw = s.slice(this.pos + 2, end === -1 ? s.length : end);
        this.pos = end === -1 ? s.length : end + 1;
        if (/^doctype/i.test(raw)) {
          return { type: 'doctype', name: raw.replace(/^doctype\s*/i, '').trim() };
        }
        return { type: 'comment', data: raw };
      }
      // Bitis etiketi
      if (s[this.pos + 1] === '/') {
        this.pos += 2;
        const name = this.readTagName();
        this.skipToTagEnd();
        return { type: 'endTag', name: name.toLowerCase() };
      }
      // Baslangic etiketi
      if (/[a-zA-Z]/.test(s[this.pos + 1] ?? '')) {
        this.pos += 1;
        const name = this.readTagName();
        const attrs = [];
        let selfClosing = false;
        while (!this.eof()) {
          this.skipWhitespace();
          if (this.eof()) break;
          if (s[this.pos] === '>') { this.pos++; break; }
          if (s[this.pos] === '/' && s[this.pos + 1] === '>') { this.pos += 2; selfClosing = true; break; }
          if (s[this.pos] === '/') { this.pos++; continue; }
          const attrName = this.readAttrName();
          if (!attrName) { this.pos++; continue; }
          this.skipWhitespace();
          let value = '';
          if (s[this.pos] === '=') {
            this.pos++;
            this.skipWhitespace();
            const q = s[this.pos];
            if (q === '"' || q === "'") {
              this.pos++;
              const end = s.indexOf(q, this.pos);
              value = end === -1 ? s.slice(this.pos) : s.slice(this.pos, end);
              this.pos = end === -1 ? s.length : end + 1;
            } else {
              const start = this.pos;
              while (!this.eof() && !/[\s>]/.test(s[this.pos])) this.pos++;
              value = s.slice(start, this.pos);
            }
          }
          const lower = attrName.toLowerCase();
          if (!attrs.some((a) => a.name === lower)) {
            attrs.push({ name: lower, value: decodeEntities(value) });
          }
        }
        return { type: 'startTag', name: name.toLowerCase(), attrs, selfClosing };
      }
    }

    // Metin
    let end = s.indexOf('<', this.pos + 1);
    if (end === -1) end = s.length;
    const data = s.slice(this.pos, end);
    this.pos = end;
    return { type: 'text', data: decodeEntities(data) };
  }

  // <script>, <style>, <title> gibi raw text elemanlarinin icerigini okur.
  // Parser, baslangic etiketini gordugunde bunu cagirir.
  readRawText(name) {
    const s = this.input;
    const re = new RegExp(`</${name}\\s*>`, 'i');
    const rest = s.slice(this.pos);
    const m = re.exec(rest);
    if (!m) {
      const data = rest;
      this.pos = s.length;
      return { data };
    }
    const data = rest.slice(0, m.index);
    this.pos += m.index + m[0].length;
    return { data };
  }

  readTagName() {
    const s = this.input;
    const start = this.pos;
    while (!this.eof() && !/[\s/>]/.test(s[this.pos])) this.pos++;
    return s.slice(start, this.pos);
  }

  readAttrName() {
    const s = this.input;
    const start = this.pos;
    while (!this.eof() && !/[\s/>=]/.test(s[this.pos])) this.pos++;
    return s.slice(start, this.pos);
  }

  skipWhitespace() {
    while (!this.eof() && WS.test(this.input[this.pos])) this.pos++;
  }

  skipToTagEnd() {
    const end = this.input.indexOf('>', this.pos);
    this.pos = end === -1 ? this.input.length : end + 1;
  }
}
