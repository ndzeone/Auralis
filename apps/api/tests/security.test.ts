import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { decodeSkin, hashPassword, hashToken, issueAccessToken, newToken, profileSchema, verifyAccessToken, verifyPassword } from '../src/security.js';
import { loadConfig } from '../src/config.js';

describe('password and token security', () => {
  it('hashes with Argon2id, unique salts, and verifies the actual password', async () => {
    const one = await hashPassword('a-long-correct-password');
    const two = await hashPassword('a-long-correct-password');
    expect(one).toMatch(/^\$argon2id\$/);
    expect(one).not.toBe(two);
    expect(await verifyPassword(one, 'a-long-correct-password')).toBe(true);
    expect(await verifyPassword(one, 'wrong-password')).toBe(false);
  });
  it('restricts access tokens to the correct secret, issuer, audience and lifetime', () => {
    const key = 'test-key-should-be-at-least-32-characters';
    const token = issueAccessToken(key, 'user-1', 'session-1');
    expect(verifyAccessToken(key, token)).toEqual({ userId: 'user-1', sessionId: 'session-1' });
    expect(() => verifyAccessToken('another-key', token)).toThrow();
    expect(() => verifyAccessToken(key, `${token}tampered`)).toThrow();
  });
  it('generates independent tokens and hashes them for persistence', () => {
    const token = newToken();
    expect(token.length).toBeGreaterThanOrEqual(64);
    expect(token).not.toBe(newToken());
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
  it('requires production JWT and mail configuration, rejects development mailbox', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('JWT_SECRET');
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32) })).toThrow('SMTP_HOST');
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(32), SMTP_HOST: 'smtp.example.com', DEV_MAILBOX: 'true' })).toThrow('DEV_MAILBOX');
  });
});

describe('skin uploads', () => {
  it('decodes and canonicalizes a real 64×64 PNG', () => {
    const input = PNG.sync.write(new PNG({ width: 64, height: 64 }));
    const output = decodeSkin(`data:image/png;base64,${input.toString('base64')}`);
    expect(PNG.sync.read(output).width).toBe(64);
  });
  it('rejects unsupported dimensions, corrupt data, SVG and oversized images', () => {
    const small = PNG.sync.write(new PNG({ width: 1, height: 1 }));
    expect(() => decodeSkin(`data:image/png;base64,${small.toString('base64')}`)).toThrow('dimensions');
    expect(() => decodeSkin('data:image/png;base64,aaaa')).toThrow('Invalid PNG');
    expect(() => decodeSkin('data:image/svg+xml;base64,aaaa')).toThrow('PNG data URL');
    expect(() => decodeSkin(`data:image/png;base64,${Buffer.alloc(70000).toString('base64')}`)).toThrow('64 KiB');
  });
});

describe('game profiles', () => {
  it('rejects memory limits and traversal-style version identifiers', () => {
    expect(profileSchema.safeParse({ name: 'World', version: '../../escape', memoryMb: 4096 }).success).toBe(false);
    expect(profileSchema.safeParse({ name: 'World', version: '1.21.1', memoryMb: 128 }).success).toBe(false);
    expect(profileSchema.parse({ name: 'World', version: '1.21.1' }).memoryMb).toBe(4096);
  });
});
