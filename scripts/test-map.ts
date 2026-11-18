// scripts/test-map.ts — which tests a changed file starts (docs/testing.md; `test-policy` §1, §4, §6).
//
// The map is data: `MODULES` (changed files → module → its integration tests, its E2E flows and the
// modules that use it), `FLOWS` (one E2E flow → its folder `tests/e2e/<flow>/`: the specs of its
// journeys and its pieces of the checks every flow has) and `CRITICAL` (shared code: the full suite). `scripts/test-select.ts` reads a diff with
// it; `src/test-map.test.ts` holds it to the tree — every file of the repository is in a row or in
// the critical list, every test belongs to a module or a flow, and a module that imports another
// one is in its "Used by". The table of docs/testing.md is printed from here.
//
// A pattern is a path with `*` (inside one folder) and `**` (any depth). Nothing else is special.

export interface Module {
  id: string;
  /** The changed files that select this module. */
  files: string[];
  /** What `sh scripts/test-integration.sh` takes to run this module's integration tests alone. */
  integration?: string[];
  /** The module's own E2E flows. */
  flows?: string[];
  /**
   * What else runs when the module changes: the id of a module that imports it, `e2e:<flow>`,
   * `integration:*` (every integration test), `e2e:*` (the specs of every flow) and `perf` (the
   * times of `npm run perf`).
   */
  usedBy?: string[];
}

export interface Flow {
  /** The flow's folder too: `tests/e2e/<id>/`. */
  id: string;
  /** The specs of the flow's own journeys, in its folder, without `.spec.ts`. */
  specs: string[];
  /** Its pieces of the checks every flow has (`CROSS_CUTTING`), in its folder, without `.spec.ts`. */
  screens?: string[];
}

/**
 * The checks every flow has a piece of: the layout and accessibility of its screens, the keyboard,
 * the phone. Their engines are in `tests/e2e/_shared/`.
 */
export const CROSS_CUTTING = ["a11y", "keyboard", "mobile"];

export const FLOWS: Flow[] = [
  {
    id: "accounts",
    specs: ["accounts", "currency", "account-switch"],
    screens: ["a11y", "keyboard"],
  },
  {
    id: "transactions",
    specs: ["expenses", "manual-movement", "manual-send", "wide"],
    screens: CROSS_CUTTING,
  },
  { id: "categories", specs: ["categories", "review", "source-categories"], screens: ["a11y"] },
  { id: "budgets", specs: ["budgets"], screens: ["a11y", "mobile"] },
  { id: "pockets", specs: ["pockets"], screens: ["a11y", "mobile"] },
  { id: "subscriptions", specs: ["subscriptions"], screens: ["a11y", "mobile"] },
  { id: "interests", specs: ["interests"], screens: ["a11y"] },
  {
    id: "funds",
    specs: [
      "funds",
      "funds-detail",
      "funds-home",
      "funds-new",
      "funds-payslip",
      "funds-settings",
      "funds-tabs",
    ],
    screens: CROSS_CUTTING,
  },
  {
    id: "investments",
    specs: ["investments", "investments-home", "investments-service"],
    screens: ["a11y", "keyboard"],
  },
  { id: "payroll", specs: ["payroll"], screens: ["a11y"] },
  { id: "timeoff", specs: ["timeoff", "holidays"], screens: CROSS_CUTTING },
  { id: "connections", specs: ["connections", "plugins", "schedule"], screens: ["a11y"] },
  { id: "auth", specs: ["auth", "two-factor", "preferences"], screens: ["a11y"] },
  { id: "admin", specs: ["admin"], screens: ["a11y"] },
  { id: "api", specs: ["security", "mcp"] },
  { id: "shell", specs: ["install", "legal"], screens: CROSS_CUTTING },
  // Every screen of every flow: the common interface, or an engine of the checks, changed.
  { id: "screens", specs: [] },
];

/** The flows whose seed (scripts/seed-e2e/<flow>.ts) seeds their users alone. */
const SEEDED_ALONE = [
  "accounts",
  "categories",
  "budgets",
  "pockets",
  "subscriptions",
  "interests",
  "funds",
  "timeoff",
  "connections",
];

const page = (name: string) => `src/app/(app)/${name}/**`;

