const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Debug logging
console.log('Environment check:');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'SET' : 'MISSING');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase environment variables!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
console.log('✅ Supabase client created');

async function loadCodes() {
  console.log('🔄 Loading codes...');
  try {
    const { data, error } = await supabase.from('codes').select('*');
    if (error) {
      console.error('❌ Error loading codes:', error);
      return [];
    }
    console.log('✅ Loaded codes:', data?.length || 0);
    return data || [];
  } catch (err) {
    console.error('❌ Exception loading codes:', err);
    return [];
  }
}

async function saveCode(code) {
  console.log('🔄 Saving code:', code);
  try {
    const { data, error } = await supabase.from('codes').insert(code);
    if (error) {
      console.error('❌ Error saving code:', error);
      return false;
    }
    console.log('✅ Code saved successfully:', data);
    return true;
  } catch (err) {
    console.error('❌ Exception saving code:', err);
    return false;
  }
}

async function updateCode(pin, updates) {
  console.log('🔄 Updating code:', pin, updates);
  try {
    const { data, error } = await supabase
      .from('codes')
      .update(updates)
      .eq('pin', pin);
    if (error) {
      console.error('❌ Error updating code:', error);
      return false;
    }
    console.log('✅ Code updated successfully:', data);
    return true;
  } catch (err) {
    console.error('❌ Exception updating code:', err);
    return false;
  }
}

async function deleteCode(pin) {
  console.log('🔄 Deleting code:', pin);
  try {
    const { data, error } = await supabase
      .from('codes')
      .delete()
      .eq('pin', pin);
    if (error) {
      console.error('❌ Error deleting code:', error);
      return false;
    }
    console.log('✅ Code deleted successfully:', data);
    return true;
  } catch (err) {
    console.error('❌ Exception deleting code:', err);
    return false;
  }
}

function minutes(t) {
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
}

function getNow() {
  const tz = process.env.TIMEZONE || 'UTC';
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
}

function codeAllowed(code) {
  const now = getNow();
  const day = now.getDay();
  if (!code.days.includes(day)) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const startM = minutes(code.start_time);
  const endM = minutes(code.end_time);
  if (startM <= endM) {
    return cur >= startM && cur <= endM;
  }
  return cur >= startM || cur <= endM;
}

async function pinAllowed(pin) {
  try {
    const { data, error } = await supabase
      .from('codes')
      .select('*')
      .eq('pin', pin)
      .single();
    if (error || !data) return null;
    return codeAllowed(data) ? data : null;
  } catch (err) {
    console.error('❌ Exception checking pin:', err);
    return null;
  }
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
  try {
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .order('timestamp', { ascending: false });
    if (error) {
      console.error('Error fetching logs:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Exception fetching logs:', err);
    return [];
  }
}

async function serveLogs(res) {
  const entries = await readLogs();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ entries }));
}

async function appendLog(pin, username) {
  try {
    const { error } = await supabase
      .from('logs')
      .insert({ timestamp: new Date().toISOString(), pin, username });
    if (error) console.error('Error writing log:', error);
  } catch (err) {
    console.error('Exception writing log:', err);
  }
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
      const code = await pinAllowed(pin);
      if (!code) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' }));
        return;
      }
      await appendLog(pin, code.username);
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

function parseUrl(url) {
  const parts = url.split('/').filter(part => part.length > 0);
  return {
    path: '/' + parts.join('/'),
    segments: parts
  };
}

const server = http.createServer((req, res) => {
  console.log(`📥 ${req.method} ${req.url}`);
  
  const { path: urlPath, segments } = parseUrl(req.url);
  
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
    loadCodes().then(codes => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(codes));
    }).catch(err => {
      console.error('Error in GET /codes:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error: ' + err.message);
    });
    return;
  }
  
  // ADD new code
  if (req.method === 'POST' && req.url === '/codes') {
    console.log('📝 POST /codes request received');
    let body = '';
    req.on('data', c => { 
      body += c; 
      console.log('📊 Data chunk received:', c.length, 'bytes');
    });
    req.on('end', async () => {
      try {
        console.log('📋 Full body received:', body);
        const data = JSON.parse(body);
        console.log('🔍 Parsed data:', JSON.stringify(data, null, 2));
        
        const codeToSave = {
          pin: String(data.pin),
          username: data.username || '',
          days: Array.isArray(data.days) ? data.days : [],
          start_time: data.start_time || '00:00',
          end_time: data.end_time || '23:59'
        };
        console.log('💾 Code to save:', JSON.stringify(codeToSave, null, 2));
        
        const success = await saveCode(codeToSave);
        console.log('✅ Save result:', success);
        
        res.writeHead(success ? 200 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: success }));
      } catch (err) {
        console.error('❌ Error in POST /codes:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  
  // UPDATE existing code
  if (req.method === 'PUT' && segments[0] === 'codes' && segments[1]) {
    const pin = segments[1];
    console.log('📝 PUT /codes/' + pin + ' request received');
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const updates = {
          username: data.username || '',
          days: Array.isArray(data.days) ? data.days : [],
          start_time: data.start_time || '00:00',
          end_time: data.end_time || '23:59'
        };
        const success = await updateCode(pin, updates);
        res.writeHead(success ? 200 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: success }));
      } catch (err) {
        console.error('❌ Error in PUT /codes:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  
  // DELETE code
  if (req.method === 'DELETE' && segments[0] === 'codes' && segments[1]) {
    const pin = segments[1];
    console.log('🗑️ DELETE /codes/' + pin + ' request received');
    deleteCode(pin).then(success => {
      res.writeHead(success ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: success }));
    }).catch(err => {
      console.error('❌ Error in DELETE /codes:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }
  
  if (req.method === 'POST' && req.url === '/open') {
    handleOpen(req, res);
    return;
  }
  
  console.log('❓ 404 - Not found:', req.method, req.url);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

module.exports = server;
