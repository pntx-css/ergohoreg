import http from 'node:http';
import {createReadStream} from 'node:fs';
import {realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
let host = '127.0.0.1';
let port = 5173;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--host') host = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : '0.0.0.0';
  else if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
  else throw new Error(`Argumen tidak dikenal: ${args[i]}. Gunakan --host atau --port 5173.`);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port harus berupa angka 1–65535.');
const lastPort = Math.min(port + 20, 65535);

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.woff2': 'font/woff2'
};
const insideRoot = file => {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};
const server = http.createServer(async (req, res) => {
  const reply = (status, message) => {
    res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end(req.method === 'HEAD' ? undefined : message);
  };
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return reply(405, 'Method not allowed');
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { return reply(400, 'Invalid URL'); }
  const segments = pathname.split(/[\\/]/);
  if (segments.some(part => part.startsWith('.') || part === 'node_modules') || /[\0:]/.test(pathname)) return reply(403, 'Forbidden');
  const candidate = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!insideRoot(candidate)) return reply(403, 'Forbidden');
  try {
    const file = await realpath(candidate);
    if (!insideRoot(file)) return reply(403, 'Forbidden');
    const info = await stat(file);
    if (!info.isFile()) return reply(404, 'Not found');
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', error => { console.error(error.message); res.destroy(error); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return reply(404, 'Not found');
    console.error(error);
    reply(500, 'Unable to read file');
  }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && port < lastPort) {
    console.log(`Port ${port} sedang dipakai, mencoba port ${port + 1}...`);
    port++;
    server.listen(port, host);
    return;
  }
  console.error(error.code === 'EADDRINUSE' ? `Semua port yang dicoba sedang dipakai. Pilih port lain dengan npm run dev -- --port 6000` : error.message);
  process.exitCode = 1;
});
server.on('listening', () => {
  console.log(`\nLiving Room Scene\nLocal: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\nRefresh browser setelah mengubah file. Ctrl+C untuk berhenti.\n`);
  if (host === '0.0.0.0') console.log(`HP satu jaringan: http://<IP-komputer>:${port}. Gunakan HTTPS untuk WebXR headset.`);
});
server.listen(port, host);
