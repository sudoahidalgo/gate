const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CODES_FILE = path.join(__dirname, 'codes.json');

async function loadCodes() {
  const { data, error } = await supabase.from('codes').select('*');
  if (error) {
    console.error('Error loading codes:', error);
    return [];
  }
  return data || [];
}

async function saveCode(code) {
  const { error } = await supabase.from('codes').insert(code);
  if (error) console.error('Error saving code:', error);
}

function minutes(t) {
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
}

function getNow() {
  const tz = process.env.TIMEZONE || 'America/Costa_Rica';
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
}

function codeAllowed(code) {
  const now = getNow();
  const day = now.getDay();
  if (!code.days.includes(day)) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  
  // Support both old and new column names
  const startTime = code.start_time || code.start || '00:00';
  const endTime = code.end_time || code.end || '23:59';
  
  const startM = minutes(startTime);
  const endM = minutes(endTime);
  
  console.log(`Code check: PIN ${code.pin}, Day ${day} (allowed: ${code.days}), Time ${cur} (${startM}-${endM})`);
  
  if (startM <= endM) {
    return cur >= startM && cur <= endM;
  }
  return cur >= startM || cur <= endM;
}

async function pinAllowed(pin) {
  const { data, error } = await supabase
    .from('codes')
    .select('*')
    .eq('pin', pin)
    .single();
  if (error || !data) return null;
  return codeAllowed(data) ? data : null;
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

async function readLogs() {
  const { data, error } = await supabase
    .from('logs')
    .select('*')
    .order('timestamp', { ascending: false });
  if (error) {
    console.error('Error fetching logs:', error);
    return [];
  }
  return data || [];
}

async function serveLogs(res) {
  const entries = await readLogs();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ entries }));
}

async function appendLog(pin, user) {
  const { error } = await supabase
    .from('logs')
    .insert({ timestamp: new Date().toISOString(), pin, user });
  if (error) console.error('Error writing log:', error);
}

function forwardWebhook(callback) {
  console.log(`🔗 Calling webhook: ${WEBHOOK_URL}`);
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
    console.log(`📡 Webhook response status: ${res.statusCode}`);
    res.on('data', (data) => {
      console.log(`📡 Webhook response data: ${data}`);
    });
    res.on('end', () => {
      console.log(`✅ Webhook completed`);
      callback();
    });
  });
  req.on('error', err => {
    console.error('❌ Webhook error:', err);
    callback();
  });
  req.setTimeout(10000, () => {
    console.error('❌ Webhook timeout');
    req.destroy();
    callback();
  });
  req.end();
}

async function handleOpen(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const pin = data.pin || 'unknown';
      console.log(`Attempting to open with PIN: ${pin} at ${getNow().toISOString()}`);
      
      const code = await pinAllowed(pin);
      if (!code) {
        console.log(`PIN ${pin} rejected - invalid or out of schedule`);
        
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' }));
        return;
      }
      
      console.log(`PIN ${pin} accepted for user: ${code.user}`);
      await appendLog(pin, code.user);
      forwardWebhook(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (err) {
      console.error('Error in handleOpen:', err);
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
  if (req.method === 'GET' && req.url === '/debug') {
    loadCodes().then(codes => {
      const now = getNow();
      const debug = {
        timezone: process.env.TIMEZONE || 'America/Costa_Rica (default)',
        currentTime: now.toISOString(),
        day: now.getDay(),
        currentMinutes: now.getHours() * 60 + now.getMinutes(),
        codes: codes.map(c => ({
          pin: c.pin,
          user: c.user,
          days: c.days,
          start: c.start_time || c.start,
          end: c.end_time || c.end,
          allowed: codeAllowed(c)
        }))
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(debug, null, 2));
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/codes') {
    loadCodes().then(codes => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(codes));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/codes') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        await saveCode({
          pin: String(data.pin),
          user: data.user || '',
          days: Array.isArray(data.days) ? data.days : [],
          start: data.start || '00:00',
          end: data.end || '23:59'
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid data');
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/test-webhook') {
    console.log('🧪 Testing webhook manually...');
    forwardWebhook(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Webhook test completed - check logs' }));
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
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = server;
