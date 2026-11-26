// Funds · the recurring debits found among the movements.
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type CivilDate, daysBetween, today } from "../../../shared/dates";
import { chargeCandidates } from "../../transactions/queries";
import { payeeKeyOf } from "../../transactions/rules";
import { carriesKey, type Detection, recurrenceKeyOf, summarise } from "../detect";
import { contributionFee } from "../fees";
import { fundContributionSources, fundOperations, funds } from "../schema";
import { linkFundLegs } from "./legs";
import { feesOf, requireFund } from "./reads";

// ——— The recurring debits found among the movements ——————————————————————————————————————————

/** An identifier without the spaces or dots a bank may print inside it (`detect.ts`). */
function compactKey(value: string): string {
  return value.replace(/[\s.]+/g, "").toUpperCase();
}

/**
 * Days between a debit that lost its movement and the movement that takes it back. When the bank
 * source gives the same debit a new id, the old row is purged and the new one arrives as a movement
 * no operation holds: it takes the orphan back — same amount, within these days — instead of making
 * a second contribution (owner, 2026-10-25: the debit of 19 October counted six times).
 */
const READOPT_DAYS = 3;

const laterOf = (a: CivilDate, b: CivilDate | null): CivilDate => (b !== null && b > a ? b : a);
const earlierOf = (a: CivilDate, b: CivilDate | null): CivilDate => (b !== null && b < a ? b : a);

/**
 * The movements that become contributions by themselves: for every active recurring debit of an
 * open fund, the visible outgoing movements (expense or giroconto) on the source's account — any
 * account without one — inside the plan's dates, whose payee contains the text without spaces or
 * case, and that no operation holds yet. Each becomes a `voluntary` operation with `source = rule`.
 * The fee is what the fund's list takes from each contribution of that source; unknown without one.
 *
 * Idempotent: a movement makes one operation (unique key), and an operation edited by hand is never
 * touched again. The period of the plan decides nothing here: what was debited is written whenever
 * it was debited, and the period only says whether a debit is late (`debitStatus`).
 */
