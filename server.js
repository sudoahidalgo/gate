const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_martes';
const ADMIN_CODE = '3401';
const PIN_TO_NAME = {
  '7777': 'Carlos Mendoza'
};

function serveIndex(res) {
  fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}

function appendLog(pin, name) {
  const entry = `${new Date().toISOString()} - ${pin} - ${name}\n`;
  const file = path.join(__dirname, 'log.txt');
  fs.appendFile(file, entry, err => {
    if (err) console.error('Error writing log:', err);
  });
}

function forwardWebhook(callback) {
  const url = new URL(WEBHOOK_URL);
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname + url.search,
    protocol: url.protocol,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    headers: { 'Content-Length': 0 }
  };

  const req = (url.protocol === 'https:' ? https : http).request(options, res => {
    res.on('data', () => {});
    res.on('end', () => callback());
  });
  req.on('error', err => {
    console.error('Webhook error:', err);
    callback();
  });
  req.end();
}

function serveAdmin(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  if (parsed.searchParams.get('code') !== ADMIN_CODE) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Unauthorized');
    return;
  }

  const file = path.join(__dirname, 'log.txt');
  fs.readFile(file, 'utf8', (err, data) => {
    if (err && err.code !== 'ENOENT') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    const lines = (data || '').trim().split('\n').filter(Boolean);
    const rows = lines.map(l => {
      const [time, pin, name] = l.split(' - ');
      return `<tr><td>${time}</td><td>${name || ''}</td><td>${pin}</td></tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Registro de uso</title>
    <style>body{font-family:Arial,sans-serif;padding:2rem;background:#f5f7fa;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:0.5rem;text-align:left;}th{background:#eee;}</style>
    </head><body><h2>Registro de uso del portón</h2>
    <table><tr><th>Hora</th><th>Usuario</th><th>PIN</th></tr>${rows}</table></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
}

function handleLog(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const pin = data.pin || 'unknown';
      const name = PIN_TO_NAME[pin] || 'unknown';
      appendLog(pin, name);
      forwardWebhook(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid data');
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    serveIndex(res);
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/admin')) {
    serveAdmin(req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/log') {
    handleLog(req, res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
