/**
 * The movements' side of moving an account from one source to another (rewrite plan N4, 04-now.md
 * §4.6 and §4.6.1): what the comparison reads, the transfers of the switch and how they go back,
 * the bank's links on the movements found in both sources, and the bank's rows after an undo. The
 * rules are pure, in `switch-rules.ts`; the use case is in the application.
 */
export {
  movementsToCompare,
  transferCandidates,
  writeTransferPairs,
  undoTransferPairs,
  linkFoundInBoth,
} from "./transfers";
export { retireBankRows, doubleMovements, choicesToCarry, joinDoubles, undoJoinedDoubles } from "./doubles";
