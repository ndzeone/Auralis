import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { PNG } from 'pngjs';
import { z } from 'zod';

export const passwordSchema = z.string().min(12).max(128);
export const deviceSchema = z.object({
  deviceId: z.string().min(8).max(128),
  deviceName: z.string().trim().min(1).max(100).default('Auralis'),
});
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(64),
  version: z.string().regex(/^[a-zA-Z0-9._+-]{1,64}$/),
  memoryMb: z.number().int().min(1024).max(65536).default(4096),
  jvmArgs: z.array(z.string().max(512)).max(32).default([]),
  icon: z.enum(['grass', 'diamond', 'forest', 'ember', 'moon']).default('grass'),
});

export const newToken = () => randomBytes(48).toString('base64url');
export const hashToken = (token: string | Uint8Array) => createHash('sha256').update(token).digest('hex');
export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);

export function issueAccessToken(secret: string, userId: string, sessionId: string) {
  return jwt.sign({ sid: sessionId }, secret, { subject: userId, expiresIn: '15m', issuer: 'auralis-api', audience: 'auralis' });
}

export function verifyAccessToken(secret: string, token: string) {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'auralis-api', audience: 'auralis' });
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('Invalid token');
  return { userId: payload.sub, sessionId: payload.sid };
}

export function decodeSkin(dataUrl: string): Buffer {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('Expected a PNG data URL');
  const buffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (buffer.length > 65536) throw new Error('Skin must be smaller than 64 KiB');
  // Inspect dimensions before decoding to avoid decompression bombs.
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG');
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (width !== 64 || (height !== 32 && height !== 64)) throw new Error('Skin dimensions must be 64×64 or 64×32');
  const png = PNG.sync.read(buffer, { checkCRC: true });
  if (png.width !== width || png.height !== height) throw new Error('Invalid PNG dimensions');
  return PNG.sync.write(png);
}
