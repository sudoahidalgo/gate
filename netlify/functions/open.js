const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http = require('http');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_martes';

function minutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
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

async function appendLog(pin, user) {
  const { error } = await supabase
    .from('logs')
    .insert({ timestamp: new Date().toISOString(), pin, user });
  if (error) console.error('Error writing log:', error);
}

function forwardWebhook() {
  return new Promise((resolve, reject) => {
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
      console.log(`Webhook response status: ${res.statusCode}`);
      res.on('data', () => {});
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Webhook failed with status ${res.statusCode}`));
        }
      });
    });

    req.on('error', err => {
      console.error('Webhook error:', err);
      reject(err);
    });

    req.end();
  });
}

exports.handler = async (event, context) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing Supabase configuration');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing Supabase configuration' })
    };
  }

  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const pin = data.pin || 'unknown';
    console.log(`Netlify function: Attempting to open with PIN ${pin} at ${getNow().toISOString()}`);
    
    const code = await pinAllowed(pin);
    
    if (!code) {
      console.log(`Netlify function: PIN ${pin} rejected`);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' })
      };
    }

    console.log(`Netlify function: PIN ${pin} accepted for user ${code.user}`);
    await appendLog(pin, code.user);

    try {
      await forwardWebhook();
    } catch (err) {
      console.error('Webhook call failed:', err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, error: 'Error al abrir el port\u00f3n. Intenta de nuevo.' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true })
    };
  } catch (error) {
    console.error('Netlify function error:', error);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid data' })
    };
  }
};
