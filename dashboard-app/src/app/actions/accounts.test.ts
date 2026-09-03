/**
 * These actions are thin FormData adapters over the accounts use cases, so the
 * suite exercises them through the real use cases and in-memory repositories
 * (via the `ui/run` test seams) rather than mocking the use cases themselves —
 * the point is to prove the FormData parsing, the error-to-message mapping,
 * and the permission check, all wired correctly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryAccountsRepository,
  MemoryClock,
  MemoryGroupsRepository,
  MemoryProviderLinksRepository,
} from "@/modules/accounts/infrastructure/memory-repositories";
import {
  setAccountDepsFactoryForTests,
  setPrincipalForTests,
} from "@/modules/accounts/ui/run";
import { testPrincipal } from "@/test/principal";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createAccountAction } = await import("./accounts");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("accounts actions", () => {
  beforeEach(() => {
    const deps = {
      accounts: new MemoryAccountsRepository(),
      links: new MemoryProviderLinksRepository(),
      groups: new MemoryGroupsRepository(),
      clock: new MemoryClock(new Date("2026-09-02T12:00:00Z")),
      audit: async () => {},
    };
    setAccountDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal());
  });

  it("rejects an empty name", async () => {
    const result = await createAccountAction(
      form({ name: "", type: "cash", currency: "EUR" }),
    );
    expect(result).toEqual({ ok: false, error: "Enter a name." });
  });

  it("creates a manual account from a valid form", async () => {
    const result = await createAccountAction(
      form({ name: "Revolut", type: "checking", currency: "EUR" }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a viewer", async () => {
    setPrincipalForTests(testPrincipal({ roles: ["viewer"] }));
    const result = await createAccountAction(
      form({ name: "Revolut", type: "checking", currency: "EUR" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "You do not have permission to change accounts.",
    });
  });
});
