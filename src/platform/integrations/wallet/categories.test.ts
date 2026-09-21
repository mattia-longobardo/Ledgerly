// The two-way category sync of §9.1 (F6), end to end without a socket or a database: the plan is
// pure, and the pass is driven by a fake Wallet (a list of categories the fake writer really
// changes) and a fake of the transactions module's own service surface. Nothing here fakes the
// database — `service.itest.ts` and `taxonomy.itest.ts` cover the real writes — and no call leaves
// the process, which is what lets the same pass be run twice in a row to show it settles.
import { describe, expect, it } from "vitest";
import type { ProviderCategory } from "@/modules/transactions/service";
import {
  type CategoryCase,
  type CategoryStore,
  type CategorySyncOutcome,
  type CategoryWriteResult,
  createWalletCategoryWriter,
  MAX_RENAMES_PER_PASS,
  planCategorySync,
  RENAME_BATCH,
  syncWalletCategories,
  type WalletCategoryWriter,
} from "./categories";
import type { WalletCategory } from "./mapping";

const CTX = { userId: "11111111-1111-4111-8111-111111111111" };

function local(over: Partial<ProviderCategory> & Pick<ProviderCategory, "id" | "name">): ProviderCategory {
  return {
    type: "expense",
    parentId: "cat-group",
    archived: false,
    locallyEdited: [],
    providerName: null,
    externalId: null,
    groupExternalId: null,
    ...over,
  };
}

function remote(over: Partial<WalletCategory> & Pick<WalletCategory, "externalId" | "name">): WalletCategory {
  return {
    groupExternalId: "wg-casa",
    groupName: "Casa",
    systemId: null,
    custom: false,
    parentExternalId: null,
    archived: false,
    ...over,
  };
}

/** The group every fixture hangs from: mirrored from Wallet's "Casa" envelope, as F2.5 files it. */
function group(over: Partial<ProviderCategory> = {}): ProviderCategory {
  return local({
    id: "cat-group",
    name: "Casa",
    parentId: null,
    groupExternalId: "wg-casa",
    providerName: "Casa",
    ...over,
  });
}

/**
 * The transactions module's category surface, in memory. Every method keeps the same invariants
 * the real one does: a follow moves the baseline, a settle moves the baseline *and* drops the
 * `name` marker, a link fills the external id.
 */
function fakeStore(rows: ProviderCategory[]): CategoryStore & { rows: ProviderCategory[] } {
  const find = (id: string) => rows.find((row) => row.id === id);
  return {
    rows,
    async list() {
      return rows.map((row) => ({ ...row }));
    },
    async follow(_ctx, id, name) {
      const row = find(id);
      if (!row) return "not_found";
      if (rows.some((other) => other.id !== id && other.parentId === row.parentId && other.name === name)) {
        return "duplicate";
      }
      row.name = name;
      row.providerName = name;
      return "renamed";
    },
    async settle(_ctx, id, providerName) {
      const row = find(id);
      if (!row) return;
      row.providerName = providerName;
      row.locallyEdited = row.locallyEdited.filter((marker) => marker !== "name");
    },
    async link(_ctx, _provider, id, externalId, providerName) {
      const row = find(id);
      if (!row) return "conflict";
      if (rows.some((other) => other.externalId === externalId)) return "conflict";
      row.externalId = externalId;
      row.providerName = providerName;
      return "linked";
    },
    // `adoptOrCreateCategory` in miniature: the provider's group becomes the parent, a name
    // already here is adopted and linked rather than duplicated, and a new one is inserted.
    async adopt(_ctx, _provider, incoming) {
      const groupName = incoming.groupName?.trim() ?? "";
      let parentId: string | null = null;
      if (groupName !== "") {
        const group =
          rows.find((row) => row.groupExternalId === incoming.groupExternalId) ??
          rows.find((row) => row.parentId === null && row.name === groupName);
        if (group) parentId = group.id;
        else {
          parentId = `local-group-${rows.length + 1}`;
          rows.push({
            id: parentId,
            name: groupName,
            type: "expense",
            parentId: null,
            archived: false,
            locallyEdited: [],
            providerName: groupName,
            externalId: null,
            groupExternalId: incoming.groupExternalId,
          });
        }
      }
      const twin = rows.find((row) => row.parentId === parentId && row.name === incoming.name);
      if (twin) {
        twin.externalId = incoming.externalId;
        twin.providerName = incoming.name;
        return "linked";
      }
      rows.push({
        id: `local-${rows.length + 1}`,
        name: incoming.name,
        type: "expense",
        parentId,
        archived: false,
        locallyEdited: [],
        providerName: incoming.name,
        externalId: incoming.externalId,
        groupExternalId: null,
      });
      return "linked";
    },
  };
}

