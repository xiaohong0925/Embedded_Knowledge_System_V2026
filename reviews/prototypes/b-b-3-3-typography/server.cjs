const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = __dirname;
const args = process.argv.slice(2);

function readArg(name, fallback) {
  const exact = args.indexOf(`--${name}`);
  if (exact !== -1 && args[exact + 1]) return args[exact + 1];
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

const host = readArg('host', '127.0.0.1');
const port = Number(readArg('port', process.env.PORT || '7100'));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, host, () => {
  console.log(`Typography prototype: http://${host}:${port}/`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
