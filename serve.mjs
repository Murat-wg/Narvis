// Narvis için küçük bir statik sunucu. ES modülleri ve fetch kullanıldığı için
// dosyaların file:// yerine HTTP üzerinden sunulması gerekir.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4777);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('Form gövdesi 1 MB sınırını aştı.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseMultipart(buffer, boundary) {
  const text = buffer.toString('utf8');
  const out = [];
  for (const part of text.split(`--${boundary}`)) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headers = part.slice(0, headerEnd);
    const match = /name="([^"]*)"/i.exec(headers);
    if (!match) continue;
    let value = part.slice(headerEnd + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    out.push([match[1], value]);
  }
  return out;
}

async function formFields(request, url) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return [...url.searchParams.entries()];
  }
  const body = await readRequestBody(request);
  const type = String(request.headers['content-type'] || '').toLowerCase();
  if (type.startsWith('application/x-www-form-urlencoded')) {
    return [...new URLSearchParams(body.toString('utf8')).entries()];
  }
  if (type.startsWith('multipart/form-data')) {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
    return boundary ? parseMultipart(body, boundary[1] || boundary[2]) : [];
  }
  if (type.startsWith('text/plain')) {
    return body.toString('utf8').split(/\r?\n/).filter((line) => line.includes('=')).map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    });
  }
  return [];
}

const FIELD_LABELS = {
  ad: 'Ad soyad',
  eposta: 'E-posta',
  email: 'E-posta',
  konu: 'Konu',
  mesaj: 'Mesaj',
  bulten: 'Bülten',
  subscribe: 'Bülten',
  guncelleme: 'Güncellemeler',
  plan: 'Plan',
  deneyim: 'Narvis\'i nasıl buldunuz?',
};

function renderFormResult(fields, method) {
  const rows = fields.length
    ? fields.map(([name, value]) => {
      const label = FIELD_LABELS[name] || name;
      const text = escapeHtml(value).replace(/\r?\n/g, '<br>');
      return `<tr><th>${escapeHtml(label)}</th><td>${text || '<span class="empty">(boş)</span>'}</td></tr>`;
    }).join('')
    : '<tr><td colspan="2" class="empty">Form alanı gelmedi. Alanlara ad verildiğinden emin olun.</td></tr>';

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <title>Form yanıtı — Narvis</title>
  <style>
    body {
      margin: 0; padding: 40px 24px; background: #f4f1ea; color: #22201c;
      font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px; line-height: 1.5;
    }
    main { max-width: 620px; margin: 0 auto; }
    .badge {
      display: inline-block; padding: 4px 10px; border-radius: 999px;
      background-color: #1f6b4f; color: #ffffff; font-size: 12px; font-weight: 700;
    }
    h1 { font-size: 30px; margin: 16px 0 8px; }
    p.lead { color: #6a655c; margin: 0 0 24px; }
    .card {
      background-color: #ffffff; border: 1px solid #ddd7cb; border-radius: 10px;
      padding: 6px 20px; box-shadow: 0 10px 28px rgba(50, 45, 36, 0.08);
    }
    table { width: 100%; border-collapse: collapse; font-size: 15px; }
    th, td { text-align: left; padding: 11px 4px; border-bottom: 1px solid #eee7db; vertical-align: top; }
    tr:last-child th, tr:last-child td { border-bottom: 0; }
    th { width: 34%; color: #6a655c; font-weight: 600; }
    .empty { color: #9a9387; font-style: italic; }
    .note { margin-top: 18px; color: #8a8175; font-size: 13px; }
    .actions { margin-top: 22px; display: flex; gap: 10px; }
    a.button {
      display: inline-block; padding: 9px 16px; border-radius: 7px; text-decoration: none;
      background-color: #22201c; color: #ffffff; font-size: 14px; font-weight: 600;
    }
    a.ghost { background-color: transparent; color: #22201c; border: 1px solid #c9c1b3; }
  </style>
</head>
<body>
  <main>
    <span class="badge">${method === 'POST' ? 'POST' : 'GET'} · form alındı</span>
    <h1>Form sunucuya ulaştı.</h1>
    <p class="lead">Narvis formu gerçek bir ağ isteğiyle gönderdi; bu sayfa sunucunun yanıtı.</p>
    <div class="card">
      <table>${rows}</table>
    </div>
    <p class="note">İstek sunucuda işlendi ve HTML yanıt motor tarafından yeniden çizildi.</p>
    <div class="actions">
      <a class="button" href="demo.html#forms">Demo formuna dön</a>
      <a class="button ghost" href="about.html">Mimariyi oku</a>
    </div>
  </main>
</body>
</html>`;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    if (pathname === '/pages/form-result.html' || pathname === '/form-result') {
      const fields = await formFields(request, url);
      const html = renderFormResult(fields, request.method || 'GET');
      const body = Buffer.from(html, 'utf8');
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }

    const filePath = normalize(join(root, pathname));
    if (filePath !== root && !filePath.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('403 — Kök dizin dışına erişim yok.');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(`404 — Bulunamadı: ${pathname}`);
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`500 — Sunucu hatası: ${error.message}`);
  }
});

server.listen(port, () => {
  console.log('');
  console.log('  Narvis 0.1 hazır.');
  console.log(`  http://localhost:${port}/`);
  console.log('');
  console.log('  Durdurmak için Ctrl+C.');
  console.log('');
});
