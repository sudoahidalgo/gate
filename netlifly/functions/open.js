// Save this as: netlify/functions/open.js

const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_URL = 'https://dyaxguerproyd2kte4awwggu9ylh6rsd.ui.nabu.casa/api/webhook/porton_martes';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function minutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
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
    const { data, error } = await supabase
      .from('codes')
      .select('*')
      .eq('pin', pin)
      .single();
    
    if (error || !data) return null;
    return codeAllowed(data) ? data : null;
  } catch (err) {
    console.error('Error checking PIN:', err);
    return null;
  }
}

async function appendLog(pin, username) {
  try {
    const { error } = await supabase
      .from('logs')
      .insert({ 
        timestamp: new Date().toISOString(), 
        pin, 
        username: username || 'Unknown'
      });
    
    if (error) console.error('Error writing log:', error);
  } catch (err) {
    console.error('Error writing log:', err);
  }
}

function forwardWebhook() {
  return new Promise((resolve) => {
    const url = new URL(WEBHOOK_URL);
    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      protocol: url.protocol,
      port: url.port || 443,
      headers: { 'Content-Length': 0 }
    };

    const req = https.request(options, res => {
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
  // Handle CORS
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
    
    console.log('Open request for PIN:', pin);
    
    const code = await pinAllowed(pin);
    if (!code) {
      console.log('PIN rejected:', pin);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ ok: false, error: 'Código inválido o fuera de horario' })
      };
    }
    
    console.log('PIN accepted, logging and forwarding webhook');
    await appendLog(pin, code.username);
    await forwardWebhook();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true })
    };
    
  } catch (err) {
    console.error('Error handling request:', err);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid data' })
    };
  }
};