export const MODULES: Module[] = [
  // ——— Domain modules, each with its pages ———
  {
    id: "accounts",
    files: ["src/modules/accounts/**", page("accounts"), "src/app/(app)/page.tsx", "src/platform/iban*"],
    integration: ["src/modules/accounts", "src/app/(app)/accounts"],
    flows: ["accounts"],
    usedBy: [
      "transactions",
      "budgets",
      "funds",
      "interests",
      "investments",
      "pockets",
      "subscriptions",
      "api",
      "jobs",
      "export",
      "connections",
      "e2e:connections",
      "e2e:transactions",
      "e2e:investments",
      "e2e:funds",
      "e2e:budgets",
      "e2e:subscriptions",
      "e2e:api",
      "e2e:categories",
    ],
  },
  {
    id: "transactions",
    files: ["src/modules/transactions/**", page("expenses"), "test/fixtures/categories/**"],
    integration: ["src/modules/transactions", "src/app/(app)/expenses"],
    flows: ["transactions", "categories"],
    usedBy: [
      "categories",
      "subscriptions",
      "connections",
      "budgets",
      "interests",
      "jobs",
      "accounts",
      "funds",
      "investments",
      "pockets",
      "api",
      "export",
      "e2e:connections",
      "e2e:interests",
      "e2e:accounts",
      "e2e:subscriptions",
    ],
  },
  {
    id: "categories",
    files: [page("settings/categories")],
    integration: ["src/app/(app)/settings/categories"],
    flows: ["categories"],
    // A source's categories are drawn on the source's page (rewrite plan N7.2).
    usedBy: ["e2e:connections"],
  },
  {
    id: "budgets",
    files: ["src/modules/budgets/**", page("budgets")],
    integration: ["src/modules/budgets"],
    flows: ["budgets"],
    usedBy: [
      "jobs",
      "categories",
      "export",
      "api",
      "accounts",
      "e2e:categories",
      "e2e:pockets",
      "e2e:accounts",
    ],
  },
  {
    id: "pockets",
    files: ["src/modules/pockets/**", page("pockets")],
    integration: ["src/modules/pockets"],
    flows: ["pockets"],
    usedBy: ["export", "jobs", "accounts", "e2e:accounts", "e2e:shell"],
  },
  {
    id: "subscriptions",
    files: ["src/modules/subscriptions/**", page("subscriptions")],
    integration: ["src/modules/subscriptions"],
    flows: ["subscriptions"],
    usedBy: ["export", "jobs", "accounts", "e2e:accounts", "e2e:shell"],
  },
  {
    id: "interests",
    files: ["src/modules/interests/**", page("interests")],
    integration: ["src/modules/interests"],
    flows: ["interests"],
    usedBy: ["pockets", "funds", "export", "jobs", "accounts", "e2e:accounts", "e2e:connections"],
  },
  {
    id: "funds",
    files: ["src/modules/funds/**", page("funds")],
    integration: ["src/modules/funds"],
    flows: ["funds"],
    usedBy: ["investments", "payroll", "export", "jobs", "accounts", "e2e:accounts", "e2e:shell"],
  },
  {
    id: "investments",
    files: [
      "src/modules/investments/**",
      page("investments"),
      "src/platform/integrations/investments/**",
      "src/platform/integrations/ccxt/**",
      "src/platform/integrations/etoro/**",
      "test/fixtures/investments/**",
    ],
    integration: ["src/modules/investments"],
    flows: ["investments"],
    usedBy: [
      "funds",
      "connections",
      "api",
      "accounts",
      "export",
      "e2e:funds",
      "e2e:connections",
      "e2e:accounts",
    ],
  },
  {
    id: "payroll",
    files: ["src/modules/payroll/**", page("payroll"), "test/fixtures/payroll/**"],
    integration: ["src/modules/payroll"],
    flows: ["payroll"],
    usedBy: ["funds", "timeoff", "export", "imports", "jobs", "e2e:funds"],
  },
  {
    id: "imports",
    files: ["src/modules/imports/**"],
    integration: ["src/modules/imports"],
    usedBy: ["payroll", "funds", "api", "export", "jobs", "e2e:payroll"],
  },
  {
    id: "timeoff",
    files: ["src/modules/timeoff/**", page("timeoff"), "src/platform/holidays/**"],
    integration: ["src/modules/timeoff", "src/platform/holidays"],
    flows: ["timeoff"],
    usedBy: ["connections", "export", "jobs", "e2e:connections"],
  },
  {
    id: "users",
    files: [
      "src/modules/users/**",
      "src/app/(auth)/**",
      page("settings/profile"),
      page("settings/security"),
      page("settings/users"),
    ],
    integration: ["src/modules/users"],
    flows: ["auth", "admin"],
    usedBy: ["integration:*", "e2e:timeoff"],
  },

  // ——— Platform services ———
  {
    id: "connections",
    files: [
      "src/platform/integrations/*",
      "src/platform/integrations/wallet/**",
      "src/platform/integrations/trek/**",
      "src/platform/plugins/**",
      "src/platform/plugin-config*",
      "plugins/**",
      page("banks"),
      page("settings/integrations"),
      "src/app/plugin-wiring.ts",
      "src/app/api/v1/plugins/**",
      "test/fixtures/plugins/**",
      "test/fixtures/wallet/**",
    ],
    integration: ["src/platform/integrations", "src/platform/plugins", "src/app/(app)/banks"],
    flows: ["connections"],
    usedBy: [
      "accounts",
      "transactions",
      "jobs",
      "investments",
      "interests",
      "timeoff",
      "categories",
      "admin",
      "e2e:accounts",
      "e2e:transactions",
      "e2e:investments",
      "e2e:admin",
      "e2e:timeoff",
      "e2e:categories",
    ],
  },
  {
    id: "api",
    files: [
      "src/platform/api/**",
      "src/platform/mcp/**",
      "src/app/api/v1/[[...route]]/**",
      "src/app/api/mcp/**",
      "src/app/.well-known/**",
      "src/baselines.itest.ts",
      "baselines/numbers/**",
      "baselines/contract/**",
    ],
    integration: ["src/platform/api", "src/platform/mcp", "src/baselines.itest.ts"],
    flows: ["api"],
    usedBy: ["investments", "accounts", "transactions", "imports", "perf"],
  },
  {
    id: "jobs",
    files: [
      "src/platform/jobs/**",
      "src/app/api/jobs/**",
      "src/app/api/health/**",
      "src/app/api/metrics/**",
      "cron/**",
    ],
    integration: ["src/platform/jobs"],
    usedBy: ["integration:*", "e2e:connections", "e2e:admin", "e2e:accounts"],
  },
  {
    id: "admin",
    files: [
      "src/platform/settings/**",
      page("settings/server"),
      "src/platform/backup/**",
      "src/platform/reports/**",
    ],
    integration: ["src/platform/settings", "src/platform/backup", "src/platform/reports"],
    flows: ["admin"],
    usedBy: ["payroll", "jobs", "api", "export", "accounts", "users", "e2e:payroll", "e2e:auth"],
  },
  {
    id: "export",
    files: ["src/platform/export/**", page("settings/data")],
    integration: ["src/platform/export"],
    flows: ["api"],
    usedBy: ["subscriptions", "jobs", "e2e:admin", "e2e:subscriptions"],
  },
  {
    id: "storage",
    files: ["src/platform/storage*"],
    integration: ["src/platform/storage.itest.ts", "src/platform/storage-ensure-bucket.itest.ts"],
    usedBy: ["imports", "payroll", "api", "timeoff", "users", "admin", "funds", "export"],
  },

  // ——— Cross-cutting rows: a file here is also in the row of its module ———
  {
    id: "data",
    files: ["drizzle/**", "src/**/schema.ts", "src/platform/db/**"],
    integration: ["src/platform/db"],
    usedBy: ["integration:*", "perf"],
  },
  {
    id: "fx",
    files: ["src/platform/fx/**"],
    integration: ["src/platform/fx"],
    usedBy: [
      "integration:*",
      "perf",
      "e2e:accounts",
      "e2e:investments",
      "e2e:funds",
      "e2e:admin",
      "e2e:auth",
    ],
  },
  { id: "queries", files: ["src/**/queries.ts", "src/**/*-queries.ts"], usedBy: ["perf", "e2e:connections"] },
  {
    id: "shared-domain",
    files: [
      "src/modules/accounts/service.ts",
      "src/modules/accounts/queries.ts",
      "src/modules/accounts/rules.ts",
      "src/modules/transactions/service.ts",
      "src/modules/transactions/queries.ts",
      "src/modules/transactions/rules.ts",
      "src/platform/integrations/service.ts",
      "src/platform/integrations/rules.ts",
    ],
    usedBy: [
      "integration:*",
      "e2e:accounts",
      "e2e:transactions",
      "e2e:categories",
      "e2e:connections",
      "e2e:funds",
      "e2e:interests",
      "e2e:investments",
      "e2e:pockets",
      "e2e:timeoff",
      "e2e:api",
    ],
  },
  {
    id: "interface",
    files: [
      "src/ui/**",
      "src/app/layout.tsx",
      "src/app/(app)/layout.tsx",
      "src/app/(app)/settings/layout.tsx",
      "src/app/(app)/settings/page.tsx",
      "src/app/(app)/settings/settings-tabs.tsx",
      "src/app/globals.css",
      "src/app/error.tsx",
      "src/app/global-error.tsx",
      "src/app/not-found.tsx",
      "src/app/boundaries.test.tsx",
      "src/platform/theme*",
    ],
    usedBy: ["e2e:screens", "e2e:transactions", "e2e:shell"],
  },
  {
    id: "shell",
    files: [
      "src/app/(legal)/**",
      "src/app/manifest.webmanifest/**",
      "src/app/*.png",
      "src/app/icon.svg",
      "src/app/favicon.ico",
      "scripts/icons.mjs",
      // Each release adds its own entries here: the shell's screens show them.
      "src/app/(app)/navigation*",
      "src/app/(app)/palette-actions.ts",
      "src/app/(app)/palette-commands*",
    ],
    flows: ["shell"],
  },
  { id: "perf", files: ["scripts/perf-*", "baselines/performance.json"], usedBy: ["perf"] },
  // The seed gives every flow its users and its data. Each release adds a user for its own flow:
  // the journeys of every flow run, and the screens of the changed modules only.
  {
    id: "e2e-data",
    files: ["scripts/seed-e2e.ts", "scripts/seed-e2e/common.ts", "tests/e2e/_shared/env.ts"],
    usedBy: ["e2e:*"],
  },
  // The `layout` user, whom every flow's screens are measured on.
  { id: "seed-layout", files: ["scripts/seed-e2e/layout.ts"], flows: ["screens"], usedBy: ["e2e:*"] },
  // The seed of a flow (scripts/seed-e2e/<flow>.ts) runs the folder of the flow, and the folders of
  // the flows whose users it seeds too.
  {
    id: "seed-investments",
    files: ["scripts/seed-e2e/investments.ts"],
    flows: ["investments", "connections"],
  },
  {
    id: "seed-transactions",
    files: ["scripts/seed-e2e/transactions.ts"],
    flows: ["transactions", "categories"],
  },
  // The engines of the checks every flow has: every flow's piece of them runs.
  {
    id: "screen-checks",
    files: ["tests/e2e/_shared/a11y.ts", "tests/e2e/_shared/keyboard.ts"],
    flows: ["screens"],
  },

  // ——— Files with no test of their own beyond the checks that always run ———
  {
    id: "tooling",
    files: [
      "scripts/release.sh",
      "scripts/release-dump.sh",
      "scripts/numbers-*",
      "scripts/snapshot-format.ts",
      "scripts/on-homelab.sh",
      "scripts/preview-on-test.sh",
      "scripts/full-suite.sh",
      "scripts/create-*",
      "scripts/plugin-probe.ts",
      "scripts/modularity.ts",
      "scripts/duplication.ts",
      "scripts/assertions-diff.ts",
      "scripts/source-graph.ts",
      "scripts/test-map.ts",
      "scripts/test-select.ts",
      "src/architecture.test.ts",
      "src/tooling.test.ts",
      "src/release-script.test.ts",
      "src/test-map.test.ts",
      "baselines/modularity.json",
      "baselines/duplication.json",
      "baselines/assertions-exceptions.json",
      "eslint.config.mjs",
      ".prettierrc.json",
      ".prettierignore",
      ".gitignore",
    ],
  },
  {
    id: "docs",
    files: ["docs/**", "*.md", "LICENSE", ".env.example", "tests/shots/**", "playwright.shots.config.ts"],
  },
  // A changed file of a flow's folder starts the whole folder: its journeys and its screens.
  ...FLOWS.filter((flow) => flow.id !== "screens").map((flow) => ({
    id: `spec-${flow.id}`,
    files: [
      `tests/e2e/${flow.id}/**`,
      ...(SEEDED_ALONE.includes(flow.id) ? [`scripts/seed-e2e/${flow.id}.ts`] : []),
    ],
    flows: [flow.id],
  })),
];

