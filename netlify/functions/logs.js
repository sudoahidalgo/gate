const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const entries = await readLogs();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ entries })
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