interface FakeWallet extends WalletCategoryWriter {
  categories: WalletCategory[];
  renames: { externalId: string; name: string }[][];
  creates: { name: string; parentExternalId: string }[];
  /** Every id a caller asked to delete: a pass must never put anything in here. */
  removals: string[];
}

/** A Wallet that really changes: what the writer sends it is what the next pass reads back. */
function fakeWallet(categories: WalletCategory[], refuse: ReadonlySet<string> = new Set()): FakeWallet {
  let made = 0;
  return {
    categories,
    renames: [],
    creates: [],
    removals: [],
    async remove(externalIds) {
      this.removals.push(...externalIds);
      return externalIds.map((externalId) => {
        const at = categories.findIndex((category) => category.externalId === externalId);
        if (at >= 0) categories.splice(at, 1);
        return { externalId, ok: at >= 0, error: at >= 0 ? null : "not found" };
      });
    },
    async rename(items) {
      expect(items.length).toBeLessThanOrEqual(RENAME_BATCH);
      this.renames.push(items.map((item) => ({ ...item })));
      const results: CategoryWriteResult[] = [];
      for (const item of items) {
        if (refuse.has(item.externalId)) {
          results.push({ externalId: item.externalId, ok: false, error: "name already used" });
          continue;
        }
        const row = categories.find((category) => category.externalId === item.externalId);
        if (row) row.name = item.name;
        results.push({ externalId: item.externalId, ok: true, error: null });
      }
      return results;
    },
    async create(input) {
      this.creates.push({ ...input });
      made += 1;
      const parent = categories.find((category) => category.externalId === input.parentExternalId);
      const created = remote({
        externalId: `wc-made-${made}`,
        name: input.name,
        groupExternalId: parent?.groupExternalId ?? null,
        groupName: parent?.groupName ?? null,
        custom: true,
        parentExternalId: input.parentExternalId,
      });
      categories.push(created);
      return { externalId: created.externalId };
    },
  };
}

function kinds(outcome: CategorySyncOutcome): CategoryCase["kind"][] {
  return outcome.cases.map((one) => one.kind);
}

