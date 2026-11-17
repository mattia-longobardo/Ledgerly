import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEAVE_DAY_KINDS, goesToTrek } from "./rules";
import { removeLeaveAction, saveLeaveRangeAction, undoLeaveAction } from "./actions";

const { requireSession, saveLeaveRange, removeLeave, restoreLeave, syncTrekNow, revalidatePath } = vi.hoisted(
  () => ({
    requireSession: vi.fn(),
    saveLeaveRange: vi.fn(),
    removeLeave: vi.fn(),
    restoreLeave: vi.fn(),
    syncTrekNow: vi.fn(),
    revalidatePath: vi.fn(),
  }),
);

vi.mock("@/platform/auth/session", () => ({ requireSession }));
vi.mock("next/cache", () => ({ revalidatePath }));
// `after()` runs its callback once the response has gone out; here that is at once.
vi.mock("next/server", () => ({ after: (callback: () => unknown) => void callback() }));
vi.mock("@/platform/integrations/trek/sync", () => ({ syncTrekNow }));
vi.mock("./service", async (actual) => ({
  ...(await actual<typeof import("./service")>()),
  saveLeaveRange,
  removeLeave,
  restoreLeave,
}));

const CTX = { userId: "alice", role: "user" as const, locale: "en" as const, timeZone: "Europe/Rome" };

const UNDO = { dates: ["2026-06-16"], rows: [] };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(CTX);
  // The real service says whether Trek has something to hear: the rules' own list decides.
  saveLeaveRange.mockImplementation(
    async (_ctx: unknown, input: { kind: (typeof LEAVE_DAY_KINDS)[number] }) => ({
      days: [],
      totalDays: 1,
      undo: UNDO,
      trek: goesToTrek(input.kind),
    }),
  );
  syncTrekNow.mockResolvedValue(null);
});

const fields = (kind: string) => ({ from: "2026-06-16", to: "2026-06-16", kind, fraction: "1", note: "" });

describe("the Trek pass after a save (decision ST-23)", () => {
  it.each(LEAVE_DAY_KINDS)("starts for %s exactly when that kind reaches Trek", async (kind) => {
    const result = await saveLeaveRangeAction(fields(kind));
    expect(result).toEqual({ ok: true, undo: UNDO, days: 1, removed: 0, pending: 0 });
    await vi.waitFor(() => expect(syncTrekNow).toHaveBeenCalledTimes(goesToTrek(kind) ? 1 : 0));
  });

  it("starts for a ROL day as it does for a vacation day, without waiting for the next sync", async () => {
    await saveLeaveRangeAction(fields("rol"));
    await vi.waitFor(() => expect(syncTrekNow).toHaveBeenCalledWith(CTX));
  });
});

describe("the leave actions", () => {
  it("hand the panel's fields to the service as they are, and nothing else", async () => {
    await saveLeaveRangeAction({ ...fields("vacation"), to: "2026-06-19", fraction: "0.5", note: " am " });
    expect(saveLeaveRange).toHaveBeenCalledWith(CTX, {
      from: "2026-06-16",
      to: "2026-06-19",
      kind: "vacation",
      fraction: 0.5,
      note: "am",
      editedKind: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/timeoff", "layout");
  });

  it("hand the second half's kind of a split day to the service, and refuse one nobody defined", async () => {
    await saveLeaveRangeAction({ ...fields("vacation"), fraction: "0.5", otherKind: "rol" });
    expect(saveLeaveRange).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ kind: "vacation", otherKind: "rol" }),
    );
    vi.mocked(saveLeaveRange).mockClear();
    expect(await saveLeaveRangeAction({ ...fields("vacation"), fraction: "0.5", otherKind: "nap" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(saveLeaveRange).not.toHaveBeenCalled();
  });

  it("refuse a kind nobody defined before the service is asked", async () => {
    expect(await saveLeaveRangeAction(fields("holiday"))).toEqual({ ok: false, error: "invalid" });
    expect(saveLeaveRange).not.toHaveBeenCalled();
  });

  it("start a pass after a removal only when Trek has to be told", async () => {
    removeLeave.mockResolvedValueOnce({ deleted: 1, pending: 0, undo: UNDO });
    expect(await removeLeaveAction({ date: "2026-06-16" })).toEqual({
      ok: true,
      undo: UNDO,
      days: 0,
      removed: 1,
      pending: 0,
    });
    expect(syncTrekNow).not.toHaveBeenCalled();

    removeLeave.mockResolvedValueOnce({ deleted: 0, pending: 1, undo: UNDO });
    await removeLeaveAction({ id: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" });
    await vi.waitFor(() => expect(syncTrekNow).toHaveBeenCalledTimes(1));
  });

  it("refuse a removal that names neither a row nor a date", async () => {
    expect(await removeLeaveAction({ date: "16 June" })).toEqual({ ok: false, error: "invalid" });
    expect(removeLeave).not.toHaveBeenCalled();
  });

  it("undo through the service, and start a pass when the undo queued something for Trek", async () => {
    restoreLeave.mockResolvedValueOnce({ trek: true });
    expect(await undoLeaveAction(UNDO)).toEqual({ ok: true });
    expect(restoreLeave).toHaveBeenCalledWith(CTX, UNDO);
    await vi.waitFor(() => expect(syncTrekNow).toHaveBeenCalledTimes(1));
  });
});
