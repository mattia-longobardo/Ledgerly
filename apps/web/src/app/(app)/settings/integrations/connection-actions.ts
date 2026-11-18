// src/app/(app)/settings/integrations/connection-actions.ts — the Server Action of a connection's
// row: the session and the use case of `connection-cases.ts` (which `/api/v1/connections` calls
// too), then the sentence the row shows.
"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { codeKey } from "@ledgerly/domain/platform/integrations";
import { requireSession } from "@/platform/auth/session";
import { labelOf } from "@/platform/integrations/registry";
import { requestPresence } from "../../banks/presence";
import { coreConnectionAction } from "./actions";
import { CONNECTION_KINDS, type ConnectionKind, type Refusal, runConnection } from "./connection-cases";

type ConnectionActionResult = { ok: true; toast: string | null } | { ok: false; message: string };

function revalidate(): void {
  revalidatePath("/settings/integrations", "layout");
  revalidatePath("/settings/integrations/advanced");
  revalidatePath("/timeoff/settings");
  revalidatePath("/accounts", "layout");
}

const isKind = (kind: string): kind is ConnectionKind => CONNECTION_KINDS.some((one) => one === kind);

/** The toast of each kind that went through. */
const TOAST = {
  update: "toasts.started",
  resume: "toasts.resumed",
  enable: "toasts.enabled",
  test: "toasts.tested",
  history: "toasts.historyRead",
} as const;

/**
 * Does one thing to one of the person's connections: "Update now", "Turn on again" (the
 * provider's recommended schedule, decision Q5), "Turn on" (the provider itself, decision H30),
 * "Test the connection" or "Download the history again".
 */
export async function runConnectionAction(
  connectionId: string,
  kind: string,
  /** For "history": how many months back the provider is read again. */
  months?: number,
): Promise<ConnectionActionResult> {
  const ctx = await requireSession();
  const t = await getTranslations("settings.connections");
  const failed: ConnectionActionResult = { ok: false, message: t("codes.failed") };
  if (!isKind(kind)) return failed;

  let outcome: Awaited<ReturnType<typeof runConnection>>;
  try {
    outcome = await runConnection(ctx, connectionId, kind, {
      months,
      presence: await requestPresence(),
      core: coreConnectionAction,
    });
  } catch (error) {
    console.error("[connections] an action failed", redactForLog(error));
    return failed;
  }
  if (kind !== "update") revalidate();
  if (!outcome.connection) return failed;
  const label = await labelOf(outcome.connection, ctx.locale);
  const names = { name: label.name, provider: label.provider };
  if (outcome.ok) return { ok: true, toast: t(TOAST[kind], names) };

  /** A refusal's sentence, one branch per code so the catalogue keys stay literal. */
  const code: Refusal = outcome.refusal;
  if (code === "busy") return { ok: false, message: t("codes.busy") };
  if (code === "unavailable") return { ok: false, message: t("codes.unavailable") };
  if (code === "notActive") return { ok: false, message: t("text.pausedProvider", names) };
  if (code === "pending") return { ok: false, message: t("text.pending") };
  return { ok: false, message: t(`codes.${codeKey(code)}`, names) };
}
