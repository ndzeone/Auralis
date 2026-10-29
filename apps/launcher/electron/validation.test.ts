import { describe, expect, it } from 'vitest';
import { defaultProfiles, defaultSettings, profileSchema, settingsSchema, redactSecrets } from './validation.js';
describe('Electron IPC input validation', () => {
  it('accepts repository defaults', () => {
    expect(profileSchema.parse(defaultProfiles[0]).version).toBe('1.21.5');
    expect(settingsSchema.parse(defaultSettings).theme).toBe('aurora');
  });
  it.each(['../escape', '/tmp/escape', 'x/y', '..\\escape'])('blocks profile directory traversal: %s', id => {
    expect(profileSchema.safeParse({ ...defaultProfiles[0], id }).success).toBe(false);
  });
  it('rejects invalid RAM and injected multiline Java arguments', () => {
    expect(profileSchema.safeParse({ ...defaultProfiles[0], ramMb: -1 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...defaultProfiles[0], jvmArgs: ['-Xmx4G\nmalicious'] }).success).toBe(false);
    expect(profileSchema.safeParse({ ...defaultProfiles[0], arbitrary: 'injected' }).success).toBe(false);
  });
  it('redacts authorization headers, launch tokens, and JWTs from logs', () => {
    const text = redactSecrets('Authorization: Bearer secret --accessToken token eyJhbGciOiJIUzI1NiJ9.eyJuYW1lIjoidGVzdCJ9.signature');
    expect(text).not.toContain('secret');
    expect(text).not.toContain('token');
    expect(text).not.toContain('eyJ');
  });
});
