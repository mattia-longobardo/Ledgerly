// Pockets (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the domain's.
// The static paths are served before `/pockets/{id}`: Hono tries the routes in their order.
import type { Hono } from "hono";
import { z } from "zod";
import { POCKETS, POCKETS_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import {
  addPlannedExpense,
  addToPocket,
  createPocket,
  expenseLinkCandidates,
  linkExpense,
  PocketError,
  pocketsTotal,
  pocketsView,
  removePlannedExpense,
  setPocketState,
  unlinkExpense,
  updatePocket,
} from "@ledgerly/domain/pockets";
import { type Cents, parseCents } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { maybe, money, pocketPage, pocketRow } from "./dto";

const { pockets } = POCKETS;

const CONFLICTS = new Set(["duplicate_name", "archived", "backed", "already_linked"]);

/** Runs a use case of the module and turns its refusal into the contract's. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PocketError) {
      if (error.code === "not_found") throw new ApiRefusal("not_found");
      throw new ApiRefusal(CONFLICTS.has(error.code) ? "conflict" : "invalid", error.code);
    }
    // The domain's own schema (a non-positive amount, a start that is not a month).
    if (error instanceof z.ZodError || error instanceof RangeError)
      throw new ApiRefusal("invalid", "invalid");
    throw error;
  }
}

/** An amount of the contract as cents; a string the server cannot read is `invalid`. */
function centsOf(amount: string): Cents {
  try {
    return parseCents(amount);
  } catch {
    throw new ApiRefusal("invalid", "amount");
  }
}

const optionalCents = (amount: string | null): Cents | null => (amount === null ? null : centsOf(amount));

function serveReads(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, pockets.listPockets, async ({ ctx }) => {
    const view = await pocketsView(ctx);
    return {
      pockets: view.pockets.map(pocketRow),
      archived: view.archived.map((pocket) => ({
        id: pocket.id,
        name: pocket.name,
        color: pocket.color,
        target: maybe(pocket.targetCents),
        monthly: maybe(pocket.monthlyCents),
      })),
      totals: {
        earmarked: money(view.earmarkedCents),
        backing: maybe(view.backingCents),
        free: maybe(view.freeCents),
        monthly: money(view.monthlyCents),
      },
      backingAccounts: Object.entries(view.freeByAccount).map(([id, free]) => ({
        id,
        name: view.pockets.find((row) => row.pocket.backingAccountId === id)?.accountName ?? "",
        free: maybe(free),
      })),
      nextAccrual: view.nextAccrual,
      accounts: view.accounts,
    };
  });
  serve(app, guard, pockets.getPocketsOverview, async ({ ctx }) => {
    const total = await pocketsTotal(ctx);
    return { total: money(total.totalCents), monthly: money(total.monthlyCents), count: total.count };
  });
  serve(app, guard, pockets.listPocketCandidates, async ({ ctx }) => ({
    candidates: (await expenseLinkCandidates(ctx)).map((candidate) => ({
      id: candidate.id,
      on: candidate.on,
      amount: money(candidate.cents),
      payee: candidate.payee,
      account: candidate.accountName,
    })),
  }));
  serve(app, guard, pockets.getPocket, async ({ ctx, params }) => {
    const view = await pocketsView(ctx);
    const selected = view.pockets.find((item) => item.pocket.id === params.id);
    if (!selected) throw new ApiRefusal("not_found");
    return pocketPage(view, selected);
  });
}

/** The pocket dialog as the domain takes it. */
function pocketInput(body: {
  name: string;
  color: string | null;
  accountId: string | null;
  target: string | null;
  monthly: string | null;
  startMonth: string;
}) {
  return {
    name: body.name,
    color: body.color,
    backingAccountId: body.accountId,
    targetCents: optionalCents(body.target),
    monthlyCents: optionalCents(body.monthly),
    startMonth: body.startMonth,
  };
}

function serveWrites(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, pockets.createPocket, async ({ ctx, body }) => {
    const input = pocketInput(body);
    const pocket = await refusing(() => createPocket(ctx, input));
    return { id: pocket.id };
  });
  serve(app, guard, pockets.updatePocket, async ({ ctx, params, body }) => {
    const input = pocketInput(body);
    await refusing(() => updatePocket(ctx, params.id, input));
  });
  serve(app, guard, pockets.setPocketState, async ({ ctx, params, body }) => {
    await refusing(() => setPocketState(ctx, params.id, body.state));
  });
  serve(app, guard, pockets.addToPocket, async ({ ctx, params, body }) => {
    const cents = centsOf(body.amount);
    await refusing(() => addToPocket(ctx, params.id, { cents, on: body.on }));
  });
  serve(app, guard, pockets.linkPocketExpense, async ({ ctx, params }) => {
    await refusing(() => linkExpense(ctx, params.id, params.transaction));
  });
  serve(app, guard, pockets.unlinkPocketExpense, async ({ ctx, params }) => {
    await refusing(() => unlinkExpense(ctx, params.id, params.transaction));
  });
  serve(app, guard, pockets.addPlannedExpense, async ({ ctx, params, body }) => {
    const cents = centsOf(body.amount);
    await refusing(() =>
      addPlannedExpense(ctx, params.id, { cents, dueOn: body.dueOn, description: body.description }),
    );
  });
  serve(app, guard, pockets.removePlannedExpense, async ({ ctx, params }) => {
    await refusing(() => removePlannedExpense(ctx, params.id));
  });
}

/** Every route of pockets, in the order that keeps the static paths before `{id}`. */
export function servePockets(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveReads(app, guard);
  serveWrites(app, guard);
  return POCKETS_ROUTES;
}
