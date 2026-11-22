import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { readEnv } from "../../../platform/env";

/**
 * The signed address of a payslip's original (UI-PAY-2, rewrite plan R4): the person's own document,
 * for five minutes, to whoever holds the address. The signature binds the document, the person and
 * the expiry; the key comes from `BETTER_AUTH_SECRET` (HKDF), so rotating that secret voids every
 * link. A link is asked again at every opening: it is never stored.
 */
const LINK_TTL_SECONDS = 5 * 60;

const INFO = "ledgerly/original-url/v1";
// What an id of the database looks like: a document's uuid, Better Auth's user id.
const DB_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface LinkClaims {
  documentId: string;
  userId: string;
  /** Seconds since the epoch. */
  expiresAt: number;
}

export type LinkCheck =
  { ok: true; claims: LinkClaims } | { ok: false; reason: "link_invalid" | "link_expired" };

/** The key of the links, derived from the server's secret and never the secret itself. */
export function linkKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32));
}

const mac = (key: Buffer, payload: string) => createHmac("sha256", key).update(payload).digest();

/** The token of the address `/api/v1/originals/<token>`. */
export function signLink(key: Buffer, claims: LinkClaims): string {
  const payload = Buffer.from(`${claims.documentId}.${claims.userId}.${claims.expiresAt}`).toString(
    "base64url",
  );
  return `${payload}.${mac(key, payload).toString("base64url")}`;
}

/**
 * Reads a token: a signature that does not match, in constant time, or a token of another shape is
 * `link_invalid`; a good one past its expiry is `link_expired`. Nothing about which part failed.
 */
/** The claims of a payload whose signature already matched, or null for one of another shape. */
function claimsOf(payload: string): LinkClaims | null {
  const [documentId, userId, expiry, ...more] = Buffer.from(payload, "base64url").toString().split(".");
  const expiresAt = Number(expiry);
  const shaped = more.length === 0 && DB_ID.test(documentId ?? "") && DB_ID.test(userId ?? "");
  return shaped && Number.isSafeInteger(expiresAt) ? { documentId, userId, expiresAt } : null;
}

/**
 * Reads a token: a signature that does not match, in constant time, or a token of another shape is
 * `link_invalid`; a good one past its expiry is `link_expired`. Nothing about which part failed.
 */
export function checkLink(key: Buffer, token: string, nowSeconds: number): LinkCheck {
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return { ok: false, reason: "link_invalid" };
  const expected = mac(key, payload);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "link_invalid" };
  }
  const claims = claimsOf(payload);
  if (!claims) return { ok: false, reason: "link_invalid" };
  if (nowSeconds >= claims.expiresAt) return { ok: false, reason: "link_expired" };
  return { ok: true, claims };
}

const serverKey = () => linkKey(readEnv().BETTER_AUTH_SECRET);

/** The token of a document's original for its person, and when it stops opening. */
export function originalLinkFor(
  documentId: string,
  userId: string,
  now: Date = new Date(),
): { token: string; expiresAt: Date } {
  const expiresAt = Math.floor(now.getTime() / 1000) + LINK_TTL_SECONDS;
  return {
    token: signLink(serverKey(), { documentId, userId, expiresAt }),
    expiresAt: new Date(expiresAt * 1000),
  };
}

/** What a token of `/api/v1/originals/<token>` says, with the server's key. */
export function checkOriginalLink(token: string, now: Date = new Date()): LinkCheck {
  return checkLink(serverKey(), token, Math.floor(now.getTime() / 1000));
}
