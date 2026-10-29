import { describe, expect, it } from 'vitest';
import { profileSchema, themeSchema, themes } from './index';

describe('shared configuration schemas', () => {
  it('accepts all five named themes and rejects arbitrary CSS values', () => {
    for (const theme of themes) expect(themeSchema.parse(theme.id)).toBe(theme.id);
    expect(themeSchema.safeParse('url(javascript:alert(1))').success).toBe(false);
  });
  it('rejects profiles with unsafe resource values', () => {
    const profile = { id: 'one', name: 'Vanilla', version: '1.21.4', ramMb: 4096, jvmArgs: [], icon: 'grass' };
    expect(profileSchema.parse(profile).ramMb).toBe(4096);
    expect(profileSchema.safeParse({ ...profile, ramMb: -1 }).success).toBe(false);
    expect(profileSchema.safeParse({ ...profile, name: '  ' }).success).toBe(false);
  });
});
