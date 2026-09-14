// No `server-only`: one rule for every way a name is set — the `/update-user` hook (auth.ts), the
// updateNameAction Server Action, the invitation form and its action, and the create-admin script —
// so none can drift (a direct API call must be bound by the same rule as the form).
import { z } from "zod";

export const MAX_NAME_LENGTH = 120;

/** Trims surrounding whitespace and bounds the result to 1-MAX_NAME_LENGTH characters. */
export const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
