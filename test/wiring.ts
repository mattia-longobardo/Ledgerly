// test/wiring.ts — the ports of the domain for every test file, as each process wires them
// (`wireDomain` of `apps/api`; 10-modularity.md §10.3). In `beforeAll` and by a dynamic import, so
// the `vi.mock` of a test file applies to the modules the wiring loads.
import { beforeAll } from "vitest";

beforeAll(async () => {
  const { wireDomain } = await import("@ledgerly/api");
  const { wireAuth } = await import("@ledgerly/domain/platform/auth");
  wireDomain();
  // The two plugins the tests serve in-process (Wallet, Trek): the core reads what each can do from
  // its manifest (rewrite plan R5c, P3b), as if this process had read it from the plugin.
  const { rememberManifest } = await import("@ledgerly/domain/platform/plugins");
  rememberManifest((await import("../plugins/wallet/src/manifest")).MANIFEST);
  rememberManifest((await import("../plugins/trek/src/manifest")).MANIFEST);
  // A person a test signs up has the first start behind them and every addon on, as a person made
  // before R5a: no row of preferences. The test of the first start wires `startOnboarding` itself.
  wireAuth({ userCreated: async () => {} });
});
