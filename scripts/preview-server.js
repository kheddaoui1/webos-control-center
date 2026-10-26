'use strict';

/* Tiny static server for previewing the renderer in a normal browser:
   npm run preview  →  http://127.0.0.1:4173 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'renderer');
const pkg = require(path.join(__dirname, '..', 'package.json'));
const port = Number(process.env.PORT) || 4173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    if (rel === 'index.html') {
      // The browser build has no app.getVersion(); expose the real one to the mock.
      // A meta tag keeps this working under the page's inline-script CSP.
      data = Buffer.from(
        data.toString('utf8').replace('</head>', `<meta name="app-version" content="${pkg.version}"></head>`)
      );
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Preview: http://127.0.0.1:${port}`);
});
