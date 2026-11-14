import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEAVE_DAY_KINDS, goesToTrek } from "./rules";
import { saveLeaveAction } from "./actions";

const { requireSession, saveLeaveDay, syncTrekNow, revalidatePath } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  saveLeaveDay: vi.fn(),
  syncTrekNow: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/platform/auth/session", () => ({ requireSession }));
vi.mock("next/cache", () => ({ revalidatePath }));
// `after()` runs its callback once the response has gone out; here that is at once.
vi.mock("next/server", () => ({ after: (callback: () => unknown) => void callback() }));
vi.mock("@/platform/integrations/trek/sync", () => ({ syncTrekNow }));
vi.mock("./service", async (actual) => ({
  ...(await actual<typeof import("./service")>()),
  saveLeaveDay,
}));

const CTX = { userId: "alice", role: "user" as const, locale: "en" as const, timeZone: "Europe/Rome" };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(CTX);
  saveLeaveDay.mockResolvedValue([]);
  syncTrekNow.mockResolvedValue(null);
});

describe("the Trek pass after a save (decision ST-23)", () => {
  it.each(LEAVE_DAY_KINDS)("starts for %s exactly when that kind reaches Trek", async (kind) => {
    const result = await saveLeaveAction({ from: "2026-06-16", to: "", kind, fraction: "1", note: "" });
    expect(result).toEqual({ ok: true });
    await vi.waitFor(() => expect(syncTrekNow).toHaveBeenCalledTimes(goesToTrek(kind) ? 1 : 0));
  });

  it("starts for a ROL day as it does for a vacation day, without waiting for the next sync", async () => {
    await saveLeaveAction({ from: "2026-06-16", to: "", kind: "rol", fraction: "1", note: "" });
    await vi.waitFor(() => expect(syncTrekNow).toHaveBeenCalledWith(CTX));
  });
});
