// The automatic checks of the contract (rewrite plan R2, 08-agents.md §8.2: «OpenAPI solo additivo,
// primitive comuni, nomi del glossario»). They run with `npm test`, before any route exists.
import { readFileSync } from "node:fs";
import type { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  ACCOUNTS_ROUTES,
  ADDONS,
  BUDGETS_ROUTES,
  CONTRACT_ROUTES,
  CONTRACT_SCOPES,
  FUNDS_ROUTES,
  IMPORTS_ROUTES,
  INTERESTS_ROUTES,
  INVESTMENTS_ROUTES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENTS,
  NOTIFICATIONS_ROUTES,
  PAYROLL_ROUTES,
  POCKETS_ROUTES,
  SETTINGS_ROUTES,
  SUBSCRIPTIONS_ROUTES,
  TIMEOFF_ROUTES,
  TRANSACTIONS_ROUTES,
  type RouteContract,
} from "@ledgerly/api-contract";
import * as notifications from "../packages/api-contract/src/notifications";
import * as wire from "../packages/api-contract/src/accounts/shared";
import * as transactionsWire from "../packages/api-contract/src/transactions/shared";
import * as rulesWire from "../packages/api-contract/src/transactions/rules";
import * as budgetsWire from "../packages/api-contract/src/budgets/shared";
import * as budgetsDomain from "@domain/modules/budgets/rules";
import * as pocketsWire from "../packages/api-contract/src/pockets/shared";
import * as pocketsDomain from "@domain/modules/pockets/rules";
import * as subscriptionsWire from "../packages/api-contract/src/subscriptions/shared";
import * as subscriptionsDomain from "@domain/modules/subscriptions/rules";
import * as interestsWire from "../packages/api-contract/src/interests/shared";
import * as interestsDomain from "@domain/modules/interests/rules";
import * as timeoffWire from "../packages/api-contract/src/timeoff/shared";
import * as timeoffDomain from "@domain/modules/timeoff/rules";
import { HOLIDAY_SOURCES } from "@domain/platform/holidays/rules";
import * as fundsWire from "../packages/api-contract/src/funds/shared";
import * as fundsSources from "@domain/modules/funds/sources";
import * as fundsRules from "@domain/modules/funds/rules";
import * as fundsPension from "@domain/modules/funds/pension/rules";
import { FEE_BASES, FEE_PERIODS } from "@domain/shared/fees";
import * as investmentsWire from "../packages/api-contract/src/investments/shared";
import * as investmentsRules from "@domain/modules/investments/rules";
import * as portfolioWire from "../packages/api-contract/src/investments/portfolio";
import * as portfolioRules from "@domain/modules/portfolio/rules";
import { ACTIVITY_FAMILIES } from "@domain/modules/investments/activity";
import { CONNECTION_STATES } from "@domain/platform/integrations/rules";
import type { InvestmentErrorCode } from "@domain/modules/investments/service";
import type { SyncErrorCode } from "@domain/modules/investments/sync/sources";
import * as payrollWire from "../packages/api-contract/src/payroll/shared";
import * as payrollRules from "@domain/modules/payroll/rules";
import * as payrollFields from "@domain/modules/payroll/fields";
import * as payrollChecks from "@domain/modules/payroll/parse/checks";
import * as importsRules from "@domain/modules/imports/rules";
import * as importsWire from "../packages/api-contract/src/imports/imports";
import { BALANCE_KINDS } from "@domain/modules/timeoff/ports";
import * as domain from "@domain/modules/accounts/rules";
import * as transactionsDomain from "@domain/modules/transactions/rules";
import * as rulesDomain from "@domain/modules/transactions/categorize/user-rules";
import { MANUAL_KINDS } from "@domain/modules/transactions/manual-rules";
import { DEFAULT_LIMIT, MAX_LIMIT } from "@domain/modules/transactions/queries/filters";
import { breakingChanges, DOCUMENT, generated, RELEASED } from "../scripts/openapi";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SEGMENT = /^([a-z][a-z0-9]*(-[a-z0-9]+)*|\{[a-z][A-Za-z0-9]*\})$/;
const CAMEL = /^[a-z][A-Za-z0-9]*$/;

