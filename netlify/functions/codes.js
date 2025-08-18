const fs = require('fs');
const path = require('path');

// Location of the JSON file that stores the access codes
const CODES_FILE = path.join(__dirname, '../../codes.json');

function loadCodes() {
  try {
    const data = fs.readFileSync(CODES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveCodes(codes) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const parts = event.path.split('/').filter(Boolean); // ['codes', '1234']
  const codes = loadCodes();

  try {
    if (parts.length === 1 && event.httpMethod === 'GET') {
      return { statusCode: 200, headers, body: JSON.stringify(codes) };
    }

    if (parts.length === 1 && event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');
      codes.push(data);
      saveCodes(codes);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    if (parts.length === 2) {
      const pin = decodeURIComponent(parts[1]);
      const index = codes.findIndex(c => String(c.pin) === pin);

      if (event.httpMethod === 'PUT') {
        const data = JSON.parse(event.body || '{}');
        if (index === -1) codes.push({ pin, ...data });
        else codes[index] = { ...codes[index], ...data, pin };
        saveCodes(codes);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }

      if (event.httpMethod === 'DELETE') {
        if (index !== -1) {
          codes.splice(index, 1);
          saveCodes(codes);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      }
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not Found' }) };
  } catch (error) {
    console.error('Function error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