export async function matchDebits(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundIds?: readonly string[],
): Promise<{ written: number }> {
  const sources = await getDb()
    .select({ source: fundContributionSources, fund: funds })
    .from(fundContributionSources)
    .innerJoin(funds, eq(funds.id, fundContributionSources.fundId))
    .where(
      and(
        userScoped(ctx).owns(fundContributionSources),
        eq(fundContributionSources.kind, "bank_debit"),
        eq(fundContributionSources.state, "active"),
        eq(funds.state, "active"),
        fundIds === undefined ? undefined : inArray(fundContributionSources.fundId, [...fundIds]),
      ),
    )
    .orderBy(asc(fundContributionSources.createdAt), asc(fundContributionSources.id));
  if (sources.length === 0) return { written: 0 };
  const fees = await feesOf(ctx, [...new Set(sources.map(({ fund }) => fund.id))]);
  let written = 0;
  const changed = new Set<string>();
  const todayOn = today(ctx.timeZone);
  for (const { source, fund } of sources) {
    const needle = source.payeeMatch === null ? null : payeeKeyOf(source.payeeMatch);
    if (source.payeeMatch === null || needle === null) continue;
    const from = laterOf(fund.startOn, source.validFrom);
    const to = earlierOf(todayOn, source.validTo);
    if (from > to) continue;
    // A source's text may be a payee or the creditor identifier of the direct debit that pays the
    // fund (`detect.ts`). The first lives in the payee, the second in the bank's own text, so both
    // are looked at: a text made from an identifier would otherwise match nothing.
    const identifier = compactKey(source.payeeMatch);
    const candidates = (
      await chargeCandidates(ctx, {
        accountId: source.accountId,
        from,
        to,
        types: ["expense", "transfer"],
      })
    ).filter(
      (candidate) =>
        (payeeKeyOf(candidate.payee) ?? "").includes(needle) ||
        compactKey(`${candidate.payee ?? ""} ${candidate.note ?? ""}`).includes(identifier),
    );
    if (candidates.length === 0) continue;
    const held = new Set(
      (
        await getDb()
          .select({ id: fundOperations.transactionId })
          .from(fundOperations)
          .where(
            and(
              userScoped(ctx).owns(fundOperations),
              inArray(
                fundOperations.transactionId,
                candidates.map((candidate) => candidate.id),
              ),
            ),
          )
      ).map((row) => row.id),
    );
    const orphans = await getDb()
      .select({
        id: fundOperations.id,
        on: fundOperations.operationDate,
        chargedCents: fundOperations.workerCents,
      })
      .from(fundOperations)
      .where(
        and(
          userScoped(ctx).owns(fundOperations),
          eq(fundOperations.fundId, fund.id),
          eq(fundOperations.source, "rule"),
          isNull(fundOperations.transactionId),
          or(eq(fundOperations.sourceId, source.id), isNull(fundOperations.sourceId)),
        ),
      );
    const fresh: typeof candidates = [];
    for (const candidate of candidates) {
      if (held.has(candidate.id)) continue;
      const nearest = orphans
        .filter(
          (orphan) =>
            orphan.chargedCents === candidate.cents &&
            Math.abs(daysBetween(orphan.on, candidate.on)) <= READOPT_DAYS,
        )
        .sort(
          (a, b) => Math.abs(daysBetween(a.on, candidate.on)) - Math.abs(daysBetween(b.on, candidate.on)),
        )[0];
      if (nearest === undefined) {
        fresh.push(candidate);
        continue;
      }
      orphans.splice(orphans.indexOf(nearest), 1);
      changed.add(fund.id);
      await getDb()
        .update(fundOperations)
        .set({ transactionId: candidate.id, sourceId: source.id })
        .where(and(eq(fundOperations.id, nearest.id), userScoped(ctx).owns(fundOperations)));
    }
    if (fresh.length === 0) continue;
    const own = fees.filter((one) => one.fundId === fund.id);
    const rows = await getDb()
      .insert(fundOperations)
      .values(
        fresh.map((candidate) => {
          const feeCents = contributionFee(own, {
            on: candidate.on,
            chargedCents: candidate.cents,
            sourceId: source.id,
          });
          return userScoped(ctx).stamp({
            fundId: fund.id,
            originKey: `rule:${candidate.id}`,
            originalType: "voluntary",
            classification: "voluntary" as const,
            originalState: null,
            operationDate: candidate.on,
            workerCents: candidate.cents,
            feesCents: feeCents ?? 0n,
            feesUnknown: feeCents === null,
            netCents: candidate.cents - (feeCents ?? 0n),
            transactionId: candidate.id,
            source: "rule" as const,
            sourceId: source.id,
          });
        }),
      )
      .onConflictDoNothing()
      .returning({ id: fundOperations.id });
    written += rows.length;
    if (rows.length > 0) changed.add(fund.id);
  }
  for (const fundId of changed) await linkFundLegs(ctx, fundId);
  return { written };
}

/**
 * The movements a contribution or a recurring debit can be tied to (the selector of the dialogs): the
 * last 60 that left the account asked for, or any of the person's, since the fund started; newest first.
 */
export async function movementCandidates(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  accountId: string | null,
  now: Date = new Date(),
) {
  const fund = await requireFund(ctx, fundId);
  const found = await chargeCandidates(ctx, {
    accountId,
    from: fund.startOn,
    to: today(ctx.timeZone, now),
    types: ["expense", "transfer"],
  });
  return found.slice(-60).reverse();
}

/**
 * "Find this charge everywhere": from one movement of a debit, the most durable name it carries —
 * the creditor identifier of the direct debit, its mandate reference, or failing both its payee
 * (`detect.ts`) — and every other charge that carries the same name.
 *
 * It only reads. What it returns is a proposal the person sees before anything is written: how
 * many charges were found, from when, what they usually cost and how far apart they fall. Saving
 * the source is a second, deliberate step, and that is what brings the past ones in as
 * contributions and keeps the future ones coming.
 */
export async function proposeDebitMatch(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  transactionId: string,
  accountId: string | null = null,
): Promise<Detection | null> {
  const fund = await requireFund(ctx, fundId);
  const todayOn = today(ctx.timeZone);
  // Every outgoing movement since the fund started, on the account asked for when there is one. The
  // chosen movement is looked for among them, so a movement of somebody else's is simply not there.
  const candidates = await chargeCandidates(ctx, {
    accountId,
    from: fund.startOn,
    to: todayOn,
    types: ["expense", "transfer"],
  });
  const chosen = candidates.find((candidate) => candidate.id === transactionId);
  if (!chosen) return null;
  const key = recurrenceKeyOf(chosen);
  if (key === null) return null;
  return summarise(
    key,
    candidates
      .filter((candidate) => carriesKey(candidate, key))
      .map((candidate) => ({ on: candidate.on, cents: candidate.cents })),
  );
}
