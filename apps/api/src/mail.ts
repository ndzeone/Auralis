import nodemailer from 'nodemailer';
import type { Config } from './config.js';

export type MailPreview = { to: string; subject: string; text: string; createdAt: string };
export function createMailer(config: Config) {
  const previews: MailPreview[] = [];
  const transport = config.SMTP_HOST ? nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    requireTLS: config.SMTP_PORT !== 465,
    auth: config.SMTP_USER && config.SMTP_PASSWORD ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
  }) : undefined;
  return {
    previews,
    async send(to: string, subject: string, text: string) {
      if (transport) {
        await transport.sendMail({ from: config.SMTP_FROM, to, subject, text });
      } else if (config.NODE_ENV !== 'production' && config.DEV_MAILBOX === 'true') {
        previews.push({ to, subject, text, createdAt: new Date().toISOString() });
        if (previews.length > 50) previews.shift();
      } else {
        throw new Error('Email delivery is not configured');
      }
    },
  };
}
