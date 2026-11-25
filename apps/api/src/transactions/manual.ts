// Transactions · the manual movement: the routes of its dialog, on the use cases the web lends
// (`manual.ts` joins accounts for the balance). The amount comes as a plain decimal, its size only.
import type { Hono } from "hono";
import { TRANSACTIONS } from "@ledgerly/api-contract";
import { suggestionsFor } from "@ledgerly/domain/transactions";
import { type Cents, parseCents } from "@ledgerly/domain/shared/money";
import { today } from "@ledgerly/domain/shared/dates";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { refusing, type TransactionCases } from "./cases";
import { money } from "./dto";

const { manual } = TRANSACTIONS;

/** The size of an amount, greater than zero, or `null` for what is not one. */
function sizeOf(amount: string): Cents | null {
  try {
    const cents = parseCents(amount);
    return cents > 0n ? cents : null;
  } catch {
    return null;
  }
}

function requireSize(amount: string): Cents {
  const size = sizeOf(amount);
  if (size === null) throw new ApiRefusal("invalid", "amount");
  return size;
}

type Form = { amount: string; on: string };
const movementOf = <F extends Form>(form: F) => ({
  ...form,
  amountCents: requireSize(form.amount),
  on: form.on,
});

/** The category the cascade would give the movement being written: the domain's, nothing lent. */
function serveSuggestion(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, manual.suggestManualCategory, async ({ ctx, body }) => {
    const size = sizeOf(body.amount);
    if (size === null) return { categoryId: null, top: [] };
    const answer = await suggestionsFor(ctx, {
      payee: body.payee,
      counterparty: null,
      rawText: null,
      note: body.note,
      accountId: body.accountId,
      amountCents: body.kind === "expense" ? -size : size,
      kind: body.kind,
      merchantCategoryCode: null,
      bankTransactionCode: null,
    });
    return { categoryId: answer.suggestion?.categoryId ?? null, top: answer.top };
  });
}

export function serveManual(app: Hono<ApiEnv>, guard: Guard, cases: TransactionCases): void {
  serveSuggestion(app, guard);
  serve(app, guard, manual.getManualForm, async ({ ctx }) => ({
    accounts: (await cases.manualAccounts(ctx)).map((account) => ({
      ...account,
      source: account.source ?? null,
    })),
    today: today(ctx.timeZone),
  }));
  serve(app, guard, manual.previewManualMovement, async ({ ctx, body }) => {
    const size = sizeOf(body.amount);
    if (size === null) return { preview: null };
    const preview = await cases.previewManual(ctx, { ...body, on: body.on, amountCents: size });
    if (preview === null || preview.effect.kind === "none") return { preview: null };
    if (preview.effect.kind === "unchanged") {
      return {
        preview: {
          kind: "unchanged" as const,
          account: preview.account,
          readingOn: preview.effect.readingOn,
        },
      };
    }
    return {
      preview: {
        kind: "change" as const,
        account: preview.account,
        before: money(preview.effect.before),
        after: money(preview.effect.after),
      },
    };
  });
  serve(app, guard, manual.createManualMovement, async ({ ctx, body }) => {
    const { key, ...form } = body;
    const movement = movementOf(form);
    const saved = await refusing(cases.createManual(ctx, movement, key));
    return { ...saved, on: movement.on, accountId: movement.accountId };
  });
  serve(app, guard, manual.updateManualMovement, async ({ ctx, params, body }) => {
    const movement = movementOf(body);
    const saved = await refusing(cases.updateManual(ctx, params.id, movement));
    return { id: saved.id, created: false, on: movement.on, accountId: movement.accountId };
  });
  serve(app, guard, manual.deleteManualMovement, ({ ctx, params }) =>
    refusing(cases.deleteManual(ctx, params.id)),
  );
  serve(app, guard, manual.retryManualSend, ({ ctx, params }) => refusing(cases.retrySend(ctx, params.id)));
}
