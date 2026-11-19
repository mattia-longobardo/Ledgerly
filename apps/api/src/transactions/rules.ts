// Transactions · the rules of the person (categories-and-rules.md §4). An amount of a condition is a
// decimal string on the wire and cents in the domain: the two conversions live here, once.
import type { Hono } from "hono";
import type { z } from "zod";
import { TRANSACTIONS } from "@ledgerly/api-contract";
import {
  applyRule,
  createRule,
  deleteRule,
  listRules,
  ruleDraft,
  previewRule,
  previewSavedRule,
  reorderRules,
  restoreRule,
  type RuleCondition,
  type RulePreview,
  rulesForCategory,
  setRuleActive,
  undoRuleApply,
  updateRule,
} from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { civilDateIn } from "@ledgerly/domain/shared/dates";
import { parseCents } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { refusing } from "./cases";
import { money } from "./dto";

const { rules } = TRANSACTIONS;

type RuleBody = z.output<typeof rules.createRule.body>;
type WireCondition = RuleBody["conditions"][number];

/** A condition of the wire as the domain keeps it; a malformed amount is the caller's `invalid`. */
function domainCondition(condition: WireCondition): unknown {
  if (condition.field !== "amount") return condition;
  const { amount, toAmount, ...rest } = condition;
  try {
    return {
      ...rest,
      cents: Number(parseCents(amount)),
      ...(toAmount === undefined ? {} : { toCents: Number(parseCents(toAmount)) }),
    };
  } catch {
    throw new ApiRefusal("invalid", "amount");
  }
}

const domainRule = (body: RuleBody) => ({ ...body, conditions: body.conditions.map(domainCondition) });

/** A condition of the domain as the wire writes it. */
function wireCondition(condition: RuleCondition) {
  if (condition.field !== "amount") return condition;
  const { cents, toCents, ...rest } = condition;
  return {
    ...rest,
    amount: money(BigInt(cents)),
    ...(toCents === undefined ? {} : { toAmount: money(BigInt(toCents)) }),
  };
}

function previewOf(ctx: Pick<Ctx, "timeZone">, preview: RulePreview) {
  const { retyped } = preview;
  return {
    matched: preview.matched,
    kept: preview.kept,
    changes: preview.changes,
    rows: preview.rows.map((row) => ({
      id: row.id,
      on: civilDateIn(row.on, ctx.timeZone),
      payee: row.payee,
      amount: money(row.amountCents),
    })),
    retyped:
      retyped.count === 0 || retyped.since === null
        ? null
        : {
            count: retyped.count,
            amount: money(retyped.sumCents),
            since: civilDateIn(retyped.since, ctx.timeZone),
            from: retyped.fromType,
          },
  };
}

function serveReads(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, rules.listRules, async ({ ctx, query }) => {
    const all = await listRules(ctx);
    const wanted =
      query.category === undefined
        ? null
        : new Set((await rulesForCategory(ctx, query.category)).map((rule) => rule.id));
    return {
      rules: all
        .filter((rule) => wanted === null || wanted.has(rule.id))
        .map((rule) => ({ ...rule, conditions: rule.conditions.map(wireCondition) })),
    };
  });
  // The editor filled from a movement (§4.7), or with a category chosen (§5.4): the page's rule.
  serve(app, guard, rules.getRuleDraft, async ({ ctx, query }) => {
    const draft = await ruleDraft(ctx, { from: query.from ?? null, category: query.category ?? null });
    return { draft: draft === null ? null : { ...draft, conditions: draft.conditions.map(wireCondition) } };
  });
  serve(app, guard, rules.previewRule, async ({ ctx, body }) =>
    previewOf(ctx, await refusing(previewRule(ctx, domainRule(body.rule), body.ruleId))),
  );
}

function serveWrites(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, rules.createRule, async ({ ctx, body }) => {
    const rule = await refusing(createRule(ctx, domainRule(body)));
    return { id: rule.id, changes: (await previewSavedRule(ctx, rule.id)).changes };
  });
  serve(app, guard, rules.reorderRules, ({ ctx, body }) => refusing(reorderRules(ctx, body.ids)));
  serve(app, guard, rules.undoRuleApply, async ({ ctx, params }) => {
    await refusing(undoRuleApply(ctx, params.undoId));
  });
}

function serveOne(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, rules.previewSavedRule, async ({ ctx, params }) => {
    const preview = await refusing(previewSavedRule(ctx, params.id));
    return { ...previewOf(ctx, preview), categoryId: preview.rule.categoryId };
  });
  serve(app, guard, rules.updateRule, async ({ ctx, params, body }) => {
    const rule = await refusing(updateRule(ctx, params.id, domainRule(body)));
    return { id: rule.id, changes: (await previewSavedRule(ctx, rule.id)).changes };
  });
  serve(app, guard, rules.setRuleActive, ({ ctx, params, body }) =>
    refusing(setRuleActive(ctx, params.id, body.active)),
  );
  serve(app, guard, rules.deleteRule, ({ ctx, params }) => refusing(deleteRule(ctx, params.id)));
  serve(app, guard, rules.restoreRule, ({ ctx, params }) => refusing(restoreRule(ctx, params.id)));
  serve(app, guard, rules.applyRule, ({ ctx, params }) => refusing(applyRule(ctx, params.id)));
}

/** The static paths (`/rules/draft`, `/rules/order`, `/rules/preview`) before `/rules/{id}`. */
export function serveRules(app: Hono<ApiEnv>, guard: Guard): void {
  serveReads(app, guard);
  serveWrites(app, guard);
  serveOne(app, guard);
}
