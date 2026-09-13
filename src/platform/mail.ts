import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { readEnv } from "./env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

let transport: Transporter | undefined;

function getTransport(): Transporter {
  const env = readEnv();
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
  });
  return transport;
}

/** Sends one plain-text email. Never call inside a database transaction. */
export async function sendMail(mail: Mail): Promise<void> {
  await getTransport().sendMail({ from: readEnv().MAIL_FROM, ...mail });
}
