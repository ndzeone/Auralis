// Sandboxed preload is emitted as CommonJS; require('electron') is the sole runtime import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');
import type { AuralisBridge, AuthCode, DownloadProgress, StatusEvent } from './contract.js';
const subscribe = <T,>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const bridge: AuralisBridge = {
  getState: () => ipcRenderer.invoke('auralis:state'),
  getVersions: () => ipcRenderer.invoke('auralis:versions'),
  saveProfile: profile => ipcRenderer.invoke('auralis:save-profile', profile),
  deleteProfile: id => ipcRenderer.invoke('auralis:delete-profile', id),
  saveSettings: settings => ipcRenderer.invoke('auralis:save-settings', settings),
  signInMicrosoft: () => ipcRenderer.invoke('auralis:sign-in'),
  signOut: () => ipcRenderer.invoke('auralis:sign-out'),
  launch: id => ipcRenderer.invoke('auralis:launch', id),
  stopGame: () => ipcRenderer.invoke('auralis:stop-game'),
  openGameFolder: id => ipcRenderer.invoke('auralis:open-folder', id),
  chooseJava: () => ipcRenderer.invoke('auralis:choose-java'),
  checkForUpdates: () => ipcRenderer.invoke('auralis:check-updates'),
  installUpdate: () => ipcRenderer.invoke('auralis:install-update'),
  windowControl: action => ipcRenderer.invoke('auralis:window', action),
  readApiSession: () => ipcRenderer.invoke('auralis:read-api-session'),
  saveApiSession: token => ipcRenderer.invoke('auralis:save-api-session', token),
  clearApiSession: () => ipcRenderer.invoke('auralis:clear-api-session'),
  onProgress: callback => subscribe<DownloadProgress>('auralis:progress', callback),
  onLog: callback => subscribe<string>('auralis:log', callback),
  onStatus: callback => subscribe<StatusEvent>('auralis:status', callback),
  onAuthCode: callback => subscribe<AuthCode>('auralis:auth-code', callback),
};
contextBridge.exposeInMainWorld('auralis', bridge);
