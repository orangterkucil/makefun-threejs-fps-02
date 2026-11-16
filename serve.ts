// serve.ts — a dependency-free static server for the game folder.
//
// The capture step needs the page over http:// (ES modules and an import map do not load
// from file://), so this serves game/ with the four MIME types that matter and refuses
// any path that escapes the root. Run it with: node --experimental-strip-types serve.ts
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const flags = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  flags.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
}
const port = Number(flags.get('port') ?? 8123);
const root = resolve(flags.get('root') ?? 'game');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const path = resolve(join(root, normalize(decodeURIComponent(requested))));

  if (path !== root && !path.startsWith(root + sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    return;
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}`);
});
