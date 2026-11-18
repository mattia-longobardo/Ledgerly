// The two refusals that keep an instance governable (spec §7.10): pure rules of Admin › Users,
// next to the use cases that apply them (`people.ts`).
import type { Role } from "../context";

/* Admin › Users (spec §7.10) — the two refusals that keep an instance governable. */

export type PersonAction = "demote" | "block" | "remove";

export type PersonRefusal = "self" | "last_admin";

/**
 * Why an admin action on a person must be refused, or null when it may go ahead.
 *
 * 1. **The last admin is untouchable.** Removing their role, blocking them or deleting them leaves
 *    an instance nobody can administer, and the only repair is a shell in the container. A screen
 *    that lets someone wall themselves out is a defect, not a feature (plan F8 §3.4.1).
 * 2. **Nobody blocks or removes themselves.** Both are one-way doors taken by accident; a second
 *    admin can always do it on their behalf, which is exactly the review that makes it safe.
 *
 * Demoting *yourself* is allowed while another admin remains: it is reversible by that admin, and
 * an admin who no longer wants the role should not have to ask someone else for it.
 */
export function personActionRefusal(
  action: PersonAction,
  input: { actorId: string; targetId: string; targetRole: Role; adminCount: number },
): PersonRefusal | null {
  const { actorId, targetId, targetRole, adminCount } = input;
  if (targetRole === "admin" && adminCount <= 1) return "last_admin";
  if (actorId === targetId && action !== "demote") return "self";
  return null;
}
