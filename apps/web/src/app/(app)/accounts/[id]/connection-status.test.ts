// Parity of the short row of an account's page (ux n2 §3.3): the row the browser says from
// `GET /connections` is the row the server built until R3 (`connectionRows().row()`, with the
// capabilities the account's page gave it), word for word, in both languages.
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, RecentRun } from "@ledgerly/domain/platform/integrations";
import en from "../../../../../../../messages/en.json";
import it_ from "../../../../../../../messages/it.json";
import { type Capabilities, connectionRows } from "../../settings/plugins/connection-view";
import { statusOf } from "../../settings/plugins/connection-state";
import { type ApiConnection, connectionStatus } from "./connection-status";

const CATALOGUES = { en, it: it_ };
let locale: "en" | "it" = "en";

vi.mock("@/app/plugin-wiring", () => ({}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale,
      messages: CATALOGUES[locale],
      namespace: namespace as "settings.connections",
    }),
}));

const NOW = new Date("2026-11-19T15:00:00.000Z");
const ZONE = "Europe/Rome";
const HOUR = 3_600_000;
const BANK = "plugin:enablebanking";

interface Case {
  provider?: string;
  connection?: Partial<Connection>;
  providerActive?: boolean;
  accountsChosen?: boolean;
  keyRefused?: boolean;
  nextAttempt?: Date | null;
  running?: boolean;
  /** A service of Investments: its key is replaced on its own page. */
  keyHref?: string | null;
}

const CASES: Record<string, Case> = {
  "up to date, two hours ago": { connection: { lastOkAt: new Date(NOW.getTime() - 2 * HOUR) } },
  "up to date, a few minutes ago": { connection: { lastOkAt: new Date(NOW.getTime() - 5 * 60_000) } },
  "up to date, yesterday": { connection: { lastOkAt: new Date(NOW.getTime() - 20 * HOUR) } },
  "up to date, days ago": { connection: { lastOkAt: new Date(NOW.getTime() - 5 * 24 * HOUR) } },
  "late after a failure": {
    connection: { lastOkAt: new Date(NOW.getTime() - 26 * HOUR), consecutiveFailures: 2 },
  },
  "late, never read": { connection: { lastOkAt: null } },
  "late, the provider asked to wait": {
    provider: BANK,
    connection: { errorCode: "rate_limited" },
    nextAttempt: new Date(NOW.getTime() + 30 * HOUR),
  },
  "a bank's access ended": { provider: BANK, connection: { expiresAt: new Date(NOW.getTime() - HOUR) } },
  "a bank's key refused": { provider: BANK, keyRefused: true },
  "a source's key refused": { connection: { state: "revoked" } },
  "a service's key refused": { connection: { state: "revoked" }, keyHref: "/investments/a1/connection" },
  "a bank's accounts not chosen": { provider: BANK, accountsChosen: false },
  "no schedule": { connection: { schedule: { rules: [] } } },
  "a plugin turned off": { provider: BANK, providerActive: false },
  "a plugin turned off, its key refused": { provider: BANK, providerActive: false, keyRefused: true },
  "a reading running": { running: true },
};

function connectionOf(one: Case): Connection {
  return {
    id: "c1",
    provider: one.provider ?? "wallet",
    instanceKey: "",
    expiresAt: null,
    state: "active",
    lastOkAt: new Date(NOW.getTime() - HOUR),
    lastError: null,
    errorCode: null,
    consecutiveFailures: 0,
    schedule: { rules: [{ kind: "times", times: ["07:00", "19:00"], days: { kind: "every" } }] },
    nextSyncAt: new Date(NOW.getTime() + 3 * HOUR),
    ibanConflicts: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...one.connection,
  } as Connection;
}

/** The capabilities the account's page gave the server's row (`connection-status.ts` until R3). */
function capabilitiesOf(one: Case, connection: Connection): Capabilities {
  if (!connection.provider.startsWith("plugin:")) {
    return { update: true, replaceKey: one.keyHref ?? "/settings/plugins" };
  }
  return one.providerActive === false
    ? { update: false }
    : {
        update: true,
        renewHref: `/banks/connect?renew=${connection.id}`,
        replaceKey: "/settings/plugins?replace=1",
        chooseAccountsHref: `/banks/connect?step=accounts&c=${connection.id}`,
      };
}

describe("the state of an account's connection", () => {
  beforeEach(() => {
    locale = "en";
  });

  for (const language of ["en", "it"] as const) {
    for (const [name, one] of Object.entries(CASES)) {
      it(`says what the server's row said (${language}): ${name}`, async () => {
        locale = language;
        const connection = connectionOf(one);
        const runs: RecentRun[] = one.running
          ? [
              {
                connectionId: connection.id,
                kind: "transactions",
                state: "running",
                origin: "manual",
                errorCode: null,
                counts: null,
                startedAt: new Date(NOW.getTime() - 60_000),
              },
            ]
          : [];
        const facts = {
          connection,
          runs,
          providerActive: one.providerActive ?? true,
          accountsChosen: one.accountsChosen ?? true,
          keyRefused: one.keyRefused ?? false,
          nextAttempt: one.nextAttempt ?? null,
        };
        const label = { name: "North Bank", provider: "Enable Banking" };
        // The connection as `GET /connections` answers it (`connection-list.ts`).
        const answer = {
          id: connection.id,
          provider: connection.provider,
          name: label.name,
          providerName: label.provider,
          lastOkAt: connection.lastOkAt?.toISOString() ?? null,
          nextSyncAt: connection.nextSyncAt?.toISOString() ?? null,
          nextAttempt: facts.nextAttempt?.toISOString() ?? null,
          providerActive: facts.providerActive,
          status: statusOf(facts, NOW),
        } as ApiConnection;
        // The server's row, built from the same answer since R3-coda (`connection-view.ts`).
        const server = (await connectionRows({ locale: language, timeZone: ZONE }, NOW)).row({
          connection: {
            ...answer,
            expiresAt: connection.expiresAt?.toISOString() ?? null,
            ibanConflicts: [],
            runs: runs.map((run) => ({ ...run, startedAt: run.startedAt.toISOString() })),
          },
          detail: null,
          capabilities: capabilitiesOf(one, connection),
        });
        const text = createTranslator({
          locale: language,
          messages: CATALOGUES[language],
          namespace: "settings.connections",
        });
        const client = connectionStatus(
          text,
          answer,
          { locale: language, timeZone: ZONE, keyHref: one.keyHref ?? null },
          NOW,
        );

        expect(client).toEqual(server.status);
      });
    }
  }

  it("covers every state of the row", () => {
    const said = new Set(
      Object.values(CASES).map((one) => {
        const connection = connectionOf(one);
        return statusOf(
          {
            connection,
            runs: one.running
              ? [
                  {
                    connectionId: "c1",
                    kind: "transactions",
                    state: "running",
                    origin: null,
                    errorCode: null,
                    counts: null,
                    startedAt: NOW,
                  },
                ]
              : [],
            providerActive: one.providerActive ?? true,
            accountsChosen: one.accountsChosen ?? true,
            keyRefused: one.keyRefused ?? false,
          },
          NOW,
        ).text;
      }),
    );
    expect([...said].sort()).toEqual(
      [
        "ok",
        "running",
        "late",
        "lateNever",
        "lateLimit",
        "consentExpired",
        "keyInvalid",
        "pending",
        "pausedSchedule",
        "pausedProvider",
      ].sort(),
    );
  });
});
