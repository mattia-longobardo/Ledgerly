import type { AuditInput } from "@/platform/audit/record";
import type { Permission } from "@/platform/auth/permissions";

/**
 * A token as everything above the repository sees it.
 *
 * There is deliberately no `tokenHash` field: the hash is written once, by
 * `create`, and read only by `authenticateToken` straight off the table. A
 * port that carried it would put the one stored secret on the path to the
 * wire, the audit log and the page.
 */
export interface TokenRecord {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  scopes: Permission[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface NewToken {
  userId: string;
  name: string;
  prefix: string;
  /** sha256 hex of the full token. The only place this type appears. */
  tokenHash: string;
  scopes: Permission[];
  expiresAt: Date | null;
}

export interface TokensRepository {
  /** Newest first. */
  list(userId: string): Promise<TokenRecord[]>;
  create(input: NewToken): Promise<TokenRecord>;
  /**
   * Stamps `revoked_at`, returning the row it changed or `null` when there
   * was nothing to change — a wrong id, someone else's token, or one that was
   * already revoked. The caller turns `null` into a 404 rather than reporting
   * a revocation that never happened.
   */
  revoke(userId: string, id: string, at: Date): Promise<TokenRecord | null>;
}

export interface Clock {
  now(): Date;
}

export interface UseCaseDeps {
  tokens: TokensRepository;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}
