const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'site');
const args = process.argv.slice(2);
let host = '127.0.0.1';
let port = 7100;

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--port' || args[i] === '-p') {
    port = Number(args[++i]);
  } else if (args[i] === '--host') {
    host = args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : '0.0.0.0';
  }
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (pathname === '/') {
    res.writeHead(302, { Location: '/eval-preview/' }).end();
    return;
  }

  let filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404).end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}).listen(port, host, () => {
  console.log(`Preview available at http://${host}:${port}/`);
});
