// test/wiring.ts — the ports of the domain for every test file, as each process wires them
// (`wireDomain` of `apps/api`; 10-modularity.md §10.3). In `beforeAll` and by a dynamic import, so
// the `vi.mock` of a test file applies to the modules the wiring loads.
import { beforeAll } from "vitest";

beforeAll(async () => {
  const { wireDomain } = await import("@ledgerly/api");
  wireDomain();
});
