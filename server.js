const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TIMEZONE = process.env.TIMEZONE || 'America/Costa_Rica'; // Default to Costa Rica timezone
const WEBHOOK_URL = process.env.WEBHOOK_URL ||
  'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_martes';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

function getCurrentTimeInTimezone() {
  return new Date().toLocaleString("en-US", {timeZone: TIMEZONE});
}

function codeAllowed(code) {
  // Use timezone-aware date
  const now = new Date(getCurrentTimeInTimezone());
  const day = now.getDay();
  
  console.log(`Checking code for user ${code.user || code.username || 'Unknown'}:`);
  console.log(`  Current time (${TIMEZONE}): ${now.toLocaleString()}`);
  console.log(`  Current day: ${day} (0=Sunday, 6=Saturday)`);
  console.log(`  Allowed days: [${code.days.join(', ')}]`);
  console.log(`  Allowed hours: ${code.start} - ${code.end}`);
  
  if (!code.days.includes(day)) {
    console.log(`  ❌ Day not allowed`);
    return false;
  }
  
  const cur = now.getHours() * 60 + now.getMinutes();
  const startM = minutes(code.start);
  const endM = minutes(code.end);
  
  console.log(`  Current time in minutes: ${cur}`);
  console.log(`  Start time in minutes: ${startM}`);
  console.log(`  End time in minutes: ${endM}`);
  
  let timeAllowed;
  if (startM <= endM) {
    // Same day range (e.g., 09:00 - 17:00)
    timeAllowed = cur >= startM && cur <= endM;
  } else {
    // Overnight range (e.g., 22:00 - 06:00)
    timeAllowed = cur >= startM || cur <= endM;
  }
  
  console.log(`  ⏰ Time allowed: ${timeAllowed ? '✅' : '❌'}`);
  return timeAllowed;
}

async function pinAllowed(pin) {
  console.log(`\n🔍 Checking PIN: ${pin}`);
  const { data, error } = await supabase
    .from('codes')
    .select('*')
    .eq('pin', pin)
    .single();
    
  if (error || !data) {
    console.log(`❌ PIN not found in database`);
    return null;
  }
  
  console.log(`✅ PIN found for user: ${data.user || data.username || 'Unknown'}`);
  const allowed = codeAllowed(data);
  console.log(`🚪 Access ${allowed ? 'GRANTED' : 'DENIED'}\n`);
  
  return allowed ? data : null;
}

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

function serveLogsPage(res) {
  fs.readFile(path.join(__dirname, 'admin-logs.html'), (err, data) => {
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

async function appendLog(pin, user, success = true, error = null) {
  const { error: dbError } = await supabase
    .from('logs')
    .insert({ 
      timestamp: new Date().toISOString(), 
      pin, 
      user,
      success,
      error_message: error
    });
  if (dbError) console.error('Error writing log:', dbError);
}

// Improved webhook function with better error handling
function forwardWebhook(callback) {
  const url = new URL(WEBHOOK_URL);
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname + url.search,
    protocol: url.protocol,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    headers: { 
      'Content-Length': 0,
      'User-Agent': 'Gate-Controller/1.0'
    },
    timeout: 10000 // 10 second timeout
  };

  console.log(`🔗 Sending webhook to: ${WEBHOOK_URL}`);
  
  const req = (url.protocol === 'https:' ? https : http).request(options, res => {
    console.log(`📡 Webhook response status: ${res.statusCode}`);
    
    let responseData = '';
    res.on('data', chunk => {
      responseData += chunk;
    });
    
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('✅ Webhook sent successfully');
        callback(null); // Success
      } else {
        const errorMsg = `Webhook failed with status ${res.statusCode}: ${responseData}`;
        console.error(`❌ ${errorMsg}`);
        callback(new Error(errorMsg));
      }
    });
  });

  req.on('error', err => {
    const errorMsg = `Webhook network error: ${err.message}`;
    console.error(`❌ ${errorMsg}`);
    callback(new Error(errorMsg));
  });

  req.on('timeout', () => {
    const errorMsg = 'Webhook request timed out';
    console.error(`⏱️ ${errorMsg}`);
    req.destroy();
    callback(new Error(errorMsg));
  });

  req.end();
}

// Debug endpoint
async function serveDebug(res) {
  const now = new Date(getCurrentTimeInTimezone());
  const codes = await loadCodes();
  
  const debugInfo = {
    server_time: new Date().toISOString(),
    local_time: now.toLocaleString(),
    timezone: TIMEZONE,
    current_day: now.getDay(),
    current_hour: now.getHours(),
    current_minute: now.getMinutes(),
    webhook_url: WEBHOOK_URL,
    codes_count: codes.length,
    codes: codes.map(code => ({
      pin: code.pin,
      user: code.user,
      days: code.days,
      schedule: `${code.start} - ${code.end}`,
      currently_allowed: codeAllowed(code)
    }))
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(debugInfo, null, 2));
}

// Test webhook endpoint
async function testWebhook(req, res) {
  console.log('🧪 Testing webhook connection...');
  
  forwardWebhook((error) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        ok: false, 
        error: 'Webhook test failed', 
        details: error.message,
        webhook_url: WEBHOOK_URL
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        ok: true, 
        message: 'Webhook test successful',
        webhook_url: WEBHOOK_URL
      }));
    }
  });
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
        await appendLog(pin, 'Unknown', false, 'Invalid code or outside allowed hours');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' }));
        return;
      }

      // Send webhook and wait for response
      forwardWebhook(async (error) => {
        if (error) {
          // Webhook failed
          console.error(`❌ Gate opening failed for ${code.user || code.username || 'Unknown'}: ${error.message}`);
          await appendLog(pin, code.user, false, error.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            ok: false, 
            error: 'Error al abrir el portón. Intenta de nuevo.' 
          }));
        } else {
          // Webhook succeeded
          console.log(`✅ Gate opened successfully for ${code.user || code.username || 'Unknown'}`);
          await appendLog(pin, code.user, true);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }
      });
    } catch (err) {
      console.error('Error parsing request:', err);
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
  if (req.method === 'GET' && (req.url === '/admin/logs' || req.url === '/logs-view')) {
    serveLogsPage(res);
    return;
  }
  if (req.method === 'GET' && req.url === '/logs') {
    serveLogs(res);
    return;
  }
  if (req.method === 'GET' && req.url === '/debug') {
    serveDebug(res);
    return;
  }
  if (req.method === 'GET' && req.url === '/test-webhook') {
    testWebhook(req, res);
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
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌍 Timezone: ${TIMEZONE}`);
    console.log(`🔗 Webhook URL: ${WEBHOOK_URL}`);
    console.log(`\n📋 Available routes:`);
    console.log(`   GET  /           - Main gate interface`);
    console.log(`   GET  /admin      - Admin panel`);
    console.log(`   GET  /debug      - Debug info & code validation`);
    console.log(`   GET  /test-webhook - Test webhook connection`);
  });
}

module.exports = server;
