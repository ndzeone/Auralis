import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile, type ChildProcess } from 'node:child_process';
import { MinecraftFolder, Version, getPlatform, launch, type ResolvedVersion } from '@xmcl/core';
import {
  DEFAULT_RUNTIME_ALL_URL, getVersionList, DownloadTask, InstallJarTask,
  installLibrariesTask, installAssetsTask, installJavaRuntimeWithJsonTask,
  type JavaRuntimes, type MinecraftVersion as RemoteVersion,
} from '@xmcl/installer';
import type { Task } from '@xmcl/task';
import type { DownloadBaseOptions } from '@xmcl/file-transfer';
import { getGlobalDispatcher, interceptors } from 'undici';
import { Authflow } from 'prismarine-auth';
import type { AuthCode, DownloadProgress, MinecraftAccount, StatusEvent } from './contract.js';
import { Store } from './store.js';
import { profileIdSchema, redactSecrets } from './validation.js';
const execFileAsync = promisify(execFile);
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
interface Events {
  progress: (event: DownloadProgress) => void;
  status: (event: StatusEvent) => void;
  log: (line: string) => void;
  authCode: (event: AuthCode) => void;
}
export class MinecraftService {
  private game: ChildProcess | null = null;
  private controller: AbortController | null = null;
  private authenticating: Promise<MinecraftAccount> | null = null;
  private readonly flow: Authflow;
  private token = '';
  // XMCL pins Undici 7.2 types; the public Dispatcher dispatch protocol remains compatible with 7.x.
  private readonly downloadDispatcher = getGlobalDispatcher().compose(interceptors.retry({ maxRetries: 2 }), interceptors.redirect({ maxRedirections: 5 })) as unknown as NonNullable<DownloadBaseOptions['dispatcher']>;
  constructor(private readonly store: Store, private readonly events: Events) {
    // Documented prismarine-auth device-code flow. No passwords or tokens enter the renderer.
    this.flow = new Authflow('auralis-primary', store.authCacheFactory, undefined, code => {
      const uri = new URL(code.verification_uri);
      if (uri.protocol !== 'https:' || !['microsoft.com', 'www.microsoft.com', 'login.live.com', 'microsoftonline.com', 'login.microsoftonline.com'].includes(uri.hostname)) {
        throw new Error('Microsoft вернул неизвестный адрес авторизации.');
      }
      events.authCode({ userCode: code.user_code, verificationUri: uri.href, expiresIn: code.expires_in });
      events.status({ status: 'authenticating', message: `Откройте ${uri.href} и введите код ${code.user_code}` });
    });
  }
  isBusy(): boolean { return Boolean(this.controller || this.game); }
  async versions(): Promise<RemoteVersion[]> {
    const manifest = await getVersionList({ remote: MANIFEST });
    return manifest.versions.filter(v => v.type === 'release' || v.type === 'snapshot');
  }
  async signIn(): Promise<MinecraftAccount> {
    if (this.authenticating) return this.authenticating;
    this.authenticating = this.authenticate().finally(() => { this.authenticating = null; });
    return this.authenticating;
  }
  private async authenticate(): Promise<MinecraftAccount> {
    this.events.status({ status: 'authenticating', message: 'Вход в Microsoft…' });
    try {
      const result = await this.flow.getMinecraftJavaToken({ fetchProfile: true, fetchEntitlements: true });
      if (!result.profile?.id || !result.profile.name || !result.entitlements?.items?.length) {
        throw new Error('У аккаунта нет доступной лицензии Minecraft Java Edition или не создан профиль игрока.');
      }
      this.token = result.token;
      const skinUrl = result.profile.skins.find(s => s.state === 'ACTIVE')?.url;
      const account: MinecraftAccount = { id: result.profile.id, name: result.profile.name, ...(skinUrl ? { skinUrl } : {}) };
      this.store.data.account = account;
      await this.store.persist();
      this.events.status({ status: this.game ? 'running' : 'idle', message: `Вы вошли как ${account.name}` });
      return account;
    } catch (error) {
      this.events.status({ status: 'error', message: this.safeError(error) });
      throw error;
    }
  }
  async signOut(): Promise<void> {
    if (this.authenticating || this.isBusy()) throw new Error('Сначала завершите вход или игру.');
    this.token = '';
    await this.store.clearMicrosoft();
    this.events.status({ status: 'idle', message: 'Вы вышли из Microsoft' });
  }
  gameFolder(id?: string): string {
    return id ? join(this.store.directory, 'instances', profileIdSchema.parse(id)) : join(this.store.directory, 'instances');
  }
  async start(id: string): Promise<void> {
    if (this.isBusy()) throw new Error('Minecraft уже запускается или работает.');
    const profile = this.store.data.profiles.find(p => p.id === profileIdSchema.parse(id));
    if (!profile) throw new Error('Профиль не найден.');
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      const account = await this.signIn();
      signal.throwIfAborted();
      this.events.status({ status: 'installing', message: 'Проверка и установка файлов Minecraft…' });
      const versionInfo = (await this.versions()).find(v => v.id === profile.version) as (RemoteVersion & { sha1?: string }) | undefined;
      if (!versionInfo?.sha1) throw new Error('Версия не найдена в официальном манифесте с контрольной суммой.');
      const folder = MinecraftFolder.from(join(this.store.directory, 'minecraft'));
      await mkdir(this.gameFolder(id), { recursive: true });
      await this.runTask('Метаданные версии', new DownloadTask({
        url: versionInfo.url, destination: folder.getVersionJson(versionInfo.id),
        validator: { algorithm: 'sha1', hash: versionInfo.sha1 }, dispatcher: this.downloadDispatcher,
      }), signal);
      const version = await Version.parse(folder, versionInfo.id);
      const javaPath = await this.ensureJava(version, signal);
      await this.runTask('Клиент Minecraft', new InstallJarTask(version, folder, { dispatcher: this.downloadDispatcher }), signal);
      await this.runTask('Библиотеки', installLibrariesTask(version, { librariesDownloadConcurrency: 6, dispatcher: this.downloadDispatcher }), signal);
      await this.runTask('Ресурсы игры', installAssetsTask(version, { prevalidSizeOnly: false, assetsDownloadConcurrency: 6, dispatcher: this.downloadDispatcher }), signal);
      signal.throwIfAborted();
      this.events.log('Контрольные суммы проверены. Запуск Minecraft…');
      const child = await launch({
        version, resourcePath: folder.root, gamePath: this.gameFolder(id), javaPath,
        gameProfile: { id: account.id, name: account.name }, accessToken: this.token,
        maxMemory: profile.ramMb, minMemory: Math.min(1024, profile.ramMb),
        extraJVMArgs: profile.jvmArgs, launcherName: 'Auralis', launcherBrand: 'Auralis',
        gameName: 'Minecraft — Auralis', resolution: { width: 1280, height: 800 },
        extraExecOption: { windowsHide: true, shell: false },
      });
      this.game = child;
      child.stdout?.on('data', data => this.events.log(this.redact(String(data))));
      child.stderr?.on('data', data => this.events.log(this.redact(String(data))));
      child.once('error', error => {
        this.game = null;
        this.events.status({ status: 'error', message: this.safeError(error) });
      });
      child.once('close', code => {
        this.game = null;
        this.events.status({ status: code === 0 ? 'idle' : 'error', message: code === 0 ? 'Игра завершена' : `Minecraft завершился с кодом ${code ?? 'неизвестно'}. Проверьте журнал.` });
      });
      this.events.status({ status: 'running', message: `Minecraft ${versionInfo.id} запущен` });
    } catch (error) {
      const message = signal.aborted ? 'Установка отменена' : this.safeError(error);
      this.events.status({ status: signal.aborted ? 'idle' : 'error', message });
      this.events.log(message);
      throw new Error(message);
    } finally { this.controller = null; }
  }
  stop(): void {
    this.controller?.abort();
    this.game?.kill('SIGTERM');
  }
  private redact(value: string): string { return redactSecrets(this.token ? value.split(this.token).join('[REDACTED]') : value).slice(0, 16000); }
  private safeError(error: unknown): string { return this.redact(error instanceof Error ? error.message : 'Неизвестная ошибка'); }
  private async runTask<T>(phase: string, task: Task<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const report = () => this.events.progress({ phase, current: task.progress, total: task.total, percent: task.total > 0 ? Math.min(100, Math.round(100 * task.progress / task.total)) : 0 });
    const cancel = () => { void task.cancel().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    report();
    const timer = setInterval(report, 200);
    try { return await task.startAndWait(); }
    finally { clearInterval(timer); signal.removeEventListener('abort', cancel); report(); }
  }
  private async ensureJava(version: ResolvedVersion, signal: AbortSignal): Promise<string> {
    const target = version.javaVersion?.component ?? 'jre-legacy';
    const major = version.javaVersion?.majorVersion ?? 8;
    const configured = this.store.data.settings.javaPath;
    if (configured) {
      const { stderr, stdout } = await execFileAsync(configured, ['-version'], { timeout: 10000, windowsHide: true });
      const match = /version "(?:1\.)?(\d+)/.exec(`${stderr}\n${stdout}`);
      if (!match || Number(match[1]) < major) throw new Error(`Для этой версии нужна Java ${major} или новее. Выберите подходящий java/java.exe в настройках.`);
      return configured;
    }
    const response = await fetch(DEFAULT_RUNTIME_ALL_URL, { signal });
    if (!response.ok) throw new Error(`Не удалось получить официальный список Java: HTTP ${response.status}`);
    const runtimes = await response.json() as JavaRuntimes;
    const platform = getPlatform();
    const key: keyof JavaRuntimes = platform.name === 'osx'
      ? (platform.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os')
      : platform.name === 'windows' ? 'windows-x64' : 'linux';
    const runtime = runtimes[key]?.[target]?.[0];
    if (!runtime) throw new Error(`Официальная Java ${major} для ${key} недоступна. Установите совместимую Java и выберите её в настройках.`);
    const destination = join(this.store.directory, 'runtimes', key, target);
    await this.runTask(`Java ${major}`, installJavaRuntimeWithJsonTask({ target: runtime, destination, dispatcher: this.downloadDispatcher }), signal);
    const executable = await this.findJava(destination);
    if (!executable) throw new Error('Java установлена, но исполняемый файл не найден. Выберите Java в настройках.');
    return executable;
  }
  private async findJava(directory: string, depth = 0): Promise<string | null> {
    if (depth > 6) return null;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name === (process.platform === 'win32' ? 'java.exe' : 'java') && directory.endsWith('bin')) return path;
      if (entry.isDirectory()) { const found = await this.findJava(path, depth + 1); if (found) return found; }
    }
    return null;
  }
}
