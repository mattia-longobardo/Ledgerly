// The adapter of the port `ManagedAccountsPort` of accounts (audit ACC-8): which accounts
// Investments manages, realised here. The application wires it (`wireDomain`).
import { managedSinceOf, serviceAccountIds } from "./managed";

export const managedAccountsOfInvestments = { managedSinceOf, serviceAccountIds };
