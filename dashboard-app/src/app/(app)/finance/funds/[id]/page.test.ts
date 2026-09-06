import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fundHarness, seedFund } from "@/modules/funds/application/test-support";
import type { UseCaseDeps } from "@/modules/funds/application/ports";
import { setFundDepsFactoryForTests, setPrincipalForTests } from "@/modules/funds/ui/deps";
import { testPrincipal } from "@/test/principal";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("not found"); }),
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/platform/auth/require-principal", () => ({
  requirePrincipalOrRedirect: async () => testPrincipal({ roles: ["viewer"] }),
}));

const { default: FundDetailPage } = await import("./page");

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  if (predicate(node)) return node;
  return findElement(node.props.children as ReactNode, predicate);
}

let deps: UseCaseDeps;
let fundId: string;

describe("Fund detail chart", () => {
  beforeEach(async () => {
    const harness = fundHarness();
    deps = harness.deps;
    const fund = await seedFund(deps, { accountId: "account-usd", currency: "USD" });
    fundId = fund.id;
    harness.latest.set("account-usd", { asOf: "2026-09-05", balance: "12345.67" });
    harness.monthly.set("account-usd", [
      { month: "2026-08-01", balance: "12000.00" },
      { month: "2026-09-01", balance: "12345.67" },
    ]);
    setFundDepsFactoryForTests(() => deps);
    setPrincipalForTests(testPrincipal({ roles: ["viewer"] }));
  });

  afterEach(() => {
    setFundDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });

  it("crosses the server/client boundary with serializable props and formats the fund currency on the client", async () => {
    const page = await FundDetailPage({ params: Promise.resolve({ id: fundId }) });
    const panel = findElement(page, (element) => element.props.title === "Value and deposited");
    expect(panel).not.toBeNull();

    const chartBoundary = panel!.props.children;
    expect(isValidElement<Record<string, unknown>>(chartBoundary)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(chartBoundary)) throw new Error("Chart boundary missing");
    expect(() => structuredClone(chartBoundary.props)).not.toThrow();
    expect(chartBoundary.props.currency).toBe("USD");

    expect(typeof chartBoundary.type).toBe("function");
    const rendered = (chartBoundary.type as (props: Record<string, unknown>) => ReactNode)(chartBoundary.props);
    expect(isValidElement<Record<string, unknown>>(rendered)).toBe(true);
    if (!isValidElement<Record<string, unknown>>(rendered)) throw new Error("Chart wrapper rendered no chart");
    const formatValue = rendered.props.formatValue;
    expect(typeof formatValue).toBe("function");
    expect((formatValue as (value: number) => string)(12345.67)).toBe("12.345,67\u00a0USD");
  });
});
