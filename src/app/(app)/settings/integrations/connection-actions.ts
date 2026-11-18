// src/app/(app)/settings/integrations/connection-actions.ts — the one Server Action of the row of
// a connection (ux/n2-connection-status.md §2.4). A thin wrapper: it finds who owns the
// connection's provider and asks them; the rules are theirs.
//
// The id comes from the browser and is read only among the signed-in person's own connections.
// The answer is a sentence or a toast: no credential and nothing a provider said.
"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import "@/app/plugin-wiring";
import { syncNowAction } from "@/modules/investments/actions";
import { providerOf } from "@ledgerly/domain/investments";
import { listInvestmentAccounts } from "@ledgerly/domain/investments";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { requireSession } from "@/platform/auth/session";
import { labelOf, passFor } from "@/platform/integrations/registry";
import { isPluginProvider } from "@ledgerly/domain/platform/integrations";
import {
  type Connection,
  findConnection,
  IntegrationError,
  makeDueNow,
  saveSchedule,
} from "@ledgerly/domain/platform/integrations";
import { codeKey } from "@ledgerly/domain/platform/integrations";
import { runAfterSync } from "@/platform/jobs/after-sync";
import { BANK_SCHEDULE } from "@ledgerly/domain/platform/plugins";
import { PluginActionError, setPluginActive } from "@/platform/plugins/service";
import { readBank } from "@/platform/plugins/sync";
import { requestPresence } from "../../banks/presence";
import { bankSink } from "../../banks/sink";
import { coreConnectionAction } from "./actions";
import { recommendedSchedule } from "./recommended-schedule";

export type ConnectionActionResult = { ok: true; toast: string | null } | { ok: false; message: string };

/** The kinds this action does itself; the others are a page or a dialog of the row's parent. */
type Kind = "update" | "resume" | "enable" | "test" | "history";

const pluginIdOf = (provider: string) => provider.slice("plugin:".length);

/** A refusal of a reading as the code whose sentence the row shows. */
type Refusal = "busy" | "unavailable" | "network" | "notActive" | "pending" | "failed" | string;

/** What the provider of the core or of Investments answered, as a code of the closed list. */
const CODE_OF_ANSWER: Record<string, Refusal> = {
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

function revalidate(): void {
  revalidatePath("/settings/integrations", "layout");
  revalidatePath("/settings/integrations/advanced");
  revalidatePath("/timeoff/settings");
  revalidatePath("/accounts", "layout");
}

/** "Update now": a reading the person asked for, by whoever owns the provider. */
async function update(
  ctx: Awaited<ReturnType<typeof requireSession>>,
  connection: Connection,
): Promise<{ created: number } | { refusal: Refusal }> {
  if (isPluginProvider(connection.provider)) {
    const outcome = await readBank(
      ctx,
      {
        pluginId: pluginIdOf(connection.provider),
        connectionId: connection.id,
        presence: await requestPresence(),
      },
      bankSink,
    );
    if (!outcome.ok) return { refusal: CODE_OF_ANSWER[outcome.error] ?? outcome.error };
    if (outcome.created + outcome.updated > 0) await runAfterSync("manual");
    return { created: outcome.created };
  }
  if (providerOf(connection.provider) !== null) {
    const service = (await listInvestmentAccounts(ctx)).find((one) => one.provider === connection.provider);
    if (!service) return { refusal: "failed" };
    const result = await syncNowAction(service.accountId);
    return result.ok ? { created: 0 } : { refusal: CODE_OF_ANSWER[result.error] ?? "failed" };
  }
  const result = await coreConnectionAction(connection.provider, "update");
  return result.ok ? { created: 0 } : { refusal: CODE_OF_ANSWER[result.error] ?? "failed" };
}

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
  const connection = await findConnection(ctx, connectionId);
  if (!connection) return failed;
  const label = await labelOf(connection, ctx.locale);
  const names = { name: label.name, provider: label.provider };

  /** A refusal's sentence, one branch per code so the catalogue keys stay literal. */
  const refused = (code: Refusal): ConnectionActionResult => {
    if (code === "busy") return { ok: false, message: t("codes.busy") };
    if (code === "unavailable") return { ok: false, message: t("codes.unavailable") };
    if (code === "notActive") return { ok: false, message: t("text.pausedProvider", names) };
    if (code === "pending") return { ok: false, message: t("text.pending") };
    return { ok: false, message: t(`codes.${codeKey(code)}`, names) };
  };

  try {
    switch (kind as Kind) {
      case "update": {
        const outcome = await update(ctx, connection);
        revalidate();
        if ("refusal" in outcome) return refused(outcome.refusal);
        return {
          ok: true,
          toast:
            outcome.created > 0 ? t("toasts.updatedNew", { count: outcome.created }) : t("toasts.updated"),
        };
      }
      case "resume": {
        const schedule = isPluginProvider(connection.provider)
          ? BANK_SCHEDULE
          : recommendedSchedule(connection.provider);
        await saveSchedule(ctx, connection.id, schedule);
        revalidate();
        return { ok: true, toast: t("toasts.resumed") };
      }
      case "enable": {
        if (!isPluginProvider(connection.provider)) return failed;
        await setPluginActive(ctx, { pluginId: pluginIdOf(connection.provider), active: true });
        // A reading for each of its connections: they are due now, and the next tick of the
        // dispatcher reads them.
        await makeDueNow(ctx, connection.provider);
        revalidate();
        return { ok: true, toast: t("toasts.enabled", names) };
      }
      case "test": {
        const result = await coreConnectionAction(connection.provider, "test");
        revalidate();
        return result.ok
          ? { ok: true, toast: t("toasts.tested", names) }
          : refused(CODE_OF_ANSWER[result.error] ?? "failed");
      }
      case "history": {
        // "Download the history again": only for a provider that reads a chosen depth.
        const choices = passFor(connection.provider)?.history?.choices ?? [];
        if (months === undefined || !choices.includes(months)) return failed;
        const result = await coreConnectionAction(connection.provider, "history", months);
        revalidate();
        return result.ok
          ? { ok: true, toast: t("toasts.historyRead") }
          : refused(CODE_OF_ANSWER[result.error] ?? "failed");
      }
      default:
        return failed;
    }
  } catch (error) {
    if (error instanceof PluginActionError) return refused(CODE_OF_ANSWER[error.code] ?? error.code);
    if (error instanceof IntegrationError) return failed;
    console.error("[connections] an action failed", redactForLog(error));
    return failed;
  }
}
