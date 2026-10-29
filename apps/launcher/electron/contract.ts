export type Theme = 'aurora' | 'midnight' | 'ember' | 'forest' | 'light';
export interface LauncherProfile { id: string; name: string; version: string; ramMb: number; jvmArgs: string[]; icon: string }
export interface LauncherSettings { theme: Theme; language: 'ru' | 'en'; javaPath: string; ramMb: number }
export interface MinecraftAccount { id: string; name: string; skinUrl?: string }
export interface MinecraftVersion { id: string; type: string; releaseTime: string }
export interface LauncherState { profiles: LauncherProfile[]; settings: LauncherSettings; account: MinecraftAccount | null; appVersion: string; platform: string }
export interface DownloadProgress { phase: string; current: number; total: number; percent: number }
export type GameStatus = 'idle' | 'authenticating' | 'installing' | 'running' | 'error';
export interface StatusEvent { status: GameStatus; message: string }
export interface AuthCode { userCode: string; verificationUri: string; expiresIn: number }
export interface UpdateResult { available: boolean; version?: string; message: string }
export interface AuralisBridge {
  getState(): Promise<LauncherState>;
  getVersions(): Promise<MinecraftVersion[]>;
  saveProfile(profile: LauncherProfile): Promise<LauncherProfile>;
  deleteProfile(id: string): Promise<void>;
  saveSettings(settings: LauncherSettings): Promise<LauncherSettings>;
  signInMicrosoft(): Promise<MinecraftAccount>;
  signOut(): Promise<void>;
  launch(profileId: string): Promise<void>;
  stopGame(): Promise<void>;
  openGameFolder(profileId?: string): Promise<void>;
  chooseJava(): Promise<string | null>;
  checkForUpdates(): Promise<UpdateResult>;
  installUpdate(): Promise<void>;
  windowControl(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  /** Only the Auralis API refresh token is persisted; access tokens stay in renderer memory. */
  readApiSession(): Promise<string | null>;
  saveApiSession(refreshToken: string): Promise<void>;
  clearApiSession(): Promise<void>;
  onProgress(callback: (event: DownloadProgress) => void): () => void;
  onLog(callback: (line: string) => void): () => void;
  onStatus(callback: (event: StatusEvent) => void): () => void;
  onAuthCode(callback: (event: AuthCode) => void): () => void;
}
