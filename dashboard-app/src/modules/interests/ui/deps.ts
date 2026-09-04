/**
 * Split out of `run.ts` only for import-path stability, mirroring the
 * expenses module's `ui/deps.ts` — the actual implementation, including the
 * test seams, lives in `run.ts`.
 */
export {
  interestDeps,
  runForPrincipal,
  setInterestDepsFactoryForTests,
  setPrincipalForTests,
} from "./run";
