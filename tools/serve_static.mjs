// Minimal static file server used to test the "host already gzips" code path:
// files ending in .gz are sent with Content-Encoding: gzip (like GitHub Pages does for .gz assets).
// Usage: node tools/serve_static.mjs <dir> <port>
import {createServer} from 'node:http';
import {readFileSync, statSync, existsSync} from 'node:fs';
import {join, resolve, extname} from 'node:path';

const root = resolve(process.argv[2] || '.');
const port = +(process.argv[3] || 8951);
const types = {'.html': 'text/html; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown', '.gz': 'application/octet-stream', '.bin': 'application/octet-stream'};

createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = join(root, path === '/' ? 'index.html' : path.slice(1));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const body = readFileSync(file);
  const ext = extname(file);
  const headers = {'Content-Type': types[ext] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=600'};
  if (ext === '.gz') headers['Content-Encoding'] = 'gzip';
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/ (gz sent with Content-Encoding: gzip)`));