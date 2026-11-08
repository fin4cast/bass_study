import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, selection, sampleBytes } from './inspect.mjs';

export async function startServer(port = Number(process.env.BASS_MUSIC_BANK_PORT || 4196)) {
  const vendor = resolve(root, 'generated-vendor');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      let data, extension;
      if (path === '/samples.json') {
        data = JSON.stringify(selection.samples.map(({ id, relativePath, reason, extension }) => ({ id, relativePath, reason, extension })));
        extension = '.json';
      } else if (path.startsWith('/samples/')) {
        const sample = selection.samples.find(s => s.id === path.slice('/samples/'.length));
        if (!sample) { response.writeHead(404).end(); return; }
        data = await sampleBytes(sample); extension = '.bin';
      } else {
        const isVendor = path.startsWith('/vendor/');
        const base = isVendor ? vendor : root;
        const relative = isVendor ? path.slice('/vendor/'.length) : ({ '/': 'index.html', '/app.mjs': 'app.mjs', '/style.css': 'style.css' })[path];
        if (!relative) { response.writeHead(404).end(); return; }
        const target = resolve(base, relative);
        if (!target.startsWith(base + sep)) { response.writeHead(403).end(); return; }
        data = await readFile(target); extension = extname(target);
      }
      response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(data);
    } catch (error) { response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(error)); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  console.log(`Отдельная проба музбанка: http://127.0.0.1:${port}`);
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startServer();
