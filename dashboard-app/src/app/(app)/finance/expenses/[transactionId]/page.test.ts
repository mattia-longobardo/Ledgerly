import { beforeEach, describe, expect, it, vi } from "vitest";

const loadTransactionDetail = vi.fn();
vi.mock("@/modules/expenses/ui/load-transactions", () => ({ loadTransactionDetail }));
// `requirePrincipalOrRedirect` transitively imports "@/auth" (next-auth),
// which pulls in "next/server" — unresolvable in vitest's unit environment
// (see `src/platform/auth/require-principal.ts`'s own doc comment). A bare
// mock is enough to load the module under test; `generateMetadata` now calls
// it too (C4), matching the page body, so every test below must stub it to
// resolve unless it is specifically exercising the redirect path.
const requirePrincipalOrRedirect = vi.fn();
vi.mock("@/platform/auth/require-principal", () => ({ requirePrincipalOrRedirect }));

describe("expenses transaction detail page — generateMetadata", () => {
  beforeEach(() => {
    requirePrincipalOrRedirect.mockReset().mockResolvedValue({ id: "user-1" });
    loadTransactionDetail.mockReset();
  });

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

  it("checks the principal before loading anything, agreeing with the page body (C4)", async () => {
    // A redirect surfaces as a thrown "NEXT_REDIRECT" marker in real Next.js;
    // simulated here as any rejection, to prove it is not swallowed by
    // `generateMetadata`'s own NotFoundError catch (which must not fire for
    // this) and that `loadTransactionDetail` is never even reached.
    requirePrincipalOrRedirect.mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    const { generateMetadata } = await import("./page");

    await expect(
      generateMetadata({ params: Promise.resolve({ transactionId: "00000000-0000-7000-8000-000000000099" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(loadTransactionDetail).not.toHaveBeenCalled();
  });
});
