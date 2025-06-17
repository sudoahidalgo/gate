const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const CODES_FILE = path.join(__dirname, 'codes.json');

function loadCodes() {
  try {
    const data = fs.readFileSync(CODES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    const defaults = [{
      pin: '7777',
      user: 'Carlos Mendoza',
      days: [0,1,2,3,4,5,6],
      start: '00:00',
      end: '23:59'
    }];
    fs.writeFileSync(CODES_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}

function saveCodes(codes) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
}

function minutes(t) {
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
}

function pinAllowed(pin) {
  const codes = loadCodes();
  const code = codes.find(c => c.pin === pin);
  if (!code) return false;
  const now = new Date();
  const day = now.getDay();
  if (!code.days.includes(day)) return false;
  const cur = now.getHours()*60 + now.getMinutes();
  const startM = minutes(code.start);
  const endM = minutes(code.end);
  if (startM <= endM) {
    return cur >= startM && cur <= endM;
  }
  return cur >= startM || cur <= endM;
}

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
    const codes = loadCodes();
    const map = {};
    codes.forEach(c => { map[c.pin] = c.user; });
    const lines = data.trim().split('\n').filter(Boolean);
    const entries = lines.map(line => {
      const [timestampPart, pin] = line.split(' - ');
      return { timestamp: timestampPart, pin, user: map[pin] };
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

function handleOpen(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const pin = data.pin || 'unknown';
      if (!pinAllowed(pin)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' }));
        return;
      }
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
  if (req.method === 'GET' && req.url === '/codes') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loadCodes()));
    return;
  }
  if (req.method === 'POST' && req.url === '/codes') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const codes = loadCodes();
        codes.push({
          pin: String(data.pin),
          user: data.user || '',
          days: Array.isArray(data.days) ? data.days : [],
          start: data.start || '00:00',
          end: data.end || '23:59'
        });
        saveCodes(codes);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid data');
      }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/open') {
    handleOpen(req, res);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
