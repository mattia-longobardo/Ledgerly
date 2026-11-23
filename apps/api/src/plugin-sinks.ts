// The ports of the engines of plugin-host that read a source or a leave calendar (rewrite plan R5c,
// P3b), realised from the modules' own services. Only an application joins a port and its adapter
// (rule M8): `wireDomain` wires these, in every process.
import {
  applyProviderAccounts,
  listAccounts,
  rebuildDerivedBalances,
  saveProviderBalance,
} from "@ledgerly/domain/accounts";
import { calendarDays } from "@ledgerly/domain/timeoff";
import {
  CATEGORY_NAME_MAX,
  adoptProviderCategory,
  alignCategoryTypesToMovements,
  followProviderCategoryName,
  getTransaction,
  linkProviderCategory,
  listProviderCategories,
  markNotSent,
  pendingSends,
  purgeRemovedUpstream,
  recordSourceCategories,
  releaseLocalEdits,
  settleProviderCategoryName,
  settleSent,
  sourceCategoryFor,
  transactionsInWindow,
  upsertFromProvider,
} from "@ledgerly/domain/transactions";
import type { LeaveSink, MovementsSink } from "@ledgerly/plugin-host";

export const movementsSink: MovementsSink = {
  listAccounts,
  applyProviderAccounts,
  saveProviderBalance,
  rebuildDerivedBalances: (ctx) => rebuildDerivedBalances(ctx),
  transactionsInWindow,
  upsertFromProvider: (ctx, accountId, incoming, options) =>
    upsertFromProvider(ctx, accountId, incoming, options),
  purgeRemovedUpstream,
  alignCategoryTypesToMovements,
  getTransaction,
  releaseLocalEdits,
  pendingSends: (ctx, accountIds) => pendingSends(ctx, accountIds),
  markNotSent,
  settleSent: (ctx, id, sent) => settleSent(ctx, id, sent),
  sourceCategoryFor,
  categoryNameMax: CATEGORY_NAME_MAX,
  recordSourceCategories,
  listProviderCategories,
  adoptProviderCategory,
  followProviderCategoryName,
  linkProviderCategory: (ctx, provider, link) =>
    linkProviderCategory(ctx, provider, link.id, link.externalId, link.providerName),
  settleProviderCategoryName,
};

export const leaveSink: LeaveSink = calendarDays;
