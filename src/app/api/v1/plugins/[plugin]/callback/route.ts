// src/app/api/v1/plugins/[plugin]/callback/route.ts — where a provider sends the browser back
// after the person gave, or refused, access (rewrite plan, 04-now.md §4.1; ux/n1-plugin-bank.md
// §6.3). It draws nothing: it hands the return to the core and answers with a redirect, so nobody
// copies a code by hand.
//
// The route is under `/api/v1` because that is the address registered with the provider, but it
// is not part of the token API: it is reached by a browser, with the session cookie, and the
// return is accepted only for the session that started it.
import { type NextRequest, NextResponse } from "next/server";
import { redactForLog } from "@/platform/auth/logger";
import { getOptionalSession } from "@/platform/auth/session";
import { readEnv } from "@/platform/env";
import { PLUGIN_ID } from "@/platform/plugins/contract/manifest";
import { completeAccess, type ReturnOutcome } from "@/platform/plugins/service";
import { exposedAccounts, readBank, tieBack } from "@/platform/plugins/sync";
import { presenceOf } from "@/app/(app)/banks/presence";
import { bankSink } from "@/app/(app)/banks/sink";

export const dynamic = "force-dynamic";

const MAX_PARAM_LENGTH = 2000;

/** A query parameter, or null when it is absent, empty or longer than anything a provider sends. */
function param(url: URL, name: string): string | null {
  const value = url.searchParams.get(name);
  return value === null || value === "" || value.length > MAX_PARAM_LENGTH ? null : value;
}

/**
 * Back to the procedure, with nothing of the provider in the address: a step, the connection's
 * id, or a code of error and the name of the bank (§6.3).
 */
function back(outcome: ReturnOutcome, step: "accounts" | "done" = "accounts"): NextResponse {
  const target = new URL("/banks/connect", readEnv().BETTER_AUTH_URL);
  if (outcome.ok) {
    target.searchParams.set("step", step);
    target.searchParams.set("c", outcome.connectionId);
    if (step === "done" && outcome.renewed) target.searchParams.set("renewed", "1");
  } else {
    target.searchParams.set("step", "bank");
    target.searchParams.set("error", outcome.error);
    if (outcome.bank !== null) target.searchParams.set("bank", outcome.bank);
  }
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/v1/plugins/[plugin]/callback">,
): Promise<NextResponse> {
  const { plugin } = await context.params;
  const session = await getOptionalSession();
  // No session: the page behind this redirect sends to sign-in, and nothing was exchanged.
  if (!session || !PLUGIN_ID.test(plugin)) return back({ ok: false, error: "session", bank: null });
  const url = new URL(request.url);
  const presence = presenceOf(request.headers);
  try {
    const outcome = await completeAccess(session.ctx, {
      pluginId: plugin,
      sessionId: session.sessionId,
      query: { state: param(url, "state"), code: param(url, "code"), error: param(url, "error") },
      presence,
    });
    // A first access goes to the choice of the accounts, at once: the bank gives its full history
    // only in the first minutes. A renewed one, or a bank connected again whose accounts are still
    // tied here, reads the bank now and shows the outcome — unless the bank exposes an account the
    // person has not been asked about yet (§6.7).
    if (!outcome.ok) return back(outcome);
    const target = { pluginId: plugin, connectionId: outcome.connectionId };
    if (!outcome.renewed && !(await tieBack(session.ctx, target, bankSink))) return back(outcome);
    const exposed = await exposedAccounts(session.ctx, target, bankSink);
    const unasked = exposed.accounts.some(
      (account) => account.linked === null && !exposed.skipped.includes(account.providerAccountId),
    );
    if (unasked) return back(outcome);
    await readBank(session.ctx, { ...target, presence }, bankSink);
    return back(outcome, "done");
  } catch (error) {
    console.error("[plugins] a return could not be completed", redactForLog(error));
    return back({ ok: false, error: "unreachable", bank: null });
  }
}
