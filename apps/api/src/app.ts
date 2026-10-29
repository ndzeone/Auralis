import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { Prisma, type PrismaClient, type User } from '@prisma/client';
import { z } from 'zod';
import type { Config } from './config.js';
import { createMailer } from './mail.js';
import { decodeSkin, deviceSchema, hashPassword, hashToken, issueAccessToken, newToken, passwordSchema, profileSchema, verifyAccessToken, verifyPassword } from './security.js';

type Auth = { userId: string; sessionId: string };
type AuthedRequest = Request & { auth?: Auth };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const publicUser = (user: Pick<User, 'id' | 'email' | 'username' | 'emailVerifiedAt' | 'createdAt'>) => ({ id: user.id, email: user.email, username: user.username, emailVerifiedAt: user.emailVerifiedAt, createdAt: user.createdAt });
const asyncRoute = (fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };
const DAY = 86400000;
const REFRESH_COOKIE = 'auralis_refresh';

export function createApp(db: PrismaClient, config: Config) {
  const app = express();
  const mailer = createMailer(config);
  const origins = new Set([config.WEB_ORIGIN, config.LAUNCHER_ORIGIN]);
  app.disable('x-powered-by');
  if (config.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin(origin, callback) { callback(null, !origin || origins.has(origin)); }, credentials: true }));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && !origins.has(req.headers.origin)) { res.status(403).json({ error: 'Origin is not allowed' }); return; }
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 400, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests; try again later' } }));
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many authentication attempts; try again later' } });
  app.use('/api/auth', authLimit);

  const cookieOptions = { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/auth', maxAge: 30 * DAY };
  function setRefresh(res: Response, token: string) { res.cookie(REFRESH_COOKIE, token, cookieOptions); }
  function clearRefresh(res: Response) { res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined }); }
  const requireAuth = asyncRoute(async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Authentication required');
    let auth: Auth;
    try { auth = verifyAccessToken(config.JWT_SECRET, header.slice(7)); } catch { throw new HttpError(401, 'Invalid or expired access token'); }
    const session = await db.session.findUnique({ where: { id: auth.sessionId } });
    if (!session || session.userId !== auth.userId || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw new HttpError(401, 'Session expired');
    req.auth = auth;
    next();
  });
  const audit = (userId: string, action: string) => db.auditLog.create({ data: { userId, action } });
  async function openSession(user: User, device: z.infer<typeof deviceSchema>, res: Response) {
    const refreshToken = newToken(), expiresAt = new Date(Date.now() + 30 * DAY);
    const session = await db.session.create({ data: { userId: user.id, deviceId: hashToken(device.deviceId), deviceName: device.deviceName, expiresAt, refreshTokens: { create: { tokenHash: hashToken(refreshToken), expiresAt } } } });
    setRefresh(res, refreshToken);
    return { user: publicUser(user), accessToken: issueAccessToken(config.JWT_SECRET, user.id, session.id), refreshToken, sessionId: session.id };
  }
  async function sendEmailToken(user: User, purpose: 'verify' | 'reset') {
    const token = newToken();
    await db.emailToken.create({ data: { userId: user.id, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + (purpose === 'verify' ? DAY : 30 * 60000)) } });
    const link = new URL(config.WEB_ORIGIN);
    link.searchParams.set('action', purpose);
    link.searchParams.set('token', token);
    await mailer.send(user.email, purpose === 'verify' ? 'Подтвердите email Auralis' : 'Сброс пароля Auralis', `${purpose === 'verify' ? 'Подтвердите email' : 'Установите новый пароль'}: ${link.toString()}\nЕсли вы не отправляли этот запрос, проигнорируйте письмо.`);
  }

  app.get('/api/health', asyncRoute(async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'auralis-api' });
  }));
  app.post('/api/auth/register', asyncRoute(async (req, res) => {
    const input = deviceSchema.extend({ email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), username: z.string().regex(/^[a-zA-Z0-9_]{3,16}$/).transform(v => v.toLowerCase()), password: passwordSchema }).parse(req.body);
    const user = await db.user.create({ data: { email: input.email, username: input.username, passwordHash: await hashPassword(input.password), settings: { create: {} } } });
    await audit(user.id, 'auth.register');
    let emailSent = true;
    try { await sendEmailToken(user, 'verify'); } catch { emailSent = false; }
    res.status(201).json({ ...await openSession(user, input, res), verificationRequired: true, emailSent });
  }));
  // A fixed valid Argon2id hash is computed once to equalize unknown-user checks.
  const dummyPasswordHash = hashPassword(newToken());
  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const input = deviceSchema.extend({ login: z.string().trim().min(1).max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128) }).parse(req.body);
    const user = await db.user.findFirst({ where: { OR: [{ email: input.login }, { username: input.login }] } });
    const valid = await verifyPassword(user?.passwordHash ?? await dummyPasswordHash, input.password);
    if (!user || !valid) throw new HttpError(401, 'Invalid login or password');
    await audit(user.id, 'auth.login');
    res.json(await openSession(user, input, res));
  }));
  app.post('/api/auth/refresh', asyncRoute(async (req, res) => {
    const input = z.object({ deviceId: z.string().min(8).max(128), refreshToken: z.string().min(32).max(256).optional() }).parse(req.body);
    const rawToken: unknown = input.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (typeof rawToken !== 'string') throw new HttpError(401, 'Refresh token required');
    const token = await db.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { session: { include: { user: true } } } });
    if (!token) throw new HttpError(401, 'Invalid refresh token');
    const { session } = token;
    if (session.deviceId !== hashToken(input.deviceId)) throw new HttpError(401, 'Device does not match session');
    if (session.revokedAt || token.expiresAt.getTime() <= Date.now() || session.expiresAt.getTime() <= Date.now()) throw new HttpError(401, 'Session expired');
    if (token.usedAt) {
      await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await audit(session.userId, 'auth.refresh_replay');
      clearRefresh(res);
      throw new HttpError(401, 'Refresh token replay; session revoked');
    }
    const replacement = newToken();
    const rotated = await db.$transaction(async tx => {
      const claimed = await tx.refreshToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!claimed.count) return false;
      await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: hashToken(replacement), expiresAt: session.expiresAt } });
      await tx.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
      return true;
    });
    if (!rotated) { await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }); throw new HttpError(401, 'Refresh token already used; session revoked'); }
    setRefresh(res, replacement);
    res.json({ user: publicUser(session.user), accessToken: issueAccessToken(config.JWT_SECRET, session.userId, session.id), refreshToken: replacement, sessionId: session.id });
  }));
  app.post('/api/auth/logout', requireAuth, asyncRoute(async (req, res) => {
    await db.session.update({ where: { id: req.auth!.sessionId }, data: { revokedAt: new Date() } });
    clearRefresh(res);
    res.status(204).end();
  }));
  app.post('/api/auth/resend-verification', requireAuth, asyncRoute(async (req, res) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (!user.emailVerifiedAt) await sendEmailToken(user, 'verify');
    res.json({ ok: true });
  }));
  app.post('/api/auth/verify-email', asyncRoute(async (req, res) => {
    const { token: rawToken } = z.object({ token: z.string().min(32).max(256) }).parse(req.body);
    const token = await db.emailToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
    if (!token || token.purpose !== 'verify' || token.usedAt || token.expiresAt.getTime() <= Date.now()) throw new HttpError(400, 'Verification link is invalid or expired');
    await db.$transaction(async tx => {
      const claim = await tx.emailToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!claim.count) throw new HttpError(400, 'Verification link already used');
      await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: new Date() } });
    });
    await audit(token.userId, 'auth.email_verified');
    res.json({ ok: true });
  }));
  app.post('/api/auth/forgot-password', asyncRoute(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().email().transform(v => v.toLowerCase()) }).parse(req.body);
    const user = await db.user.findUnique({ where: { email } });
    if (user) { try { await sendEmailToken(user, 'reset'); } catch { /* Do not reveal account existence or mail configuration. */ } }
    res.json({ ok: true, message: 'If this account exists, a reset email has been sent' });
  }));
  app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
    const input = z.object({ token: z.string().min(32).max(256), password: passwordSchema }).parse(req.body);
    const token = await db.emailToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
    if (!token || token.purpose !== 'reset' || token.usedAt || token.expiresAt.getTime() <= Date.now()) throw new HttpError(400, 'Reset link is invalid or expired');
    const passwordHash = await hashPassword(input.password);
    await db.$transaction(async tx => {
      const claim = await tx.emailToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!claim.count) throw new HttpError(400, 'Reset link already used');
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
      await tx.session.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.emailToken.updateMany({ where: { userId: token.userId, purpose: 'reset', usedAt: null }, data: { usedAt: new Date() } });
    });
    clearRefresh(res);
    await audit(token.userId, 'auth.password_reset');
    res.json({ ok: true });
  }));

  app.get('/api/me', requireAuth, asyncRoute(async (req, res) => {
    const user = await db.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, include: { settings: true, skin: { select: { id: true, model: true } } } });
    res.json({ user: { ...publicUser(user), settings: user.settings ?? { theme: 'aurora', language: 'ru' }, skin: user.skin ? { ...user.skin, url: `/api/media/skins/${user.skin.id}.png` } : null } });
  }));
  app.patch('/api/me/settings', requireAuth, asyncRoute(async (req, res) => {
    const input = z.object({ theme: z.enum(['aurora', 'midnight', 'ember', 'forest', 'light']).optional(), language: z.enum(['ru', 'en']).optional() }).strict().parse(req.body);
    const settings = await db.userSettings.upsert({ where: { userId: req.auth!.userId }, create: { userId: req.auth!.userId, ...input }, update: input });
    res.json({ settings });
  }));
  app.get('/api/me/sessions', requireAuth, asyncRoute(async (req, res) => {
    const sessions = await db.session.findMany({ where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: 'desc' }, select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true, expiresAt: true } });
    res.json({ sessions: sessions.map(s => ({ ...s, current: s.id === req.auth!.sessionId })) });
  }));
  app.delete('/api/me/sessions/:id', requireAuth, asyncRoute(async (req, res) => {
    const result = await db.session.updateMany({ where: { id: req.params.id, userId: req.auth!.userId }, data: { revokedAt: new Date() } });
    if (!result.count) throw new HttpError(404, 'Session not found');
    await audit(req.auth!.userId, 'auth.session_revoked');
    res.status(204).end();
  }));
  app.patch('/api/me/password', requireAuth, asyncRoute(async (req, res) => {
    const input = z.object({ currentPassword: z.string().max(128), password: passwordSchema }).parse(req.body);
    const user = await db.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (!await verifyPassword(user.passwordHash, input.currentPassword)) throw new HttpError(401, 'Current password is incorrect');
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.password) } }),
      db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    clearRefresh(res);
    await audit(user.id, 'auth.password_changed');
    res.status(204).end();
  }));
  app.put('/api/me/skin', requireAuth, asyncRoute(async (req, res) => {
    const input = z.object({ dataUrl: z.string().max(90000), model: z.enum(['classic', 'slim']).default('classic') }).parse(req.body);
    let png: Buffer;
    try { png = decodeSkin(input.dataUrl); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Invalid PNG'); }
    const bytes = new Uint8Array(png);
    const skin = await db.skin.upsert({ where: { userId: req.auth!.userId }, create: { userId: req.auth!.userId, png: bytes, sha256: hashToken(png), model: input.model }, update: { png: bytes, sha256: hashToken(png), model: input.model } });
    res.json({ skin: { id: skin.id, model: skin.model, url: `/api/media/skins/${skin.id}.png` } });
  }));
  app.get('/api/media/skins/:id.png', asyncRoute(async (req, res) => {
    const skin = await db.skin.findUnique({ where: { id: req.params.id } });
    if (!skin) throw new HttpError(404, 'Skin not found');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.type('image/png').send(Buffer.from(skin.png));
  }));
  app.get('/api/profiles', requireAuth, asyncRoute(async (req, res) => { res.json({ profiles: await db.profile.findMany({ where: { userId: req.auth!.userId }, orderBy: { createdAt: 'asc' } }) }); }));
  app.post('/api/profiles', requireAuth, asyncRoute(async (req, res) => {
    const input = profileSchema.parse(req.body);
    const count = await db.profile.count({ where: { userId: req.auth!.userId } });
    if (count >= 50) throw new HttpError(400, 'Maximum 50 profiles');
    res.status(201).json({ profile: await db.profile.create({ data: { userId: req.auth!.userId, ...input } }) });
  }));
  app.put('/api/profiles/:id', requireAuth, asyncRoute(async (req, res) => {
    const input = profileSchema.parse(req.body);
    const found = await db.profile.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!found) throw new HttpError(404, 'Profile not found');
    res.json({ profile: await db.profile.update({ where: { id: found.id }, data: input }) });
  }));
  app.delete('/api/profiles/:id', requireAuth, asyncRoute(async (req, res) => {
    const result = await db.profile.deleteMany({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!result.count) throw new HttpError(404, 'Profile not found');
    res.status(204).end();
  }));
  app.get('/api/news', asyncRoute(async (_req, res) => { res.json({ news: await db.news.findMany({ where: { publishedAt: { lte: new Date() } }, orderBy: { publishedAt: 'desc' }, take: 20 }) }); }));
  if (config.NODE_ENV !== 'production' && config.DEV_MAILBOX === 'true') {
    app.get('/api/dev/mailbox', (req, res) => {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) { res.status(403).json({ error: 'Local development only' }); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ messages: mailer.previews });
    });
  }
  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid request', issues: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') { res.status(409).json({ error: 'Email, username, or profile name already exists' }); return; }
    if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: 'Invalid JSON' }); return; }
    if (error instanceof Error && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'Request body is too large' }); return; }
    console.error('API request failed:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}
