const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

exports.handler = async (event, context) => {
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
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(50);
    
    if (error) {
      throw error;
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        entries: data || [],
        debug: {
          supabaseUrl: SUPABASE_URL ? 'Set' : 'Missing',
          supabaseKey: SUPABASE_SERVICE_KEY ? 'Set' : 'Missing'
        }
      })
    };
    
  } catch (err) {
    console.error('Error fetching logs:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        entries: [], 
        error: err.message,
        debug: {
          supabaseUrl: SUPABASE_URL ? 'Set' : 'Missing',
          supabaseKey: SUPABASE_SERVICE_KEY ? 'Set' : 'Missing'
        }
      })
    };
  }
};
