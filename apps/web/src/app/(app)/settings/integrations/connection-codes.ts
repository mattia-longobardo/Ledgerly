// src/app/(app)/settings/integrations/connection-codes.ts — what the provider of the core or of
// Investments answered, as a code of the closed list of `/api/v1/connections` (CONNECTION_REFUSALS).
// Pure: the use cases of a connection read it on the server, the row on the client for a provider
// of the core, whose card answers "test" and "history" until R5c.

/** A refusal of a reading as the code whose sentence the row shows. */
export type Refusal = "busy" | "unavailable" | "network" | "notActive" | "pending" | "failed" | string;

/** What the provider of the core or of Investments answered, as a code of the closed list. */
export const CODE_OF_ANSWER: Record<string, Refusal> = {
  rejected: "auth",
  unreachable: "provider_down",
  provider: "invalid_data",
  busy: "busy",
  sync_busy: "busy",
  cooldown: "busy",
  sync_refused: "auth",
  provider_auth: "auth",
  rate_limited: "rate_limited",
  provider_unavailable: "provider_down",
  plugin_down: "unavailable",
  not_active: "notActive",
  not_chosen: "pending",
};

/** The code of what a provider of the core answered; `null` when it went through. */
export const answered = (result: { ok: boolean; error?: string }): Refusal | null =>
  result.ok ? null : (CODE_OF_ANSWER[result.error ?? ""] ?? "failed");
