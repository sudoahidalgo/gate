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

// FUNCIÓN PARA AGREGAR HEADERS CORS
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://gate2hive.netlify.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
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

function minutes(t) {
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
}

// FUNCIÓN CORREGIDA: Usar hora de Costa Rica para validación
function codeAllowed(code) {
  // Obtener hora actual en Costa Rica (GMT-6)
  const now = new Date();
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const costaRicaOffset = -6; // GMT-6
  const costaRicaTime = new Date(utcTime + (costaRicaOffset * 3600000));
  
  const day = costaRicaTime.getDay();
  const cur = costaRicaTime.getHours() * 60 + costaRicaTime.getMinutes();
  
  // DEBUG: Imprimir información de validación
  console.log(`[DEBUG] Validando código ${code.pin}:`);
  console.log(`[DEBUG] Día actual (Costa Rica): ${day} (${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][day]})`);
  console.log(`[DEBUG] Hora actual (Costa Rica): ${String(costaRicaTime.getHours()).padStart(2,'0')}:${String(costaRicaTime.getMinutes()).padStart(2,'0')}`);
  console.log(`[DEBUG] Días permitidos: ${code.days}`);
  console.log(`[DEBUG] Horario permitido: ${code.start} - ${code.end}`);
  
  if (!code.days.includes(day)) {
    console.log(`[DEBUG] ❌ Día no permitido`);
    return false;
  }
  
  const startM = minutes(code.start);
  const endM = minutes(code.end);
  let timeAllowed = false;
  
  if (startM <= endM) {
    timeAllowed = cur >= startM && cur <= endM;
  } else {
    timeAllowed = cur >= startM || cur <= endM;
  }
  
  console.log(`[DEBUG] ${timeAllowed ? '✅' : '❌'} Horario ${timeAllowed ? 'permitido' : 'no permitido'}`);
  
  return timeAllowed;
}

async function pinAllowed(pin) {
  console.log(`[DEBUG] Verificando PIN: ${pin}`);
  
  const { data, error } = await supabase
    .from('codes')
    .select('*')
    .eq('pin', pin)
    .single();
    
  if (error) {
    console.log(`[DEBUG] ❌ Error en base de datos: ${error.message}`);
    return null;
  }
  
  if (!data) {
    console.log(`[DEBUG] ❌ PIN no encontrado en base de datos`);
    return null;
  }
  
  console.log(`[DEBUG] ✅ PIN encontrado: ${data.user}`);
  
  const allowed = codeAllowed(data);
  console.log(`[DEBUG] Resultado final: ${allowed ? '✅ PERMITIDO' : '❌ DENEGADO'}`);
  
  return allowed ? data : null;
}

// URL CORREGIDA DEL WEBHOOK
const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_abrir';

function serveIndex(res) {
  setCorsHeaders(res);
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
  setCorsHeaders(res);
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
  setCorsHeaders(res);
  const entries = await readLogs();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ entries }));
}

// FUNCIÓN CORREGIDA: Guardar en hora de Costa Rica
async function appendLog(pin, user) {
  // Obtener tiempo actual en Costa Rica (GMT-6)
  const now = new Date();
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const costaRicaOffset = -6; // GMT-6
  const costaRicaTime = new Date(utcTime + (costaRicaOffset * 3600000));
  
  console.log(`[DEBUG] Guardando log: ${user} (${pin}) a las ${costaRicaTime.toISOString()}`);
  
  const { error } = await supabase
    .from('logs')
    .insert({ 
      timestamp: costaRicaTime.toISOString(), 
      pin, 
      user 
    });
  if (error) console.error('Error writing log:', error);
}

function forwardWebhook(callback) {
  console.log(`[DEBUG] Enviando webhook a: ${WEBHOOK_URL}`);
  
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
    console.log(`[DEBUG] ✅ Webhook respondió con status: ${res.statusCode}`);
    res.on('data', () => {});
    res.on('end', () => callback());
  });
  req.on('error', err => {
    console.error('[DEBUG] ❌ Error en webhook:', err.message);
    callback();
  });
  req.end();
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
      
      console.log(`[DEBUG] ===== INTENTO DE APERTURA =====`);
      console.log(`[DEBUG] PIN recibido: ${pin}`);
      
      const code = await pinAllowed(pin);
      if (!code) {
        console.log(`[DEBUG] ❌ ACCESO DENEGADO`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' }));
        return;
      }
      
      console.log(`[DEBUG] ✅ ACCESO PERMITIDO - Procediendo a abrir portón`);
      await appendLog(pin, code.user);
      
      forwardWebhook(() => {
        console.log(`[DEBUG] ✅ PROCESO COMPLETADO`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (err) {
      console.error('[DEBUG] ❌ Error en handleOpen:', err);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid data');
    }
  });
}

const server = http.createServer((req, res) => {
  // MANEJAR OPTIONS REQUESTS (PREFLIGHT CORS)
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(200);
    res.end();
    return;
  }

  setCorsHeaders(res);

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
