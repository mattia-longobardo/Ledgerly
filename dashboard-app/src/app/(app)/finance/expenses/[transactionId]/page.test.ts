import { describe, expect, it, vi } from "vitest";

const loadTransactionDetail = vi.fn();
vi.mock("@/modules/expenses/ui/load-transactions", () => ({ loadTransactionDetail }));
// `requirePrincipalOrRedirect` transitively imports "@/auth" (next-auth),
// which pulls in "next/server" — unresolvable in vitest's unit environment
// (see `src/platform/auth/require-principal.ts`'s own doc comment). Only the
// page's default export calls it; `generateMetadata` never does, so a bare
// mock is enough to load the module under test.
vi.mock("@/platform/auth/require-principal", () => ({ requirePrincipalOrRedirect: vi.fn() }));

describe("expenses transaction detail page — generateMetadata", () => {
  it("rethrows a non-NotFoundError instead of swallowing it into a generic title", async () => {
    loadTransactionDetail.mockRejectedValueOnce(new Error("boom"));
    const { generateMetadata } = await import("./page");
    await expect(
      generateMetadata({ params: Promise.resolve({ transactionId: "00000000-0000-7000-8000-000000000099" }) }),
    ).rejects.toThrow("boom");
  });

  it("falls back to a generic title when the transaction is not found", async () => {
    const { NotFoundError } = await import("@/modules/expenses/application/errors");
    loadTransactionDetail.mockRejectedValueOnce(new NotFoundError());
    const { generateMetadata } = await import("./page");
    await expect(
      generateMetadata({ params: Promise.resolve({ transactionId: "00000000-0000-7000-8000-000000000099" }) }),
    ).resolves.toEqual({ title: "Transaction" });
  });
});
