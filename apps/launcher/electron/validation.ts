import { z } from 'zod';
export const profileIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const profileSchema = z.object({
  id: profileIdSchema,
  name: z.string().trim().min(1).max(64),
  version: z.string().regex(/^[a-zA-Z0-9_.+-]{1,80}$/),
  ramMb: z.number().int().min(1024).max(32768),
  jvmArgs: z.array(z.string().max(1024).refine(v => !/[\r\n\0]/.test(v))).max(32),
  icon: z.string().max(32),
}).strict();
export const settingsSchema = z.object({
  theme: z.enum(['aurora', 'midnight', 'ember', 'forest', 'light']),
  language: z.enum(['ru', 'en']),
  javaPath: z.string().max(4096).refine(v => !/[\r\n\0]/.test(v)),
  ramMb: z.number().int().min(1024).max(32768),
}).strict();
export const defaultSettings = { theme: 'aurora' as const, language: 'ru' as const, javaPath: '', ramMb: 4096 };
export const defaultProfiles = [{ id: 'default', name: 'Мой мир', version: '1.21.5', ramMb: 4096, jvmArgs: [], icon: '🌿' }];
export function redactSecrets(line: string): string {
  return line.replace(/(Bearer\s+|--accessToken[=\s]+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]');
}
