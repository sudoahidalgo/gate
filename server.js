const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const USERS = { '7777': 'Carlos Mendoza' };

const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_martes';

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

function serveAdmin(res) {
  fs.readFile(path.join(__dirname, 'admin.html'), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}

function readLogs(callback) {
  const file = path.join(__dirname, 'log.txt');
  fs.readFile(file, 'utf8', (err, data) => {
    if (err) {
      callback([]);
      return;
    }
    const lines = data.trim().split('\n').filter(Boolean);
    const entries = lines.map(line => {
      const [timestampPart, pin] = line.split(' - ');
      return { timestamp: timestampPart, pin, user: USERS[pin] };
    });
    callback(entries);
  });
}

function serveLogs(res) {
  readLogs(entries => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ entries }));
  });
}

function appendLog(pin) {
  const entry = `${new Date().toISOString()} - ${pin}\n`;
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

function handleLog(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const pin = data.pin || 'unknown';
      appendLog(pin);
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
  if (req.method === 'GET' && req.url === '/admin') {
    serveAdmin(res);
    return;
  }
  if (req.method === 'GET' && req.url === '/logs') {
    serveLogs(res);
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
