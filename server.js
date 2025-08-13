const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_abrir';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function serveFile(filePath, contentType, res) {
  fs.readFile(path.join(__dirname, filePath), (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

function handleCodes(req, res) {
  setCorsHeaders(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify([]));
}

function handleOpen(req, res) {
  setCorsHeaders(res);
  const url = new URL(WEBHOOK_URL);
  const client = url.protocol === 'https:' ? https : http;

  const webhookReq = client.request(url, { method: 'POST' }, webhookRes => {
    webhookRes.on('data', () => {});
    webhookRes.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  webhookReq.on('error', () => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Webhook error' }));
  });

  webhookReq.end();
}

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    serveFile('index.html', 'text/html', res);
    return;
  }

  if (req.method === 'GET' && req.url === '/admin') {
    serveFile('admin.html', 'text/html', res);
    return;
  }

  if (req.method === 'GET' && req.url === '/codes-encrypted.js') {
    serveFile('codes-encrypted.js', 'application/javascript', res);
    return;
  }

  if (req.url === '/codes') {
    handleCodes(req, res);
    return;
  }

  if (req.method === 'POST' && req.url === '/open') {
    handleOpen(req, res);
    return;
  }

  setCorsHeaders(res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Gate Control Server running on port ${PORT}`);
  });
}

module.exports = server;
