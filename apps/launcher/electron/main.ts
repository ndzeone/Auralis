import { app, BrowserWindow, dialog, ipcMain, shell, session, type IpcMainInvokeEvent } from 'electron';
import electronUpdater from 'electron-updater';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { z } from 'zod';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { Store } from './store.js';
import { MinecraftService } from './minecraft.js';
import { profileIdSchema, profileSchema, settingsSchema, redactSecrets } from './validation.js';
import type { UpdateResult } from './contract.js';
const { autoUpdater } = electronUpdater;
const directory = dirname(fileURLToPath(import.meta.url));
const devUrl = !app.isPackaged ? process.env.AURALIS_DEV_URL : undefined;
if (devUrl && devUrl !== 'http://127.0.0.1:5173') throw new Error('Invalid development URL');
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
app.setName('Auralis');
let window: BrowserWindow | null = null;
let game: MinecraftService;
let store: Store;
let updateReady = false;
let updateStatus: UpdateResult = { available: false, message: 'Обновления ещё не проверялись' };
function send(channel: string, payload: unknown): void { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); }
function trusted(event: IpcMainInvokeEvent): void {
  if (!window || event.sender.id !== window.webContents.id || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender');
  const url = event.senderFrame?.url;
  if (!url || (devUrl ? !url.startsWith(`${devUrl}/`) : url !== new URL('../dist/index.html', import.meta.url).href)) throw new Error('Untrusted IPC origin');
}
function handle(name: string, callback: (...args: unknown[]) => unknown): void {
  ipcMain.handle(`auralis:${name}`, async (event, ...args: unknown[]) => {
    trusted(event);
    try { return await callback(...args); }
    catch (error) { throw new Error(redactSecrets(error instanceof Error ? error.message : 'Операция не выполнена')); }
  });
}
function registerIpc(): void {
  handle('state', () => ({ ...store.data, appVersion: app.getVersion(), platform: process.platform }));
  handle('versions', async () => (await game.versions()).map(({ id, type, releaseTime }) => ({ id, type, releaseTime })));
  handle('save-profile', async value => {
    const profile = profileSchema.parse(value);
    const index = store.data.profiles.findIndex(p => p.id === profile.id);
    if (index < 0 && store.data.profiles.length >= 100) throw new Error('Максимум 100 профилей.');
    if (index < 0) store.data.profiles.push(profile); else store.data.profiles[index] = profile;
    await store.persist();
    return profile;
  });
  handle('delete-profile', async value => {
    if (game.isBusy()) throw new Error('Завершите игру перед удалением профиля.');
    const id = profileIdSchema.parse(value);
    store.data.profiles = store.data.profiles.filter(p => p.id !== id);
    await store.persist();
  });
  handle('save-settings', async value => {
    store.data.settings = settingsSchema.parse(value);
    await store.persist();
    return store.data.settings;
  });
  handle('sign-in', () => game.signIn());
  handle('sign-out', () => game.signOut());
  handle('launch', id => game.start(profileIdSchema.parse(id)));
  handle('stop-game', () => game.stop());
  handle('open-folder', async value => {
    const id = value === undefined ? undefined : profileIdSchema.parse(value);
    if (id && !store.data.profiles.some(p => p.id === id)) throw new Error('Профиль не найден');
    const folder = game.gameFolder(id);
    await mkdir(folder, { recursive: true });
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  });
  handle('choose-java', async () => {
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: process.platform === 'win32' ? 'Выберите java.exe' : 'Выберите исполняемый файл Java (bin/java)',
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'Java', extensions: ['exe'] }] } : {}),
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle('read-api-session', () => store.readSecret('api-refresh'));
  handle('save-api-session', token => store.writeSecret('api-refresh', z.string().min(16).max(16384).parse(token)));
  handle('clear-api-session', () => store.deleteSecret('api-refresh'));
  handle('window', value => {
    const action = z.enum(['minimize', 'maximize', 'close']).parse(value);
    if (action === 'minimize') window?.minimize();
    if (action === 'maximize') { if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); }
    if (action === 'close') window?.close();
  });
  handle('check-updates', async () => {
    if (!app.isPackaged) return { available: false, message: 'Обновления доступны в установленной версии. В разработке используйте pnpm install.' } satisfies UpdateResult;
    await autoUpdater.checkForUpdates();
    return updateStatus;
  });
  handle('install-update', () => {
    if (game.isBusy()) throw new Error('Сначала завершите Minecraft.');
    if (!updateReady) throw new Error('Обновление ещё не загружено.');
    autoUpdater.quitAndInstall();
  });
}
function configureUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', info => {
    updateStatus = { available: true, version: info.version, message: `Загружается Auralis ${info.version}` };
    send('auralis:log', updateStatus.message);
  });
  autoUpdater.on('update-not-available', () => { updateStatus = { available: false, message: 'Установлена последняя версия' }; });
  autoUpdater.on('download-progress', progress => send('auralis:progress', { phase: 'Обновление Auralis', current: progress.transferred, total: progress.total, percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => {
    updateReady = true;
    updateStatus = { available: true, version: info.version, message: 'Обновление загружено. Нажмите «Установить обновление».' };
    send('auralis:log', updateStatus.message);
  });
  autoUpdater.on('error', error => {
    updateStatus = { available: false, message: `Не удалось проверить обновления: ${redactSecrets(error.message)}` };
    send('auralis:log', updateStatus.message);
  });
}
async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1060, minHeight: 720,
    title: 'Auralis', backgroundColor: '#0B0B16', frame: false,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 18, y: 18 } } : {}),
    icon: join(directory, '../build/icon.png'),
    webPreferences: {
      preload: join(directory, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  const contentSecurityPolicy = [
    "default-src 'self'", `script-src 'self'${devUrl ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https:",
    "font-src 'self' data:", `connect-src 'self' http://localhost:3001 http://127.0.0.1:3001 https:${devUrl ? ' ws://127.0.0.1:5173' : ''}`,
    "object-src 'none'", "base-uri 'self'", "frame-src 'none'", "form-action 'self'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy] } }));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && ['github.com', 'www.minecraft.net', 'minecraft.net', 'www.microsoft.com', 'microsoft.com', 'login.live.com'].includes(parsed.hostname)) void shell.openExternal(url);
    } catch { /* Invalid external URLs stay closed. */ }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('closed', () => { window = null; });
  if (devUrl) await window.loadURL(devUrl); else await window.loadFile(join(directory, '../dist/index.html'));
}
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    store = new Store(); await store.init();
    game = new MinecraftService(store, {
      progress: event => send('auralis:progress', event), status: event => send('auralis:status', event),
      log: line => send('auralis:log', line), authCode: event => send('auralis:auth-code', event),
    });
    registerIpc(); configureUpdater(); await createWindow();
  }).catch(error => { dialog.showErrorBox('Auralis не удалось запустить', redactSecrets(error instanceof Error ? error.message : String(error))); app.quit(); });
  app.on('activate', () => { if (!window && store) void createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => game?.stop());
}
