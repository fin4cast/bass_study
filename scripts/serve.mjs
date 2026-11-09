import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';

const defaultRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf' };
export function createStudyStaticServer(directory = defaultRoot) {
  const root = resolve(directory);
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const filename = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!filename.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(filename);
      res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch { res.writeHead(404).end('Not found'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = 4173;
  const server = createStudyStaticServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Порт 4173 занят. Остановите другой экземпляр приложения или стенд P1.' : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`bass.study — Local: http://localhost:${port}`));
}
