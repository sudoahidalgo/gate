const getNow = () => {
  const tz = process.env.TIMEZONE || 'America/Costa_Rica';
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
};

exports.handler = async (event, context) => {
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

  console.log('Netlify function: test webhook called');

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      message: 'Test webhook funcionando correctamente',
      timestamp: getNow().toISOString()
    })
  };
};
