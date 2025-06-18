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

function codeAllowed(code) {
  // Use Costa Rica timezone (UTC-6)
  const now = new Date();
  const costaRicaTime = new Date(now.getTime() - (6 * 60 * 60 * 1000)); // UTC-6
  
  const day = costaRicaTime.getUTCDay();
  if (!code.days.includes(day)) return false;
  
  const cur = costaRicaTime.getUTCHours() * 60 + costaRicaTime.getUTCMinutes();
  const startM = minutes(code.start);
  const endM = minutes(code.end);
  
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

async function handleOpen(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const pin = data.pin || 'unknown';
      console.log(`Attempting to open with PIN: ${pin}`);
      
      const code = await pinAllowed(pin);
      if (!code) {
        console.log(`PIN ${pin} rejected - invalid or out of schedule`);
        
        // Check if PIN exists at all
        const { data: allCodes, error } = await supabase
          .from('codes')
          .select('*')
          .eq('pin', pin);
        
        if (error || !allCodes || allCodes.length === 0) {
          console.log(`PIN ${pin} not found in database`);
        } else {
          console.log(`PIN ${pin} found but not allowed right now:`, allCodes[0]);
        }
        
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
    // Debug endpoint to check current time and codes
    loadCodes().then(codes => {
      const now = new Date();
      const costaRicaTime = new Date(now.getTime() - (6 * 60 * 60 * 1000));
      const debug = {
        serverTime: now.toISOString(),
        costaRicaTime: costaRicaTime.toISOString(),
        day: costaRicaTime.getUTCDay(),
        currentMinutes: costaRicaTime.getUTCHours() * 60 + costaRicaTime.getUTCMinutes(),
        codes: codes.map(c => ({
          pin: c.pin,
          user: c.user,
          days: c.days,
          start: c.start,
          end: c.end,
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
