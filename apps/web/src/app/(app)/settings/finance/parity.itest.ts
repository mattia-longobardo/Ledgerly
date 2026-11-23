// R3 parity of the writes of Settings › Categories (03-releases.md §R3, criterion 11): the labels and
// "Categories of {source}". What each deleted Server Action answered — its use case, its refusal as a
// code or as `{ ok: false }` — is what the route answers to the call that replaces it (`createLabel`,
// `saveLabel`, `deleteLabel` of `taxonomy-calls.ts`, `SOURCE_CATEGORY_CALLS`), and both leave the same
// rows. Two people alike: the old path writes for one, the new path for the other.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const transactions = await import("@ledgerly/domain/transactions");
const { listAccounts } = await import("@ledgerly/domain/accounts");
const { applyProviderAccounts } = await import("@domain/modules/accounts/service");
const source = await import("./source");

const contextFor = (userId: string): Ctx => ({
  userId,
  role: "user",
  locale: "en",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT",
  displayCurrency: "EUR",
});

let old: Ctx;
let now: Ctx;

beforeEach(async () => {
  await resetDatabase();
  old = contextFor((await createTestUser()).id);
  now = contextFor((await createTestUser()).id);
});

afterAll(closeDatabase);

/** One request to `/api/v1` as `ctx`, as the call sends it: its status and its body. */
async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

/** What the taxonomy calls answer: `{ ok: true }`, or the refusal's reason or code (`refused`). */
function taxonomyAnswer(answer: { status: number; body: { error?: string; reason?: string | null } | null }) {
  if (answer.status < 300) return { ok: true };
  return { ok: false, error: answer.body?.reason ?? answer.body?.error };
}

/** What `createLabelAction`, `saveLabelAction` and `deleteLabelAction` answered. */
async function oldLabel(work: () => Promise<unknown>) {
  try {
    await work();
    return { ok: true };
  } catch (error) {
    if (error instanceof transactions.TaxonomyError) return { ok: false, error: error.code };
    throw error;
  }
}

const labelsOf = async (ctx: Ctx) =>
  (await transactions.listLabelsWithUsage(ctx)).map(({ label, usage }) => ({
    name: label.name,
    color: label.color,
    usage,
  }));

describe("the labels, old action = new call", () => {
  it("answers and stores the same for a create, a change and a delete, and their refusals", async () => {
    const inputs = [
      { name: "Holiday", color: "#f59e0b" },
      { name: "holiday", color: null },
      { name: "   ", color: null },
      { name: "x".repeat(61), color: null },
      { name: "Trips", color: null },
    ];
    for (const input of inputs) {
      const before = await oldLabel(() => transactions.createLabel(old, input));
      expect(taxonomyAnswer(await send(now, "POST", "/labels", input))).toEqual(before);
    }
    expect(await labelsOf(now)).toEqual(await labelsOf(old));

    const idOf = async (ctx: Ctx, name: string) =>
      (await transactions.listLabelsWithUsage(ctx)).find(({ label }) => label.name === name)!.label.id;
    const changes = [
      { name: "Holidays", color: "#3366cc" },
      { name: "Trips", color: null },
      { name: "", color: null },
    ];
    const holiday = { old: await idOf(old, "Holiday"), now: await idOf(now, "Holiday") };
    for (const input of changes) {
      const before = await oldLabel(() => transactions.updateLabel(old, holiday.old, input));
      const after = await send(now, "PATCH", `/labels/${holiday.now}`, input);
      expect(taxonomyAnswer(after)).toEqual(before);
    }
    const missing = "0b6c3f9e-2d41-4a7b-9c8e-5f1a2b3c4d5e";
    expect(
      taxonomyAnswer(await send(now, "PATCH", `/labels/${missing}`, { name: "A", color: null })),
    ).toEqual(await oldLabel(() => transactions.updateLabel(old, missing, { name: "A", color: null })));
    expect(await labelsOf(now)).toEqual(await labelsOf(old));

    const trips = { old: await idOf(old, "Trips"), now: await idOf(now, "Trips") };
    for (let pass = 0; pass < 2; pass += 1) {
      const before = await oldLabel(() => transactions.deleteLabel(old, trips.old));
      expect(taxonomyAnswer(await send(now, "DELETE", `/labels/${trips.now}`))).toEqual(before);
    }
    expect(await labelsOf(now)).toEqual(await labelsOf(old));
  });
});

/** A source that gave two categories to the person's movements. */
async function sourceFor(ctx: Ctx) {
  await applyProviderAccounts(ctx, "plugin:wallet", [
    {
      provider: "plugin:wallet",
      providerAccountId: "acc-1",
      name: "Current",
      type: "checking",
      currency: "EUR",
    },
  ]);
  const [account] = await listAccounts(ctx);
  const incoming = (serial: number, id: string, name: string) => ({
    externalId: `ext-${serial}`,
    counterpartExternalId: null,
    occurredAt: new Date(Date.UTC(2026, 9, serial, 10)),
    amountCents: -1_000n,
    currency: "EUR",
    type: "expense" as const,
    state: "cleared" as const,
    payee: `Shop ${serial}`,
    note: null,
    categoryExternalId: id,
    categoryName: name,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  });
  await transactions.upsertFromProvider(
    ctx,
    account.id,
    [incoming(1, "sc-tobacco", "Tobacco"), incoming(2, "sc-alcohol", "Alcohol, tobacco")],
    { provider: "plugin:wallet" },
  );
  const rows = await transactions.listSourceCategories(ctx);
  const category = (await transactions.listCategories(ctx, { includeArchived: true })).find(
    (one) => one.name === "Alcohol, tobacco",
  )!;
  return { tobacco: rows.find((row) => row.name === "Tobacco")!.id, alcohol: category.id };
}

