const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_martes';
const WEBHOOK_TIMEOUT = 10000; // 10 seconds timeout

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
  return !error;
}

async function updateCode(pin, updates) {
  const { error } = await supabase
    .from('codes')
    .update(updates)
    .eq('pin', pin);
  if (error) console.error('Error updating code:', error);
  return !error;
}

async function deleteCode(pin) {
  const { error } = await supabase
    .from('codes')
    .delete()
    .eq('pin', pin);
  if (error) console.error('Error deleting code:', error);
  return !error;
}

function minutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------
// Time validation helpers
// ---------------------------------------------------------------
// Use Costa Rica time (GMT-6) when validating codes. This avoids
// discrepancies when the server is running in a different timezone.
function codeAllowed(code) {
  // Current time in Costa Rica
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  const costaRicaOffset = -6; // GMT-6
  const crTime = new Date(utcTime + costaRicaOffset * 3600000);

  const day = crTime.getDay();
  const cur = crTime.getHours() * 60 + crTime.getMinutes();

  // Debug information for easier troubleshooting
  console.log(`[DEBUG] Validando código ${code.pin}:`);
  console.log(
    `[DEBUG] Día actual (Costa Rica): ${day} (${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][day]})`
  );
  console.log(
    `[DEBUG] Hora actual (Costa Rica): ${String(crTime.getHours()).padStart(2,'0')}:${String(crTime.getMinutes()).padStart(2,'0')}`
  );
  console.log(`[DEBUG] Días permitidos: ${code.days}`);
  console.log(`[DEBUG] Horario permitido: ${code.start} - ${code.end}`);

  if (!code.days.includes(day)) {
    console.log('[DEBUG] ❌ Día no permitido');
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

  console.log(
    `[DEBUG] ${timeAllowed ? '✅' : '❌'} Horario ${timeAllowed ? 'permitido' : 'no permitido'}`
  );

  return timeAllowed;
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

// Store logs using Costa Rica time to keep reports consistent
async function appendLog(pin, user, success = true, error = null) {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  const costaRicaOffset = -6; // GMT-6
  const crTime = new Date(utcTime + costaRicaOffset * 3600000);

  console.log(
    `[DEBUG] Guardando log: ${user} (${pin}) a las ${crTime.toISOString()}`
  );

  const logEntry = {
    timestamp: crTime.toISOString(),
    pin,
    user,
    success,
    error_message: error
  };
  
  const { error: dbError } = await supabase
    .from('logs')
    .insert(logEntry);
  
  if (dbError) console.error('Error writing log:', dbError);
  
  // Also log to console for debugging
  console.log(`[${logEntry.timestamp}] PIN: ${pin}, User: ${user}, Success: ${success}${error ? `, Error: ${error}` : ''}`);
}

function forwardWebhook(pin, user) {
  return new Promise((resolve, reject) => {
    const url = new URL(WEBHOOK_URL);
    
    // Create payload with useful information
    const payload = JSON.stringify({
      action: 'open_gate',
      pin: pin,
      user: user,
      timestamp: new Date().toISOString(),
      source: 'gate_control_app'
    });
    
    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      protocol: url.protocol,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'GateControlApp/1.0',
        'X-Source': 'gate-control-app'
      },
      timeout: WEBHOOK_TIMEOUT
    };

    console.log(`[WEBHOOK] Sending request to: ${WEBHOOK_URL}`);
    console.log(`[WEBHOOK] Payload: ${payload}`);
    console.log(`[WEBHOOK] Headers: ${JSON.stringify(options.headers)}`);

    const req = (url.protocol === 'https:' ? https : http).request(options, res => {
      let responseData = '';
      
      console.log(`[WEBHOOK] Response status: ${res.statusCode}`);
      console.log(`[WEBHOOK] Response headers: ${JSON.stringify(res.headers)}`);
      
      res.on('data', chunk => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        console.log(`[WEBHOOK] Response body: ${responseData}`);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[WEBHOOK] Success - Gate should be opening');
          resolve({
            success: true,
            statusCode: res.statusCode,
            response: responseData
          });
        } else {
          console.error(`[WEBHOOK] Error - HTTP ${res.statusCode}: ${responseData}`);
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', err => {
      console.error('[WEBHOOK] Request error:', err);
      reject(err);
    });

    req.on('timeout', () => {
      console.error('[WEBHOOK] Request timeout');
      req.destroy();
      reject(new Error('Webhook request timeout'));
    });

    // Set timeout
    req.setTimeout(WEBHOOK_TIMEOUT);
    
    // Send the payload
    req.write(payload);
    req.end();
  });
}

// Alternative webhook function for testing different approaches
function forwardWebhookSimple(pin, user) {
  return new Promise((resolve, reject) => {
    const url = new URL(WEBHOOK_URL);
    
    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      protocol: url.protocol,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      headers: {
        'Content-Length': '0',
        'User-Agent': 'GateControlApp/1.0'
      },
      timeout: WEBHOOK_TIMEOUT
    };

    console.log(`[WEBHOOK_SIMPLE] Sending empty POST to: ${WEBHOOK_URL}`);

    const req = (url.protocol === 'https:' ? https : http).request(options, res => {
      let responseData = '';
      
      console.log(`[WEBHOOK_SIMPLE] Response status: ${res.statusCode}`);
      
      res.on('data', chunk => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        console.log(`[WEBHOOK_SIMPLE] Response: ${responseData}`);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
        }
      });
    });

    req.on('error', err => {
      console.error('[WEBHOOK_SIMPLE] Error:', err);
      reject(err);
    });

    req.on('timeout', () => {
      console.error('[WEBHOOK_SIMPLE] Timeout');
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.setTimeout(WEBHOOK_TIMEOUT);
    req.end();
  });
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

async function readLogs() {
  const { data, error } = await supabase
    .from('logs')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(500); // Limit to last 500 entries for performance
    
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

async function handleOpen(req, res) {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
  });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const pin = data.pin || 'unknown';
      const testMode = data.test === true; // Allow test mode
      
      console.log(`[OPEN] Request received - PIN: ${pin}, Test Mode: ${testMode}`);
      
      const code = await pinAllowed(pin);
      if (!code && !testMode) {
        console.log(`[OPEN] Access denied for PIN: ${pin}`);
        await appendLog(pin, 'unknown', false, 'Código inválido o fuera de horario');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          ok: false, 
          error: 'Código inválido o fuera de horario' 
        }));
        return;
      }
      
      const user = code ? code.user : 'Test User';
      console.log(`[OPEN] Access granted for user: ${user}`);
      
      try {
        // Try the main webhook first
        console.log('[OPEN] Attempting webhook with payload...');
        const webhookResult = await forwardWebhook(pin, user);
        
        await appendLog(pin, user, true);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          ok: true, 
          message: 'Portón activado exitosamente',
          webhook: webhookResult
        }));
        
      } catch (webhookError) {
        console.error('[OPEN] Primary webhook failed, trying simple webhook...', webhookError);
        
        try {
          // Try simple webhook as fallback
          const simpleResult = await forwardWebhookSimple(pin, user);
          
          await appendLog(pin, user, true, `Webhook simple usado: ${webhookError.message}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            ok: true, 
            message: 'Portón activado (webhook simple)',
            webhook: simpleResult,
            warning: 'Primary webhook failed'
          }));
          
        } catch (simpleError) {
          console.error('[OPEN] Both webhooks failed:', simpleError);
          
          await appendLog(pin, user, false, `Webhook error: ${simpleError.message}`);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            ok: false, 
            error: 'Error de conexión con el sistema del portón',
            details: simpleError.message
          }));
        }
      }
    } catch (err) {
      console.error('[OPEN] Request parsing error:', err);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid data');
    }
  });
}

// Add webhook test endpoint
async function handleWebhookTest(req, res) {
  console.log('[TEST] Webhook test requested');
  
  try {
    const result = await forwardWebhook('TEST', 'Test User');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true, 
      message: 'Webhook test successful',
      result 
    }));
  } catch (error) {
    console.error('[TEST] Webhook test failed:', error);
    
    try {
      const simpleResult = await forwardWebhookSimple('TEST', 'Test User');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        message: 'Simple webhook test successful',
        result: simpleResult,
        warning: 'Primary webhook failed'
      }));
    } catch (simpleError) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: false, 
        error: 'Both webhook tests failed',
        primaryError: error.message,
        simpleError: simpleError.message
      }));
    }
  }
}

async function handleCodesCRUD(req, res) {
  if (req.method === 'GET') {
    // Get all codes
    const codes = await loadCodes();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(codes));
    return;
  }
  
  if (req.method === 'POST') {
    // Create new code
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const success = await saveCode({
          pin: String(data.pin),
          user: data.user || '',
          days: Array.isArray(data.days) ? data.days : [],
          start: data.start || '00:00',
          end: data.end || '23:59'
        });
        
        if (success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'Code saved successfully' }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Failed to save code' }));
        }
      } catch (error) {
        console.error('Error processing POST /codes:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid data' }));
      }
    });
    return;
  }
  
  if (req.method === 'PUT') {
    // Update existing code
    const pin = req.url.split('/')[2]; // Extract PIN from URL
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const updates = {
          user: data.user || '',
          days: Array.isArray(data.days) ? data.days : [],
          start: data.start || '00:00',
          end: data.end || '23:59'
        };
        
        const success = await updateCode(pin, updates);
        
        if (success) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'Code updated successfully' }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Failed to update code' }));
        }
      } catch (error) {
        console.error('Error processing PUT /codes:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid data' }));
      }
    });
    return;
  }
  
  if (req.method === 'DELETE') {
    // Delete code
    const pin = req.url.split('/')[2]; // Extract PIN from URL
    
    if (!pin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'PIN is required' }));
      return;
    }
    
    try {
      const success = await deleteCode(pin);
      
      if (success) {
        console.log(`[DELETE] Successfully deleted code with PIN: ${pin}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Code deleted successfully' }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Failed to delete code' }));
      }
    } catch (error) {
      console.error('Error processing DELETE /codes:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Server error' }));
    }
    return;
  }
  
  // Method not allowed
  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
}

const server = http.createServer((req, res) => {
  // Add CORS headers for better debugging
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Log all requests for debugging
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  
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
  
  // Handle all codes CRUD operations
  if (req.url.startsWith('/codes')) {
    handleCodesCRUD(req, res);
    return;
  }
  
  if (req.method === 'POST' && req.url === '/open') {
    handleOpen(req, res);
    return;
  }
  
  // Add webhook test endpoint
  if (req.method === 'POST' && req.url === '/test-webhook') {
    handleWebhookTest(req, res);
    return;
  }
  
  // 404 Not Found
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Webhook URL configured: ${WEBHOOK_URL}`);
    console.log('Available endpoints:');
    console.log('  GET  /           - Main gate control interface');
    console.log('  GET  /admin      - Admin interface');
    console.log('  GET  /logs       - Get access logs');
    console.log('  GET  /codes      - Get all codes');
    console.log('  POST /codes      - Create new code');
    console.log('  PUT  /codes/:pin - Update existing code');
    console.log('  DELETE /codes/:pin - Delete code');
    console.log('  POST /open       - Open gate with PIN');
    console.log('  POST /test-webhook - Test webhook connection');
  });
}

module.exports = server;
