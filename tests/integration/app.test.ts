import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../../src/app';
import { errorHandler } from '../../src/common/middleware/errorHandler';
import { requestId } from '../../src/common/middleware/requestId';
import { requireRole } from '../../src/common/middleware/requireRole';
import { validate } from '../../src/common/middleware/validate';

describe('app skeleton', () => {
  const app = createApp({ readinessCheck: async () => undefined });

  it('GET /health is ok and carries a request id', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok' } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /health/ready reports 503 when the database is down', async () => {
    const down = createApp({
      readinessCheck: async () => {
        throw new Error('db down');
      },
    });
    const res = await request(down).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.request_id).toBeTruthy();
  });

  it('GET /health/ready is ok when the database answers', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
  });

  it('serves the API root', async () => {
    const res = await request(app).get('/api/v1');
    expect(res.body).toEqual({ success: true, data: { name: 'mess-api', version: 'v1' } });
  });

  it('unknown routes use the error envelope', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('malformed JSON becomes VALIDATION_ERROR (not a stack trace)', async () => {
    const res = await request(app).post('/api/v1/anything').set('content-type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('validate + requireRole middleware', () => {
  const schema = z.object({ note: z.string().min(1) }).strict();
  const mini = express();
  mini.use(requestId, express.json());
  mini.post('/echo', validate({ body: schema }), (req, res) => {
    res.json({ success: true, data: req.valid.body });
  });
  mini.get('/admin-only', requireRole('admin'), (_req, res) => {
    res.json({ success: true });
  });
  mini.use(errorHandler);

  it('accepts a valid body', async () => {
    const res = await request(mini).post('/echo').send({ note: 'hi' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ note: 'hi' });
  });

  it('rejects unknown fields (mass-assignment guard)', async () => {
    const res = await request(mini).post('/echo').send({ note: 'hi', role: 'super_admin' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('fails closed when there is no authenticated user', async () => {
    const res = await request(mini).get('/admin-only');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