/** Every key of every object of a value: the wire speaks camelCase (glossary of the contract). */
function keysOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      found.push(key);
      keysOf(item, found);
    }
  }
  return found;
}

/** A provider's credential fields keep the provider's names (`credentialFields` of the catalog). */
const PROVIDER_FIELDS = ["api_key", "user_key"];

const label = (route: RouteContract) => `${route.method} ${route.path}`;

describe("the contract of /api/v1", () => {
  it("has the OpenAPI document the descriptors give (npm run openapi)", () => {
    expect(readFileSync(DOCUMENT, "utf8")).toBe(generated());
  });

  it("only adds to the OpenAPI document of the last release", () => {
    expect(breakingChanges(json(RELEASED), json(DOCUMENT))).toEqual([]);
  });

  it("names each route once, in snake_case, on a kebab-case path", () => {
    const ids = CONTRACT_ROUTES.map((route) => route.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    expect(ids.filter((id) => !SNAKE.test(id))).toEqual([]);
    const keys = CONTRACT_ROUTES.map(label);
    expect(keys.filter((key, index) => keys.indexOf(key) !== index)).toEqual([]);
    const badPaths = CONTRACT_ROUTES.filter(
      (route) =>
        !route.path
          .split("/")
          .slice(1)
          .every((s) => SEGMENT.test(s)),
    );
    expect(badPaths.map(label)).toEqual([]);
  });

  it("declares the schema of every parameter of a path, and nothing else", () => {
    const wrong = CONTRACT_ROUTES.filter((route) => {
      const named = [...route.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      return JSON.stringify(named) !== JSON.stringify(Object.keys(route.params?.shape ?? {}).sort());
    });
    expect(wrong.map(label)).toEqual([]);
  });

  it("asks a scope of the contract on every route but /meta", () => {
    const open = CONTRACT_ROUTES.filter((route) => route.scope === null).map((route) => route.id);
    expect(open).toEqual(["get_meta"]);
    const unknown = CONTRACT_ROUTES.filter(
      (route) => route.scope !== null && !CONTRACT_SCOPES.includes(route.scope),
    );
    expect(unknown.map(label)).toEqual([]);
  });

  it("makes an MCP tool only of a read with the scope read or investments:read", () => {
    const wrong = CONTRACT_ROUTES.filter(
      (route) =>
        route.mcp &&
        (route.method !== "GET" || (route.scope !== "read" && route.scope !== "investments:read")),
    );
    expect(wrong.map(label)).toEqual([]);
  });

  it("answers no body with 204, and a body only with a status that has one", () => {
    const wrong = CONTRACT_ROUTES.filter((route) =>
      route.response === null ? route.status !== 204 && route.status !== 202 : route.status === 204,
    );
    expect(wrong.map(label)).toEqual([]);
  });

  it.each(CONTRACT_ROUTES.map((route) => [label(route), route] as const))(
    "%s: the example fits the schemas",
    (_, route) => {
      if (route.params) expect(route.params.safeParse(route.example.params).error).toBeUndefined();
      else expect(route.example.params).toBeUndefined();
      if (route.query) expect(route.query.safeParse(route.example.query ?? {}).error).toBeUndefined();
      if (route.body) expect(route.body.safeParse(route.example.body).error).toBeUndefined();
      else expect(route.example.body).toBeUndefined();
      if (route.response) expect(route.response.safeParse(route.example.response).error).toBeUndefined();
      else expect(route.example.response).toBeUndefined();
    },
  );

  it("speaks camelCase in every example", () => {
    const wrong = CONTRACT_ROUTES.flatMap((route) =>
      keysOf([route.example.body, route.example.response])
        .filter(
          (key) =>
            !CAMEL.test(key) &&
            !(route.id.includes("undo") || key.startsWith("acc-") || PROVIDER_FIELDS.includes(key)),
        )
        .map((key) => `${label(route)}: ${key}`),
    );
    expect(wrong).toEqual([]);
  });
});

/**
 * The Server Actions of users and settings (05-refactor.md §5.5) and the route each one calls the
 * same use case of (R2 criterion 4). An action left out is in `EXCLUDED`, with its reason: the
 * written list of exclusions of the module.
 */
const SETTINGS_ACTION_FILES: string[] = [];

const EXCLUDED: Record<string, string> = {};

describe("the Server Actions of users and settings", () => {
  const actions = SETTINGS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(SETTINGS_ROUTES.flatMap((route) => route.actions.map((name) => name.split(":")[0])));

  it("each have a route or a written exclusion", () => {
    expect(actions.filter((name) => !routed.has(name) && !(name in EXCLUDED))).toEqual([]);
  });

  it("are named by the routes only when they exist", () => {
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
    expect(Object.keys(EXCLUDED).filter((name) => !actions.includes(name))).toEqual([]);
  });
});

/** The Server Actions of accounts (05-refactor.md §5.5) and their routes; no exclusion. */
const ACCOUNTS_ACTION_FILES: string[] = [];

describe("the Server Actions of accounts", () => {
  const actions = ACCOUNTS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(ACCOUNTS_ROUTES.flatMap((route) => route.actions));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(wire.ACCOUNT_TYPES).toEqual(domain.ACCOUNT_TYPES);
    expect(wire.ACCOUNT_STATES).toEqual(domain.ACCOUNT_STATES);
    expect(wire.ACCOUNT_ORIGINS).toEqual(domain.ACCOUNT_ORIGINS);
    expect(wire.ENTRY_SOURCES).toEqual(domain.ENTRY_SOURCES);
    expect(wire.REMINDERS).toEqual(domain.REMINDERS);
    expect(wire.TRENDS).toEqual(domain.TRENDS);
    expect(wire.CONNECTION_CHANNELS).toEqual(domain.CONNECTION_CHANNELS);
    expect(wire.SNAPSHOT_STATES).toEqual(domain.SNAPSHOT_STATES);
  });
});

