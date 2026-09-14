// No `server-only`: shared by the `/update-user` hook (auth.ts) and the updateNameAction Server
// Action, so the two can't drift (a direct API call must be bound by the same rule as the form).
import { z } from "zod";

export const MAX_NAME_LENGTH = 120;

/** Trims surrounding whitespace and bounds the result to 1-120 characters. */
export const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);
