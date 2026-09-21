import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { settingsBacked, SMTP_TRANSPORT, smtpConfig } from "./settings/config";
import { transportFlags } from "./settings/smtp";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * The transport, built from the saved settings when there are any and from `.env.homelab`
 * otherwise (plan F8 §3.4.3). `settingsBacked` re-reads `smtp.transport`'s `updated_at` at most
 * every 30 s and rebuilds when it moved, so an admin saving in one worker reaches the others
 * within that window; `invalidateMailTransport` closes it immediately for the worker that saved.
 */
const transport = settingsBacked(SMTP_TRANSPORT, async (): Promise<{ from: string; send: Transporter }> => {
  const config = await smtpConfig();
  const { secure, requireTLS } = transportFlags(config.encryption);
  return {
    from: config.from,
    send: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure,
      requireTLS,
      auth: config.user ? { user: config.user, pass: config.password ?? "" } : undefined,
      // Bounded so a stalled SMTP server cannot hang a request indefinitely.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    }),
  };
});

export function invalidateMailTransport(): void {
  transport.invalidate();
}

/** Sends one plain-text email. Never call inside a database transaction. */
export async function sendMail(mail: Mail): Promise<void> {
  const { from, send } = await transport.get();
  await send.sendMail({ from, ...mail });
}
