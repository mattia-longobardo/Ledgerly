/**
 * The Conti server actions — hide/show and delete — with everything below them
 * mocked. The delete is the interesting one: it is a destructive external write
 * (it removes the Teable column) followed by a local registry delete, and the
 * ordering matters — a Teable failure must leave the registry row intact.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/contracts";
import type { TrackedAccount } from "@/lib/db/schema";

const env = vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://dashboard@localhost/dashboard",
    AUTH_URL: "https://dash.example.test",
    AUTH_SECRET: "a".repeat(40),
    OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    AUTHORIZED_SUB: "sub-123",
    TEABLE_URL: "https://teable.example.test",
    TEABLE_TOKEN: "teable-token",
    TEABLE_TABLE_ID: "tblTest",
    PAPERLESS_URL: "https://paperless.example.test",
    PAPERLESS_TOKEN: "paperless-token",
    CRON_SECRET: "c".repeat(20),
    WEBHOOK_SECRET: "w".repeat(20),
  });
  return {};
});
void env;

const auth = vi.hoisted(() => ({ requireUser: vi.fn(async () => ({ sub: "sub-123" })) }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
const teable = vi.hoisted(() => ({ deleteAllocationField: vi.fn(async () => ({ deleted: true })) }));
const repo = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn(), setVisible: vi.fn() }));

vi.mock("next/cache", () => cache);
vi.mock("@/lib/auth/require-user", () => auth);
vi.mock("@/lib/clients/teable", () => teable);
vi.mock("@/lib/repo/tracked-accounts", () => repo);

const { setAccountVisible, deleteAccount } = await import("./settings");

function account(over: Partial<TrackedAccount> = {}): TrackedAccount {
  return {
    slug: "etoro",
    label: "EToro",
    teableColumn: "EToro",
    visible: true,
    sortOrder: 1,
    createdAt: new Date(0),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireUser.mockResolvedValue({ sub: "sub-123" });
  teable.deleteAllocationField.mockResolvedValue({ deleted: true });
  repo.get.mockResolvedValue(account());
  repo.remove.mockResolvedValue(account());
  repo.setVisible.mockResolvedValue(account({ visible: false }));
});

describe("setAccountVisible", () => {
  it("flips the flag and revalidates the pages", async () => {
    const result = await setAccountVisible({ slug: "etoro", visible: false });

    expect(result.ok).toBe(true);
    expect(repo.setVisible).toHaveBeenCalledWith("etoro", false);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/finance");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("fails when the account no longer exists", async () => {
    repo.setVisible.mockResolvedValue(null);
    const result = await setAccountVisible({ slug: "gone", visible: true });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed input without touching the registry", async () => {
    const result = await setAccountVisible({ slug: "etoro" });
    expect(result.ok).toBe(false);
    expect(repo.setVisible).not.toHaveBeenCalled();
  });
});

describe("deleteAccount", () => {
  it("deletes the Teable column with the right name, then removes the registry row", async () => {
    const result = await deleteAccount({ slug: "etoro" });

    expect(result.ok).toBe(true);
    expect(teable.deleteAllocationField).toHaveBeenCalledWith("EToro");
    expect(repo.remove).toHaveBeenCalledWith("etoro");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("still deletes when the column is already gone (no-op field delete)", async () => {
    teable.deleteAllocationField.mockResolvedValue({ deleted: false });

    const result = await deleteAccount({ slug: "etoro" });

    expect(result.ok).toBe(true);
    expect(repo.remove).toHaveBeenCalledWith("etoro");
  });

  it("aborts and keeps the registry row when the Teable delete fails", async () => {
    teable.deleteAllocationField.mockRejectedValue(new UpstreamError("teable", "boom"));

    const result = await deleteAccount({ slug: "etoro" });

    expect(result.ok).toBe(false);
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it("is an idempotent success when the account is already gone", async () => {
    repo.get.mockResolvedValue(null);

    const result = await deleteAccount({ slug: "etoro" });

    expect(result.ok).toBe(true);
    expect(teable.deleteAllocationField).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
