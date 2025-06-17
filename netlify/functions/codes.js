const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
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
  if (error) {
    console.error('Error saving code:', error);
    throw new Error('Failed to save code');
  }
}

async function updateCode(pin, updates) {
  const { error } = await supabase.from('codes').update(updates).eq('pin', pin);
  if (error) {
    console.error('Error updating code:', error);
    throw new Error('Failed to update code');
  }
}

async function deleteCode(pin) {
  const { error } = await supabase.from('codes').delete().eq('pin', pin);
  if (error) {
    console.error('Error deleting code:', error);
    throw new Error('Failed to delete code');
  }
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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    if (event.httpMethod === 'GET') {
      const codes = await loadCodes();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(codes)
      };
    }

    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      const pin = String(data.pin || '').trim();
      if (!/^[A-Za-z0-9]{4,10}$/.test(pin)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'PIN inválido' })
        };
      }
      await saveCode({
        pin,
        user: data.user || '',
        days: Array.isArray(data.days) ? data.days : [],
        start: data.start || '00:00',
        end: data.end || '23:59'
      });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true })
      };
    }

    if (event.httpMethod === 'PUT') {
      const pin = decodeURIComponent(event.path.split('/').pop());
      const data = JSON.parse(event.body || '{}');
      await updateCode(pin, {
        user: data.user || '',
        days: Array.isArray(data.days) ? data.days : [],
        start: data.start || '00:00',
        end: data.end || '23:59'
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'DELETE') {
      const pin = decodeURIComponent(event.path.split('/').pop());
      await deleteCode(pin);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
