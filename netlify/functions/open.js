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

function codeAllowed(code) {
  const now = new Date();
  const day = now.getDay();
  if (!code.days.includes(day)) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
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

async function appendLog(pin, user) {
  const { error } = await supabase
    .from('logs')
    .insert({ timestamp: new Date().toISOString(), pin, user });
  if (error) console.error('Error writing log:', error);
}

function forwardWebhook() {
  return new Promise((resolve) => {
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
      res.on('end', () => resolve());
    });
    req.on('error', err => {
      console.error('Webhook error:', err);
      resolve();
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
    const code = await pinAllowed(pin);
    
    if (!code) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' })
      };
    }

    await appendLog(pin, code.user);
    await forwardWebhook();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true })
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid data' })
    };
  }
};
