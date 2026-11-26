import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.hoisted(() => vi.fn());
vi.mock("@ledgerly/api-client", async (original) => ({ ...(await original<object>()), call }));
vi.mock("@ledgerly/ui/data", () => ({
  read: async () => ({ numberFormat: "it-IT", decimalSeparator: null, currencyPosition: null }),
  invalidate: () => undefined,
}));

const { recordPortfolioOperation } = await import("./calls");
const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const DEPOSIT = { kind: "deposit" as const, on: "2026-11-20", amount: "100", note: "" };

async function bodyOf(counterpart: string) {
  await recordPortfolioOperation(ACCOUNT, { ...DEPOSIT, counterpart });
  return call.mock.calls[0][1].body;
}

describe("recordPortfolioOperation: the other side of a deposit's leg (PERS-651)", () => {
  beforeEach(() => {
    call.mockReset();
    call.mockResolvedValue({});
  });

  it("sends neither field when the choice is automatic", async () => {
    const body = await bodyOf("");
    expect(body).not.toHaveProperty("transactionId");
    expect(body).not.toHaveProperty("counterpart");
  });

  it("sends the bank movement chosen as transactionId", async () => {
    expect(await bodyOf(`tx:${OTHER}`)).toMatchObject({ transactionId: OTHER });
  });

  it("sends an account, an account outside or none as counterpart", async () => {
    expect((await bodyOf(`acc:${OTHER}`)).counterpart).toEqual({ kind: "account", accountId: OTHER });
    call.mockClear();
    expect((await bodyOf("outside")).counterpart).toEqual({ kind: "outside" });
    call.mockClear();
    expect((await bodyOf("none")).counterpart).toEqual({ kind: "none" });
  });
});
