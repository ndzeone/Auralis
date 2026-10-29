import { z } from 'zod';

export const themeSchema = z.enum(['aurora', 'midnight', 'ember', 'forest', 'light']);
export type Theme = z.infer<typeof themeSchema>;
export const themes: { id: Theme; name: string; primary: string; accent: string }[] = [
  { id: 'aurora', name: 'Aurora', primary: '#C4B5FD', accent: '#5EEAD4' },
  { id: 'midnight', name: 'Midnight', primary: '#93C5FD', accent: '#67E8F9' },
  { id: 'ember', name: 'Ember', primary: '#FDBA74', accent: '#FCA5A5' },
  { id: 'forest', name: 'Forest', primary: '#86EFAC', accent: '#FDE68A' },
  { id: 'light', name: 'Light', primary: '#6941C6', accent: '#087F71' },
];
export const profileSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(64),
  version: z.string().min(1).max(64),
  ramMb: z.number().int().min(1024).max(32768),
  jvmArgs: z.array(z.string().max(512)).max(32),
  icon: z.string().max(32),
});
export type GameProfile = z.infer<typeof profileSchema>;
export const userSettingsSchema = z.object({
  theme: themeSchema.default('aurora'),
  language: z.enum(['ru', 'en']).default('ru'),
});
export function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'aurora';
  const saved = themeSchema.safeParse(window.localStorage.getItem('auralis-theme'));
  return saved.success ? saved.data : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'aurora';
}
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem('auralis-theme', theme);
}
