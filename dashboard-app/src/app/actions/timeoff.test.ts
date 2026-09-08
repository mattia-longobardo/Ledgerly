/**
 * `syncTimeoffNowAction`, with everything below it mocked.
 *
 * The three cases ported from the retired `actions/leave.test.ts` that still
 * mean something: the LOST RACE (the hourly pass holds the sync lock, so this
 * pass does nothing — which is a success, not a failure, because the staged
 * rows are untouched and the pass that owns the lock delivers them), a real
 * upstream failure, and Trek not being connected at all.
 *
 * The set/remove cases are not ported: `setLeaveDay`/`removeLeaveDay` pushed
 * to Trek themselves, and everything those tests asserted about staging and
 * lost races now lives in `setEvent`/`removeEvent`, proved against real
 * Postgres in `modules/timeoff/application/use-cases.itest.ts`. The two
 * actions left here are three lines of `FormData` parsing over those use
 * cases.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionsForRoles, type RoleCode } from "@/platform/auth/permissions";
import type { TrekSyncResult } from "@/modules/timeoff/infrastructure/trek-sync";

const store = vi.hoisted(() => ({ connected: true }));
const auth = vi.hoisted(() => ({ roles: ["owner"] as string[] }));
const sync = vi.hoisted(() => ({
  runTrekSync: vi.fn(),
  disabledTrekSync: vi.fn((year: number) => ({
    status: "disabled" as const,
    year,
    pulled: 0,
    deleted: 0,
    pushed: 0,
    weekendBlocked: [],
    stillPending: [],
    stats: null,
    errors: [],
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The action resolves the caller itself — `openPrincipalConnection` only
// authenticates, so the permission check needs a principal of its own.
vi.mock("@/platform/auth/require-principal", () => ({
  requirePrincipal: vi.fn(async () => ({
    userId: "00000000-0000-7000-8000-00000000000a",
    organizationId: "00000000-0000-7000-8000-0000000000aa",
    roles: auth.roles,
    permissions: permissionsForRoles(auth.roles as RoleCode[]),
  })),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/modules/timeoff/infrastructure/trek-sync", () => sync);
vi.mock("@/modules/timeoff/infrastructure/trek-store", () => ({
  drizzleTimeoffStore: vi.fn(() => ({ withEvents: vi.fn() })),
}));
vi.mock("@/modules/integrations/ui/principal-connection", () => ({
  openPrincipalConnection: vi.fn(async () =>
    store.connected
      ? {
          connection: { id: "c1", userId: "00000000-0000-7000-8000-00000000000a" },
          credentials: { baseUrl: "https://trek.example", token: "trek_t" },
        }
      : null,
  ),
  isProviderConnectedForPrincipal: vi.fn(async () => store.connected),
}));

const { syncTimeoffNowAction } = await import("./timeoff");

function result(over: Partial<TrekSyncResult> = {}): TrekSyncResult {
  return {
    status: "ok",
    year: 2026,
    pulled: 0,
    deleted: 0,
    pushed: 1,
    weekendBlocked: [],
    stillPending: [],
    stats: null,
    errors: [],
    ...over,
  };
}

function form(year = "2026"): FormData {
  const data = new FormData();
  data.append("year", year);
  return data;
}

describe("syncTimeoffNowAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.connected = true;
    auth.roles = ["owner"];
    sync.runTrekSync.mockResolvedValue(result());
  });

  it("runs the pass for the connection's own owner", async () => {
    await syncTimeoffNowAction(form());

    expect(sync.runTrekSync).toHaveBeenCalledWith(
      expect.objectContaining({
        year: 2026,
        userId: "00000000-0000-7000-8000-00000000000a",
        call: { config: { baseUrl: "https://trek.example", token: "trek_t" } },
      }),
    );
  });

  it("treats a lock held by the hourly pass as success, not as a failed sync", async () => {
    sync.runTrekSync.mockResolvedValue(result({ status: "skipped", pushed: 0 }));

    const out = await syncTimeoffNowAction(form());

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.status).toBe("skipped");
  });

  it("still surfaces a real upstream failure", async () => {
    sync.runTrekSync.mockResolvedValue(result({ status: "failed", errors: ["trek is down"] }));

    const out = await syncTimeoffNowAction(form());

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe("trek is down");
  });

  it("reports a disabled pass — never an error — when Trek is not connected", async () => {
    store.connected = false;

    const out = await syncTimeoffNowAction(form());

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.status).toBe("disabled");
    expect(sync.runTrekSync).not.toHaveBeenCalled();
  });

  /**
   * A sync is a WRITE: it pushes staged rows upstream and deletes local events
   * Trek no longer has. `runTrekSync` takes a `userId` and a store, never a
   * `Principal`, so it asserts nothing — the check has to live in the action,
   * and without it a viewer holding `timeoff.read` alone could drive all of it.
   */
  it("refuses a viewer, who holds timeoff.read and nothing else", async () => {
    auth.roles = ["viewer"];

    const out = await syncTimeoffNowAction(form());

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/permission/i);
    expect(sync.runTrekSync).not.toHaveBeenCalled();
  });

  it("refuses a year outside the supported range before touching Trek", async () => {
    const out = await syncTimeoffNowAction(form("1999"));

    expect(out.ok).toBe(false);
    expect(sync.runTrekSync).not.toHaveBeenCalled();
  });
});