/** Shared code: a changed file here starts the full suite (`test-policy` §3, point 2). */
export const CRITICAL: { files: string[]; why: string }[] = [
  {
    why: "build, runtime and test configuration",
    files: [
      "package.json",
      "package-lock.json",
      "Dockerfile",
      ".dockerignore",
      "entrypoint.sh",
      "docker-compose.yml",
      "next.config.ts",
      "postcss.config.mjs",
      "tsconfig.json",
      "drizzle.config.ts",
      "vitest.config.ts",
      "playwright.config.ts",
      "playwright.preview.config.ts",
      "scripts/copy-pdfjs.mjs",
      "scripts/migrate.ts",
      "scripts/test-integration.sh",
      "src/global.d.ts",
    ],
  },
  {
    why: "every request passes here",
    files: [
      "src/proxy*",
      "src/instrumentation*",
      "src/platform/env*",
      "src/platform/context.ts",
      "src/platform/auth/**",
      "src/app/api/auth/**",
      "src/platform/db/client.ts",
    ],
  },
  {
    why: "used by almost every module",
    files: [
      "src/platform/money*",
      "src/platform/dates*",
      "src/platform/format*",
      "src/platform/ranges.ts",
      "src/platform/i18n/**",
      "src/platform/crypto*",
      "src/platform/keyring.ts",
      "src/platform/version.ts",
      "src/platform/mail.ts",
      "src/platform/alerts/**",
      "src/platform/notifications/**",
    ],
  },
  {
    why: "every test stands on it",
    files: [
      "tests/e2e/_shared/helpers.ts",
      "tests/e2e/_shared/global-setup.ts",
      "tests/e2e/_shared/global-teardown.ts",
      "tests/e2e/_shared/homelab.ts",
      "tests/e2e/_shared/totp.ts",
      "test/*",
    ],
  },
];

