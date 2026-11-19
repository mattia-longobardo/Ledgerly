// The adapter of the port `MovementsPort` of accounts (audit ACC-8): what accounts reads of the
// movements, realised here. The shape is the port's; the application wires it (`wireDomain`).
import { dailyNetByAccount, manualMovementsByAccount, transactionIdsOfAccount } from "./queries/movements";
import { linkOwnTransfers } from "./service/provider";

export const movementsOfAccounts = {
  dailyNetByAccount,
  manualMovementsByAccount,
  transactionIdsOfAccount,
  linkOwnTransfers,
};
