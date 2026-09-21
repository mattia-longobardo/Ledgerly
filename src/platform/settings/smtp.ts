import { z } from "zod";

/**
 * The outgoing mail settings (spec §9.4), as pure rules. The design offers three encryptions
 * rather than nodemailer's two booleans, because "SSL/TLS · STARTTLS · None" is what an admin
 * reads on their provider's help page; {@link transportFlags} is the only translation between them.
 */

export const ENCRYPTIONS = ["ssl", "starttls", "none"] as const;
export type Encryption = (typeof ENCRYPTIONS)[number];

/** nodemailer's two switches: `secure` opens the socket in TLS, `requireTLS` demands STARTTLS. */
export function transportFlags(encryption: Encryption): { secure: boolean; requireTLS: boolean } {
  return {
    secure: encryption === "ssl",
    requireTLS: encryption === "starttls",
  };
}

/** The same mapping backwards, for the initial value read from `SMTP_SECURE`/`SMTP_REQUIRE_TLS`. */
export function encryptionFrom(flags: { secure: boolean; requireTLS: boolean }): Encryption {
  if (flags.secure) return "ssl";
  return flags.requireTLS ? "starttls" : "none";
}

/**
 * The three switches of the SMTP card. They decide whether a *category* of mail leaves at all:
 * a user's own preference still applies on top of them.
 *
 * `invitations` covers the password reset link as well, which is the one setting here that can
 * lock a person out of their own account; the card says so beside the switch.
 */
export interface MailPolicy {
  invitations: boolean;
  syncAlerts: boolean;
  monthlySummary: boolean;
}

export type MailCategory = keyof MailPolicy;

/** Nothing configured yet means nothing switched off: an instance on `.env.homelab` sends. */
export const DEFAULT_MAIL_POLICY: Readonly<MailPolicy> = Object.freeze({
  invitations: true,
  syncAlerts: true,
  monthlySummary: true,
});

/** The policy stored in the settings row, falling back to {@link DEFAULT_MAIL_POLICY} per switch. */
export function mailPolicyFrom(value: Record<string, unknown> | null | undefined): MailPolicy {
  const read = (key: MailCategory) =>
    typeof value?.[key] === "boolean" ? (value[key] as boolean) : DEFAULT_MAIL_POLICY[key];
  return {
    invitations: read("invitations"),
    syncAlerts: read("syncAlerts"),
    monthlySummary: read("monthlySummary"),
  };
}

export const MAX_SMTP_FIELD = 200;

/**
 * What the SMTP card accepts. The password is optional like every other sealed secret: empty keeps
 * the stored one. A username without any encryption is refused for the same reason the environment
 * refuses it — credentials must not travel in plaintext (`envSchema`, spec §9.4).
 */
export const smtpInputSchema = z
  .object({
    host: z.string().trim().min(1).max(MAX_SMTP_FIELD),
    port: z.coerce.number().int().min(1).max(65535),
    encryption: z.enum(ENCRYPTIONS),
    user: z.string().trim().max(MAX_SMTP_FIELD),
    password: z.string().max(MAX_SMTP_FIELD),
    from: z.string().trim().min(3).max(MAX_SMTP_FIELD),
    invitations: z.boolean(),
    syncAlerts: z.boolean(),
    monthlySummary: z.boolean(),
  })
  .refine((input) => input.user === "" || input.encryption !== "none", {
    path: ["encryption"],
    message: "Credentials must not travel in plaintext",
  });

export type SmtpInput = z.infer<typeof smtpInputSchema>;