/**
 * The Server Actions of transactions (05-refactor.md §5.5) and Expenses' manual movement, and their
 * routes; no exclusion. The palette's two searches have no action left: it calls `/api/v1`. `name:variant` is one action that calls two use cases.
 */
const TRANSACTIONS_ACTION_FILES: string[] = [];

describe("the Server Actions of transactions", () => {
  const actions = TRANSACTIONS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(
    TRANSACTIONS_ROUTES.flatMap((route) => route.actions.map((name) => name.split(":")[0])),
  );

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(transactionsWire.TRANSACTION_TYPES).toEqual(transactionsDomain.TRANSACTION_TYPES);
    expect(transactionsWire.TRANSACTION_STATES).toEqual(transactionsDomain.TRANSACTION_STATES);
    expect(transactionsWire.TRANSACTION_ORIGINS).toEqual(transactionsDomain.TRANSACTION_ORIGINS);
    expect(transactionsWire.SEND_STATES).toEqual(transactionsDomain.SEND_STATES);
    expect(transactionsWire.ROW_BADGES).toEqual(transactionsDomain.ROW_BADGES);
    expect(transactionsWire.MANUAL_KINDS).toEqual(MANUAL_KINDS);
    expect([transactionsWire.DEFAULT_TRANSACTIONS, transactionsWire.MAX_TRANSACTIONS]).toEqual([
      DEFAULT_LIMIT,
      MAX_LIMIT,
    ]);
    expect(rulesWire.TEXT_OPS).toEqual(rulesDomain.TEXT_OPS);
    expect(rulesWire.COUNTERPARTY_OPS).toEqual(rulesDomain.COUNTERPARTY_OPS);
    expect(rulesWire.AMOUNT_OPS).toEqual(rulesDomain.AMOUNT_OPS);
    expect(rulesWire.DIRECTIONS).toEqual(rulesDomain.DIRECTIONS);
    expect(rulesWire.RULE_SOURCES).toEqual(rulesDomain.RULE_SOURCES);
    expect(rulesWire.MAX_CONDITIONS).toEqual(rulesDomain.MAX_CONDITIONS);
  });
});

/**
 * The Server Actions of budgets (05-refactor.md §5.5) and their routes; no exclusion. Overview's card
 * and a budget's page read routes of their own, with no action. The screens call `/api/v1`: no action left.
 */
