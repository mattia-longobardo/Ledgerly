// What the descriptors of users and settings share: no route is declared here.
import { z } from "zod";
import { id } from "../primitives";

const CATEGORY_TYPES = ["income", "expense"] as const;
export const categoryType = z.enum(CATEGORY_TYPES);
export const CATEGORY_ID = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f";
/** A refusal of the taxonomy: `duplicate`, `invalid`, `invalid_parent` (`reason` of `invalid`/`conflict`). */
export const TAXONOMY_ERRORS = ["invalid", "not_found", "conflict"] as const;
export const CONNECTION_ID = "4b3a2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d";
/** The refusals of a provider or of the state of the connection. */
export const CONNECTION_ERRORS = ["invalid", "not_found", "conflict"] as const;
/**
 * The closed list of `reason`s a run of a connection (sync, test, history, resume, enable) answers
 * with: the client writes the sentence from its own catalogue, as the Server Action did.
 */
export const CONNECTION_REFUSALS = [
  "busy",
  "unavailable",
  "not_active",
  "pending",
  "auth",
  "consent_expired",
  "rate_limited",
  "provider_down",
  "invalid_data",
  "failed",
] as const;
export const byId = z.object({ id: id() });
