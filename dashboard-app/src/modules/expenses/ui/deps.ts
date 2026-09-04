/**
 * Split out of `run.ts` only for import-path stability, mirroring the
 * accounts module's `ui/deps.ts` — the actual implementation, including the
 * test seams, lives in `run.ts`.
 */
export {
  expenseDeps,
  runForPrincipal,
  setExpenseDepsFactoryForTests,
  setPrincipalForTests,
} from "./run";