const BUDGETS_ACTION_FILES: string[] = [];

describe("the Server Actions of budgets", () => {
  const actions = BUDGETS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(BUDGETS_ROUTES.flatMap((route) => route.actions));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(budgetsWire.ALERT_PRESETS).toEqual(budgetsDomain.ALERT_PRESETS);
    expect(budgetsWire.MAX_ALERT_THRESHOLDS).toEqual(budgetsDomain.MAX_ALERT_THRESHOLDS);
  });
});

/**
 * The Server Actions of pockets (05-refactor.md §5.5) and their routes; no exclusion. Overview's tile,
 * a pocket's page and «Link an expense» read routes of their own, with no action. The screens call
 * `/api/v1`: no action left.
 */
const POCKETS_ACTION_FILES: string[] = [];

describe("the Server Actions of pockets", () => {
  const actions = POCKETS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(POCKETS_ROUTES.flatMap((route) => route.actions));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(pocketsWire.POCKET_STATES).toEqual(pocketsDomain.POCKET_STATES);
    expect(pocketsWire.INTEREST_REASONS).toEqual(pocketsDomain.INTEREST_REASONS);
    const fields = pocketsDomain.pocketInputSchema.shape;
    expect(fields.name.maxLength).toBe(pocketsWire.MAX_NAME);
    expect(pocketsDomain.plannedSchema.shape.description.maxLength).toBe(pocketsWire.MAX_DESCRIPTION);
  });
});

/**
 * The Server Actions of subscriptions (05-refactor.md §5.5) and their routes; no exclusion. The
 * suggestions read a route of their own, with no action. The dialogs call `/api/v1`: no action left.
 */
const SUBSCRIPTIONS_ACTION_FILES: string[] = [];

describe("the Server Actions of subscriptions", () => {
  const actions = SUBSCRIPTIONS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(SUBSCRIPTIONS_ROUTES.flatMap((route) => route.actions));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(subscriptionsWire.CYCLES).toEqual(subscriptionsDomain.CYCLES);
    expect(subscriptionsWire.SUBSCRIPTION_STATES).toEqual(subscriptionsDomain.SUBSCRIPTION_STATES);
    expect(subscriptionsWire.CHARGE_STATES).toEqual(subscriptionsDomain.CHARGE_STATES);
    const fields = subscriptionsDomain.subscriptionInputSchema.shape;
    expect(fields.name.maxLength).toBe(subscriptionsWire.MAX_NAME);
    expect(fields.utility.unwrap().minValue).toBe(subscriptionsWire.MIN_UTILITY);
    expect(fields.utility.unwrap().maxValue).toBe(subscriptionsWire.MAX_UTILITY);
  });
});

/**
 * The Server Actions of interests (05-refactor.md §5.5) and their routes; no exclusion. The two pages
 * read routes of their own, with no action. The dialog and the posting call `/api/v1`: no action left.
 */
const INTERESTS_ACTION_FILES: string[] = [];

describe("the Server Actions of interests", () => {
  const actions = INTERESTS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(INTERESTS_ROUTES.flatMap((route) => route.actions));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(interestsWire.DAY_BASES).toEqual(interestsDomain.DAY_BASES);
    expect(interestsWire.SETTLEMENTS).toEqual(interestsDomain.SETTLEMENTS);
    expect(interestsWire.RULE_MODES).toEqual(interestsDomain.RULE_MODES);
    expect(interestsWire.RULE_STATES).toEqual(interestsDomain.RULE_STATES);
    expect(interestsWire.ACCRUAL_STATUSES).toEqual(interestsDomain.ACCRUAL_STATUSES);
    expect(interestsWire.POSTING_STATES).toEqual(interestsDomain.POSTING_STATES);
    expect(interestsWire.MAX_MATCH).toBe(interestsDomain.MAX_MATCH);
  });
});

/**
 * The Server Actions of time off (05-refactor.md §5.5), one file of them (TOF-5), and their routes;
 * no exclusion. The page and Time off › Settings read routes of their own, with no action. The
 * working day is `PATCH /preferences` of users. Trek's figures beside the cards and
 * its connection stay on the web until R5c (they are not actions of this module). The panel and
 * the forms call `/api/v1`: no action left.
 */
