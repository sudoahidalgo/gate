const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // GET - Fetch all codes
  if (event.httpMethod === 'GET') {
    try {
      const { data, error } = await supabase
        .from('codes')
        .select('*')
        .order('pin');
      
      if (error) {
        throw error;
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data || [])
      };
      
    } catch (err) {
      console.error('Error fetching codes:', err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: err.message })
      };
    }
  }

  // POST - Add new code
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body);
      
      const { error } = await supabase
        .from('codes')
        .insert({
          pin: String(data.pin),
          username: data.user || '',
          days: Array.isArray(data.days) ? data.days : [],
          start_time: data.start || '00:00',
          end_time: data.end || '23:59'
        });
      
      if (error) {
        throw error;
      }
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true })
      };
      
    } catch (err) {
      console.error('Error saving code:', err);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: err.message })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: 'Method not allowed' })
  };
};
