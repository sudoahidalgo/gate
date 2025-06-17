const request = require('supertest');

// Set minimal environment variables so the server does not exit on load
process.env.SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_SERVICE_KEY = 'test-key';

jest.mock('@supabase/supabase-js', () => {
  return {
    createClient: jest.fn(() => ({
      from: () => ({
        select: () => Promise.resolve({ data: [{ pin: '1234' }], error: null })
      })
    }))
  };
});

const server = require('../server');

afterAll(() => {
  server.close();
});

test('GET /codes returns list of codes', async () => {
  const res = await request(server).get('/codes');
  expect(res.statusCode).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body[0].pin).toBe('1234');
});
