import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb } from '../src/db.js';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

// Explicit opt-in: migrations must already be deployed on an isolated test database.
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
run('PostgreSQL account lifecycle', () => {
  const db = createDb(process.env.TEST_DATABASE_URL ?? 'postgresql://unused:unused@localhost/unused');
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'integration-secret-at-least-32-characters', DEV_MAILBOX: 'true' });
  const app = createApp(db, config);
  const suffix = randomBytes(4).toString('hex');
  const email = `integration-${suffix}@example.test`;
  const username = `test_${suffix}`;
  const device = { deviceId: `test-device-${suffix}`, deviceName: 'Integration test' };
  let userId = '', accessToken = '', refreshToken = '';
  const auth = () => ({ Authorization: `Bearer ${accessToken}` });
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => { if (userId) await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect(); });

  it('registers, persists salted hash, rotates refresh tokens, detects replay, and revokes access', async () => {
    const created = await request(app).post('/api/auth/register').send({ ...device, email, username, password: 'integration-password-123' });
    expect(created.status).toBe(201);
    userId = created.body.user.id; accessToken = created.body.accessToken; refreshToken = created.body.refreshToken;
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toMatch(/^\$argon2id/);
    expect(created.body.user.passwordHash).toBeUndefined();
    expect((await request(app).get('/api/me').set(auth())).body.user.email).toBe(email);
    const mailbox = await request(app).get('/api/dev/mailbox');
    const verifyMail = mailbox.body.messages.find((m: { subject: string }) => m.subject.includes('Подтвердите'));
    const verificationLink = verifyMail.text.match(/https?:\/\/\S+/)[0];
    const verificationToken = new URL(verificationLink).searchParams.get('token');
    expect((await request(app).post('/api/auth/verify-email').send({ token: verificationToken })).status).toBe(200);
    expect((await request(app).post('/api/auth/verify-email').send({ token: verificationToken })).status).toBe(400);
    expect((await request(app).get('/api/me').set(auth())).body.user.emailVerifiedAt).toBeTruthy();
    const wrongDevice = await request(app).post('/api/auth/refresh').send({ deviceId: 'wrong-device-id', refreshToken });
    expect(wrongDevice.status).toBe(401);
    const rotated = await request(app).post('/api/auth/refresh').send({ ...device, refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(refreshToken);
    const replay = await request(app).post('/api/auth/refresh').send({ ...device, refreshToken });
    expect(replay.status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', `Bearer ${rotated.body.accessToken}`)).status).toBe(401);
  });
  it('logs in, saves scoped profile/settings and rejects duplicate usernames', async () => {
    const login = await request(app).post('/api/auth/login').send({ ...device, login: username, password: 'integration-password-123' });
    expect(login.status).toBe(200);
    accessToken = login.body.accessToken;
    const profile = await request(app).post('/api/profiles').set(auth()).send({ name: 'Test World', version: '1.21.1', memoryMb: 4096 });
    expect(profile.status).toBe(201);
    expect((await request(app).get('/api/profiles').set(auth())).body.profiles).toHaveLength(1);
    const settings = await request(app).patch('/api/me/settings').set(auth()).send({ theme: 'forest' });
    expect(settings.body.settings.theme).toBe('forest');
    const duplicate = await request(app).post('/api/auth/register').send({ ...device, email: `other-${email}`, username, password: 'integration-password-456' });
    expect(duplicate.status).toBe(409);
  });
  it('resets password with single-use token and invalidates all old sessions', async () => {
    expect((await request(app).post('/api/auth/forgot-password').send({ email })).status).toBe(200);
    const mailbox = await request(app).get('/api/dev/mailbox');
    const reset = mailbox.body.messages.findLast((m: { subject: string }) => m.subject.includes('Сброс'));
    const link = reset.text.match(/https?:\/\/\S+/)[0];
    const token = new URL(link).searchParams.get('token');
    expect(token).toBeTruthy();
    const result = await request(app).post('/api/auth/reset-password').send({ token, password: 'new-integration-password-123' });
    expect(result.status).toBe(200);
    expect((await request(app).get('/api/me').set(auth())).status).toBe(401);
    expect((await request(app).post('/api/auth/reset-password').send({ token, password: 'another-integration-password' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ ...device, login: email, password: 'integration-password-123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ ...device, login: email, password: 'new-integration-password-123' })).status).toBe(200);
  });
});