const TIMEOFF_ACTION_FILES: string[] = [];

describe("the Server Actions of time off", () => {
  const actions = TIMEOFF_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(
    [...TIMEOFF_ROUTES, ...SETTINGS_ROUTES].flatMap((route) =>
      route.actions.map((name) => name.split(":")[0]),
    ),
  );

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    const own = TIMEOFF_ROUTES.flatMap((route) => route.actions.map((name) => name.split(":")[0]));
    expect(own.filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(timeoffWire.LEAVE_KINDS).toEqual(timeoffDomain.LEAVE_DAY_KINDS);
    expect(timeoffWire.RESIDUAL_BASES).toEqual(timeoffDomain.RESIDUAL_BASES);
    expect(timeoffWire.SYNC_STATES).toEqual(timeoffDomain.PENDING_STATES);
    expect(timeoffWire.LEAVE_ORIGINS.length).toBe(timeoffDomain.LEAVE_ORIGINS.length);
    expect(timeoffWire.MAX_RANGE_DAYS).toBe(timeoffDomain.MAX_RANGE_DAYS);
    expect(timeoffWire.HOLIDAY_SOURCES).toEqual(HOLIDAY_SOURCES);
  });
});

/**
 * The Server Actions of payroll (05-refactor.md §5.5) and their routes. The register, the review and
 * the code map read routes of their own and write through `/api/v1` (R3), and the upload is
 * `POST /imports` (R3 imports; PAY-2, IMP-4): no action is left, and no route names one.
 */
const PAYROLL_ACTION_FILES: string[] = [];

describe("the Server Actions of payroll", () => {
  const actions = PAYROLL_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set([...PAYROLL_ROUTES, ...IMPORTS_ROUTES].flatMap((route) => route.actions));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(payrollWire.PAYSLIP_TYPES).toEqual(payrollRules.PAYSLIP_TYPES);
    expect(payrollWire.CODE_ROLES).toEqual(payrollRules.CODE_ROLES);
    expect(payrollWire.LINE_UNITS).toEqual(payrollRules.LINE_UNITS);
    expect(payrollWire.SUMMED_FIELDS).toEqual(payrollRules.SUMMED_FIELDS);
    expect(payrollWire.FIELD_GROUPS).toEqual(payrollFields.FIELD_GROUPS);
    expect(payrollWire.LEAVE_KINDS).toEqual(payrollFields.LEAVE_KINDS);
    // PAY-6: one vocabulary of the balances, payroll's and the port of time off alike.
    expect(payrollFields.LEAVE_KINDS).toEqual(BALANCE_KINDS);
    expect(payrollWire.CHECK_IDS).toEqual(payrollChecks.CHECK_IDS);
    expect(payrollWire.WARNING_CODES).toEqual(payrollChecks.WARNING_CODES);
    expect(payrollWire.DOCUMENT_STATES).toEqual(importsRules.DOCUMENT_STATES);
    expect(payrollWire.FIELD_UNITS).toEqual(importsRules.EVIDENCE_UNITS);
    expect(payrollWire.EVIDENCE_ORIGINS).toEqual(importsRules.EVIDENCE_ORIGINS);
    expect(payrollWire.VERIFICATION_STATES).toEqual(importsRules.VERIFICATION_STATES);
  });
});

/**
 * The Server Actions of funds (05-refactor.md §5.5) and their routes: every one has a route, none is
 * excluded. `name:variant` is one action that calls two use cases (add or update, and a fee's «Undo»).
 */
const FUNDS_ACTION_FILES: string[] = [];