/** The namespace of a message (`messages/*.json`) → the module whose screens show it. */
export const MESSAGES: Record<string, string> = {
  accounts: "accounts",
  overview: "accounts",
  expenses: "transactions",
  budgets: "budgets",
  pockets: "pockets",
  subscriptions: "subscriptions",
  interests: "interests",
  funds: "funds",
  investments: "investments",
  payroll: "payroll",
  timeoff: "timeoff",
  banks: "connections",
  auth: "users",
  legal: "shell",
  // What every screen shows is the common interface.
  common: "interface",
  unsaved: "interface",
  nav: "interface",
  shell: "interface",
  gallery: "interface",
  errors: "interface",
  // `settings` is read one level down: each section of Settings belongs to a module.
  "settings.title": "interface",
  "settings.tabs": "interface",
  "settings.categories": "categories",
  "settings.labels": "categories",
  "settings.integrations": "connections",
  "settings.plugins": "connections",
  "settings.plugin": "connections",
  "settings.banks": "connections",
  "settings.connections": "connections",
  "settings.diagnostics": "connections",
  "settings.account": "users",
  "settings.preferences": "users",
  "settings.signIn": "users",
  "settings.password": "users",
  "settings.twoFactor": "users",
  "settings.sessions": "users",
  "settings.tokens": "users",
  "settings.apiClients": "users",
  "settings.connectedApps": "users",
  "settings.people": "users",
  "settings.jobs": "admin",
  "settings.snapshots": "admin",
  "settings.llm": "admin",
  "settings.maintenance": "admin",
  "settings.oidc": "admin",
  "settings.smtp": "admin",
  "settings.codeMap": "payroll",
  "settings.holidays": "timeoff",
  "settings.exportMine": "export",
  "emails.invitation": "users",
  "emails.passwordReset": "users",
  "emails.test": "admin",
  "emails.lowBalance": "accounts",
  "emails.monthlySummary": "admin",
  "emails.budgetNear": "budgets",
  "emails.budgetOver": "budgets",
  "emails.connection": "connections",
};

