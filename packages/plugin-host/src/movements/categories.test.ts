// The two-way category sync of §9.1 (F6), end to end without a socket or a database: the plan is
// pure, and the pass is driven by a fake Wallet (a list of categories the fake writer really
// changes) and a fake of the transactions module's own service surface. Nothing here fakes the
// database — `service.itest.ts` and `taxonomy.itest.ts` cover the real writes — and no call leaves
// the process, which is what lets the same pass be run twice in a row to show it settles.
import { describe, expect, it } from "vitest";
import type { ProviderCategory } from "./ports";
import {
  type CategoryStore,
  type CategorySyncOutcome,
  type CategoryWriteResult,
  MAX_RENAMES_PER_PASS,
  RENAME_BATCH,
  syncSourceCategories,
  type SourceCategoryWriter,
} from "./categories";
import { type CategoryCase, planCategorySync } from "./category-plan";

/** What `categories.name` holds here (spec §6). */
const NAME_HERE = 60;
const planHere = (local: readonly ProviderCategory[], remote: readonly SourceCategory[]) =>
  planCategorySync(local, remote, NAME_HERE);
import type { SourceCategory } from "./calls";

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

function remote(over: Partial<SourceCategory> & Pick<SourceCategory, "externalId" | "name">): SourceCategory {
  return {
    groupExternalId: "wg-casa",
    groupName: "Casa",
    transfer: false,
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
    nameMax: NAME_HERE,
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
    async link(_ctx, _provider, { id, externalId, providerName }) {
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

interface FakeWallet extends SourceCategoryWriter {
  categories: SourceCategory[];
  renames: { externalId: string; name: string }[][];
  creates: { name: string; parentExternalId: string }[];
  /** Every id a caller asked to delete: a pass must never put anything in here. */
  removals: string[];
}

/** A Wallet that really changes: what the writer sends it is what the next pass reads back. */
function fakeWallet(categories: SourceCategory[], refuse: ReadonlySet<string> = new Set()): FakeWallet {
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
        return { externalId, ok: at >= 0 };
      });
    },
    async rename(items) {
      expect(items.length).toBeLessThanOrEqual(RENAME_BATCH);
      this.renames.push(items.map((item) => ({ ...item })));
      const results: CategoryWriteResult[] = [];
      for (const item of items) {
        if (refuse.has(item.externalId)) {
          results.push({ externalId: item.externalId, ok: false });
          continue;
        }
        const row = categories.find((category) => category.externalId === item.externalId);
        if (row) row.name = item.name;
        results.push({ externalId: item.externalId, ok: true });
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
    const plan = planHere(
      [group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-1", providerName: "Spesa" })],
      [remote({ externalId: "wg-base", name: "Casa" }), remote({ externalId: "wc-1", name: "Spesa grande" })],
    );
    expect(plan.adopt).toEqual([{ categoryId: "cat-1", name: "Spesa grande" }]);
    expect(plan.push).toEqual([]);
    expect(plan.cases).toEqual([]);
  });

  it("writes the name changed here to Wallet, and says nothing about it", () => {
    const plan = planHere(
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
    const plan = planHere(
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
    const edited = planHere(
      [group(), local({ id: "cat-1", name: "Mia", externalId: "wc-1", locallyEdited: ["name"] })],
      [remote({ externalId: "wc-1", name: "Sua" })],
    );
    // No baseline means nobody can prove Wallet did not change too, so it is reported as a clash.
    expect(edited.push).toEqual([{ categoryId: "cat-1", externalId: "wc-1", name: "Mia" }]);
    expect(kinds({ counts: {}, cases: edited.cases })).toEqual(["conflict"]);

    const untouched = planHere(
      [group(), local({ id: "cat-1", name: "Mia", externalId: "wc-1" })],
      [remote({ externalId: "wc-1", name: "Sua" })],
    );
    expect(untouched.adopt).toEqual([{ categoryId: "cat-1", name: "Sua" }]);
  });

  it("reports a category that is gone from Wallet and deletes nothing", () => {
    const plan = planHere(
      [group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-gone", providerName: "Spesa" })],
      [remote({ externalId: "wc-1", name: "Altro" })],
    );
    expect(plan.cases).toEqual([
      { kind: "gone_from_source", categoryId: "cat-1", externalId: "wc-gone", local: "Spesa", remote: null },
    ]);
    expect(plan.adopt).toEqual([]);
    expect(plan.push).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("never changes a type: Wallet filing it as a transfer is reported, not applied", () => {
    const plan = planHere(
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
      [remote({ externalId: "wc-1", name: "Giroconto", transfer: true })],
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
    const plan = planHere(
      [group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-1", providerName: "Spesa" })],
      [remote({ externalId: "wc-1", name: tooLong })],
    );
    expect(plan.adopt).toEqual([]);
    expect(kinds({ counts: {}, cases: plan.cases })).toEqual(["name_too_long"]);
  });

  it("refuses to adopt a name a sibling already holds", () => {
    const plan = planHere(
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
    const plan = planHere(
      [group({ name: "Casa mia", externalId: "wc-group", locallyEdited: ["name"] })],
      [remote({ externalId: "wc-group", name: "Casa" })],
    );
    expect(plan.push).toEqual([]);
    expect(kinds({ counts: {}, cases: plan.cases })).toEqual(["group_not_writable"]);
  });

  it("reads an empty answer as no answer, never as ninety-one categories gone", () => {
    const plan = planHere([group(), local({ id: "cat-1", name: "Spesa", externalId: "wc-1" })], []);
    expect(plan).toEqual({ adopt: [], push: [], settle: [], create: [], add: [], cases: [] });
  });
});

describe("syncSourceCategories", () => {
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

    const first = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(first.counts.categoriesPushed).toBe(1);
    expect(wallet.categories[0].name).toBe("Spesa grande");
    expect(store.rows[1]).toMatchObject({
      name: "Spesa grande",
      providerName: "Spesa grande",
      locallyEdited: [],
    });

    const second = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
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
      const outcome = await syncSourceCategories(CTX, {
        provider: "plugin:wallet",
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
      const first = await syncSourceCategories(CTX, {
        provider: "plugin:wallet",
        remote: wallet,
        writer: null,
        store,
      });
      expect(first.counts.categoriesAdded).toBe(0);
      const second = await syncSourceCategories(CTX, {
        provider: "plugin:wallet",
        remote: wallet,
        writer: null,
        store,
      });
      expect(second.counts.categoriesAdded).toBe(0);
      expect(store.rows).toHaveLength(2);
    });

    it("reports a name this app's column cannot hold, and takes the rest on", async () => {
      const store = fakeStore([group()]);
      const outcome = await syncSourceCategories(CTX, {
        provider: "plugin:wallet",
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

    const first = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(first.counts.categoriesAdopted).toBe(1);
    expect(store.rows[1]).toMatchObject({ name: "Spesa grande", providerName: "Spesa grande" });
    expect(wallet.renames).toEqual([]);

    const second = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
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

    const first = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(kinds(first)).toEqual(["conflict"]);
    expect(store.rows[1].name).toBe("Spesa di casa");
    expect(wallet.categories[0].name).toBe("Spesa di casa");

    // And the case does not come back for ever: the two agree now.
    const second = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(second.cases).toEqual([]);
    expect(second.counts.categoriesPushed).toBe(0);
  });

  it("creates a category made here in Wallet exactly once", async () => {
    const store = fakeStore([group(), local({ id: "cat-1", name: "Cane" })]);
    const wallet = fakeWallet([remote({ externalId: "wc-base", name: "Casa" })]);

    const first = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(first.counts.categoriesCreated).toBe(1);
    expect(wallet.creates).toEqual([{ name: "Cane", parentExternalId: "wc-base" }]);
    expect(store.rows[1]).toMatchObject({ externalId: "wc-made-1", providerName: "Cane" });

    const second = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(second.counts.categoriesCreated).toBe(0);
    expect(wallet.creates).toHaveLength(1);
    expect(wallet.categories.filter((row) => row.name === "Cane")).toHaveLength(1);
    expect(second.cases).toEqual([]);
  });

  it("leaves a category alone when Wallet's group has no base category to hang it from", async () => {
    const store = fakeStore([group({ groupExternalId: "wg-nowhere" }), local({ id: "cat-1", name: "Cane" })]);
    const wallet = fakeWallet([remote({ externalId: "wc-base", name: "Casa" })]);

    const outcome = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(wallet.creates).toEqual([]);
    expect(kinds(outcome)).toEqual(["not_creatable"]);
  });

  it("never creates a group there, and never reports one it could not have created", async () => {
    const store = fakeStore([group({ groupExternalId: null, providerName: null })]);
    const wallet = fakeWallet([remote({ externalId: "wc-base", name: "Casa" })]);

    const outcome = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
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

    const first = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(kinds(first)).toEqual(["write_failed"]);
    expect(store.rows[1]).toMatchObject({ providerName: "Spesa", locallyEdited: ["name"] });

    const second = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
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
    const outcome = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
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

    const first = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(first.counts.categoriesPushed).toBe(MAX_RENAMES_PER_PASS);
    expect(wallet.renames.map((batch) => batch.length)).toEqual([RENAME_BATCH, RENAME_BATCH, RENAME_BATCH]);
    expect(kinds(first)).toEqual(["deferred", "deferred", "deferred"]);

    const second = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(second.counts.categoriesPushed).toBe(3);
    expect(second.cases).toEqual([]);

    const third = await syncSourceCategories(CTX, {
      provider: "plugin:wallet",
      remote: wallet.categories,
      writer: wallet,
      store,
    });
    expect(third.counts).toMatchObject({ categoriesPushed: 0, categoriesReported: 0 });
  });
});
