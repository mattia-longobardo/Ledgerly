/**
 * Reconciles one user's local transactions, categories and labels with what a
 * provider currently reports.
 *
 * Provider-agnostic on purpose: it never sees a Wallet field, only the
 * `ProviderTransaction`/`ProviderCategory` an adapter hands it. Two rules
 * carry most of the weight:
 *
 *  - Never invent financial data. A transaction not yet fetched is simply not
 *    processed this run — nothing here fabricates an amount, a category, or a
 *    zero in place of a value the provider hasn't reported. `getRecords`'s
 *    `sinceDate` cursor is a rolling window, not a full listing (unlike the
 *    accounts sync), so an entity absent from one page of transactions cannot
 *    be told apart from one merely outside the window — nothing is marked
 *    missing on that basis here, and nothing is ever deleted.
 *  - Idempotence. Every write is keyed off a provider link keyed by
 *    (provider, entityType, externalId), so re-running this over the same
 *    records — expected, since the sync cursor deliberately re-fetches a
 *    lookback overlap — creates nothing twice and only touches a row's
 *    version when something in it actually changed.
 */

import type { ProviderLink, ProviderLinksRepository } from "@/modules/accounts/application/ports";
import { pairTransfers, type TransferCandidate } from "../domain/transaction";
import type { TransactionCategory, TransactionLabel } from "../domain/transaction";
import type { TransactionPatch, TransactionsSource, UseCaseDeps } from "./ports";

export interface SyncProviderTransactionsResult {
  transactionsCreated: number;
  transactionsUpdated: number;
  categoriesCreated: number;
  labelsCreated: number;
  skippedNoAccount: number;
}

export type SyncProviderTransactionsDeps = UseCaseDeps & {
  links: ProviderLinksRepository;
  source: TransactionsSource;
};

