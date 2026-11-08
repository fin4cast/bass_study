import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const routes = new Map([['/', 'index.html'], ...['style.css', 'app.mjs', 'audio.mjs', 'patterns.mjs'].map(name => ['/' + name, name])]);
export async function startServer(port = 4197) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    const target = path === '/theme.css' ? resolve(root, '../../src/theme.css') : routes.has(path) ? resolve(root, routes.get(path)) : null;
    if (!target) { res.writeHead(404).end(); return; }
    try { const bytes = await readFile(target); res.writeHead(200, {'Content-Type': extname(target) === '.css' ? 'text/css; charset=utf-8' : extname(target) === '.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store'}).end(bytes); }
    catch { res.writeHead(500).end('Reference file unavailable'); }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const server = await startServer(); console.log(`Референс VIS-05 r1: http://127.0.0.1:${server.address().port}`); }
  catch(error) { console.error(error.message); process.exitCode = 1; }
}