/** The namespaces of `messages/*.json` that `MESSAGES` reads one level down. */
export const NESTED_MESSAGES = ["settings", "emails"];

// ——— Reading the map —————————————————————————————————————————————————————————————————————————

const patterns = new Map<string, RegExp>();
export function matches(pattern: string, file: string): boolean {
  let regex = patterns.get(pattern);
  if (!regex) {
    const source = pattern
      .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
      .replace(/\*\*\/?/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, ".*");
    regex = new RegExp(`^${source}$`);
    patterns.set(pattern, regex);
  }
  return regex.test(file);
}

export const criticalOf = (file: string) =>
  CRITICAL.find((group) => group.files.some((pattern) => matches(pattern, file)));

export const modulesOf = (file: string) =>
  MODULES.filter((module) => module.files.some((pattern) => matches(pattern, file)));

/**
 * The specs with a test about what differs between the preview and the site (`@site`): they run on
 * the preview with the others, and on the site again, after the deploy. The number is the password sign-ins those tests spend: the site allows 5 a minute to one
 * client, and the `@smoke` tests spend one.
 */
export const SITE_ONLY: Record<string, number> = {
  "auth/auth": 2,
  "auth/two-factor": 2,
  "auth/preferences": 1,
  "shell/mobile": 1,
  "api/security": 0,
  "api/mcp": 0,
  "accounts/currency": 0,
  "investments/investments-service": 0,
  "connections/plugins": 0,
};
/** The password sign-ins one command may spend on the site. */
export const SIGN_INS = 4;

