const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Add validation for environment variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase environment variables. Please check your .env file.');
  console.error('Required: SUPABASE_URL and SUPABASE_SERVICE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CODES_FILE = path.join(__dirname, 'codes.json');

async function loadCodes() {
  try {
    console.log('Loading codes from Supabase...');
    const { data, error } = await supabase.from('codes').select('*');
    if (error) {
      console.error('Supabase error loading codes:', error.message);
      // Fallback to local file if Supabase fails
      try {
        const localData = fs.readFileSync(CODES_FILE, 'utf8');
        console.log('Falling back to local codes.json file');
        return JSON.parse(localData);
      } catch (fileError) {
        console.error('Local file fallback failed:', fileError.message);
        return [];
      }
    }
    console.log(`Loaded ${data?.length || 0} codes from Supabase`);
    return data || [];
  } catch (err) {
    console.error('Unexpected error loading codes:', err.message);
    return [];
  }
}

async function saveCode(code) {
  try {
    console.log('Saving code to Supabase:', code.pin);
    const { error } = await supabase.from('codes').insert(code);
    if (error) {
      console.error('Supabase error saving code:', error.message);
      throw error;
    }
    console.log('Code saved successfully');
  } catch (err) {
    console.error('Error saving code:', err.message);
    throw err;
  }
}

function minutes(t) {
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
}

function codeAllowed(code) {
  const now = new Date();
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
    console.log('Checking PIN:', pin);
    const { data, error } = await supabase
      .from('codes')
      .select('*')
      .eq('pin', pin)
      .single();
    
    if (error) {
      console.error('Supabase error checking PIN:', error.message);
      return null;
    }
    
    if (!data) {
      console.log('PIN not found in database');
      return null;
    }
    
    const allowed = codeAllowed(data);
    console.log(`PIN ${pin} allowed:`, allowed);
    return allowed ? data : null;
  } catch (err) {
    console.error('Unexpected error checking PIN:', err.message);
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
    console.log('Reading logs from Supabase...');
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(50); // Limit to last 50 entries
    
    if (error) {
      console.error('Supabase error reading logs:', error.message);
      return [];
    }
    
    console.log(`Found ${data?.length || 0} log entries`);
    return data || [];
  } catch (err) {
    console.error('Unexpected error reading logs:', err.message);
    return [];
  }
}

async function serveLogs(res) {
  try {
    const entries = await readLogs();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      entries,
      debug: {
        supabaseUrl: SUPABASE_URL ? 'Set' : 'Missing',
        supabaseKey: SUPABASE_SERVICE_KEY ? 'Set' : 'Missing'
      }
    }));
  } catch (err) {
    console.error('Error serving logs:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      entries: [], 
      error: err.message,
      debug: {
        supabaseUrl: SUPABASE_URL ? 'Set' : 'Missing',
        supabaseKey: SUPABASE_SERVICE_KEY ? 'Set' : 'Missing'
      }
    }));
  }
}

async function appendLog(pin, username) {
  try {
    console.log('Appending log entry:', { pin, username });
    const { error } = await supabase
      .from('logs')
      .insert({ 
        timestamp: new Date().toISOString(), 
        pin, 
        username: username || 'Unknown'
      });
    
    if (error) {
      console.error('Supabase error writing log:', error.message);
    } else {
      console.log('Log entry saved successfully');
    }
  } catch (err) {
    console.error('Unexpected error writing log:', err.message);
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
      console.log('Open request for PIN:', pin);
      
      const code = await pinAllowed(pin);
      if (!code) {
        console.log('PIN rejected:', pin);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' }));
        return;
      }
      
      console.log('PIN accepted, logging and forwarding webhook');
      await appendLog(pin, code.username);
      
      forwardWebhook(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    } catch (err) {
      console.error('Error handling open request:', err.message);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid data');
    }
  });
}

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);
  
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
      console.error('Error loading codes:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/codes') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);

        const pin = String(data.pin || '').trim();
        if (!/^[A-Za-z0-9]{4,10}$/.test(pin)) {
          throw new Error('PIN must be 4-10 letters or numbers');
        }

        await saveCode({
          pin,
          username: data.user || '',
          days: Array.isArray(data.days) ? data.days : [],
          start_time: data.start || '00:00',
          end_time: data.end || '23:59'
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('Error saving code:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
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
    console.log('Supabase URL:', SUPABASE_URL ? 'Set' : 'Missing');
    console.log('Supabase Key:', SUPABASE_SERVICE_KEY ? 'Set' : 'Missing');
  });
}

module.exports = server;
