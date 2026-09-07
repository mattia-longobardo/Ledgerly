/**
 * Split out of `run.ts` only for import-path stability, mirroring the
 * interests and expenses modules' `ui/deps.ts` — the actual implementation,
 * including the test seams, lives in `run.ts`.
 */
export {
  runForPrincipal,
  setPrincipalForTests,
  setTimeoffDepsFactoryForTests,
  timeoffDeps,
} from "./run";