export interface Selection {
  /** Why the full suite runs; empty when the map answers. */
  full: string[];
  /** Module id → the changed files that selected it. */
  modules: Map<string, string[]>;
  /** `"*"` for every integration test, or the paths of the selected modules. */
  integration: "*" | string[];
  /** The flows whose journeys run: the flows of the changed modules and of the modules that use them. */
  flows: string[];
  /** The flows of the changed modules: their whole folder runs, their screens too. */
  screens: string[];
  perf: boolean;
}

/**
 * The tests of a list of changed files. `messages` gives the changed namespaces of
 * `messages/*.json` and `versionOnly` the files whose only change is the version number: both come
 * from the diff itself (`scripts/test-select.ts`), and without them those files are critical.
 */
export function select(
  files: readonly string[],
  diff: { messages?: readonly string[]; versionOnly?: readonly string[] } = {},
): Selection {
  const full: string[] = [];
  const chosen = new Map<string, string[]>();
  const choose = (id: string, file: string) => chosen.set(id, [...(chosen.get(id) ?? []), file]);

  for (const file of files) {
    if (diff.versionOnly?.includes(file)) continue;
    if (/^messages\/[^/]+\.json$/.test(file)) {
      if (!diff.messages) full.push(`${file}: the changed messages are not known`);
      for (const namespace of diff.messages ?? []) {
        const owner = MESSAGES[namespace];
        if (owner) choose(owner, `${file} (${namespace})`);
        else full.push(`${file}: the messages "${namespace}" belong to more than one module`);
      }
      continue;
    }
    const critical = criticalOf(file);
    if (critical) {
      full.push(`${file}: critical, ${critical.why}`);
      continue;
    }
    const rows = modulesOf(file);
    if (rows.length === 0) full.push(`${file}: outside the map`);
    for (const row of rows) choose(row.id, file);
  }

  const byId = new Map(MODULES.map((module) => [module.id, module]));
  const integration = new Set<string>();
  const flows = new Set<string>();
  const screens = new Set<string>();
  let everyIntegration = false;
  let perf = false;
  for (const id of chosen.keys()) {
    const row = byId.get(id)!;
    for (const path of row.integration ?? []) integration.add(path);
    for (const flow of row.flows ?? []) {
      flows.add(flow);
      screens.add(flow);
    }
    for (const user of row.usedBy ?? []) {
      if (user === "integration:*") everyIntegration = true;
      else if (user === "perf") perf = true;
      else if (user === "e2e:*") {
        for (const one of FLOWS) if (one.id !== "screens") flows.add(one.id);
      } else if (user.startsWith("e2e:")) flows.add(user.slice(4));
      else for (const path of byId.get(user)!.integration ?? []) integration.add(path);
    }
  }
  const inOrder = (ids: ReadonlySet<string>) => FLOWS.map((flow) => flow.id).filter((id) => ids.has(id));
  return {
    full,
    modules: chosen,
    integration: everyIntegration ? "*" : [...integration].sort(),
    flows: inOrder(flows),
    // With every screen selected there is nothing left to filter.
    screens: flows.has("screens") ? [] : inOrder(screens),
    perf,
  };
}
