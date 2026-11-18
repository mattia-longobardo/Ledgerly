// The person's own profile (rewrite plan R2): who they are, and the name they may change unless the
// identity provider manages it (spec §5.1). Used by the Profile form and by `/api/v1/profile`.
import { eq } from "drizzle-orm";
import { hasSsoAccount } from "./accounts";
import { nameSchema } from "./name-policy";
import { users } from "./schema";
import type { Ctx } from "../context";
import { getDb } from "../db/client";

interface Profile {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  /** The identity provider manages name and email (spec §5.1). */
  managedByProvider: boolean;
  twoFactor: boolean;
}

export async function profileOf(ctx: Pick<Ctx, "userId">): Promise<Profile> {
  const [row] = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      twoFactor: users.twoFactorEnabled,
    })
    .from(users)
    .where(eq(users.id, ctx.userId));
  if (!row) throw new Error("the person of the context does not exist");
  return {
    ...row,
    role: row.role === "admin" ? "admin" : "user",
    managedByProvider: await hasSsoAccount(ctx.userId),
  };
}

export class ProfileError extends Error {
  constructor(readonly code: "sso" | "invalid") {
    super(code);
    this.name = "ProfileError";
  }
}

/** Writes the name of the row; the web passes Better Auth's own `updateUser`, inside the session. */
type NameWriter = (name: string) => Promise<unknown>;

/**
 * Renames the person; refused when the identity provider manages the name (spec §5.1). The rules
 * are one for the Profile form and for `PATCH /api/v1/profile`; only the writer of the row differs.
 */
export async function renameProfile(
  ctx: Pick<Ctx, "userId">,
  name: unknown,
  write: NameWriter = (valid) =>
    getDb().update(users).set({ name: valid, updatedAt: new Date() }).where(eq(users.id, ctx.userId)),
): Promise<void> {
  if (await hasSsoAccount(ctx.userId)) throw new ProfileError("sso");
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) throw new ProfileError("invalid");
  await write(parsed.data);
}
