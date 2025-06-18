const request = require('supertest');

// Set minimal environment variables so the server does not exit on load
process.env.SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_SERVICE_KEY = 'test-key';
process.env.TIMEZONE = 'UTC';

jest.mock('@supabase/supabase-js', () => {
  const mockFrom = jest.fn((table) => {
    if (table === 'codes') {
      const selectBuilder = {
        then: (resolve) =>
          Promise.resolve({ data: [{ pin: '1234' }], error: null }).then(resolve),
        eq: jest.fn(() => ({
          single: jest
            .fn()
            .mockResolvedValue({ data: null, error: { message: 'not found' } })
        }))
      };
      return {
        select: jest.fn(() => selectBuilder),
        insert: jest.fn(() => Promise.resolve({ error: null }))
      };
    }
    if (table === 'logs') {
      const logsData = [];
      const selectBuilder = {
        then: (resolve) =>
          Promise.resolve({ data: logsData, error: null }).then(resolve),
        order: jest
          .fn()
          .mockResolvedValue({ data: logsData, error: null })
      };
      return {
        select: jest.fn(() => selectBuilder),
        insert: jest.fn(() => Promise.resolve({ error: null }))
      };
    }
    return {};
  });

  return {
    createClient: jest.fn(() => ({ from: mockFrom }))
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

test('POST /codes with valid data returns 200', async () => {
  const res = await request(server)
    .post('/codes')
    .send({ pin: '9999', user: 'tester', days: [1], start: '00:00', end: '23:59' })
    .set('Content-Type', 'application/json');
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ ok: true });
});

test('POST /open with unknown PIN returns 401', async () => {
  const res = await request(server)
    .post('/open')
    .send({ pin: '0000' })
    .set('Content-Type', 'application/json');
  expect(res.statusCode).toBe(401);
});

test('GET /logs returns an object with entries array', async () => {
  const res = await request(server).get('/logs');
  expect(res.statusCode).toBe(200);
  expect(res.body).toHaveProperty('entries');
  expect(Array.isArray(res.body.entries)).toBe(true);
});
