import { generateToken } from "@/platform/auth/pat";
import { PERMISSIONS, type Permission } from "@/platform/auth/permissions";
import type { Principal } from "@/platform/auth/principal";
import { InvalidInputError } from "./errors";
import type { TokenRecord, UseCaseDeps } from "./ports";

export interface CreateTokenInput {
  name: string;
  scopes: readonly Permission[];
  expiresAt?: Date | null;
}

const MAX_NAME_LENGTH = 80;

/**
 * Mint one personal access token.
 *
 * No `assertPermission`: a token can only ever grant what its owner already
 * has, so managing one's own tokens is not a privilege on top of being an
 * active user. The scope check below is what keeps that true — scopes must be
 * a subset of the caller's **current** permissions (R8-5); the live
 * re-intersection in `authenticateToken` keeps it true afterwards.
 *
 * The plain token is returned to exactly one caller and is never written
 * anywhere: not to the row (which keeps the sha256), not to the audit detail,
 * not to a log line.
 */
export function createToken(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    input: CreateTokenInput,
  ): Promise<{ token: string; record: TokenRecord }> => {
    const name = input.name.trim();
    if (name === "") throw new InvalidInputError("Give the token a name.");
    if (name.length > MAX_NAME_LENGTH) {
      throw new InvalidInputError(`A token name is at most ${MAX_NAME_LENGTH} characters.`);
    }

    // Duplicates in the request would otherwise be stored, and then shown, as
    // duplicates; the set also makes the subset check below order-independent.
    const scopes = [...new Set(input.scopes)];
    if (scopes.length === 0) throw new InvalidInputError("Pick at least one scope.");
    const unknown = scopes.filter((s) => !(PERMISSIONS as readonly string[]).includes(s));
    if (unknown.length > 0) throw new InvalidInputError(`No such permission: ${unknown.join(", ")}.`);
    const beyond = scopes.filter((s) => !principal.permissions.has(s));
    if (beyond.length > 0) {
      throw new InvalidInputError(`You do not hold these permissions: ${beyond.join(", ")}.`);
    }

    const expiresAt = input.expiresAt ?? null;
    if (expiresAt !== null) {
      if (Number.isNaN(expiresAt.getTime())) throw new InvalidInputError("That is not a real date.");
      if (expiresAt.getTime() <= deps.clock.now().getTime()) {
        throw new InvalidInputError("The expiry date must be in the future.");
      }
    }

    const { token, prefix, hash } = generateToken();
    const record = await deps.tokens.create({
      userId: principal.userId,
      name,
      prefix,
      tokenHash: hash,
      scopes,
      expiresAt,
    });

    await deps.audit({
      actorUserId: principal.userId,
      action: "security.token_created",
      entityType: "personal_access_token",
      entityId: record.id,
      // Name, prefix, scopes and expiry — enough to recognise the token in the
      // log, and nothing that could be replayed as one. Never `token`, never
      // `tokenHash`.
      after: {
        name: record.name,
        prefix: record.prefix,
        scopes: record.scopes,
        expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
      },
    });

    return { token, record };
  };
}