describe("the Server Actions of funds", () => {
  const actions = FUNDS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(FUNDS_ROUTES.flatMap((route) => route.actions.map((name) => name.split(":")[0])));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(fundsWire.FUND_STATES).toEqual(fundsRules.FUND_STATES);
    expect(fundsWire.SOURCE_KINDS).toEqual(fundsSources.SOURCE_KINDS);
    expect(fundsWire.SOURCE_STATES).toEqual(fundsSources.SOURCE_STATES);
    expect(fundsWire.PAYROLL_COMPONENTS).toEqual(fundsSources.PAYROLL_COMPONENTS);
    expect(fundsWire.ACCRUAL_PERIODS).toEqual(fundsSources.ACCRUAL_PERIODS);
    expect(fundsWire.INTERVAL_UNITS).toEqual(fundsSources.INTERVAL_UNITS);
    expect(fundsWire.FEE_BASES).toEqual(FEE_BASES);
    expect(fundsWire.FEE_PERIODS).toEqual(FEE_PERIODS);
    expect(fundsWire.OPERATION_CLASSES).toEqual(fundsPension.OPERATION_CLASSES);
    expect(fundsWire.OPERATION_SOURCES).toEqual(fundsPension.OPERATION_SOURCES);
    expect(fundsWire.COMPONENTS).toEqual(fundsPension.COMPONENTS);
  });
});

/**
 * The Server Actions of investments (05-refactor.md §5.5) and their routes: every one has a route, none
 * is excluded. R3 deleted them: the pages call the routes (`modules/investments/calls.ts`).
 */
const INVESTMENTS_ACTION_FILES: string[] = [];

/** Every code of the domain's refusals: the compiler holds this record to the two unions, no more and no less. */
const INVESTMENT_CODES: Record<InvestmentErrorCode | SyncErrorCode, true> = {
  not_found: true,
  future_date: true,
  not_eligible: true,
  wrong_mode: true,
  negative_cash: true,
  no_value: true,
  duplicate_asset: true,
  duplicate_holding: true,
  invalid_transaction: true,
  already_linked: true,
  not_editable: true,
  before_period: true,
  not_a_transfer: true,
  unknown_provider: true,
  invalid_credentials: true,
  not_read_only: true,
  provider_auth: true,
  provider_unavailable: true,
  rate_limited: true,
  unsupported_currency: true,
  already_connected: true,
  not_connected: true,
  cooldown: true,
  different_account: true,
};

describe("the Server Actions of investments", () => {
  const actions = INVESTMENTS_ACTION_FILES.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)/gm)].map((match) => match[1]),
  );
  const routed = new Set(INVESTMENTS_ROUTES.flatMap((route) => route.actions));

  it("each have a route, and a route names only actions that exist", () => {
    expect(actions.filter((name) => !routed.has(name))).toEqual([]);
    expect([...routed].filter((name) => !actions.includes(name))).toEqual([]);
  });

  it("speak the vocabularies of the domain", () => {
    expect(investmentsWire.INVESTMENT_CATEGORIES).toEqual(investmentsRules.INVESTMENT_CATEGORIES);
    expect(investmentsWire.MODES).toEqual(investmentsRules.MODES);
    expect(investmentsWire.ORIGINS).toEqual(investmentsRules.ORIGINS);
    expect(investmentsWire.ASSET_CLASSES).toEqual(investmentsRules.ASSET_CLASSES);
    expect(investmentsWire.HOLDING_ORIGINS).toEqual(investmentsRules.HOLDING_ORIGINS);
    expect(investmentsWire.EVENT_ORIGINS).toEqual(investmentsRules.EVENT_ORIGINS);
    expect(investmentsWire.PERIOD_REASONS).toEqual(investmentsRules.PERIOD_REASONS);
    expect(investmentsWire.OPERATION_KINDS).toEqual(investmentsRules.OPERATION_KINDS);
    expect(investmentsWire.ADJUSTMENT_CLASSES).toEqual(investmentsRules.ADJUSTMENT_CLASSES);
    expect(investmentsWire.RECONCILIATION_KINDS).toEqual(investmentsRules.RECONCILIATION_KINDS);
    expect(investmentsWire.READING_STATUSES).toEqual(investmentsRules.READING_STATUSES);
    expect(investmentsWire.KEY_CHECK_RESULTS).toEqual(investmentsRules.KEY_CHECK_RESULTS);
    expect(investmentsWire.COVERAGE_STATUSES).toEqual(investmentsRules.COVERAGE_STATUSES);
    expect(investmentsWire.PRODUCT_PATTERN).toEqual(investmentsRules.PRODUCT_PATTERN);
    expect(investmentsWire.ACTIVITY_FAMILIES).toEqual(ACTIVITY_FAMILIES);
    expect(investmentsWire.CONNECTION_STATES).toEqual(CONNECTION_STATES);
    expect(portfolioWire.PORTFOLIO_KINDS).toEqual(portfolioRules.PORTFOLIO_KINDS);
    expect(portfolioWire.PORTFOLIO_GROUPS).toEqual(portfolioRules.PORTFOLIO_GROUPS);
    expect(portfolioWire.RATE_REASONS).toEqual(portfolioRules.RATE_REASONS);
  });

  it("have no value `pac` in any schema or example of the API and the MCP (R5b, decision H12)", () => {
    expect(generated().toLowerCase()).not.toMatch(/"pac"/);
  });

  it("name every refusal of the domain as a reason", () => {
    const codes = Object.keys(INVESTMENT_CODES).filter((code) => code !== "not_found");
    expect([...investmentsWire.INVESTMENT_REFUSALS].sort()).toEqual(codes.sort());
  });
});

