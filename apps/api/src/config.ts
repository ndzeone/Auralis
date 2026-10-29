import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().default('postgresql://auralis:auralis_local_only@localhost:5432/auralis'),
  JWT_SECRET: z.string().min(32).optional(),
  WEB_ORIGIN: z.string().url().default('http://localhost:5174'),
  LAUNCHER_ORIGIN: z.string().url().default('http://localhost:5173'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('Auralis <noreply@localhost>'),
  DEV_MAILBOX: z.enum(['true', 'false']).default('false'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});

export function loadConfig(input: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(input);
  if (env.NODE_ENV === 'production' && !env.JWT_SECRET) throw new Error('JWT_SECRET (32+ characters) is required in production');
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST) throw new Error('SMTP_HOST is required in production for verification and password recovery');
  if (env.NODE_ENV === 'production' && env.DEV_MAILBOX === 'true') throw new Error('DEV_MAILBOX must be disabled in production');
  return { ...env, JWT_SECRET: env.JWT_SECRET ?? randomBytes(48).toString('base64url') };
}

export type Config = ReturnType<typeof loadConfig>;
