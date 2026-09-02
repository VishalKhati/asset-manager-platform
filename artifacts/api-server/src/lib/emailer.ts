/**
 * Email sender using nodemailer with user-supplied SMTP credentials.
 * Returns true on success, false on failure (never throws).
 */

import nodemailer from "nodemailer";

export interface SmtpConfig {
  host:  string;
  port:  number;
  user:  string;
  pass:  string;
  to:    string;
}

export async function sendEmail(cfg: SmtpConfig, subject: string, html: string): Promise<boolean> {
  if (!cfg.host || !cfg.user || !cfg.pass || !cfg.to) return false;
  try {
    const transporter = nodemailer.createTransport({
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.port === 465,
      auth:   { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 8_000,
    });
    await transporter.sendMail({
      from:    `"SMC Bot" <${cfg.user}>`,
      to:      cfg.to,
      subject,
      html,
    });
    return true;
  } catch {
    return false;
  }
}
