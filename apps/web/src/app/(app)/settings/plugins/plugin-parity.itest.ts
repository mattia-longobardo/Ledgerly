// R3 parity of the writes of a person's plugin (03-releases.md §R3, criterion 11): each deleted Server
// Action of `plugin-actions.ts` called a use case of the plugin host and answered its code; its route
// calls the same use case, and `plugin-calls.ts` reads the route's refusal back as that code. The
// successes are the E2E of the connections (`tests/e2e/connections/plugins.spec.ts`).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const host = await import("@ledgerly/plugin-host");

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

/** The answer of `plugin-calls.ts` to one request: `ok`, or the refusal's reason or code. */
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

/** The answer of the old action: `ok`, the plugin host's code, or `failed`. */
async function viaAction(work: () => Promise<void>) {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    if (error instanceof host.PluginActionError) return { ok: false, error: error.code };
    return { ok: false, error: "failed" };
  }
}

describe("a person's plugin, old action = new call", () => {
  it("answers the same code for a plugin the instance does not have", async () => {
    const pluginId = "nothing";
    expect(await viaRoute("PATCH", `/plugins/${pluginId}`, { active: true })).toEqual(
      await viaAction(() => host.setPluginActive(ctx, { pluginId, active: true })),
    );
    expect(
      await viaRoute("PUT", `/plugins/${pluginId}/credentials`, { applicationId: "a", privateKey: "k" }),
    ).toEqual(
      await viaAction(() => host.saveUserCredentials(ctx, { pluginId, applicationId: "a", privateKey: "k" })),
    );
    expect(await viaRoute("DELETE", `/plugins/${pluginId}/credentials`)).toEqual(
      await viaAction(() => host.removeUserCredentials(ctx, pluginId)),
    );
  });
});
