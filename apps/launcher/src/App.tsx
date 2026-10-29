import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownToLine, ArrowRight, Bell, Blocks, Check, ChevronDown, CircleHelp, Copy, Download, FolderOpen, Gamepad2, HardDrive, LayoutDashboard, LogOut, Maximize2, MemoryStick, Minus, Newspaper, Palette, Pencil, Play, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Square, Terminal, Trash2, UserRound, X } from 'lucide-react';
import { applyTheme, initialTheme, themes, type Theme } from '@auralis/shared';
import type { AuralisBridge, AuthCode, DownloadProgress, LauncherProfile, LauncherSettings, LauncherState, MinecraftVersion, StatusEvent } from '../electron/contract';
import landscape from './assets/landscape.svg';

declare global { interface Window { auralis?: AuralisBridge } }
type Page = 'home' | 'profiles' | 'news' | 'settings' | 'account';
type ApiUser = { id: string; username: string; email: string; emailVerified?: boolean };
type AuthSession = { user: ApiUser; accessToken: string; refreshToken?: string };
type ApiRequest = <T = AuthSession>(path: string, body?: unknown, method?: string, auth?: boolean) => Promise<T>;
type News = { id: string; title: string; body?: string; content?: string; publishedAt?: string };
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const defaultSettings: LauncherSettings = { theme: initialTheme(), language: 'ru', javaPath: '', ramMb: 4096 };
const defaultProfile: LauncherProfile = { id: 'vanilla', name: 'Мой первый мир', version: '1.21.4', ramMb: 4096, jvmArgs: [], icon: 'grass' };
const initial: LauncherState = { profiles: [defaultProfile], settings: defaultSettings, account: null, appVersion: '0.1.0', platform: 'browser' };
const nav: { id: Page; label: string; icon: typeof Play }[] = [{ id: 'home', label: 'Главная', icon: LayoutDashboard }, { id: 'profiles', label: 'Мои сборки', icon: Blocks }, { id: 'news', label: 'Новости', icon: Newspaper }, { id: 'settings', label: 'Настройки', icon: Settings2 }];
const pageTitles: Record<Page, string> = { home: 'Обзор', profiles: 'Мои сборки', news: 'Новости', settings: 'Настройки', account: 'Аккаунт' };

