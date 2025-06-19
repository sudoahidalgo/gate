const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_abrir';
const COSTA_RICA_OFFSET = -6; // GMT-6

// CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Get current time in Costa Rica timezone
function getCostaRicaTime() {
  const now = new Date();
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utcTime + (COSTA_RICA_OFFSET * 3600000));
}

// Convert time string (HH:MM) to minutes
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

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

function isCodeAllowed(code) {
  const costaRicaTime = getCostaRicaTime();
  const currentDay = costaRicaTime.getDay();
  const currentMinutes = costaRicaTime.getHours() * 60 + costaRicaTime.getMinutes();
  
  // Check if current day is allowed
  if (!code.days.includes(currentDay)) {
    console.log(`Access denied: Day ${currentDay} not in allowed days [${code.days}]`);
    return false;
  }
  
  // Check if current time is within allowed hours
  const startMinutes = timeToMinutes(code.start);
  const endMinutes = timeToMinutes(code.end);
  
  let timeAllowed;
  if (startMinutes <= endMinutes) {
    // Normal time range (e.g., 08:00 to 18:00)
    timeAllowed = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    // Overnight time range (e.g., 22:00 to 06:00)
    timeAllowed = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
  
  if (!timeAllowed) {
    const currentTime = `${String(costaRicaTime.getHours()).padStart(2, '0')}:${String(costaRicaTime.getMinutes()).padStart(2, '0')}`;
    console.log(`Access denied: Current time ${currentTime} not in allowed range ${code.start}-${code.end}`);
  }
  
  return timeAllowed;
}

async function validatePin(pin) {
  const { data, error } = await supabase
    .from('codes')
    .select('*')
    .eq('pin', pin)
    .single();
    
  if (error || !data) {
    console.log(`PIN validation failed: ${pin} not found`);
    return null;
  }
  
  if (!isCodeAllowed(data)) {
    return null;
  }
  
  console.log(`PIN validated: ${pin} for user ${data.user}`);
  return data;
}

async function logAccess(pin, user) {
  const timestamp = getCostaRicaTime().toISOString();
  const { error } = await supabase
    .from('logs')
    .insert({ timestamp, pin, user });
    
  if (error) {
    console.error('Error logging access:', error);
  } else {
    console.log(`Access logged: ${user} (${pin}) at ${timestamp}`);
  }
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

function triggerWebhook(callback) {
  console.log(`Triggering webhook: ${WEBHOOK_URL}`);
  
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
    console.log(`Webhook response: ${res.statusCode}`);
    res.on('data', () => {});
    res.on('end', () => callback());
  });
  
  req.on('error', err => {
    console.error('Webhook error:', err.message);
    callback();
  });
  
  req.end();
}

// Route handlers
function serveFile(filePath, contentType, res) {
  setCorsHeaders(res);
  fs.readFile(path.join(__dirname, filePath), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function handleOpen(req, res) {
  setCorsHeaders(res);
  let body = '';
  
  req.on('data', chunk => {
    body += chunk;
  });
  
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const pin = data.pin || 'unknown';
      
      console.log(`Gate access attempt with PIN: ${pin}`);
      
      const code = await validatePin(pin);
      if (!code) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          ok: false, 
          error: 'Código inválido o fuera de horario' 
        }));
        return;
      }
      
      await logAccess(pin, code.user);
      
      triggerWebhook(() => {
        console.log(`Gate opened successfully for ${code.user}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          ok: true,
          user: code.user,
          message: `¡Bienvenido(a) ${code.user} a la Casa Hidalgo Venegas!`
        }));
      });
      
    } catch (err) {
      console.error('Error handling open request:', err);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid data');
    }
  });
}

async function handleCodes(req, res) {
  setCorsHeaders(res);
  
  if (req.method === 'GET') {
    const codes = await loadCodes();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(codes));
    return;
  }
  
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
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
      } catch (err) {
        console.error('Error saving code:', err);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid data');
      }
    });
  }
}

async function handleCodesWithPin(req, res, pin) {
  setCorsHeaders(res);
  
  if (req.method === 'PUT') {
    // Actualizar código existente
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { error } = await supabase
          .from('codes')
          .update({
            user: data.user || '',
            days: Array.isArray(data.days) ? data.days : [],
            start: data.start || '00:00',
            end: data.end || '23:59'
          })
          .eq('pin', pin);
          
        if (error) {
          console.error('Error updating code:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: error.message }));
          return;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Error updating code:', err);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid data');
      }
    });
  }
  
  if (req.method === 'DELETE') {
    // Eliminar código
    try {
      const { error } = await supabase
        .from('codes')
        .delete()
        .eq('pin', pin);
        
      if (error) {
        console.error('Error deleting code:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message }));
        return;
      }
      
      console.log(`Code ${pin} deleted successfully`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error('Error deleting code:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
    }
  }
}

async function handleLogs(req, res) {
  setCorsHeaders(res);
  const entries = await readLogs();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ entries }));
}

async function handleTestWebhook(req, res) {
  setCorsHeaders(res);
  console.log('Test webhook called - no actual gate activation');
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ 
    ok: true, 
    message: 'Test webhook funcionando correctamente',
    timestamp: getCostaRicaTime().toISOString()
  }));
}

// Main server
const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(200);
    res.end();
    return;
  }

  // Route handling
  if (req.method === 'GET' && req.url === '/') {
    serveFile('index.html', 'text/html', res);
    return;
  }
  
  if (req.method === 'GET' && req.url === '/admin') {
    serveFile('admin.html', 'text/html', res);
    return;
  }
  
  if (req.url === '/logs') {
    handleLogs(req, res);
    return;
  }
  
  if (req.url === '/codes') {
    handleCodes(req, res);
    return;
  }
  
  // Handle /codes/{pin} routes for PUT and DELETE
  const codesMatch = req.url.match(/^\/codes\/([^\/]+)$/);
  if (codesMatch) {
    const pin = codesMatch[1];
    handleCodesWithPin(req, res, pin);
    return;
  }
  
  if (req.method === 'POST' && req.url === '/open') {
    handleOpen(req, res);
    return;
  }
  
  if (req.method === 'POST' && req.url === '/test-webhook') {
    handleTestWebhook(req, res);
    return;
  }
  
  // 404 for unhandled routes
  setCorsHeaders(res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Gate Control Server running on port ${PORT}`);
    console.log(`Webhook URL: ${WEBHOOK_URL}`);
    console.log(`Timezone: Costa Rica (GMT${COSTA_RICA_OFFSET})`);
    console.log('Available endpoints:');
    console.log('  GET  /               - Main page');
    console.log('  GET  /admin          - Admin panel');
    console.log('  GET  /codes          - Get all codes');
    console.log('  POST /codes          - Create new code');
    console.log('  PUT  /codes/{pin}    - Update code');
    console.log('  DELETE /codes/{pin}  - Delete code');
    console.log('  GET  /logs           - Get access logs');
    console.log('  POST /open           - Open gate');
    console.log('  POST /test-webhook   - Test webhook');
  });
}

module.exports = server;