/** The old `setSourceCategoryAction`, `undoSourceCategoryAction`, `keepSourceCategoryAction`. */
const oldSource = {
  async set(ctx: Ctx, id: string, categoryId: string | null) {
    try {
      return { ok: true, ...(await source.setSourceCategory(ctx, { id, categoryId })) };
    } catch (error) {
      if (error instanceof transactions.SourceCategoryError) return { ok: false };
      throw error;
    }
  },
  async undo(ctx: Ctx, undoId: string) {
    return { ok: (await source.undoSourceCategoryChange(ctx, undoId)) !== null };
  },
  async keep(ctx: Ctx, id: string) {
    await transactions.keepSourceCategory(ctx, id);
    return { ok: true };
  },
};

/** What `SOURCE_CATEGORY_CALLS` answer: the change, or `{ ok: false }` for a refusal. */
const sourceAnswer = (answer: { status: number; body: unknown }) =>
  answer.status < 300 ? { ok: true, ...(answer.body as object) } : { ok: false };

const sourceRowsOf = async (ctx: Ctx) =>
  (await transactions.listSourceCategories(ctx)).map(({ name, choice, count, isNew }) => ({
    name,
    choice,
    count,
    isNew,
  }));

describe("the categories of a source, old action = new call", () => {
  it("answers and stores the same for a match, its undo, a refusal and «Keep as it is»", async () => {
    const before = await sourceFor(old);
    const after = await sourceFor(now);

    const matched = await oldSource.set(old, before.tobacco, before.alcohol);
    const sent = sourceAnswer(
      await send(now, "PUT", `/source-categories/${after.tobacco}`, { categoryId: after.alcohol }),
    );
    if (!("undoId" in matched) || !("undoId" in sent)) throw new Error("the match was refused");
    const { undoId: oldUndo, ...oldRest } = matched as { undoId: string };
    const { undoId: newUndo, ...newRest } = sent as { undoId: string };
    expect(newRest).toEqual(oldRest);
    expect(await sourceRowsOf(now)).toEqual(await sourceRowsOf(old));

    expect(sourceAnswer(await send(now, "POST", `/source-categories/undo/${newUndo}`))).toEqual(
      await oldSource.undo(old, oldUndo),
    );
    expect(sourceAnswer(await send(now, "POST", `/source-categories/undo/${newUndo}`))).toEqual(
      await oldSource.undo(old, oldUndo),
    );
    expect(await sourceRowsOf(now)).toEqual(await sourceRowsOf(old));

    // Another person's category: a refusal on both paths.
    expect(
      sourceAnswer(
        await send(now, "PUT", `/source-categories/${after.tobacco}`, { categoryId: before.alcohol }),
      ),
    ).toEqual(await oldSource.set(old, before.tobacco, after.alcohol));

    expect(sourceAnswer(await send(now, "POST", `/source-categories/${after.tobacco}/keep`))).toEqual(
      await oldSource.keep(old, before.tobacco),
    );
    expect(await sourceRowsOf(now)).toEqual(await sourceRowsOf(old));
  });
});

describe("the proposals to merge, page = new call", () => {
  it("answers each side as the page drew it, and whether two budgets are summed", async () => {
    const { createAccount } = await import("@domain/modules/accounts/service");
    const { createManualTransaction } = await import("@domain/modules/transactions/manual");
    const { mergeProposalsView } = await import("./merge");
    const tobacco = await transactions.createCategory(now, { name: "Tobacco" });
    await transactions.createCategory(now, { name: "Cigars", parentId: tobacco.id });
    const vices = await transactions.createCategory(now, { name: "Vices" });
    const both = await transactions.createCategory(now, { name: "Alcohol, tobacco", parentId: vices.id });
    const account = await createAccount(now, { name: "Cash", type: "cash" });
    for (const categoryId of [tobacco.id, both.id, both.id]) {
      await createManualTransaction(now, {
        kind: "expense",
        amountCents: 500n,
        on: "2026-11-02",
        accountId: account.id,
        categoryId,
        payee: "Shop",
        note: "",
      });
    }

    // What `settings/finance/page.tsx` drew from `mergeProposalsView` and the categories.
    const categories = await transactions.listCategoriesWithUsage(now, { includeArchived: true });
    const byId = new Map(categories.map(({ category }) => [category.id, category]));
    const hasChildren = (id: string) => categories.some((row) => row.category.parentId === id);
    const side = (category: { id: string; name: string; usage: number }, other: { id: string }) => ({
      id: category.id,
      name: category.name,
      color: transactions.colorOfCategory(byId.get(category.id)!, byId),
      usage: category.usage,
      hasChildren: hasChildren(category.id),
      canKeepOther: !(hasChildren(other.id) && byId.get(category.id)?.parentId !== null),
    });
    const page = (await mergeProposalsView(now)).map((proposal) => ({
      first: side(proposal.first, proposal.second),
      second: side(proposal.second, proposal.first),
      sumsBudgets: proposal.sumsBudgets,
    }));

    expect(page.some((one) => !one.first.canKeepOther || !one.second.canKeepOther)).toBe(true);
    const answer = await send(now, "GET", "/categories/merge-proposals");
    expect(answer).toEqual({ status: 200, body: { proposals: page } });
    expect(await send(old, "GET", "/categories/merge-proposals")).toEqual({
      status: 200,
      body: { proposals: [] },
    });
  });
});