function Logo({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'small' : ''}`}><svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="brand" x1="5" x2="35" y1="35" y2="5" gradientUnits="userSpaceOnUse"><stop stopColor="#5EEAD4"/><stop offset="1" stopColor="#C4B5FD"/></linearGradient></defs><path d="m20 4 16 30H25l-5-10-5 10H4L20 4Z" fill="url(#brand)"/><path d="m20 14 5 10H15l5-10Z" fill="var(--bg)"/></svg>{!small && <span>auralis<span className="brand-dot">.</span></span>}</div>;
}
function BlockIcon({ variant = 'grass', size = '' }: { variant?: string; size?: string }) { return <div className={`block-icon ${variant} ${size}`} aria-hidden="true"><div/><span/><i/></div>; }
function readPreview(): LauncherState {
  try {
    const saved = JSON.parse(localStorage.getItem('auralis-preview') || 'null') as LauncherState | null;
    if (saved && Array.isArray(saved.profiles) && saved.settings) return { ...initial, profiles: saved.profiles, settings: { ...defaultSettings, ...saved.settings, theme: initialTheme() } };
  } catch { /* A corrupt preview state must not prevent the UI from opening. */ }
  return initial;
}
function deviceId() { const old = localStorage.getItem('auralis-device-id'); if (old) return old; const id = crypto.randomUUID(); localStorage.setItem('auralis-device-id', id); return id; }
function ErrorNotice({ children }: { children: ReactNode }) { return <div className="error-notice" role="alert"><CircleHelp size={17}/><span>{children}</span></div>; }

export default function App() {
  const bridge = window.auralis;
  const [state, setState] = useState<LauncherState>(readPreview);
  const [page, setPage] = useState<Page>('home');
  const [selected, setSelected] = useState('vanilla');
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [status, setStatus] = useState<StatusEvent>({ status: 'idle', message: 'Готовы к приключению?' });
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [editing, setEditing] = useState<LauncherProfile | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [authCode, setAuthCode] = useState<AuthCode | null>(null);
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const accessToken = useRef('');
  const [news, setNews] = useState<News[]>([]);
  const [newsError, setNewsError] = useState('');
  const [updateReady, setUpdateReady] = useState(false);
  const profile = state.profiles.find(p => p.id === selected) || state.profiles[0];
  const running = status.status === 'running';
  const downloading = status.status === 'installing';

  function notify(message: string) { setToast(message); }
  async function request<T = AuthSession>(path: string, body?: unknown, method = 'POST', auth = false): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(auth && accessToken.current ? { Authorization: `Bearer ${accessToken.current}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data: unknown = await response.json().catch(() => ({}));
    const failure = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
    if (!response.ok) throw new Error(typeof failure.error === 'string' ? failure.error : typeof failure.message === 'string' ? failure.message : `Ошибка API (${response.status})`);
    return data as T;
  }
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge.getState().then(value => { if (live) { setState(value); setSelected(value.profiles[0]?.id || ''); applyTheme(value.settings.theme); } }).catch(e => setError(String(e)));
    bridge.getVersions().then(value => { if (live) setVersions(value); }).catch(e => { if (live) setError(`Не удалось загрузить версии Minecraft: ${String(e)}`); });
    const off = [bridge.onProgress(setProgress), bridge.onLog(line => setLogs(old => [...old.slice(-499), line])), bridge.onStatus(event => { setStatus(event); if (event.status === 'idle' || event.status === 'error') setProgress(null); }), bridge.onAuthCode(setAuthCode)];
    bridge.readApiSession().then(async refreshToken => {
      if (!refreshToken) return;
      const data = await request('/auth/refresh', { refreshToken, deviceId: deviceId() });
      if (!live) return;
      accessToken.current = data.accessToken;
      if (data.refreshToken) await bridge.saveApiSession(data.refreshToken);
      const me = await request<ApiUser | { user: ApiUser }>('/me', undefined, 'GET', true);
      if (live) setApiUser('user' in me ? me.user : me);
    }).catch(() => bridge.clearApiSession());
    return () => { live = false; off.forEach(fn => fn()); };
  }, []);
  useEffect(() => { applyTheme(state.settings.theme); if (!bridge) localStorage.setItem('auralis-preview', JSON.stringify(state)); }, [state]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/news`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); return response.json(); }).then(data => setNews(Array.isArray(data) ? data : data.news || [])).catch(() => { if (!controller.signal.aborted) setNewsError('Новости появятся после подключения к серверу Auralis.'); });
    return () => controller.abort();
  }, []);

  async function action(task: () => Promise<unknown>) { setError(''); setBusy(true); try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function saveProfile(value: LauncherProfile) {
    await action(async () => {
      const saved = bridge ? await bridge.saveProfile(value) : value;
      setState(old => ({ ...old, profiles: old.profiles.some(p => p.id === saved.id) ? old.profiles.map(p => p.id === saved.id ? saved : p) : [...old.profiles, saved] }));
      setSelected(saved.id); setEditing(null); notify('Сборка сохранена');
    });
  }
  async function deleteProfile(value: LauncherProfile) {
    await action(async () => { if (bridge) await bridge.deleteProfile(value.id); setState(old => ({ ...old, profiles: old.profiles.filter(p => p.id !== value.id) })); notify('Сборка удалена'); });
  }
  async function settings(patch: Partial<LauncherSettings>) {
    const value = { ...state.settings, ...patch };
    await action(async () => { const saved = bridge ? await bridge.saveSettings(value) : value; setState(old => ({ ...old, settings: saved })); if (apiUser) await request('/me/settings', { theme: saved.theme, language: saved.language }, 'PATCH', true); });
  }
  async function microsoftLogin() {
    if (!bridge) { notify('Вход Microsoft доступен в установленном приложении.'); return; }
    await action(async () => { const account = await bridge.signInMicrosoft(); setState(old => ({ ...old, account })); setAuthCode(null); notify(`Добро пожаловать, ${account.name}`); });
  }
  async function play() {
    if (!bridge) { notify('Для запуска Minecraft установите Auralis для Windows или macOS.'); return; }
    if (!state.account) { setPage('account'); return; }
    if (!profile) { setPage('profiles'); return; }
    await action(async () => { setShowLogs(true); await bridge.launch(profile.id); });
  }
  async function checkUpdates() {
    await action(async () => { if (!bridge) { notify('Обновления доступны в установленном приложении.'); return; } const result = await bridge.checkForUpdates(); setUpdateReady(result.available); notify(result.message); });
  }
  const primaryAction = <button className="play-button" disabled={busy || downloading || !profile} onClick={() => running ? void action(async () => bridge?.stopGame()) : void play()}>{running ? <Square size={20} fill="currentColor"/> : downloading ? <RefreshCw size={22} className="spin"/> : <Play size={22} fill="currentColor"/>}<span>{running ? 'Остановить' : downloading ? 'Установка…' : 'Играть'}<small>{running ? 'Minecraft запущен' : profile ? `Minecraft ${profile.version}` : 'Создайте сборку'}</small></span>{!running && !downloading && <ArrowRight size={19}/>}</button>;

  return <div className="launcher-shell">
    <aside className="sidebar">
      <Logo/>
      <div className="sidebar-label">ВАШЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Навигация лаунчера">{nav.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}><item.icon size={19}/><span>{item.label}</span>{item.id === 'profiles' && <span className="nav-count">{state.profiles.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Sparkles size={18}/><p>Меньше настроек.<br/><strong>Больше приключений.</strong></p><span>Создано для вашего мира</span></div><button className={`sidebar-account ${page === 'account' ? 'active' : ''}`} onClick={() => setPage('account')}><div className="avatar">{state.account ? state.account.name.slice(0, 2).toUpperCase() : <UserRound size={19}/>}</div><div><strong>{state.account?.name || 'Ваш аккаунт'}</strong><small>{state.account ? 'Microsoft · Minecraft' : 'Войти в Auralis'}</small></div><ChevronDown size={15}/></button><div className="sidebar-version"><span>Auralis {state.appVersion}</span><span className="status-dot"/> <span>{bridge ? 'Desktop' : 'Веб-превью'}</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="titlebar"><div className="breadcrumb">Лаунчер <span>/</span> <strong>{pageTitles[page]}</strong></div><div className="titlebar-actions"><span className="edition-badge"><span/> JAVA EDITION</span><button className="icon-button" aria-label="Показать новости" onClick={() => setPage('news')}><Bell size={17}/></button>{bridge && <div className="window-buttons"><button aria-label="Свернуть" onClick={() => void bridge.windowControl('minimize')}><Minus size={15}/></button><button aria-label="Развернуть" onClick={() => void bridge.windowControl('maximize')}><Maximize2 size={13}/></button><button className="close-window" aria-label="Закрыть" onClick={() => void bridge.windowControl('close')}><X size={17}/></button></div>}</div></header>
      <main>
        {error && <div className="top-error"><ErrorNotice>{error}</ErrorNotice><button className="icon-button" onClick={() => setError('')} aria-label="Скрыть ошибку"><X size={17}/></button></div>}
        <AnimatePresence mode="wait"><motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .18 }}>
        {page === 'home' && <>
          <div className="page-heading"><div><div className="eyebrow">РАДЫ ВАС ВИДЕТЬ</div><h1>{state.account ? `Привет, ${state.account.name}` : 'Твой следующий мир.'}<span className="heading-star">✦</span></h1><p>Всё готово для нового приключения. Осталось сделать первый шаг.</p></div><button className="outline-button compact" onClick={() => void action(async () => { if (bridge) await bridge.openGameFolder(profile?.id); else notify('Папка игры доступна в приложении.'); })}><FolderOpen size={16}/><span>Папка игры</span></button></div>
          <section className="hero-card"><img src={landscape} alt="Горное озеро в свете северного сияния" className="hero-landscape"/><div className="hero-content"><span className="pill"><span/> ТВОЙ МИР. ТВОИ ПРАВИЛА.</span><h2>Большие истории<br/>начинаются с блока<span>.</span></h2><p>Исследуй, строй, находи своё.<br/>А о запуске позаботится Auralis.</p><button className="hero-link" onClick={() => setPage('profiles')}>Найти своё приключение <ArrowRight size={17}/></button></div><div className="hero-footer"><span><ShieldCheck size={14}/> Официальные файлы Minecraft</span><span className="hero-coordinates">X: 128 · Y: 64 · Z: −256</span></div></section>
          <div className="launch-panel"><div className="selected-profile"><BlockIcon variant={profile?.icon}/><div><label htmlFor="active-profile">ВЫБРАННАЯ СБОРКА</label><div className="select-wrap"><select id="active-profile" value={profile?.id || ''} onChange={e => setSelected(e.target.value)} aria-label="Активная сборка">{state.profiles.length ? state.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">Нет сборок</option>}</select><ChevronDown size={16}/></div><span><i className="status-dot"/>{profile ? `Vanilla · ${profile.ramMb / 1024} ГБ RAM` : 'Создайте первую сборку'}</span></div></div><div className="launch-panel-right"><div className="launch-status"><span className={downloading ? 'accent' : ''}>{downloading ? `${Math.round(progress?.percent || 0)}% · ${progress?.phase || 'Загрузка'}` : running ? 'Игра запущена' : state.account ? 'Готово к запуску' : 'Требуется вход Microsoft'}</span><small>{bridge ? 'Minecraft Java Edition' : 'Режим предпросмотра'}</small></div>{primaryAction}</div>{downloading && <div className="download-progress"><div style={{ width: `${progress?.percent || 0}%` }}/></div>}</div>
          <div className="section-heading"><h3>Твоё пространство</h3><button className="text-button" onClick={() => setPage('profiles')}>Все сборки <ArrowRight size={15}/></button></div>
          <div className="quick-grid"><button className="quick-card" onClick={() => setPage('profiles')}><div className="quick-icon purple"><Blocks size={21}/></div><div><h4>Собери свой мир</h4><p>Версии, память и профили — всё здесь.</p></div><ArrowRight size={18}/></button><button className="quick-card" onClick={() => setPage('settings')}><div className="quick-icon teal"><Palette size={21}/></div><div><h4>В твоих цветах</h4><p>Пять тем. Одно настроение — твоё.</p></div><ArrowRight size={18}/></button></div>
          <div className="bottom-note"><span><span className="status-dot"/> {status.message}</span><button className="text-button" onClick={() => setShowLogs(value => !value)}><Terminal size={14}/> Журнал запуска</button></div>
        </>}
        {page === 'profiles' && <><PageHeading eyebrow="БИБЛИОТЕКА ПРИКЛЮЧЕНИЙ" title="У каждого мира свой профиль." description="Выбери версию и выдели ресурсы. Сборки хранятся отдельно." action={<button className="primary-button" onClick={() => setEditing({ ...defaultProfile, id: crypto.randomUUID(), name: 'Новая сборка', version: versions.find(v => v.type === 'release')?.id || defaultProfile.version })}><Plus size={18}/> Новая сборка</button>}/><div className="profiles-grid">{state.profiles.map((value, index) => <article className={`profile-card ${value.id === profile?.id ? 'selected' : ''}`} key={value.id}><div className={`profile-art art-${index % 3}`}><BlockIcon variant={value.icon} size="large"/>{value.id === profile?.id && <span className="pill selected-pill"><Check size={12}/> Выбрана</span>}</div><div className="profile-card-content"><div className="profile-card-top"><h3>{value.name}</h3><button className="icon-button" aria-label={`Редактировать ${value.name}`} onClick={() => setEditing(value)}><Pencil size={16}/></button></div><p>Vanilla <span>·</span> {value.version}</p><div className="profile-meta"><span><MemoryStick size={15}/> {value.ramMb / 1024} ГБ RAM</span><span><HardDrive size={14}/> Отдельная папка</span></div><div className="profile-actions"><button className={value.id === profile?.id ? 'outline-button' : 'primary-button'} onClick={() => { setSelected(value.id); setPage('home'); }}>{value.id === profile?.id ? <Check size={16}/> : <Play size={15}/>} {value.id === profile?.id ? 'Открыть' : 'Выбрать'}</button><button className="icon-button danger" disabled={busy || running || downloading} aria-label={`Удалить ${value.name}`} onClick={() => void deleteProfile(value)}><Trash2 size={16}/></button></div></div></article>)}<button className="new-profile-card" onClick={() => setEditing({ ...defaultProfile, id: crypto.randomUUID(), name: 'Новая сборка' })}><span><Plus size={24}/></span><strong>Ещё одно приключение</strong><p>Создать новую сборку</p></button></div><div className="info-line"><ShieldCheck size={17}/><p>Каждая сборка получает свою папку игры. Миры и настройки разных профилей не смешиваются.</p></div></>}
        {page === 'settings' && <><PageHeading eyebrow="СДЕЛАЙ ПО-СВОЕМУ" title="Настроено под тебя." description="Ресурсы для игры. Цвета для настроения."/><section className="settings-section"><div className="section-heading"><h3><Palette size={19}/> Внешний вид</h3><span className="muted">Тема сохраняется автоматически</span></div><div className="theme-grid">{themes.map(theme => <button className={`theme-card ${theme.id === state.settings.theme ? 'chosen' : ''}`} onClick={() => void settings({ theme: theme.id as Theme })} key={theme.id} aria-pressed={theme.id === state.settings.theme}><div className={`theme-preview theme-${theme.id}`}><div/><span/><i style={{ background: theme.primary }}/><b style={{ background: theme.accent }}/></div><span>{theme.name}{theme.id === state.settings.theme && <Check size={15}/>}</span></button>)}</div></section><section className="settings-section"><h3><MemoryStick size={19}/> Производительность</h3><div className="setting-row"><div><strong>Память для новых сборок</strong><p>Оставляй не менее 2 ГБ для системы. Память существующей сборки меняется в её настройках.</p></div><span className="value-badge">{state.settings.ramMb / 1024} ГБ</span></div><input className="ram-slider" aria-label="Память по умолчанию" type="range" min="1024" max="16384" step="1024" value={state.settings.ramMb} onChange={event => setState(old => ({ ...old, settings: { ...old.settings, ramMb: Number(event.target.value) } }))} onPointerUp={() => void settings({ ramMb: state.settings.ramMb })} onKeyUp={() => void settings({ ramMb: state.settings.ramMb })}/><div className="range-labels"><span>1 ГБ</span><span>16 ГБ</span></div><div className="setting-row java-row"><div><strong>Java Runtime</strong><p>{state.settings.javaPath || 'Автоматический подбор совместимой Java'}</p></div><button className="outline-button compact" onClick={() => void action(async () => { if (!bridge) { notify('Выбор Java доступен в приложении.'); return; } const path = await bridge.chooseJava(); if (path) await settings({ javaPath: path }); })}><FolderOpen size={16}/> Выбрать</button></div>{state.settings.javaPath && <button className="text-button" onClick={() => void settings({ javaPath: '' })}>Вернуть автоматический подбор</button>}</section><section className="settings-section"><h3><Download size={19}/> Приложение</h3><div className="setting-row"><div><strong>Auralis {state.appVersion}</strong><p>{state.platform === 'darwin' ? 'macOS Apple Silicon' : state.platform === 'win32' ? 'Windows' : state.platform === 'browser' ? 'Предпросмотр интерфейса в браузере' : state.platform} · Minecraft Java Edition</p></div><button className="outline-button compact" onClick={() => void checkUpdates()} disabled={busy}><RefreshCw size={16}/> Проверить обновления</button></div>{updateReady && <button className="primary-button" onClick={() => void action(async () => bridge?.installUpdate())}><ArrowDownToLine size={17}/> Установить обновление</button>}<div className="setting-row"><div><strong>Язык интерфейса</strong><p>Русский. Другие языки появятся в следующих версиях.</p></div><span className="value-badge">RU</span></div></section></>}
        {page === 'news' && <><PageHeading eyebrow="ЧТО НОВОГО" title="Истории за пределами мира." description="Обновления Auralis, заметки команды и новости сообщества."/><article className="news-feature"><img src={landscape} alt="Северное сияние над горами"/><div><span className="pill">AURALIS · ПЕРВЫЙ РЕЛИЗ</span><h2>Место, с которого<br/>начинается твой мир.</h2><p>Профили, пять тем и простой запуск Minecraft Java.<br/>Добро пожаловать в Auralis.</p><button className="outline-button compact" onClick={() => setPage('profiles')}>Открыть сборки <ArrowRight size={16}/></button></div></article><div className="section-heading"><h3>Лента новостей</h3></div>{news.length ? <div className="news-list">{news.map(item => <article className="news-item" key={item.id}><div className="quick-icon purple"><Newspaper size={22}/></div><div><small>{item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('ru-RU') : 'Auralis'}</small><h3>{item.title}</h3><p>{item.body || item.content}</p></div></article>)}</div> : <div className="empty-state"><Newspaper size={27}/><h3>Свежие истории скоро появятся</h3><p>{newsError || 'Пока нет опубликованных новостей.'}</p></div>}</>}
        {page === 'account' && <><PageHeading eyebrow="ТВОЯ УЧЁТНАЯ ЗАПИСЬ" title="Приключения начинаются с тебя." description="Microsoft открывает доступ к игре. Аккаунт Auralis сохраняет твои настройки."/><div className="account-grid"><section className="settings-section minecraft-account"><div className="account-icon"><Gamepad2 size={30}/></div><h2>Minecraft Java Edition</h2><p className="muted">Войди в Microsoft-аккаунт с приобретённой Minecraft Java Edition.</p>{state.account ? <><div className="connected-account"><div className="avatar large">{state.account.name.slice(0, 2).toUpperCase()}</div><div><strong>{state.account.name}</strong><small><ShieldCheck size={14}/> Аккаунт подключён</small></div></div><button className="outline-button" onClick={() => void action(async () => { await bridge?.signOut(); setState(old => ({ ...old, account: null })); })}><LogOut size={16}/> Выйти из Microsoft</button></> : <button className="primary-button wide" disabled={busy || !bridge} onClick={() => void microsoftLogin()}><MicrosoftLogo/> {busy ? 'Ожидаем вход…' : 'Войти через Microsoft'} <ArrowRight size={16}/></button>}{!bridge && <p className="caption">Вход Microsoft и запуск игры доступны в установленном приложении.</p>}{authCode && <div className="device-code"><p>Открой <strong>{authCode.verificationUri}</strong> в браузере и введи код:</p><button onClick={() => { void navigator.clipboard.writeText(authCode.userCode).then(() => notify('Код скопирован')); }}><code>{authCode.userCode}</code><Copy size={16}/></button><p>После подтверждения вход завершится автоматически.</p></div>}<div className="security-note"><ShieldCheck size={16}/><span>Авторизация проходит на стороне Microsoft. Auralis не получает пароль от вашего аккаунта.</span></div></section><ApiAccount user={apiUser} request={request} onSignedIn={async data => { accessToken.current = data.accessToken; setApiUser(data.user); if (bridge && data.refreshToken) await bridge.saveApiSession(data.refreshToken); notify('Вы вошли в Auralis'); }} onSignedOut={async () => { await action(async () => { const refreshToken = await bridge?.readApiSession(); await request('/auth/logout', refreshToken ? { refreshToken, deviceId: deviceId() } : { deviceId: deviceId() }); await bridge?.clearApiSession(); accessToken.current = ''; setApiUser(null); }); }}/></div></>}
        </motion.div></AnimatePresence>
        {showLogs && <section className="log-panel"><div><h3><Terminal size={16}/> Журнал запуска <span>{logs.length}</span></h3><button className="icon-button" aria-label="Скрыть журнал" onClick={() => setShowLogs(false)}><X size={17}/></button></div><pre aria-live="polite">{logs.length ? logs.join('\n') : 'Логи установки и игры появятся после запуска Minecraft.'}</pre></section>}
        <footer className="app-footer"><span>Создано для больших маленьких миров.</span><span>Auralis не связан с Mojang или Microsoft.</span></footer>
      </main>
    </div>
    <AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 15 }}><Check size={18}/>{toast}<button aria-label="Закрыть уведомление" onClick={() => setToast('')}><X size={16}/></button></motion.div>}</AnimatePresence>
    {editing && <ProfileEditor value={editing} versions={versions} busy={busy} onClose={() => setEditing(null)} onSave={saveProfile}/>}
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function MicrosoftLogo() { return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#F25022" d="M0 0h8v8H0z"/><path fill="#7FBA00" d="M10 0h8v8h-8z"/><path fill="#00A4EF" d="M0 10h8v8H0z"/><path fill="#FFB900" d="M10 10h8v8h-8z"/></svg>; }
function ProfileEditor({ value, versions, busy, onClose, onSave }: { value: LauncherProfile; versions: MinecraftVersion[]; busy: boolean; onClose: () => void; onSave: (value: LauncherProfile) => Promise<void> }) {
  const [profile, setProfile] = useState(value);
  const [snapshots, setSnapshots] = useState(false);
  const [args, setArgs] = useState(value.jvmArgs.join('\n'));
  const filtered = versions.filter(version => snapshots || version.type === 'release');
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener); }, []);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><motion.section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }}><div className="modal-heading"><div><span className="eyebrow">НАСТРОЙКИ СБОРКИ</span><h2 id="profile-title">Твой новый мир.</h2></div><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={20}/></button></div><form onSubmit={event => { event.preventDefault(); void onSave({ ...profile, jvmArgs: args.split('\n').map(arg => arg.trim()).filter(Boolean) }); }}><label className="field-label">Название<input autoFocus required maxLength={64} value={profile.name} onChange={event => setProfile({ ...profile, name: event.target.value })}/></label><div className="form-row"><label className="field-label">Версия Minecraft{filtered.length ? <select value={profile.version} onChange={event => setProfile({ ...profile, version: event.target.value })}>{!filtered.some(v => v.id === profile.version) && <option value={profile.version}>{profile.version}</option>}{filtered.map(version => <option key={version.id} value={version.id}>{version.id}{version.type === 'snapshot' ? ' · Snapshot' : ''}</option>)}</select> : <input required maxLength={64} value={profile.version} onChange={event => setProfile({ ...profile, version: event.target.value })}/>}</label><label className="field-label">Оперативная память<select value={profile.ramMb} onChange={event => setProfile({ ...profile, ramMb: Number(event.target.value) })}>{[1024, 2048, 3072, 4096, 6144, 8192, 12288, 16384].map(ram => <option key={ram} value={ram}>{ram / 1024} ГБ</option>)}</select></label></div><label className="checkbox-label"><input type="checkbox" checked={snapshots} onChange={event => setSnapshots(event.target.checked)}/> Показывать экспериментальные версии (snapshot)</label><div className="field-label">Иконка<div className="icon-options">{['grass', 'stone', 'amethyst', 'sand'].map(icon => <button key={icon} className={profile.icon === icon ? 'selected' : ''} onClick={() => setProfile({ ...profile, icon })} type="button" aria-label={`Иконка ${icon}`} aria-pressed={profile.icon === icon}><BlockIcon variant={icon}/></button>)}</div></div><details className="advanced"><summary>Дополнительные параметры Java</summary><label className="field-label">По одному аргументу на строку<textarea rows={3} value={args} onChange={event => setArgs(event.target.value)} placeholder={'-XX:+UseG1GC'}/></label><p>Указывай только знакомые параметры. Память управляется отдельно.</p></details><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Отмена</button><button className="primary-button" disabled={busy || !profile.name.trim()} type="submit"><Check size={17}/> Сохранить сборку</button></div></form></motion.section></div>;
}

function ApiAccount({ user, request, onSignedIn, onSignedOut }: { user: ApiUser | null; request: ApiRequest; onSignedIn: (data: AuthSession) => Promise<void>; onSignedOut: () => Promise<void> }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget); setLoading(true); setError(''); setMessage('');
    try {
      if (mode === 'reset') { await request('/auth/forgot-password', { email: fields.get('email') }); setMessage('Если адрес зарегистрирован, письмо для сброса отправлено.'); }
      else { const data = await request(`/auth/${mode}`, { ...(mode === 'register' ? { email: fields.get('email'), username: fields.get('username') } : { login: fields.get('login') }), password: fields.get('password'), deviceId: deviceId(), deviceName: 'Auralis Desktop' }); if (data.accessToken) await onSignedIn(data); else { setMode('login'); setMessage('Аккаунт создан. Проверь почту и войди.'); } }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось связаться с сервером Auralis.'); } finally { setLoading(false); }
  }
  return <section className="settings-section api-account"><div className="account-icon purple"><UserRound size={27}/></div><h2>Аккаунт Auralis</h2>{user ? <><p className="muted">Настройки привязаны к твоему аккаунту.</p><div className="connected-account"><div className="avatar large">{user.username.slice(0, 2).toUpperCase()}</div><div><strong>{user.username}</strong><small>{user.email}</small></div></div><button className="outline-button" onClick={() => void onSignedOut()}><LogOut size={16}/> Выйти из Auralis</button></> : <><div className="auth-tabs"><button className={mode !== 'register' ? 'selected' : ''} onClick={() => { setMode('login'); setError(''); }}>Вход</button><button className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError(''); }}>Регистрация</button></div><form onSubmit={event => void submit(event)}>{mode === 'login' && <label className="field-label">Email или имя<input name="login" autoComplete="username" required placeholder="Твой email или никнейм"/></label>}{mode === 'register' && <label className="field-label">Имя пользователя<input name="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoComplete="username" placeholder="Например, aurora_player"/></label>}{mode !== 'login' && <label className="field-label">Email<input name="email" type="email" autoComplete="email" required placeholder="you@example.com"/></label>}{mode !== 'reset' && <label className="field-label">Пароль<input name="password" type="password" minLength={12} maxLength={128} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required placeholder={mode === 'register' ? 'Не менее 12 символов' : 'Твой пароль'}/></label>}{error && <ErrorNotice>{error}</ErrorNotice>}{message && <p className="success-message" role="status">{message}</p>}<button className="primary-button wide" disabled={loading} type="submit">{loading ? 'Подождите…' : mode === 'register' ? 'Создать аккаунт' : mode === 'reset' ? 'Отправить письмо' : 'Войти в Auralis'}<ArrowRight size={16}/></button></form>{mode !== 'register' && <button className="text-button forgot-button" onClick={() => setMode(mode === 'reset' ? 'login' : 'reset')}>{mode === 'reset' ? 'Вернуться ко входу' : 'Не помню пароль'}</button>}<p className="caption">Аккаунт Auralis не заменяет лицензию Minecraft.</p></>}</section>;
}
