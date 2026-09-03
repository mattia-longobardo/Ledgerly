/**
 * Split out of `run.ts` only for import-path stability: existing callers reach
 * for `ui/deps.ts`. The actual implementation, including the test seams, lives
 * in `run.ts` — see the comment there for why.
 */
export {
  accountDeps,
  runForPrincipal,
  setAccountDepsFactoryForTests,
  setPrincipalForTests,
} from "./run";
