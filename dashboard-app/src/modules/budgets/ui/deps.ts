/**
 * Split out of `run.ts` only for import-path stability, mirroring the
 * interests and funds modules' `ui/deps.ts` — the actual implementation,
 * including the test seams, lives in `run.ts`.
 */
export {
  budgetDeps,
  runForPrincipal,
  setBudgetDepsFactoryForTests,
  setPrincipalForTests,
} from "./run";
