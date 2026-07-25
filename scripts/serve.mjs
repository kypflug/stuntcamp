#!/usr/bin/env node
/**
 * Local preview that mimics the Cloudflare Worker: visit
 * http://localhost:8787/ for the hub and http://<slug>.localhost:8787/ for an
 * app, so subdomain routing can be exercised without deploying.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { DIST, ROOT } from './registry.mjs';

const PORT = Number(process.env.PORT || 8787);
const ROUTES_FILE = join(ROOT, 'worker', 'routes.json');
const table = existsSync(ROUTES_FILE)
  ? JSON.parse(readFileSync(ROUTES_FILE, 'utf8'))
  : { routes: {} };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function resolveFile(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, rel);
  if (!file.startsWith(DIST)) return null;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const label = host.endsWith('.localhost') ? host.slice(0, -'.localhost'.length) : null;
  const url = new URL(req.url, 'http://x');

  let pathname = url.pathname;
  if (label && label !== 'www') {
    const route = table.routes?.[label];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return createReadStream(join(DIST, '404.html')).pipe(res);
    }
    if (route.kind !== 'hosted') {
      res.writeHead(301, { location: route.url });
      return res.end();
    }
    pathname = route.path + pathname;
  }

  const file = resolveFile(pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return createReadStream(join(DIST, '404.html')).pipe(res);
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`hub    http://localhost:${PORT}/`);
  for (const slug of Object.keys(table.routes || {})) {
    console.log(`app    http://${slug}.localhost:${PORT}/`);
  }
});
