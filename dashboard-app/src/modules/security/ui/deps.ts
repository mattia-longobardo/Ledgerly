/**
 * Split out of `run.ts` only for import-path stability, mirroring the
 * interests module's `ui/deps.ts` — the implementation, including the test
 * seams, lives in `run.ts`.
 */
export {
  runForPrincipal,
  securityDeps,
  setPrincipalForTests,
  setSecurityDepsFactoryForTests,
} from "./run";