export function syncProviderTransactions(deps: SyncProviderTransactionsDeps) {
  return async (userId: string, sinceDate: string | null): Promise<SyncProviderTransactionsResult> => {
    const { provider } = deps.source;
    const now = deps.clock.now();
    const result: SyncProviderTransactionsResult = {
      transactionsCreated: 0,
      transactionsUpdated: 0,
      categoriesCreated: 0,
      labelsCreated: 0,
      skippedNoAccount: 0,
    };

    // 1. Categories, mirrored first so every transaction below can resolve one.
    const incomingCategories = await deps.source.fetchCategories();
    const categoryLinks = await deps.links.byExternal(
      userId,
      provider,
      "category",
      incomingCategories.map((c) => c.externalId),
    );
    const categoryIdByExternal = new Map<string, string>();
    for (const c of incomingCategories) {
      const link = categoryLinks.get(c.externalId);
      if (link) {
        categoryIdByExternal.set(c.externalId, link.entityId);
        continue;
      }
      // A mutable snapshot, same reasoning as `transactionLinks` below: two
      // incoming categories sharing one `externalId` within the same batch
      // (a defensive case, not an expected one) must not both take the
      // create branch. Each record processed updates this map in place, so
      // a later record with the same externalId sees the category the
      // earlier one just resolved instead of creating a duplicate.
      const existing = await deps.categories.findByName(userId, c.name);
      let local: TransactionCategory;
      if (existing) {
        local = existing;
      } else {
        const created = await deps.categories.create({
          userId,
          name: c.name,
          groupName: c.groupName,
          kind: c.kind,
          color: null,
          parentId: null,
          source: "provider",
          archivedAt: null,
        });
        if (created === "duplicate_name") {
          // Only reachable if a category by this name was created between the
          // `findByName` check above and this call — not possible from this
          // single-threaded loop, but the port's return type allows it, so it
          // is handled rather than cast away: fall back to the row that must
          // now exist instead of fabricating one.
          const found = await deps.categories.findByName(userId, c.name);
          if (!found) throw new Error(`category "${c.name}" reported duplicate_name but cannot be found`);
          local = found;
        } else {
          local = created;
          result.categoriesCreated += 1;
        }
      }
      await deps.links.upsertSeen(userId, { provider, entityType: "category", entityId: local.id, externalId: c.externalId, metadata: { name: c.name } }, now);
      categoryIdByExternal.set(c.externalId, local.id);
      // Keep the in-run snapshot current so a repeat of this externalId
      // later in the same batch finds this category rather than creating
      // another.
      categoryLinks.set(c.externalId, {
        provider,
        entityType: "category",
        entityId: local.id,
        externalId: c.externalId,
        metadata: { name: c.name },
        missingSince: null,
      });
    }

    // 2. Transactions. An account must already be linked by the accounts
    // SyncKind — this handler never creates an account.
    const incoming = await deps.source.fetchTransactions(sinceDate);
    const accountLinks = await deps.links.byExternal(
      userId,
      provider,
      "account",
      [...new Set(incoming.map((t) => t.accountExternalId))],
    );
    // A mutable snapshot: two incoming records sharing one `externalId` within
    // the same batch (a defensive case, not an expected one — but Wallet's
    // shapes are unverified) must not both take the create branch below. Each
    // record processed updates this map in place, so a later record with the
    // same externalId sees the transaction the earlier one just created or
    // updated, and takes the update branch instead of creating a duplicate.
    const transactionLinks = await deps.links.byExternal(
      userId,
      provider,
      "transaction",
      incoming.map((t) => t.externalId),
    );

    const transferCandidates: TransferCandidate[] = [];
    // Raw (unsorted) counterpart external id per leg created/updated this
    // run, keyed by this leg's local id. Used below to reconsider a leg that
    // does not pair within this run's own batch — see the block after
    // `pairTransfers`.
    const counterpartExternalIdByLocalId = new Map<string, string>();

    for (const t of incoming) {
      const accountLink = accountLinks.get(t.accountExternalId);
      if (!accountLink) {
        result.skippedNoAccount += 1;
        continue;
      }
      const categoryId = t.categoryExternalId ? categoryIdByExternal.get(t.categoryExternalId) ?? null : null;
      const link = transactionLinks.get(t.externalId);
      const current = link ? await deps.transactions.get(userId, link.entityId) : null;

      let localId: string;
      if (link && current) {
        const patch: TransactionPatch = {};
        if (current.categoryId !== categoryId) patch.categoryId = categoryId;
        if (current.note !== t.note) patch.note = t.note;
        if (current.state !== t.state) patch.state = t.state;
        if (current.payee !== t.payee) patch.payee = t.payee;
        if (Object.keys(patch).length > 0) {
          // A lost version race means the user edited this transaction while
          // the sync was running; their edit wins and the next run
          // reconciles from the newer row, exactly like the accounts sync's
          // equivalent best-effort patch. Only a patch that actually landed
          // counts as an update — a "version_mismatch" or "null" (row raced
          // away or vanished) is a no-op for stats purposes, not a hidden
          // extra update.
          const updated = await deps.transactions.update(userId, current.id, current.version, patch);
          if (updated && updated !== "version_mismatch") result.transactionsUpdated += 1;
        }
        localId = current.id;
      } else {
        const created = await deps.transactions.create({
          userId,
          accountId: accountLink.entityId,
          occurredAt: t.occurredAt,
          bookedAt: t.updatedAt,
          amount: t.amount,
          currency: t.currency,
          type: t.type,
          state: t.state,
          categoryId,
          payee: t.payee,
          note: t.note,
          transferGroupId: null,
          source: "provider",
          syncRunId: null,
        });
        result.transactionsCreated += 1;
        localId = created.id;
      }
      await deps.links.upsertSeen(userId, { provider, entityType: "transaction", entityId: localId, externalId: t.externalId, metadata: {} }, now);
      // Keep the in-run snapshot current so a repeat of this externalId later
      // in the same batch finds this transaction rather than creating another.
      const seenLink: ProviderLink = { provider, entityType: "transaction", entityId: localId, externalId: t.externalId, metadata: {}, missingSince: null };
      transactionLinks.set(t.externalId, seenLink);

      const labelIds: string[] = [];
      for (const labelName of t.labelExternalIds) {
        let label: TransactionLabel | null = await deps.labels.findByName(userId, labelName);
        if (!label) {
          const created = await deps.labels.create({ userId, name: labelName, color: null, source: "provider" });
          if (created === "duplicate_name") {
            // Same race-that-cannot-happen-here-but-the-type-allows-it as
            // categories above.
            const found = await deps.labels.findByName(userId, labelName);
            if (!found) throw new Error(`label "${labelName}" reported duplicate_name but cannot be found`);
            label = found;
          } else {
            label = created;
            result.labelsCreated += 1;
          }
        }
        // Wallet exposes a label only as a name, never a stable id, so the
        // name itself stands in for the external id here.
        await deps.links.upsertSeen(userId, { provider, entityType: "label", entityId: label.id, externalId: labelName, metadata: {} }, now);
        labelIds.push(label.id);
      }
      await deps.transactions.setLabels(userId, localId, labelIds);

      if (t.externalTransferRef) {
        // `pairTransfers` groups legs that carry the *same* reference value.
        // Wallet's `transferCounterRecordId` instead points at the other leg's
        // own id, so each side of a pair holds a different raw value (A points
        // at B, B points at A) — passing it straight through would never
        // match. Sorting the pair of ids into one canonical key gives both
        // legs the identical reference `pairTransfers` needs, without this
        // use case (or the domain function) knowing anything Wallet-specific.
        const pairKey = [t.externalId, t.externalTransferRef].sort().join("|");
        transferCandidates.push({ id: localId, accountId: accountLink.entityId, amount: t.amount, occurredAt: t.occurredAt, externalTransferRef: pairKey });
        counterpartExternalIdByLocalId.set(localId, t.externalTransferRef);
      }
    }

    // 3. Transfer pairing, once every leg above has a local id.
    const groups = pairTransfers(transferCandidates);
    for (const [transactionId, groupId] of groups) {
      const row = await deps.transactions.get(userId, transactionId);
      if (row && row.transferGroupId !== groupId) {
        await deps.transactions.update(userId, transactionId, row.version, { transferGroupId: groupId });
      }
    }

    // 3b. Cross-run reconciliation (ruling P3-C45). `pairTransfers` above only
    // ever sees legs fetched *this run* — a leg whose counterpart cleared
    // more than `RECORDS_LOOKBACK_DAYS` ago (a delayed-clearing credit, an
    // account linked into the app after the debit leg already synced, ...)
    // never appears in the same `incoming` batch as its partner, so it would
    // otherwise stay unpaired forever, double-counting one transfer as two
    // separate movements.
    //
    // This does not scan the transactions table by date. Wallet's own
    // `transferCounterRecordId` already names the counterpart leg's external
    // id directly (see the doc comment above), so for any leg that failed to
    // pair this run, a single targeted provider-link lookup on that exact
    // external id either finds the counterpart — however long ago it
    // synced — or confirms it has never synced. Bounded by the number of
    // unpaired legs in this batch, not by a window or a table size.
    //
    // This whole `apply` runs inside one transaction (see module doc above),
    // so a thrown error here would roll back every category, transaction and
    // label already reconciled this run — the exact "one bad row rolls back
    // the whole import" failure this ruling exists to avoid for pairing.
    // Every lookup below is therefore guarded: a missing link, a vanished
    // row, or a lost version race is treated as "not pairable this run" and
    // skipped rather than thrown — the leg simply stays a pairing candidate
    // on the next run.
    const unpairedLegs = [...counterpartExternalIdByLocalId.entries()].filter(([localId]) => !groups.has(localId));
    if (unpairedLegs.length > 0) {
      const counterpartExternalIds = [...new Set(unpairedLegs.map(([, ref]) => ref))];
      const counterpartLinks = await deps.links.byExternal(userId, provider, "transaction", counterpartExternalIds);
      for (const [legId, counterpartExternalId] of unpairedLegs) {
        try {
          const counterpartLink = counterpartLinks.get(counterpartExternalId);
          if (!counterpartLink || counterpartLink.entityId === legId) continue;
          const [leg, counterpart] = await Promise.all([
            deps.transactions.get(userId, legId),
            deps.transactions.get(userId, counterpartLink.entityId),
          ]);
          if (!leg || !counterpart || leg.transferGroupId !== null) continue;
          // Reuse the counterpart's existing group id if it already has one
          // (stable across however many runs it took to find this leg);
          // otherwise mint the same canonical id `pairTransfers` would have.
          const groupId = counterpart.transferGroupId ?? [leg.id, counterpart.id].sort()[0]!;
          if (leg.transferGroupId !== groupId) {
            await deps.transactions.update(userId, leg.id, leg.version, { transferGroupId: groupId });
          }
          if (counterpart.transferGroupId !== groupId) {
            await deps.transactions.update(userId, counterpart.id, counterpart.version, { transferGroupId: groupId });
          }
        } catch {
          // See the guard note above: skip this pair, keep reconciling the
          // rest of the run.
          continue;
        }
      }
    }

    await deps.audit({
      actorUserId: userId,
      action: "expenses.sync",
      entityType: "provider_connection",
      entityId: provider,
      after: { ...result },
    });

    return result;
  };
}
