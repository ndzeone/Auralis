import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { issueAccessToken } from '../src/security.js';

const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'a-long-test-secret-at-least-32-characters' });
const db = { session: { findUnique: async () => null }, $queryRaw: async () => [{ '?column?': 1 }] } as unknown as PrismaClient;
const app = createApp(db, config);

describe('HTTP authorization boundary', () => {
  it('serves a database-backed health check', async () => {
    const result = await request(app).get('/api/health');
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ok');
    expect(result.headers['x-content-type-options']).toBe('nosniff');
  });
  it('rejects missing and revoked sessions even with a valid JWT', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
    const jwt = issueAccessToken(config.JWT_SECRET, 'user', 'revoked-session');
    const result = await request(app).get('/api/me').set('Authorization', `Bearer ${jwt}`);
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('Session expired');
  });
  it('rejects foreign origins before running authentication logic', async () => {
    const result = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({});
    expect(result.status).toBe(403);
    expect(result.body.error).toContain('Origin');
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('validates inputs without echoing submitted password values', async () => {
    const result = await request(app).post('/api/auth/register').send({ email: 'invalid', password: 'secret' });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).not.toContain('secret');
  });
  it('limits repeated authentication attempts even when credentials are malformed', async () => {
    const isolated = createApp(db, config);
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await request(isolated).post('/api/auth/login').send({})).status).toBe(400);
    }
    const blocked = await request(isolated).post('/api/auth/login').send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('authentication attempts');
  });
});