describe("planCategorySync", () => {
  it("adopts the name Wallet changed when nothing changed here", () => {
    const plan = planCategorySync(
      [group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-1", providerName: "Spesa" })],
      [remote({ externalId: "wg-base", name: "Casa" }), remote({ externalId: "wc-1", name: "Spesa grande" })],
    );
    expect(plan.adopt).toEqual([{ categoryId: "cat-1", name: "Spesa grande" }]);
    expect(plan.push).toEqual([]);
    expect(plan.cases).toEqual([]);
  });

  it("writes the name changed here to Wallet, and says nothing about it", () => {
    const plan = planCategorySync(
      [
        group(),
        local({
          id: "cat-1",
          name: "Spesa grande",
          externalId: "wc-1",
          providerName: "Spesa",
          locallyEdited: ["name"],
        }),
      ],
      [remote({ externalId: "wc-1", name: "Spesa" })],
    );
    expect(plan.push).toEqual([{ categoryId: "cat-1", externalId: "wc-1", name: "Spesa grande" }]);
    expect(plan.adopt).toEqual([]);
    expect(plan.cases).toEqual([]);
  });

  it("lets the local name win when both sides changed, and reports it", () => {
    const plan = planCategorySync(
      [
        group(),
        local({
          id: "cat-1",
          name: "Spesa di casa",
          externalId: "wc-1",
          providerName: "Spesa",
          locallyEdited: ["name"],
        }),
      ],
      [remote({ externalId: "wc-1", name: "Spesa grande" })],
    );
    expect(plan.push).toEqual([{ categoryId: "cat-1", externalId: "wc-1", name: "Spesa di casa" }]);
    expect(plan.cases).toEqual([
      {
        kind: "conflict",
        categoryId: "cat-1",
        externalId: "wc-1",
        local: "Spesa di casa",
        remote: "Spesa grande",
      },
    ]);
  });

  it("falls back to the old rule for a row with no baseline: a local edit wins, otherwise Wallet", () => {
    const edited = planCategorySync(
      [group(), local({ id: "cat-1", name: "Mia", externalId: "wc-1", locallyEdited: ["name"] })],
      [remote({ externalId: "wc-1", name: "Sua" })],
    );
    // No baseline means nobody can prove Wallet did not change too, so it is reported as a clash.
    expect(edited.push).toEqual([{ categoryId: "cat-1", externalId: "wc-1", name: "Mia" }]);
    expect(kinds({ counts: {}, cases: edited.cases })).toEqual(["conflict"]);

    const untouched = planCategorySync(
      [group(), local({ id: "cat-1", name: "Mia", externalId: "wc-1" })],
      [remote({ externalId: "wc-1", name: "Sua" })],
    );
    expect(untouched.adopt).toEqual([{ categoryId: "cat-1", name: "Sua" }]);
  });

  it("reports a category that is gone from Wallet and deletes nothing", () => {
    const plan = planCategorySync(
      [group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-gone", providerName: "Spesa" })],
      [remote({ externalId: "wc-1", name: "Altro" })],
    );
    expect(plan.cases).toEqual([
      { kind: "gone_from_wallet", categoryId: "cat-1", externalId: "wc-gone", local: "Spesa", remote: null },
    ]);
    expect(plan.adopt).toEqual([]);
    expect(plan.push).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("never changes a type: Wallet filing it as a transfer is reported, not applied", () => {
    const plan = planCategorySync(
      [
        group(),
        local({
          id: "cat-1",
          name: "Giroconto",
          type: "expense",
          externalId: "wc-1",
          providerName: "Giroconto",
        }),
      ],
      [remote({ externalId: "wc-1", name: "Giroconto", systemId: "system_categories__transfer" })],
    );
    expect(plan.cases).toEqual([
      {
        kind: "type_mismatch",
        categoryId: "cat-1",
        externalId: "wc-1",
        local: "expense",
        remote: "transfer",
      },
    ]);
    expect(plan.adopt).toEqual([]);
    expect(plan.push).toEqual([]);
  });

  it("keeps the local name when Wallet's does not fit this app's column", () => {
    const tooLong = "Spesa ".repeat(11).trim();
    expect(tooLong.length).toBeGreaterThan(60);
    const plan = planCategorySync(
      [group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-1", providerName: "Spesa" })],
      [remote({ externalId: "wc-1", name: tooLong })],
    );
    expect(plan.adopt).toEqual([]);
    expect(kinds({ counts: {}, cases: plan.cases })).toEqual(["name_too_long"]);
  });

  it("refuses to adopt a name a sibling already holds", () => {
    const plan = planCategorySync(
      [
        group(),
        local({ id: "cat-1", name: "Spesa", externalId: "wc-1", providerName: "Spesa" }),
        local({ id: "cat-2", name: "Bollette", externalId: "wc-2", providerName: "Bollette" }),
      ],
      [remote({ externalId: "wc-1", name: "Bollette" }), remote({ externalId: "wc-2", name: "Bollette" })],
    );
    expect(plan.adopt).toEqual([]);
    expect(kinds({ counts: {}, cases: plan.cases })).toEqual(["duplicate_name"]);
  });

  it("says a group renamed here cannot reach Wallet, because no endpoint carries one", () => {
    const plan = planCategorySync(
      [group({ name: "Casa mia", externalId: "wc-group", locallyEdited: ["name"] })],
      [remote({ externalId: "wc-group", name: "Casa" })],
    );
    expect(plan.push).toEqual([]);
    expect(kinds({ counts: {}, cases: plan.cases })).toEqual(["group_not_writable"]);
  });

  it("reads an empty answer as no answer, never as ninety-one categories gone", () => {
    const plan = planCategorySync([group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-1" })], []);
    expect(plan).toEqual({ adopt: [], push: [], settle: [], create: [], add: [], cases: [] });
  });
});

describe("syncWalletCategories", () => {
  it("writes a rename made here to Wallet, once, and settles", async () => {
    const store = fakeStore([
      group(),
      local({
        id: "cat-1",
        name: "Spesa grande",
        externalId: "wc-1",
        providerName: "Spesa",
        locallyEdited: ["name"],
      }),
    ]);
    const wallet = fakeWallet([remote({ externalId: "wc-1", name: "Spesa" })]);

    const first = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(first.counts.categoriesPushed).toBe(1);
    expect(wallet.categories[0].name).toBe("Spesa grande");
    expect(store.rows[1]).toMatchObject({
      name: "Spesa grande",
      providerName: "Spesa grande",
      locallyEdited: [],
    });

    const second = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(second.counts).toEqual({
      categoriesAdded: 0,
      categoriesAdopted: 0,
      categoriesPushed: 0,
      categoriesCreated: 0,
      categoriesReported: 0,
    });
    expect(wallet.renames).toHaveLength(1);
  });

  /*
    Wallet publishes its whole list (`GET /categories`), so a category added there is taken on here
    at the next sync instead of waiting for a movement to be filed under it (owner, 2026-09-20).
  */
  describe("categories Wallet has and this app has not", () => {
    it("takes a new one on, under the group it hangs from", async () => {
      const store = fakeStore([group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-1" })]);
      const outcome = await syncWalletCategories(CTX, {
        remote: [
          remote({ externalId: "wc-1", name: "Spesa" }),
          remote({ externalId: "wc-2", name: "Bollette" }),
        ],
        writer: null,
        store,
      });
      expect(outcome.counts.categoriesAdded).toBe(1);
      expect(store.rows.map((row) => row.name)).toContain("Bollette");
      expect(store.rows.find((row) => row.name === "Bollette")).toMatchObject({
        externalId: "wc-2",
        parentId: "cat-group",
      });
    });

    it("takes nothing on twice, and leaves an archived one alone", async () => {
      const store = fakeStore([group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-1" })]);
      const wallet = [
        // The group itself comes back in the list: it is mirrored here as the local parent, whose
        // link is `groupExternalId`, and taking it on again would add a twin every hour.
        remote({ externalId: "wg-casa", name: "Casa", groupExternalId: null, groupName: null }),
        remote({ externalId: "wc-1", name: "Spesa" }),
        remote({ externalId: "wc-9", name: "Vecchia", archived: true }),
      ];
      const first = await syncWalletCategories(CTX, { remote: wallet, writer: null, store });
      expect(first.counts.categoriesAdded).toBe(0);
      const second = await syncWalletCategories(CTX, { remote: wallet, writer: null, store });
      expect(second.counts.categoriesAdded).toBe(0);
      expect(store.rows).toHaveLength(2);
    });

    it("reports a name this app's column cannot hold, and takes the rest on", async () => {
      const store = fakeStore([group()]);
      const outcome = await syncWalletCategories(CTX, {
        remote: [
          remote({ externalId: "wc-2", name: "x".repeat(80) }),
          remote({ externalId: "wc-3", name: "Gas" }),
        ],
        writer: null,
        store,
      });
      expect(outcome.counts.categoriesAdded).toBe(1);
      expect(outcome.cases.map((one) => one.kind)).toContain("name_too_long");
    });
  });

  it("adopts a rename made in Wallet, and does not send it back", async () => {
    const store = fakeStore([
      group(),
      local({ id: "cat-1", name: "Spesa", externalId: "wc-1", providerName: "Spesa" }),
    ]);
    const wallet = fakeWallet([remote({ externalId: "wc-1", name: "Spesa grande" })]);

    const first = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(first.counts.categoriesAdopted).toBe(1);
    expect(store.rows[1]).toMatchObject({ name: "Spesa grande", providerName: "Spesa grande" });
    expect(wallet.renames).toEqual([]);

    const second = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(second.cases).toEqual([]);
    expect(wallet.renames).toEqual([]);
    expect(store.rows[1].name).toBe("Spesa grande");
  });

  it("gives the local name the last word when both sides changed, and reports the case", async () => {
    const store = fakeStore([
      group(),
      local({
        id: "cat-1",
        name: "Spesa di casa",
        externalId: "wc-1",
        providerName: "Spesa",
        locallyEdited: ["name"],
      }),
    ]);
    const wallet = fakeWallet([remote({ externalId: "wc-1", name: "Spesa grande" })]);

    const first = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(kinds(first)).toEqual(["conflict"]);
    expect(store.rows[1].name).toBe("Spesa di casa");
    expect(wallet.categories[0].name).toBe("Spesa di casa");

    // And the case does not come back for ever: the two agree now.
    const second = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(second.cases).toEqual([]);
    expect(second.counts.categoriesPushed).toBe(0);
  });

  it("creates a category made here in Wallet exactly once", async () => {
    const store = fakeStore([group(), local({ id: "cat-1", name: "Cane" })]);
    const wallet = fakeWallet([remote({ externalId: "wc-base", name: "Casa" })]);

    const first = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(first.counts.categoriesCreated).toBe(1);
    expect(wallet.creates).toEqual([{ name: "Cane", parentExternalId: "wc-base" }]);
    expect(store.rows[1]).toMatchObject({ externalId: "wc-made-1", providerName: "Cane" });

    const second = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(second.counts.categoriesCreated).toBe(0);
    expect(wallet.creates).toHaveLength(1);
    expect(wallet.categories.filter((row) => row.name === "Cane")).toHaveLength(1);
    expect(second.cases).toEqual([]);
  });

  it("leaves a category alone when Wallet's group has no base category to hang it from", async () => {
    const store = fakeStore([group({ groupExternalId: "wg-nowhere" }), local({ id: "cat-1", name: "Cane" })]);
    const wallet = fakeWallet([remote({ externalId: "wc-base", name: "Casa" })]);

    const outcome = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(wallet.creates).toEqual([]);
    expect(kinds(outcome)).toEqual(["not_creatable"]);
  });

  it("never creates a group there, and never reports one it could not have created", async () => {
    const store = fakeStore([group({ groupExternalId: null, providerName: null })]);
    const wallet = fakeWallet([remote({ externalId: "wc-base", name: "Casa" })]);

    const outcome = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(wallet.creates).toEqual([]);
    expect(outcome.cases).toEqual([]);
  });

  it("keeps a write Wallet refused out of the baseline, so the next pass tries again", async () => {
    const store = fakeStore([
      group(),
      local({
        id: "cat-1",
        name: "Spesa grande",
        externalId: "wc-1",
        providerName: "Spesa",
        locallyEdited: ["name"],
      }),
    ]);
    const wallet = fakeWallet([remote({ externalId: "wc-1", name: "Spesa" })], new Set(["wc-1"]));

    const first = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(kinds(first)).toEqual(["write_failed"]);
    expect(store.rows[1]).toMatchObject({ providerName: "Spesa", locallyEdited: ["name"] });

    const second = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(kinds(second)).toEqual(["write_failed"]);
    expect(wallet.renames).toHaveLength(2);
  });

  it("does the Wallet → here half with no writer at all, and writes nothing back", async () => {
    const store = fakeStore([
      group(),
      local({ id: "cat-1", name: "Spesa", externalId: "wc-1", providerName: "Spesa" }),
      local({
        id: "cat-2",
        name: "Bollette mie",
        externalId: "wc-2",
        providerName: "Bollette",
        locallyEdited: ["name"],
      }),
    ]);
    const outcome = await syncWalletCategories(CTX, {
      remote: [
        remote({ externalId: "wc-1", name: "Spesa grande" }),
        remote({ externalId: "wc-2", name: "Bollette" }),
      ],
      writer: null,
      store,
    });
    expect(outcome.counts.categoriesAdopted).toBe(1);
    expect(store.rows[2].name).toBe("Bollette mie");
  });

  it("writes in batches of ten and leaves the rest to the next pass", async () => {
    const many = MAX_RENAMES_PER_PASS + 3;
    const rows: ProviderCategory[] = [group()];
    const wallet = fakeWallet([remote({ externalId: "wc-base", name: "Casa" })]);
    for (let index = 0; index < many; index += 1) {
      const externalId = `wc-${String(index).padStart(3, "0")}`;
      rows.push(
        local({
          id: `cat-${String(index).padStart(3, "0")}`,
          name: `Nuovo ${index}`,
          externalId,
          providerName: `Vecchio ${index}`,
          locallyEdited: ["name"],
        }),
      );
      wallet.categories.push(remote({ externalId, name: `Vecchio ${index}` }));
    }
    const store = fakeStore(rows);

    const first = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(first.counts.categoriesPushed).toBe(MAX_RENAMES_PER_PASS);
    expect(wallet.renames.map((batch) => batch.length)).toEqual([RENAME_BATCH, RENAME_BATCH, RENAME_BATCH]);
    expect(kinds(first)).toEqual(["deferred", "deferred", "deferred"]);

    const second = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(second.counts.categoriesPushed).toBe(3);
    expect(second.cases).toEqual([]);

    const third = await syncWalletCategories(CTX, { remote: wallet.categories, writer: wallet, store });
    expect(third.counts).toMatchObject({ categoriesPushed: 0, categoriesReported: 0 });
  });
});

describe("createWalletCategoryWriter", () => {
  function writerOn(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetcher = (async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        method: String(init.method),
        body: init.body === undefined ? null : JSON.parse(String(init.body)),
      });
      return handler(String(url), init);
    }) as unknown as typeof globalThis.fetch;
    return {
      calls,
      writer: createWalletCategoryWriter("tok", { fetch: fetcher, baseUrl: "https://wallet.test/v1/api" }),
    };
  }

  const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("sends a PATCH of {id, name} and reads the per-item results back by inputIndex", async () => {
    const { calls, writer } = writerOn(() =>
      answer({
        results: [
          { inputIndex: 1, id: "wc-2", success: true },
          { inputIndex: 0, id: "wc-1", success: false, error: "name already used" },
        ],
      }),
    );
    const results = await writer.rename([
      { externalId: "wc-1", name: "Uno" },
      { externalId: "wc-2", name: "Due" },
    ]);
    expect(calls).toEqual([
      {
        url: "https://wallet.test/v1/api/categories",
        method: "PATCH",
        body: [
          { id: "wc-1", name: "Uno" },
          { id: "wc-2", name: "Due" },
        ],
      },
    ]);
    expect(results).toEqual([
      { externalId: "wc-1", ok: false, error: "name already used" },
      { externalId: "wc-2", ok: true, error: null },
    ]);
  });

  it("treats 207 as an answer to read, not as a failure", async () => {
    const { writer } = writerOn(() =>
      answer({ results: [{ inputIndex: 0, id: "wc-1", success: true }] }, 207),
    );
    expect(await writer.rename([{ externalId: "wc-1", name: "Uno" }])).toEqual([
      { externalId: "wc-1", ok: true, error: null },
    ]);
  });

  it("refuses a batch bigger than Wallet's own limit before sending it", async () => {
    const { calls, writer } = writerOn(() => answer({ results: [] }));
    const items = Array.from({ length: RENAME_BATCH + 1 }, (_, index) => ({
      externalId: `wc-${index}`,
      name: `Nome ${index}`,
    }));
    await expect(writer.rename(items)).rejects.toThrow(/at most 10/);
    expect(calls).toEqual([]);
  });

  it("posts a custom subcategory under a base category and returns its id", async () => {
    const { calls, writer } = writerOn(() => answer({ category: { id: "wc-new" } }, 201));
    expect(await writer.create({ name: "Cane", parentExternalId: "wc-base" })).toEqual({
      externalId: "wc-new",
    });
    expect(calls).toEqual([
      {
        url: "https://wallet.test/v1/api/categories/custom",
        method: "POST",
        body: { name: "Cane", parentId: "wc-base" },
      },
    ]);
  });

  it("answers an unreadable creation as unsure rather than failing", async () => {
    const { writer } = writerOn(() => answer({ ok: true }, 201));
    expect(await writer.create({ name: "Cane", parentExternalId: "wc-base" })).toEqual({ externalId: null });
  });

  it("fails at once on a refused token, and never writes twice on a 500", async () => {
    const { writer } = writerOn(() => answer({ error: "nope" }, 401));
    await expect(writer.rename([{ externalId: "wc-1", name: "Uno" }])).rejects.toMatchObject({
      kind: "token_rejected",
    });

    const server = writerOn(() => answer({ error: "boom" }, 500));
    await expect(server.writer.rename([{ externalId: "wc-1", name: "Uno" }])).rejects.toMatchObject({
      kind: "http",
      status: 500,
    });
    expect(server.calls).toHaveLength(1);
  });

  it("never lets the token into a message", async () => {
    const { writer } = writerOn(() => {
      throw new Error("connect ECONNREFUSED with Bearer tok");
    });
    await expect(writer.rename([{ externalId: "wc-1", name: "Uno" }])).rejects.toMatchObject({
      message: expect.not.stringContaining("Bearer tok"),
    });
  });
});
