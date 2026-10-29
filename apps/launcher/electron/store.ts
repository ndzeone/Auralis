import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Cache, CacheFactory } from 'prismarine-auth';
import type { LauncherProfile, LauncherSettings, MinecraftAccount } from './contract.js';
import { defaultProfiles, defaultSettings, profileSchema, settingsSchema } from './validation.js';
const dataSchema = z.object({
  profiles: z.array(profileSchema).max(100),
  settings: settingsSchema,
  account: z.object({ id: z.string(), name: z.string(), skinUrl: z.string().optional() }).nullable(),
});
interface Data { profiles: LauncherProfile[]; settings: LauncherSettings; account: MinecraftAccount | null }
export class Store {
  readonly directory = app.getPath('userData');
  data: Data = { profiles: defaultProfiles, settings: defaultSettings, account: null };
  private writes: Promise<unknown> = Promise.resolve();
  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try { this.data = dataSchema.parse(JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Настройки повреждены. Сохраните копию settings.json из папки Auralis и исправьте JSON.'); }
  }
  async persist(): Promise<void> { await this.atomicWrite(join(this.directory, 'settings.json'), JSON.stringify(this.data, null, 2)); }
  private async atomicWrite(file: string, value: string | Buffer): Promise<void> {
    const task = this.writes.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true });
      await writeFile(`${file}.tmp`, value, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    this.writes = task;
    await task;
  }
  private async assertSecure(): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable()) || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('Системное защищённое хранилище недоступно. На Linux нужен Secret Service/Keyring; на Windows и macOS войдите в системную учётную запись.');
    }
  }
  async readSecret(name: string): Promise<string | null> {
    let encrypted: Buffer;
    try { encrypted = await readFile(join(this.directory, `${name}.enc`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    await this.assertSecure();
    try {
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      if (decrypted.shouldReEncrypt) await this.writeSecret(name, decrypted.result);
      return decrypted.result;
    } catch { throw new Error('Не удалось прочитать системное хранилище Auralis.'); }
  }
  async writeSecret(name: string, value: string): Promise<void> {
    await this.assertSecure();
    await this.atomicWrite(join(this.directory, `${name}.enc`), await safeStorage.encryptStringAsync(value));
  }
  async deleteSecret(name: string): Promise<void> { await rm(join(this.directory, `${name}.enc`), { force: true }); }
  authCacheFactory: CacheFactory = ({ cacheName }): Cache => {
    // The library only supplies fixed cache names; never use a supplied path.
    const name = `microsoft-${cacheName.replace(/[^a-z0-9_-]/gi, '')}`;
    return {
      reset: async () => this.writeSecret(name, '{}'),
      getCached: async () => JSON.parse((await this.readSecret(name)) ?? '{}') as Record<string, unknown>,
      setCached: async (value: unknown) => this.writeSecret(name, JSON.stringify(value)),
      setCachedPartial: async (value: Record<string, unknown>) => {
        const existing = JSON.parse((await this.readSecret(name)) ?? '{}') as Record<string, unknown>;
        await this.writeSecret(name, JSON.stringify({ ...existing, ...value }));
      },
    };
  };
  async clearMicrosoft(): Promise<void> {
    const { readdir } = await import('node:fs/promises');
    for (const file of await readdir(this.directory)) {
      if (/^microsoft-[a-zA-Z0-9_-]+\.enc$/.test(file)) await rm(join(this.directory, file), { force: true });
    }
    this.data.account = null;
    await this.persist();
  }
}
