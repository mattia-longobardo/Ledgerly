// R3 parity of the steps of "Connect a bank" (03-releases.md §R3, criterion 11): each deleted Server
// Action called a use case of `cases.ts` and answered its code; `calls.ts` reads the route's refusal
// back as a code. The successes are the E2E of the connections (`tests/e2e/connections/`).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const cases = await import("./cases");

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = {
    userId: (await createTestUser()).id,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
});

afterAll(closeDatabase);

/** The answer of `calls.ts` to one request: `ok`, or the refusal's reason or code. */
async function viaRoute(method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.ok) return { ok: true };
  if (response.status >= 500) return { ok: false, error: "failed" };
  const refusal = (await response.json()) as { error: string; reason?: string | null };
  return { ok: false, error: refusal.reason ?? refusal.error };
}

describe("the steps of a bank, old action = new call", () => {
  it("answers the same code for a country, and for a connection that is not the person's", async () => {
    const missing = "0b6c3f9e-2d41-4a7b-9c8e-5f1a2b3c4d5e";
    const old = async (work: Promise<{ ok: boolean; error?: string }>) => {
      const answer = await work;
      return answer.ok ? { ok: true } : { ok: false, error: answer.error };
    };
    expect(await viaRoute("GET", "/banks?country=IT")).toEqual(
      await old(cases.listBanks(ctx, "IT")).then((answer) => (answer.ok ? { ok: true } : answer)),
    );
    // A reading of a connection that is not the person's: the old use case read nothing and said `ok`,
    // the route says `not_found`. «Try again» reads the outcome page again whatever the answer.
    expect(await old(cases.retryBankReading(ctx, missing, null))).toEqual({ ok: true });
    expect(await viaRoute("POST", `/connections/${missing}/read`)).toEqual({ ok: false, error: "not_found" });
    expect(await viaRoute("DELETE", `/connections/${missing}`)).toEqual(
      await old(cases.cancelBankConnection(ctx, missing)),
    );
  });
});
