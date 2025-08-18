const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_abrir';
const CODES_FILE = path.join(__dirname, 'codes.json');

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

function loadCodes() {
  try {
    const data = fs.readFileSync(CODES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveCodes(codes) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
}

async function handleCodes(req, res) {
  setCorsHeaders(res);
  const parts = req.url.split('/').filter(Boolean); // ['codes', '1234']
  const codes = loadCodes();

  if (parts.length === 1 && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(codes));
    return;
  }

  if (parts.length === 1 && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        codes.push(data);
        saveCodes(codes);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (parts.length === 2) {
    const pin = parts[1];
    const index = codes.findIndex(c => String(c.pin) === pin);

    if (req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (index === -1) codes.push({ pin, ...data });
          else codes[index] = { ...codes[index], ...data, pin };
          saveCodes(codes);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      if (index !== -1) {
        codes.splice(index, 1);
        saveCodes(codes);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === 'GET') {
      if (index === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(codes[index]));
      }
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
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

  if (req.url.startsWith('/codes')) {
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