describe("the route of imports", () => {
  it("speaks the vocabulary of the domain", () => {
    expect(importsWire.DOCUMENT_KINDS).toEqual(importsRules.DOCUMENT_KINDS);
    expect(importsWire.MAX_FILES).toBe(importsRules.MAX_FILES);
  });

  it("takes the file as multipart/form-data, and answers 200 for a file already received", () => {
    const doc = json(DOCUMENT) as { paths: Record<string, Record<string, Record<string, unknown>>> };
    const upload = doc.paths["/imports"].post;
    expect(Object.keys((upload.requestBody as { content: object }).content)).toEqual(["multipart/form-data"]);
    expect(Object.keys(upload.responses as object)).toEqual(expect.arrayContaining(["200", "201"]));
  });
});

describe("breakingChanges", () => {
  const doc = (body: object, answer: object) => ({
    paths: {
      "/x": {
        post: {
          requestBody: { content: { "application/json": { schema: body } } },
          responses: { "200": { content: { "application/json": { schema: answer } } } },
        },
      },
    },
  });
  const answer = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
  const body = { type: "object", properties: { b: { type: "string" } }, required: [] };

  it("lets a field or an optional input in", () => {
    const more = { ...answer, properties: { ...answer.properties, c: { type: "number" } } };
    const optional = { ...body, properties: { ...body.properties, d: { type: "string" } } };
    expect(breakingChanges(doc(body, answer), doc(optional, more))).toEqual([]);
  });

  it("refuses a field gone, a new required input, a route gone", () => {
    const required = { ...body, required: ["b"] };
    expect(breakingChanges(doc(body, answer), doc(required, { type: "object", properties: {} }))).toEqual([
      "POST /x body.b: newly required",
      "POST /x 200.a: gone",
      "POST /x 200.a: no longer always there",
    ]);
    expect(breakingChanges(doc(body, answer), { paths: {} })).toEqual(["POST /x: gone"]);
  });
});

describe("the notifications of R5e", () => {
  it("carry no amount, bank, account or name in their parameters (G4)", () => {
    const shape = (notifications.listTodo.response.shape.items.element.shape.params as z.ZodObject).shape;
    expect(Object.keys(shape).sort()).toEqual(["count", "date", "days", "percent"]);
    const keys = NOTIFICATIONS_ROUTES.flatMap((route) => keysOf(route.example.response));
    expect(keys.filter((key) => /amount|bank|account|name/i.test(key))).toEqual([]);
  });

  it("give every event a category and an addon of the contract, or none for a base module", () => {
    for (const [event, { category, addon }] of Object.entries(NOTIFICATION_EVENTS)) {
      expect(event).toMatch(SNAKE);
      expect(NOTIFICATION_CATEGORIES).toContain(category);
      if (addon !== null) expect(ADDONS).toContain(addon);
    }
  });

  it("are routes of the contract, and only «Da fare» is an MCP tool", () => {
    for (const route of NOTIFICATIONS_ROUTES) expect(CONTRACT_ROUTES).toContain(route);
    expect(NOTIFICATIONS_ROUTES.filter((route) => route.mcp).map((route) => route.id)).toEqual(["list_todo"]);
  });
});
