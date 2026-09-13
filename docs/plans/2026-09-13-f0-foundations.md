# F0 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clean, running Next.js 16 app on `dev-0.1` with the design system, the app shell, sign-in (Authentik + password), invitations and password reset, user preferences (EN/IT, theme, formats), the platform services (money, dates, holidays, formatting, encryption, database, mail, S3, jobs, health, metrics), the Docker images and a full test harness — the base every later phase builds on.

**Architecture:** Modular monolith (spec §4). Pages and Server Actions call module services directly; platform code lives in `src/platform/`, domain code in `src/modules/<name>/`, the design system in `src/ui/`. Postgres 18 through Drizzle, every user-owned row carries `user_id`, services receive a `Ctx`. Better Auth owns sessions, passwords and the Authentik OIDC login.

**Tech Stack:** Next.js 16.3.5 (App Router, standalone output), React 19.3, TypeScript 6.0.3, Tailwind CSS 4.3.3, Base UI 1.8.0, Better Auth 1.7.4, Drizzle ORM 0.45.2 + node-postgres, next-intl 4.14.4, zod 4.6.4, nodemailer 10, AWS SDK S3 v3, Vitest 5, Testing Library, Playwright 1.63.

**Spec:** `docs/specs/2026-09-13-dev-0.1-design.md` (approved 2026-09-13). Read §1 (decisions), §3 (repository layout), §4 (architecture and conventions), §5 (auth), §8 (UI), §10 (jobs), §11 (tests) before starting.

## Global Constraints

Every task implicitly includes these.

- **Working copy:** `/home/mattia/docker/projects/personal-dashboard`, branch `dev-0.1`. Never create branches or worktrees (a user hook blocks it). Commit on `dev-0.1`.
- **Support folders are read-only and never committed:** `Fondo Cometa/`, `Payroll/`, `UI Recreation and branding decisions/`. Never modify, move or copy them; they are already in `.gitignore`.
- **Clean repository:** no file or code copied from the old version on `main` (read it only as reference); no dead code, no commented-out code, no TODOs; docs describe only what exists.
- **Node:** `>=22.12` (host has 22.22.1; Docker uses `node:22-alpine`).
- **Exact dependency versions** (install with `--save-exact`): next 16.3.5, react 19.3.0, react-dom 19.3.0, @base-ui/react 1.8.0, better-auth 1.7.4, drizzle-orm 0.45.2, pg 8.23.0, next-intl 4.14.4, zod 4.6.4, lucide-react 1.45.0, nodemailer 10.0.9, @aws-sdk/client-s3 3.1131.0, @node-rs/argon2 2.2.1, jose 6.2.12, server-only 0.0.1, clsx 2.1.1, tailwind-merge 3.7.0, @fontsource-variable/inter 5.3.0; dev: typescript 6.0.3 (**not 7**: typescript-eslint requires <6.1), @types/node 22.20.2, @types/react 19.3.0, @types/react-dom 19.3.0, @types/pg 8.23.1, tailwindcss 4.3.3, @tailwindcss/postcss 4.3.3, eslint 9.39.5 (**not 10**: eslint-config-next crashes on it), eslint-config-next 16.3.5, prettier 3.9.6, drizzle-kit 0.31.10, vitest 5.0.0, @vitejs/plugin-react 6.1.1, vite 8.3.0, jsdom 29.1.1 (**not 30**: needs Node ≥22.22.2), @testing-library/react 16.3.3, @testing-library/dom 10.4.1, @testing-library/jest-dom 7.0.1, @testing-library/user-event 14.6.7, @playwright/test 1.63.0, tsx 4.23.13, esbuild 0.28.2. Do **not** add `@types/nodemailer` (nodemailer 10 ships its own types).
- **Money:** `bigint` cents in Postgres (`bigint(..., { mode: "bigint" })`) and TypeScript (`Cents` from `src/platform/money.ts`). Never `number` for money.
- **Unknown is `null`, never 0.** The UI renders `null` as `—` (`NULL_DISPLAY`).
- **Dates:** civil dates are `date({ mode: "string" })` / `CivilDate`; instants are `timestamp({ withTimezone: true })`. "Today" only via `today(ctx.timeZone)` from `src/platform/dates.ts`. Never derive a civil date from `toISOString()`.
- **Ids:** `uuid().primaryKey().default(sql\`uuidv7()\`)` (Postgres 18).
- **User scoping:** every user-owned table has `user_id uuid not null references users(id) on delete cascade`; every service function takes `(ctx: Ctx, input)`; queries use `userScoped(ctx)` (Task 8).
- **No network I/O inside a database transaction** (mail, S3, HTTP, LLM happen outside; results are applied in a short transaction).
- **LLM fallback is OpenAI only** (spec D18): no LLM code belongs in F0; never add another provider's SDK or configuration.
- **Deterministic `ORDER BY`** on every list query.
- **Copy:** every user-facing string is a next-intl message in `messages/en.json` **and** `messages/it.json` (English is the source); a unit test (Task 13) fails if the two files' keys differ.
- **Production `docker-compose.yml` is NOT added in F0** (spec §3): only `compose.dev.yml`. `projects/stack.sh` would otherwise start the dev build in place of production.
- **Dev services** run from `compose.dev.yml` (project name `finance-dev`) on ports that do not clash with the homelab: Postgres `55432`, MinIO `59000`/`59001`, Mailpit SMTP `51025` / UI `58025`, mock OIDC `58090`. No named Docker volumes (homelab rule): disposable `tmpfs` only.
- **Commits:** small, conventional (`feat(scope): …`, `test: …`, `chore: …`), each ending with the two lines:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg`.
  Every task's commit step uses `git commit -F - <<'EOF' … EOF` with those two lines after a blank line. Before each commit (from Task 1 on) run `npm run format`, then `npm run lint`, `npm run typecheck` and `npm run format:check`; all must exit 0.

## File structure (created in F0)

```
.
├── src/
│   ├── app/
│   │   ├── layout.tsx, globals.css
│   │   ├── (auth)/layout.tsx, (auth)/auth-card.tsx, (auth)/actions.ts (accept invitation)
│   │   │   (auth)/sign-in/{page,sign-in-form,errors}, (auth)/forgot-password/{page,forgot-form},
│   │   │   (auth)/reset-password/{page,reset-form}, (auth)/invite/[token]/{page,invite-form}
│   │   ├── (app)/layout.tsx, (app)/navigation.ts, (app)/page.tsx (Overview, empty state)
│   │   ├── (app)/settings/             layout, page, settings-tabs, profile/{page,preferences-form,name-form},
│   │   │                               security/{page,password-form,sessions-list}
│   │   ├── (app)/components/           page.tsx, gallery.tsx — design-system page (Admin only)
│   │   └── api/auth/[...all]/route.ts, api/jobs/tick/route.ts, api/health/route.ts, api/metrics/route.ts
│   ├── proxy.ts                        anonymous → /sign-in, CSP header
│   ├── global.d.ts                     next-intl typed messages
│   ├── architecture.test.ts            module-boundary test
│   ├── modules/users/                  schema.ts, rules.ts, service.ts, actions.ts (theme, preferences, name, sessions)
│   ├── platform/
│   │   ├── money.ts, dates.ts, holidays.ts, format.ts, crypto.ts, env.ts, context.ts, mail.ts,
│   │   │   storage.ts, storage-keys.ts, theme.ts
│   │   ├── db/                         client.ts, tables.ts, scope.ts, migrate.ts
│   │   ├── auth/                       schema.ts, roles.ts, provider.ts, csp.ts, auth.ts, session.ts, client.ts,
│   │   │                               invitations.ts, emails.ts
│   │   ├── jobs/                       schema.ts, registry.ts, lock.ts, tick.ts, heartbeat.ts, housekeeping.ts, secret.ts
│   │   └── i18n/request.ts, i18n/locales.ts
│   └── ui/                             cn.ts, tone.ts, button, input, field, badge, card, kpi-tile, progress-bar,
│                                       avatar, skeleton, kbd, modal, toast, segmented, menu, popover, tab-links,
│                                       table, states, section, shell/
├── messages/en.json, messages/it.json
├── drizzle/                            generated migrations
├── scripts/migrate.ts, scripts/create-admin.ts, scripts/seed-dev.ts, scripts/seed-e2e.ts
├── test/setup-dom.ts, test/server-only.ts, test/integration-setup.ts, test/db.ts, test/truncate.ts,
│   test/users.ts, test/mailpit.ts
├── tests/e2e/                          Playwright specs, env, serve.sh, global setup, helpers
├── dev/postgres-init.sql, dev/mock-oidc.json
├── cron/Dockerfile, cron/crontab
├── Dockerfile, entrypoint.sh, .dockerignore, compose.dev.yml
├── package.json, tsconfig.json, next.config.ts, postcss.config.mjs, eslint.config.mjs,
│   .prettierrc.json, .prettierignore, vitest.config.ts, playwright.config.ts, drizzle.config.ts
├── .env.example, README.md, CLAUDE.md
```

## Task overview

| # | Task | Deliverable |
|---|---|---|
| 1 | Scaffold | App builds, lints, type-checks, tests run |
| 2 | Money | `src/platform/money.ts` |
| 3 | Dates | `src/platform/dates.ts` |
| 4 | Holidays | `src/platform/holidays.ts` |
| 5 | Formatting | `src/platform/format.ts` |
| 6 | Encryption | `src/platform/crypto.ts` |
| 7 | Dev services, env, database, migrations, integration harness | `compose.dev.yml`, `src/platform/db/*`, integration tests run |
| 8 | Auth tables, users module, `Ctx`, `userScoped`, preferences | preferences service with isolation test |
| 9 | Better Auth | sign-in by password and OIDC, gates, roles, proxy |
| 10 | Mail, invitations, password reset | invite and reset emails end to end (Mailpit) |
| 11 | S3 storage | `src/platform/storage.ts` against MinIO |
| 12 | Jobs, health, metrics | tick endpoint, lock, runs, housekeeping |
| 13 | Design tokens, theme, font, i18n | tokens in Tailwind, theme without flash, EN/IT |
| 14 | UI primitives | buttons, inputs, badges, cards, KPI tile, avatar, skeleton, progress |
| 15 | UI overlays, table, states | modal, popover, menu, toast, segmented, tabs, table, empty/error |
| 16 | App shell | sidebar, topbar, mobile tabs + More sheet, command palette |
| 17 | Auth pages | sign-in, invite accept, forgot/reset password |
| 18 | Settings: Profile and Security | preferences form, password change, sessions |
| 19 | Components page and Overview | `/components` (Admin), Overview empty state |
| 20 | Docker images | app image, cron image, entrypoint with migrations |
| 21 | End-to-end tests | Playwright desktop + mobile, password + OIDC |
| 22 | Dev seed, docs, phase gate | seed script, README, CLAUDE.md, full gate + review |

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `test/setup-dom.ts`, `test/server-only.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `.env.example`, `README.md`, `CLAUDE.md`
- Modify: `.gitignore` (add `.vitest/`)

**Interfaces:**
- Consumes: nothing.
- Produces: npm scripts `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:watch` (later tasks add `test:integration`, `e2e`, `db:*`, `dev:*`); path alias `@/*` → `src/*`; Vitest projects `unit-node` (`src/**/*.test.ts`) and `unit-dom` (`src/**/*.test.tsx`).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "finance-dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.12.0"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "next typegen && tsc --noEmit",
    "test": "vitest run --project 'unit-*'",
    "test:watch": "vitest --project 'unit-*'"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "3.1131.0",
    "@base-ui/react": "1.8.0",
    "@fontsource-variable/inter": "5.3.0",
    "@node-rs/argon2": "2.2.1",
    "better-auth": "1.7.4",
    "clsx": "2.1.1",
    "drizzle-orm": "0.45.2",
    "jose": "6.2.12",
    "lucide-react": "1.45.0",
    "next": "16.3.5",
    "next-intl": "4.14.4",
    "nodemailer": "10.0.9",
    "pg": "8.23.0",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "server-only": "0.0.1",
    "tailwind-merge": "3.7.0",
    "zod": "4.6.4"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@tailwindcss/postcss": "4.3.3",
    "@testing-library/dom": "10.4.1",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.7",
    "@types/node": "22.20.2",
    "@types/pg": "8.23.1",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "drizzle-kit": "0.31.10",
    "esbuild": "0.28.2",
    "eslint": "9.39.5",
    "eslint-config-next": "16.3.5",
    "jsdom": "29.1.1",
    "prettier": "3.9.6",
    "tailwindcss": "4.3.3",
    "tsx": "4.23.13",
    "typescript": "6.0.3",
    "vite": "8.3.0",
    "vitest": "5.0.0"
  }
}
```

- [ ] **Step 2: Install and confirm the lockfile resolves**

Run: `npm install`
Expected: `added N packages`, a `package-lock.json` is created, no `ERESOLVE` error. `EBADENGINE` warnings are acceptable only if they name a package outside this list.

- [ ] **Step 3: Write the TypeScript, Next, PostCSS, ESLint and Prettier configs**

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "types": ["node"],
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "**/*.mts"],
  "exclude": ["node_modules", "Fondo Cometa", "Payroll", "UI Recreation and branding decisions"]
}
```

(`// tsconfig.json` is a label for this plan; do not put comments in the JSON file.)

```ts
// next.config.ts
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  // Otherwise `next dev` writes its own CLAUDE.md/AGENTS.md into the repository.
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
```

If `agentRules` is rejected by the type checker (unknown key), remove that property and add `CLAUDE.md`/`AGENTS.md` generation to the Task 22 review checklist instead; do not silence the type error.

```js
// postcss.config.mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

```js
// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**/*.{ts,tsx}", "src/ui/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/*/schema"],
              message: "Pages and UI read data through a module's service or queries, never its tables.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "drizzle/**",
    "test-results/**",
    "playwright-report/**",
    "Fondo Cometa/**",
    "Payroll/**",
    "UI Recreation and branding decisions/**",
  ]),
]);
```

```json
// .prettierrc.json
{
  "printWidth": 110,
  "trailingComma": "all"
}
```

```
# .prettierignore
.next
drizzle
package-lock.json
test-results
playwright-report
docs
.superpowers
Fondo Cometa
Payroll
UI Recreation and branding decisions
```

(`typecheck` runs `next typegen` first: `LayoutProps`, `PageProps` and the typed-route declarations exist only after Next has generated `.next/types`, so a bare `tsc --noEmit` fails on a fresh checkout. `docs` and `.superpowers` are prose and controller notes; Prettier would re-pad their tables.)

- [ ] **Step 4: Write the Vitest config and test setup**

```ts
// vitest.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside React Server Components; tests import server modules directly.
      "server-only": new URL("./test/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: "unit-node", environment: "node", include: ["src/**/*.test.ts"] },
      },
      {
        extends: true,
        test: {
          name: "unit-dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./test/setup-dom.ts"],
        },
      },
    ],
  },
});
```

```ts
// test/setup-dom.ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

```ts
// test/server-only.ts
// Stand-in for the `server-only` package inside Vitest (see vitest.config.ts).
export {};
```

- [ ] **Step 5: Write the minimal app**

```css
/* src/app/globals.css */
@import "tailwindcss";
```

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Finance Dashboard" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// src/app/page.tsx
export default function Home() {
  return <main>Finance Dashboard</main>;
}
```

(`src/app/page.tsx` is replaced by the `(app)` Overview in Task 19.)

- [ ] **Step 6: Write `.env.example`, `README.md`, `CLAUDE.md` and extend `.gitignore`**

```bash
# .env.example — copy to .env for local development (values match compose.dev.yml)
DATABASE_URL=postgres://finance:finance@127.0.0.1:55432/finance_dev
TEST_DATABASE_URL=postgres://finance:finance@127.0.0.1:55432/finance_test
BETTER_AUTH_URL=http://localhost:3000
# 32+ characters: `openssl rand -base64 32`
BETTER_AUTH_SECRET=change-me-change-me-change-me-change-me
```

````markdown
<!-- README.md -->
# Finance Dashboard

Personal finance and household-admin dashboard. Version 0.1 is a from-scratch rebuild; the design is in
[`docs/specs/2026-09-13-dev-0.1-design.md`](docs/specs/2026-09-13-dev-0.1-design.md) and each phase has its
plan in [`docs/plans/`](docs/plans/).

## Develop

```bash
npm install
cp .env.example .env
npm run dev          # http://localhost:3000
```

## Check

```bash
npm run lint && npm run typecheck && npm test && npm run build
```
````

```markdown
<!-- CLAUDE.md -->
# Repository conventions

- The design and every binding decision: `docs/specs/2026-09-13-dev-0.1-design.md`. Phase plans: `docs/plans/`.
- `Fondo Cometa/`, `Payroll/` and `UI Recreation and branding decisions/` are the owner's local reference
  material: read-only, never committed, deleted at the end of development.
- Layout: `src/app` routes, `src/modules/<name>` domain modules, `src/platform` shared services, `src/ui` design system.
- Money is `bigint` cents, unknown is `null`, dates go through `src/platform/dates.ts`, services take `(ctx, input)`.
- Before committing: `npm run format && npm run lint && npm run typecheck && npm run format:check && npm test`.
```

Append to `.gitignore`:

```
.vitest/
```

- [ ] **Step 7: Verify the scaffold end to end**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build`
Expected: Prettier rewrites what it needs to; ESLint prints no errors; `next typegen` generates the route types and `tsc` exits 0; `format:check` reports `All matched files use Prettier code style!`; Vitest reports `No test files found, exiting with code 0`; `next build` ends with `Route (app)` listing `/` and creates `.next/standalone/server.js`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs \
  .prettierrc.json .prettierignore vitest.config.ts test src .env.example README.md CLAUDE.md .gitignore
git commit -F - <<'EOF'
chore: scaffold Next.js 16 app with TypeScript, Tailwind, ESLint and Vitest

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 2: Money in integer cents

**Files:**
- Create: `src/platform/money.ts`
- Test: `src/platform/money.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Cents = bigint`
  - `parseCents(input: string): Cents` — plain decimal string → cents, half-up (away from zero) at the third decimal; throws `RangeError` on anything else.
  - `centsFromNumber(value: number): Cents` — for provider JSON numbers; goes through `value.toFixed(6)`.
  - `centsToDecimal(cents: Cents): string` — canonical `"-1234.56"`.
  - `sumCents(values: readonly (Cents | null)[]): { total: Cents | null; partial: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/money.test.ts
import { describe, expect, it } from "vitest";
import { centsFromNumber, centsToDecimal, parseCents, sumCents } from "./money";

describe("parseCents", () => {
  it.each([
    ["1234.56", 123456n],
    ["12", 1200n],
    ["1.2", 120n],
    ["0.005", 1n],
    ["0.0049", 0n],
    ["-0.005", -1n],
    ["-1.235", -124n],
    [" 7.10 ", 710n],
    ["-0", 0n],
  ])("parses %s", (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });

  it.each(["1.234,56", "1,5", "1e3", "€1", "", "abc", "1.2.3"])("rejects %s", (input) => {
    expect(() => parseCents(input)).toThrow(RangeError);
  });
});

describe("centsFromNumber", () => {
  it("goes through the decimal representation, never float arithmetic", () => {
    expect(centsFromNumber(0.1 + 0.2)).toBe(30n);
    expect(centsFromNumber(-12.345)).toBe(-1235n);
    expect(centsFromNumber(2615.39)).toBe(261539n);
  });

  it("rejects non-finite and out-of-range values", () => {
    expect(() => centsFromNumber(Number.NaN)).toThrow(RangeError);
    expect(() => centsFromNumber(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => centsFromNumber(1e16)).toThrow(RangeError);
  });
});

describe("centsToDecimal", () => {
  it.each([
    [123456n, "1234.56"],
    [-5n, "-0.05"],
    [0n, "0.00"],
    [100n, "1.00"],
  ])("formats %s", (cents, expected) => {
    expect(centsToDecimal(cents)).toBe(expected);
  });
});

describe("sumCents", () => {
  it("keeps unknown distinct from zero", () => {
    expect(sumCents([100n, null, 50n])).toEqual({ total: 150n, partial: true });
    expect(sumCents([null, null])).toEqual({ total: null, partial: true });
    expect(sumCents([])).toEqual({ total: null, partial: false });
    expect(sumCents([0n])).toEqual({ total: 0n, partial: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/platform/money.test.ts`
Expected: FAIL — `Failed to resolve import "./money"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/platform/money.ts

/** Integer cents. Every amount in the app travels as Cents, never as a float. */
export type Cents = bigint;

const PLAIN_DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;
const MAX_SAFE_AMOUNT = 1e15;

/**
 * Parses a plain decimal string ("1234.5", "-0.005") into cents, rounding
 * half-up, away from zero, at the third decimal. Italian formatting,
 * exponents and currency symbols are rejected: callers normalise first.
 */
export function parseCents(input: string): Cents {
  const match = PLAIN_DECIMAL.exec(input.trim());
  if (!match) throw new RangeError(`Not a plain decimal amount: "${input}"`);
  const [, sign, whole, fraction = ""] = match;
  const firstThree = `${fraction}000`.slice(0, 3);
  let cents = BigInt(whole) * 100n + BigInt(firstThree.slice(0, 2));
  if (Number(firstThree[2]) >= 5) cents += 1n;
  return sign === "-" ? -cents : cents;
}

/** Converts a JSON number from a provider through its fixed decimal representation. */
export function centsFromNumber(value: number): Cents {
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_SAFE_AMOUNT) {
    throw new RangeError(`Not a representable amount: ${value}`);
  }
  return parseCents(value.toFixed(6));
}

/** The canonical decimal string of an amount: "1234.56", "-0.05". */
export function centsToDecimal(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${abs / 100n}.${fraction}`;
}

/**
 * Sums amounts where null means "unknown". The total is null only when no
 * value is known; `partial` says whether any value was unknown, so a partial
 * total is never presented as a complete one.
 */
export function sumCents(values: readonly (Cents | null)[]): { total: Cents | null; partial: boolean } {
  let total: Cents | null = null;
  let partial = false;
  for (const value of values) {
    if (value === null) {
      partial = true;
      continue;
    }
    total = (total ?? 0n) + value;
  }
  return { total, partial };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/platform/money.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/money.ts src/platform/money.test.ts
git commit -F - <<'EOF'
feat(platform): money in integer cents with half-up parsing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 3: Civil dates in the user's timezone

**Files:**
- Create: `src/platform/dates.ts`
- Test: `src/platform/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CivilDate = string` (`YYYY-MM-DD`), `type MonthKey = string` (`YYYY-MM-01`)
  - `isCivilDate(value: string): boolean`
  - `civilDateIn(instant: Date, timeZone: string): CivilDate`
  - `today(timeZone: string, now?: Date): CivilDate`
  - `monthKey(date: CivilDate): MonthKey`
  - `addDays(date: CivilDate, days: number): CivilDate`
  - `addMonths(month: MonthKey, months: number): MonthKey`
  - `lastDayOfMonth(month: MonthKey): CivilDate`
  - `monthsBetween(from: MonthKey, to: MonthKey): MonthKey[]` (inclusive)
  - `dayOfWeek(date: CivilDate): number` (0 = Sunday … 6 = Saturday)

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/dates.test.ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  civilDateIn,
  dayOfWeek,
  isCivilDate,
  lastDayOfMonth,
  monthKey,
  monthsBetween,
  today,
} from "./dates";

describe("civil dates", () => {
  it("resolves the civil date in the given timezone, not UTC", () => {
    const lateEvening = new Date("2026-09-12T22:30:00Z");
    expect(civilDateIn(lateEvening, "Europe/Rome")).toBe("2026-09-13");
    expect(civilDateIn(lateEvening, "UTC")).toBe("2026-09-12");
    expect(today("Europe/Rome", lateEvening)).toBe("2026-09-13");
  });

  it("validates real calendar dates only", () => {
    expect(isCivilDate("2024-02-29")).toBe(true);
    expect(isCivilDate("2026-02-29")).toBe(false);
    expect(isCivilDate("2026-02-31")).toBe(false);
    expect(isCivilDate("2026-9-1")).toBe(false);
  });

  it("does month arithmetic across year boundaries", () => {
    expect(monthKey("2026-09-13")).toBe("2026-09-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(lastDayOfMonth("2026-02-01")).toBe("2026-02-28");
    expect(lastDayOfMonth("2024-02-01")).toBe("2024-02-29");
    expect(monthsBetween("2025-11-01", "2026-02-01")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
    expect(monthsBetween("2026-02-01", "2025-11-01")).toEqual([]);
  });

  it("does day arithmetic and weekday lookup", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(dayOfWeek("2026-09-13")).toBe(0);
    expect(dayOfWeek("2026-09-14")).toBe(1);
  });

  it("rejects malformed input instead of guessing", () => {
    expect(() => monthKey("13/09/2026")).toThrow(RangeError);
    expect(() => addDays("2026-02-31", 1)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/platform/dates.test.ts`
Expected: FAIL — `Failed to resolve import "./dates"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/platform/dates.ts

/** A calendar date with no time and no timezone: "YYYY-MM-DD". */
export type CivilDate = string;
/** The first day of a month: "YYYY-MM-01". */
export type MonthKey = string;

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function isCivilDate(value: string): boolean {
  const match = CIVIL_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function parts(date: CivilDate): [number, number, number] {
  if (!isCivilDate(date)) throw new RangeError(`Not a civil date: "${date}"`);
  const [year, month, day] = date.split("-").map(Number);
  return [year, month, day];
}

function fromUtcMillis(millis: number): CivilDate {
  const d = new Date(millis);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The civil date of an instant as seen in `timeZone` (an IANA name). */
export function civilDateIn(instant: Date, timeZone: string): CivilDate {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const byType = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/** "Today" for a user. The only sanctioned way to obtain the current civil date. */
export function today(timeZone: string, now: Date = new Date()): CivilDate {
  return civilDateIn(now, timeZone);
}

export function monthKey(date: CivilDate): MonthKey {
  const [year, month] = parts(date);
  return `${pad(year, 4)}-${pad(month)}-01`;
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const [year, month, day] = parts(date);
  return fromUtcMillis(Date.UTC(year, month - 1, day + days));
}

export function addMonths(month: MonthKey, months: number): MonthKey {
  const [year, m] = parts(month);
  return fromUtcMillis(Date.UTC(year, m - 1 + months, 1));
}

export function lastDayOfMonth(month: MonthKey): CivilDate {
  return addDays(addMonths(monthKey(month), 1), -1);
}

/** Every month from `from` to `to`, both included; empty when `from` is after `to`. */
export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const result: MonthKey[] = [];
  for (let cursor = monthKey(from); cursor <= monthKey(to); cursor = addMonths(cursor, 1)) {
    result.push(cursor);
  }
  return result;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: CivilDate): number {
  const [year, month, day] = parts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/platform/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/dates.ts src/platform/dates.test.ts
git commit -F - <<'EOF'
feat(platform): civil dates and month keys in the user's timezone

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 4: Italian public holidays

**Files:**
- Create: `src/platform/holidays.ts`
- Test: `src/platform/holidays.test.ts`

**Interfaces:**
- Consumes: `CivilDate`, `addDays`, `dayOfWeek` from `src/platform/dates.ts` (Task 3).
- Produces:
  - `type HolidayKey = "newYear" | "epiphany" | "easter" | "easterMonday" | "liberation" | "labour" | "republic" | "assumption" | "allSaints" | "immaculate" | "christmas" | "stStephen" | "patronSaint"`
  - `interface Holiday { date: CivilDate; key: HolidayKey }`
  - `interface PatronSaint { month: number; day: number }`
  - `easterSunday(year: number): CivilDate`
  - `italianHolidays(year: number, patron?: PatronSaint | null): Holiday[]` (sorted by date, one entry per date)
  - `isWeekend(date: CivilDate): boolean`
  - `isHoliday(date: CivilDate, patron?: PatronSaint | null): boolean`
  - `isBookable(date: CivilDate, patron?: PatronSaint | null): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/holidays.test.ts
import { describe, expect, it } from "vitest";
import { easterSunday, isBookable, isHoliday, isWeekend, italianHolidays } from "./holidays";

describe("easterSunday", () => {
  it.each([
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2038, "2038-04-25"],
  ])("computes Easter %i", (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe("italianHolidays", () => {
  it("lists the national holidays including Easter Monday", () => {
    const dates = italianHolidays(2026).map((h) => h.date);
    expect(dates).toEqual([
      "2026-01-01",
      "2026-01-06",
      "2026-04-05",
      "2026-04-06",
      "2026-04-25",
      "2026-05-01",
      "2026-06-02",
      "2026-08-15",
      "2026-11-01",
      "2026-12-08",
      "2026-12-25",
      "2026-12-26",
    ]);
  });

  it("adds the patron saint and never duplicates a date", () => {
    const milan = italianHolidays(2026, { month: 12, day: 7 });
    expect(milan.find((h) => h.key === "patronSaint")?.date).toBe("2026-12-07");
    const rome = italianHolidays(2026, { month: 6, day: 29 });
    expect(rome).toHaveLength(13);
    const coincides = italianHolidays(2026, { month: 12, day: 8 });
    expect(coincides.filter((h) => h.date === "2026-12-08")).toHaveLength(1);
  });
});

describe("bookable days", () => {
  it("refuses weekends and holidays", () => {
    expect(isWeekend("2026-09-13")).toBe(true);
    expect(isWeekend("2026-09-14")).toBe(false);
    expect(isHoliday("2026-12-25")).toBe(true);
    expect(isHoliday("2026-12-07", { month: 12, day: 7 })).toBe(true);
    expect(isBookable("2026-09-14")).toBe(true);
    expect(isBookable("2026-09-13")).toBe(false);
    expect(isBookable("2026-04-06")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/platform/holidays.test.ts`
Expected: FAIL — `Failed to resolve import "./holidays"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/platform/holidays.ts
import { addDays, type CivilDate, dayOfWeek } from "./dates";

export type HolidayKey =
  | "newYear"
  | "epiphany"
  | "easter"
  | "easterMonday"
  | "liberation"
  | "labour"
  | "republic"
  | "assumption"
  | "allSaints"
  | "immaculate"
  | "christmas"
  | "stStephen"
  | "patronSaint";

export interface Holiday {
  date: CivilDate;
  key: HolidayKey;
}

/** The local patron-saint holiday, from the user's preferences (e.g. Milan: 7 December). */
export interface PatronSaint {
  month: number;
  day: number;
}

const FIXED: ReadonlyArray<[number, number, HolidayKey]> = [
  [1, 1, "newYear"],
  [1, 6, "epiphany"],
  [4, 25, "liberation"],
  [5, 1, "labour"],
  [6, 2, "republic"],
  [8, 15, "assumption"],
  [11, 1, "allSaints"],
  [12, 8, "immaculate"],
  [12, 25, "christmas"],
  [12, 26, "stStephen"],
];

function isoDate(year: number, month: number, day: number): CivilDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Easter Sunday in the Gregorian calendar (anonymous Gregorian algorithm). */
export function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

export function italianHolidays(year: number, patron?: PatronSaint | null): Holiday[] {
  const easter = easterSunday(year);
  const holidays: Holiday[] = [
    ...FIXED.map(([month, day, key]) => ({ date: isoDate(year, month, day), key })),
    { date: easter, key: "easter" },
    { date: addDays(easter, 1), key: "easterMonday" },
  ];
  if (patron) {
    const date = isoDate(year, patron.month, patron.day);
    if (!holidays.some((h) => h.date === date)) holidays.push({ date, key: "patronSaint" });
  }
  return holidays.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

export function isWeekend(date: CivilDate): boolean {
  const weekday = dayOfWeek(date);
  return weekday === 0 || weekday === 6;
}

export function isHoliday(date: CivilDate, patron?: PatronSaint | null): boolean {
  return italianHolidays(Number(date.slice(0, 4)), patron).some((h) => h.date === date);
}

/** A leave day can be booked only on a working day. */
export function isBookable(date: CivilDate, patron?: PatronSaint | null): boolean {
  return !isWeekend(date) && !isHoliday(date, patron);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/platform/holidays.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/holidays.ts src/platform/holidays.test.ts
git commit -F - <<'EOF'
feat(platform): Italian public holidays with Easter and patron saint

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 5: Number and date formatting

**Files:**
- Create: `src/platform/format.ts`
- Test: `src/platform/format.test.ts`

**Interfaces:**
- Consumes: `Cents`, `centsToDecimal` (Task 2); `CivilDate`, `isCivilDate` (Task 3).
- Produces:
  - `type NumberFormat = "it-IT" | "en-US" | "fr-FR"`
  - `type UiLocale = "en" | "it"`
  - `NULL_DISPLAY = "—"`
  - `formatMoney(cents: Cents | null, format: NumberFormat, options?: { decimals?: boolean; signed?: boolean }): string`
  - `formatPercent(fraction: number | null, format: NumberFormat, options?: { decimals?: number; signed?: boolean }): string`
  - `formatDate(date: CivilDate | null, style: "dayMonth" | "long" | "monthYear" | "monthShort", locale: UiLocale): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/format.test.ts
import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatPercent } from "./format";

/** Intl uses no-break spaces (U+00A0, U+202F); compare with plain spaces. */
const plain = (s: string) => s.replace(/\s/g, " ");

describe("formatMoney", () => {
  it("always groups thousands, even for four-digit amounts", () => {
    expect(plain(formatMoney(713595n, "it-IT"))).toBe("7.135,95 €");
    expect(plain(formatMoney(5914590n, "it-IT"))).toBe("59.145,90 €");
  });

  it("uses a true minus sign and an explicit plus when signed", () => {
    expect(plain(formatMoney(-31240n, "it-IT"))).toBe("−312,40 €");
    expect(plain(formatMoney(136710n, "it-IT", { signed: true }))).toBe("+1.367,10 €");
    expect(plain(formatMoney(0n, "it-IT", { signed: true }))).toBe("0,00 €");
  });

  it("can drop decimals and renders unknown as a dash", () => {
    expect(plain(formatMoney(4095000n, "it-IT", { decimals: false }))).toBe("40.950 €");
    expect(formatMoney(null, "it-IT")).toBe("—");
  });

  it("follows the chosen number format", () => {
    expect(plain(formatMoney(123456n, "en-US"))).toBe("€1,234.56");
    expect(plain(formatMoney(123456n, "fr-FR"))).toBe("1 234,56 €");
  });
});

describe("formatPercent", () => {
  it("puts a space before % outside en-US and signs on request", () => {
    expect(plain(formatPercent(0.016, "it-IT", { signed: true }))).toBe("+1,6 %");
    expect(plain(formatPercent(-0.107, "it-IT", { signed: true }))).toBe("−10,7 %");
    expect(plain(formatPercent(0.297, "it-IT"))).toBe("29,7 %");
    expect(formatPercent(0.297, "en-US")).toBe("29.7%");
    expect(plain(formatPercent(0.0275, "it-IT", { decimals: 2 }))).toBe("2,75 %");
    expect(formatPercent(null, "it-IT")).toBe("—");
  });
});

describe("formatDate", () => {
  it("formats civil dates without timezone drift", () => {
    expect(formatDate("2026-09-09", "dayMonth", "en")).toBe("09 Sep");
    expect(formatDate("2026-09-01", "long", "en")).toBe("1 Sep 2026");
    expect(formatDate("2026-09-01", "monthYear", "en")).toBe("September 2026");
    expect(formatDate("2026-09-01", "monthShort", "en")).toBe("Sep 26");
    expect(formatDate("2026-09-09", "dayMonth", "it")).toBe("09 set");
    expect(formatDate("2026-09-01", "monthYear", "it")).toBe("settembre 2026");
    expect(formatDate(null, "long", "en")).toBe("—");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/platform/format.test.ts`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/platform/format.ts
import { type CivilDate, isCivilDate } from "./dates";
import { type Cents, centsToDecimal } from "./money";

export type NumberFormat = "it-IT" | "en-US" | "fr-FR";
export type UiLocale = "en" | "it";

export const NULL_DISPLAY = "—";
const MINUS = "−";
const NBSP = " ";

function withTrueMinus(text: string): string {
  return text.replace(/-/g, MINUS);
}

export function formatMoney(
  cents: Cents | null,
  format: NumberFormat,
  options: { decimals?: boolean; signed?: boolean } = {},
): string {
  if (cents === null) return NULL_DISPLAY;
  const digits = options.decimals === false ? 0 : 2;
  const formatter = new Intl.NumberFormat(format, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: "always",
    signDisplay: options.signed ? "exceptZero" : "auto",
  });
  // A decimal string is formatted exactly (Intl.NumberFormat v3): no float on the way.
  return withTrueMinus(formatter.format(centsToDecimal(cents) as `${number}`));
}

export function formatPercent(
  fraction: number | null,
  format: NumberFormat,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  if (fraction === null) return NULL_DISPLAY;
  const digits = options.decimals ?? 1;
  const number = new Intl.NumberFormat(format, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: "always",
    signDisplay: options.signed ? "exceptZero" : "auto",
  }).format(fraction * 100);
  return format === "en-US" ? `${withTrueMinus(number)}%` : `${withTrueMinus(number)}${NBSP}%`;
}

const MONTH_LOCALE: Record<UiLocale, string> = { en: "en-US", it: "it-IT" };

function monthName(date: CivilDate, locale: UiLocale, width: "short" | "long"): string {
  const [year, month] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(MONTH_LOCALE[locale], { month: width, timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * Civil dates are formatted from their parts, never through a local Date,
 * so the displayed day cannot drift with the server's timezone. Month names
 * come from Intl; the order of the parts is fixed to match the design.
 */
export function formatDate(
  date: CivilDate | null,
  style: "dayMonth" | "long" | "monthYear" | "monthShort",
  locale: UiLocale,
): string {
  if (date === null) return NULL_DISPLAY;
  if (!isCivilDate(date)) throw new RangeError(`Not a civil date: "${date}"`);
  const [year, , day] = date.split("-");
  switch (style) {
    case "dayMonth":
      return `${day} ${monthName(date, locale, "short")}`;
    case "long":
      return `${Number(day)} ${monthName(date, locale, "short")} ${year}`;
    case "monthYear":
      return `${monthName(date, locale, "long")} ${year}`;
    case "monthShort":
      return `${monthName(date, locale, "short")} ${year.slice(2)}`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/platform/format.test.ts`
Expected: PASS. If `fr-FR` fails only on spacing, check that `plain()` is applied; ICU uses U+202F for the group separator.

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/format.ts src/platform/format.test.ts
git commit -F - <<'EOF'
feat(platform): money, percent and date formatting per user preference

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 6: Credential encryption with a rotatable key ring

**Files:**
- Create: `src/platform/crypto.ts`
- Test: `src/platform/crypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface KeyRing { activeId: string; keys: ReadonlyMap<string, Buffer> }`
  - `parseKeyRing(spec: string): KeyRing` — `"k2:<base64>,k1:<base64>"`; the first key seals, all keys open.
  - `seal(ring: KeyRing, plaintext: string): Buffer`
  - `open(ring: KeyRing, blob: Buffer): string`
  - `sealJson(ring: KeyRing, value: Record<string, string>): Buffer`, `openJson(ring: KeyRing, blob: Buffer): Record<string, string>`

Blob layout: `0x01 | idLength (1 byte) | keyId (utf8) | iv (12) | tag (16) | ciphertext`; the key id is the AES-GCM additional authenticated data.

- [ ] **Step 1: Write the failing test**

```ts
// src/platform/crypto.test.ts
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, openJson, parseKeyRing, seal, sealJson } from "./crypto";

const key = () => randomBytes(32).toString("base64");

describe("key ring", () => {
  it("parses ids and keys, first one active", () => {
    const ring = parseKeyRing(`k2:${key()},k1:${key()}`);
    expect(ring.activeId).toBe("k2");
    expect([...ring.keys.keys()]).toEqual(["k2", "k1"]);
  });

  it.each([
    ["", "empty"],
    [`K1:${key()}`, "bad id"],
    [`k1:${randomBytes(16).toString("base64")}`, "short key"],
    [`k1:${key()},k1:${key()}`, "duplicate id"],
    ["k1-nokey", "missing separator"],
  ])("rejects %s (%s)", (spec) => {
    expect(() => parseKeyRing(spec)).toThrow();
  });
});

describe("seal / open", () => {
  it("round-trips and uses a fresh IV every time", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const a = seal(ring, "wallet-token-123");
    const b = seal(ring, "wallet-token-123");
    expect(open(ring, a)).toBe("wallet-token-123");
    expect(a.equals(b)).toBe(false);
  });

  it("detects tampering", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, "secret");
    blob[blob.length - 1] ^= 0xff;
    expect(() => open(ring, blob)).toThrow();
  });

  it("opens values sealed with a retired key after rotation", () => {
    const oldKey = key();
    const before = parseKeyRing(`k1:${oldKey}`);
    const blob = seal(before, "secret");
    const after = parseKeyRing(`k2:${key()},k1:${oldKey}`);
    expect(open(after, blob)).toBe("secret");
    expect(() => open(parseKeyRing(`k2:${key()}`), blob)).toThrow(/Unknown key id/);
  });

  it("seals JSON credential objects", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = sealJson(ring, { token: "abc", baseUrl: "https://trek.example" });
    expect(openJson(ring, blob)).toEqual({ token: "abc", baseUrl: "https://trek.example" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/platform/crypto.test.ts`
Expected: FAIL — `Failed to resolve import "./crypto"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/platform/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface KeyRing {
  activeId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[a-z0-9_-]{1,32}$/;
const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Parses APP_ENCRYPTION_KEY: "k2:<base64 32 bytes>,k1:<base64 32 bytes>". The first key seals. */
export function parseKeyRing(spec: string): KeyRing {
  const entries = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error("APP_ENCRYPTION_KEY is empty");
  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    const id = separator > 0 ? entry.slice(0, separator) : "";
    const encoded = entry.slice(separator + 1);
    if (!KEY_ID.test(id)) throw new Error(`Invalid key id in APP_ENCRYPTION_KEY: "${id}"`);
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      throw new Error(`Key "${id}" must be 32 bytes of canonical base64`);
    }
    if (keys.has(id)) throw new Error(`Duplicate key id "${id}" in APP_ENCRYPTION_KEY`);
    keys.set(id, key);
  }
  return { activeId: [...keys.keys()][0], keys };
}

export function seal(ring: KeyRing, plaintext: string): Buffer {
  const key = ring.keys.get(ring.activeId);
  if (!key) throw new Error(`Active key "${ring.activeId}" is missing`);
  const id = Buffer.from(ring.activeId, "utf8");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(id);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION, id.length]), id, iv, cipher.getAuthTag(), ciphertext]);
}

export function open(ring: KeyRing, blob: Buffer): string {
  if (blob.length < 2 || blob[0] !== VERSION) throw new Error("Unsupported ciphertext version");
  const idEnd = 2 + blob[1];
  const id = blob.subarray(2, idEnd);
  const key = ring.keys.get(id.toString("utf8"));
  if (!key) throw new Error(`Unknown key id "${id.toString("utf8")}"`);
  const iv = blob.subarray(idEnd, idEnd + IV_BYTES);
  const tag = blob.subarray(idEnd + IV_BYTES, idEnd + IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(idEnd + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(id);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function sealJson(ring: KeyRing, value: Record<string, string>): Buffer {
  return seal(ring, JSON.stringify(value));
}

export function openJson(ring: KeyRing, blob: Buffer): Record<string, string> {
  const parsed: unknown = JSON.parse(open(ring, blob));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Sealed credentials are not an object");
  }
  for (const value of Object.values(parsed)) {
    if (typeof value !== "string") throw new Error("Sealed credentials must be string values");
  }
  return parsed as Record<string, string>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/platform/crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/crypto.ts src/platform/crypto.test.ts
git commit -F - <<'EOF'
feat(platform): AES-256-GCM credential sealing with a rotatable key ring

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 7: Dev services, environment, database client, migrations and the integration harness

**Files:**
- Create: `compose.dev.yml`, `dev/postgres-init.sql`, `dev/mock-oidc.json`, `src/platform/env.ts`, `src/platform/db/client.ts`, `src/platform/db/tables.ts`, `src/platform/db/migrate.ts`, `scripts/migrate.ts`, `drizzle.config.ts`, `test/integration-setup.ts`, `test/truncate.ts`, `test/db.ts`
- Modify: `vitest.config.ts` (add the `integration` project), `package.json` (scripts), `.env.example`
- Test: `src/platform/db/client.itest.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `readEnv(): Env` — validated environment, parsed once and cached. Later tasks add fields to `envSchema`.
  - `getPool(): Pool`, `getDb(): Db`, `type Db`, `type Tx` (`src/platform/db/client.ts`).
  - `src/platform/db/tables.ts` — the barrel that re-exports every `schema.ts`; later tasks add one `export * from` line each.
  - `runMigrations(pool: Pool, migrationsFolder: string): Promise<void>` (blocking advisory lock).
  - `truncateAllTables(db: Pool | ClientBase): Promise<void>` (`test/truncate.ts`; it imports nothing from `src/`, so Playwright's global setup can load it too — Task 21).
  - `resetDatabase(): Promise<void>` and `closeDatabase(): Promise<void>` test helpers (`test/db.ts`; they import the app's `server-only` client, so only Vitest loads them).
  - npm scripts: `dev:services`, `dev:services:down`, `db:generate`, `db:migrate`, `test:integration`.

- [ ] **Step 1: Write the dev services**

```yaml
# compose.dev.yml — local development and tests only. Never deployed (spec §3).
name: finance-dev

services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_USER: finance
      POSTGRES_PASSWORD: finance
      POSTGRES_DB: finance_dev
    ports:
      - "127.0.0.1:55432:5432"
    tmpfs:
      - /var/lib/postgresql
    volumes:
      - ./dev/postgres-init.sql:/docker-entrypoint-initdb.d/10-databases.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U finance -d finance_dev"]
      interval: 2s
      timeout: 3s
      retries: 30

  minio:
    image: quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: finance
      MINIO_ROOT_PASSWORD: finance-dev-secret
    ports:
      - "127.0.0.1:59000:9000"
      - "127.0.0.1:59001:9001"
    tmpfs:
      - /data

  mailpit:
    image: axllent/mailpit:v1.31.1
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
    ports:
      - "127.0.0.1:51025:1025"
      - "127.0.0.1:58025:8025"

  oidc:
    image: ghcr.io/navikt/mock-oauth2-server:6.0.2
    environment:
      SERVER_PORT: "8080"
      JSON_CONFIG_PATH: /config/mock-oidc.json
    ports:
      - "127.0.0.1:58090:8080"
    volumes:
      - ./dev/mock-oidc.json:/config/mock-oidc.json:ro
```

```sql
-- dev/postgres-init.sql — extra databases for the test suites
CREATE DATABASE finance_test;
CREATE DATABASE finance_e2e;
```

```json
{
  "interactiveLogin": true,
  "httpServer": "NettyWrapper",
  "tokenCallbacks": [
    {
      "issuerId": "default",
      "tokenExpiry": 3600,
      "requestMappings": [
        {
          "requestParam": "subject",
          "match": "admin@example.test",
          "claims": {
            "sub": "${subject}",
            "email": "${subject}",
            "email_verified": true,
            "name": "Admin User",
            "preferred_username": "admin",
            "groups": ["finance-admins"]
          }
        },
        {
          "requestParam": "subject",
          "match": ".*",
          "claims": {
            "sub": "${subject}",
            "email": "${subject}",
            "email_verified": true,
            "name": "${subject}",
            "groups": ["finance-users"]
          }
        }
      ]
    }
  ]
}
```

(That JSON is `dev/mock-oidc.json`. Claims must include `email`: Better Auth uses the ID token as the profile only when it has both `sub` and `email`. Do not set `aud`.)

- [ ] **Step 2: Start the services and check them**

Run: `docker compose -f compose.dev.yml up -d --wait && docker compose -f compose.dev.yml ps`
Expected: `postgres` is `healthy`; `minio`, `mailpit`, `oidc` are `running`.
Run: `docker compose -f compose.dev.yml exec postgres psql -U finance -d finance_dev -Atc "select uuidv7() is not null, (select count(*) from pg_database where datname in ('finance_test','finance_e2e'))"`
Expected: `t|2`.

- [ ] **Step 3: Write the environment module**

```ts
// src/platform/env.ts
import "server-only";
import { z } from "zod";

/** Compose passes unset variables as "", which must behave like "absent". */
const blankAsUndefined = (value: unknown) => (value === "" ? undefined : value);

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** The validated environment. Parsed on first use, never at import time (the build has no secrets). */
export function readEnv(): Env {
  cached ??= envSchema.parse(
    Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, blankAsUndefined(value)])),
  );
  return cached;
}
```

- [ ] **Step 4: Write the database client, the table barrel and the migration runner**

```ts
// src/platform/db/tables.ts
// Every module's Drizzle tables, re-exported for the client and for Better Auth.
// Each task that adds a `schema.ts` adds one `export * from` line here.
export {};
```

```ts
// src/platform/db/client.ts
import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readEnv } from "@/platform/env";
import * as tables from "./tables";

export type Db = NodePgDatabase<typeof tables>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Cached on globalThis so `next dev` hot reloads do not open a new pool each time.
const cache = globalThis as unknown as { financePool?: Pool; financeDb?: Db };

export function getPool(): Pool {
  cache.financePool ??= new Pool({ connectionString: readEnv().DATABASE_URL, max: 10 });
  return cache.financePool;
}

export function getDb(): Db {
  cache.financeDb ??= drizzle(getPool(), { schema: tables });
  return cache.financeDb;
}
```

```ts
// src/platform/db/migrate.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

const MIGRATION_LOCK_KEY = 7_243_911;

/**
 * Applies pending migrations. The advisory lock is session-level and taken on one
 * dedicated connection, so two containers starting together migrate one after the other.
 */
export async function runMigrations(pool: Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle({ client }), { migrationsFolder });
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
```

```ts
// scripts/migrate.ts — `npm run db:migrate` locally; bundled to /app/migrate.mjs in the image.
import { Pool } from "pg";
import { runMigrations } from "../src/platform/db/migrate";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new Pool({ connectionString, max: 1 });
try {
  await runMigrations(pool, process.env.MIGRATIONS_FOLDER ?? "./drizzle");
  console.log("[migrate] schema is up to date");
} finally {
  await pool.end();
}
```

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/platform/**/schema.ts", "./src/modules/**/schema.ts"],
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
```

- [ ] **Step 5: Add the integration project and its harness**

Add this project to the `projects` array in `vitest.config.ts`:

```ts
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.itest.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          globalSetup: ["./test/integration-setup.ts"],
          env: {
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ?? "postgres://finance:finance@127.0.0.1:55432/finance_test",
          },
        },
      },
```

```ts
// test/integration-setup.ts — runs once before the integration project.
import { existsSync } from "node:fs";
import { Pool } from "pg";
import { runMigrations } from "../src/platform/db/migrate";

export default async function setup(): Promise<void> {
  if (!existsSync("./drizzle/meta/_journal.json")) return; // no migration generated yet
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://finance:finance@127.0.0.1:55432/finance_test",
    max: 1,
  });
  try {
    await runMigrations(pool, "./drizzle");
  } finally {
    await pool.end();
  }
}
```

```ts
// test/truncate.ts — imports nothing from src/, so both Vitest and Playwright's global setup can load it.
import type { ClientBase, Pool } from "pg";

/** Empties every table of the public schema; drizzle's journal lives in the `drizzle` schema and stays. */
export async function truncateAllTables(db: Pool | ClientBase): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  if (rows.length === 0) return;
  const names = rows.map((row) => `"${row.tablename}"`).join(", ");
  await db.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}
```

```ts
// test/db.ts — helpers for *.itest.ts files (Vitest only: the client imports `server-only`).
import { getPool } from "@/platform/db/client";
import { truncateAllTables } from "./truncate";

/** Empties every application table, keeping the migrations journal. Call in `beforeEach`. */
export async function resetDatabase(): Promise<void> {
  await truncateAllTables(getPool());
}

/** Closes the shared pool. Call in `afterAll`. */
export async function closeDatabase(): Promise<void> {
  await getPool().end();
  const cache = globalThis as unknown as { financePool?: unknown; financeDb?: unknown };
  cache.financePool = undefined;
  cache.financeDb = undefined;
}
```

Scripts in `package.json`:

```json
    "test:integration": "vitest run --project integration",
    "dev:services": "docker compose -f compose.dev.yml up -d --wait",
    "dev:services:down": "docker compose -f compose.dev.yml down",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node --env-file-if-exists=.env --conditions=react-server --import tsx scripts/migrate.ts"
```

(`--conditions=react-server` makes `server-only` resolve to its empty build in scripts.)

- [ ] **Step 6: Write the integration test**

The client already exists, so this test passes on its first run; it proves the harness and Postgres 18.

```ts
// src/platform/db/client.itest.ts
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase } from "../../../test/db";
import { getDb } from "./client";

describe("database client", () => {
  afterAll(closeDatabase);

  it("reaches Postgres 18 with native uuidv7()", async () => {
    const result = await getDb().execute<{ id: string; major: number }>(
      sql`SELECT uuidv7()::text AS id, current_setting('server_version_num')::int / 10000 AS major`,
    );
    expect(result.rows[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(result.rows[0].major).toBe(18);
  });
});
```

- [ ] **Step 7: Run it**

Run: `npm run test:integration`
Expected: PASS (1 test). If it fails with `ECONNREFUSED 127.0.0.1:55432`, run `npm run dev:services` first.

- [ ] **Step 8: Update `.env.example` and commit**

Append to `.env.example`:

```bash
# compose.dev.yml services
# (Postgres 55432, MinIO 59000, Mailpit 51025/58025, mock OIDC 58090)
```

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add compose.dev.yml dev src/platform/env.ts src/platform/db drizzle.config.ts scripts/migrate.ts \
  test/integration-setup.ts test/truncate.ts test/db.ts vitest.config.ts package.json .env.example
git commit -F - <<'EOF'
feat(platform): dev services, validated env, Drizzle client, migrations and integration harness

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 8: Auth tables, the users module, `Ctx`, `userScoped` and preferences

**Files:**
- Create: `src/platform/context.ts`, `src/platform/db/scope.ts`, `src/platform/auth/schema.ts`, `src/modules/users/schema.ts`, `src/modules/users/rules.ts`, `src/modules/users/service.ts`, `test/users.ts`, `src/architecture.test.ts`
- Modify: `src/platform/db/tables.ts`
- Generate: `drizzle/0000_*.sql` (+ `drizzle/meta/*`)
- Test: `src/modules/users/rules.test.ts`, `src/modules/users/service.itest.ts`, `src/architecture.test.ts`

**Interfaces:**
- Consumes: `getDb`, `Db` (Task 7); `NumberFormat`, `UiLocale` (Task 5); `isCivilDate`-free.
- Produces:
  - `type Role = "admin" | "user"`, `interface Ctx { userId: string; role: Role; locale: UiLocale; timeZone: string; numberFormat: NumberFormat }` (`src/platform/context.ts`).
  - `userScoped(ctx: Pick<Ctx, "userId">): { owns(table): SQL; stamp<V>(values: V): V & { userId: string } }`.
  - Better Auth tables with Drizzle export keys `users`, `sessions`, `authAccounts` (SQL `auth_accounts`), `verifications`, `rateLimits` (SQL `rate_limits`), plus `invitations` (`src/platform/auth/schema.ts`).
  - `userPreferences` table (uuidv7 `id`, unique `user_id`, `created_at`, `updated_at`); `interface Preferences { timeZone; locale; numberFormat; weekStart: 0 | 1; theme: "system" | "light" | "dark"; defaultRange: "this_month" | "last_30_days" | "year_to_date"; monthlySummary: boolean; minutesPerDay: number; patronSaint: { month: number; day: number } | null }`; `DEFAULT_PREFERENCES` (theme `"light"`: spec §8.1 "light theme by default"); `preferencesInputSchema` (zod).
  - Every table has `id`, `created_at`, `updated_at` (spec §6) except `rate_limits`, whose shape Better Auth owns.
  - `getPreferences(ctx: Pick<Ctx, "userId">): Promise<Preferences>`, `updatePreferences(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Preferences>`.
  - Test helper `createTestUser(email?: string): Promise<{ id: string; email: string }>` (`test/users.ts`).

Note: Better Auth's OAuth-account table is `auth_accounts`, not `accounts`, so the name `accounts` stays free for bank accounts (F1).

- [ ] **Step 1: Write `Ctx` and the scoping helper**

```ts
// src/platform/context.ts
import type { NumberFormat, UiLocale } from "./format";

export type Role = "admin" | "user";

/** Who is acting. Built once per request (or per user inside a job) and passed to every service. */
export interface Ctx {
  userId: string;
  role: Role;
  locale: UiLocale;
  timeZone: string;
  numberFormat: NumberFormat;
}
```

```ts
// src/platform/db/scope.ts
import { eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Ctx } from "@/platform/context";

/**
 * The only way services touch user-owned rows: `owns(table)` for WHERE clauses,
 * `stamp(values)` for inserts. Keeps one user's data out of another user's queries.
 */
export function userScoped(ctx: Pick<Ctx, "userId">) {
  return {
    owns(table: { userId: AnyPgColumn }): SQL {
      return eq(table.userId, ctx.userId);
    },
    stamp<V extends object>(values: V): V & { userId: string } {
      return { ...values, userId: ctx.userId };
    },
  };
}
```

- [ ] **Step 2: Write the Better Auth tables and invitations**

```ts
// src/platform/auth/schema.ts
import { sql } from "drizzle-orm";
import { bigint, boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Column sets follow Better Auth 1.7 (core + admin plugin + database rate limit).
// Better Auth validates export keys and column property names at startup, not SQL types.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("auth_accounts_user_id_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/**
 * The one table without `created_at`/`updated_at` (spec §6 exception): Better Auth owns its shape
 * and its rows are ephemeral counters, overwritten on every request.
 */
export const rateLimits = pgTable("rate_limits", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/** Sign-up is closed: a person joins through an invitation (spec §5.1). Server-level, not user-owned. */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("invitations_email_idx").on(table.email)],
);
```

- [ ] **Step 3: Write the preferences rules test**

```ts
// src/modules/users/rules.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, preferencesInputSchema } from "./rules";

describe("preferencesInputSchema", () => {
  it("accepts a complete, valid preference set", () => {
    const parsed = preferencesInputSchema.parse({
      ...DEFAULT_PREFERENCES,
      locale: "it",
      timeZone: "Europe/London",
      patronSaint: { month: 12, day: 7 },
    });
    expect(parsed.locale).toBe("it");
    expect(parsed.patronSaint).toEqual({ month: 12, day: 7 });
  });

  it("rejects an unknown timezone", () => {
    expect(() => preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, timeZone: "Mars/Olympus" })).toThrow();
  });

  it("rejects an impossible patron-saint date", () => {
    expect(() =>
      preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, patronSaint: { month: 2, day: 30 } }),
    ).toThrow();
  });

  it("bounds the working day", () => {
    expect(() => preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, minutesPerDay: 0 })).toThrow();
    expect(() => preferencesInputSchema.parse({ ...DEFAULT_PREFERENCES, minutesPerDay: 721 })).toThrow();
  });

  it("defaults are themselves valid", () => {
    expect(preferencesInputSchema.parse(DEFAULT_PREFERENCES)).toEqual(DEFAULT_PREFERENCES);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/modules/users/rules.test.ts`
Expected: FAIL — `Failed to resolve import "./rules"`.

- [ ] **Step 5: Write the users schema and rules**

```ts
// src/modules/users/schema.ts
import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";

export const userPreferences = pgTable(
  "user_preferences",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    timeZone: text("time_zone").notNull(),
    locale: text("locale", { enum: ["en", "it"] }).notNull(),
    numberFormat: text("number_format", { enum: ["it-IT", "en-US", "fr-FR"] }).notNull(),
    weekStart: smallint("week_start").notNull(),
    theme: text("theme", { enum: ["system", "light", "dark"] }).notNull(),
    defaultRange: text("default_range", { enum: ["this_month", "last_30_days", "year_to_date"] }).notNull(),
    monthlySummary: boolean("monthly_summary").notNull(),
    minutesPerDay: integer("minutes_per_day").notNull(),
    patronMonth: smallint("patron_month"),
    patronDay: smallint("patron_day"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("user_preferences_week_start_ck", sql`${table.weekStart} in (0, 1)`),
    check("user_preferences_minutes_ck", sql`${table.minutesPerDay} between 60 and 720`),
    check(
      "user_preferences_patron_ck",
      sql`(${table.patronMonth} is null) = (${table.patronDay} is null)`,
    ),
  ],
);
```

Every `schema.ts` imports other schema files by **relative** path (`../../platform/auth/schema`), never through the `@/` alias: drizzle-kit loads schema files with its own loader, which does not read tsconfig `paths`. The preferences row has its own uuidv7 `id` and the usual `created_at`/`updated_at` (spec §6); `user_id` is unique, one row per user.

```ts
// src/modules/users/rules.ts
import { z } from "zod";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const patronSaintSchema = z
  .object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
  .refine(({ month, day }) => {
    // 2024 is a leap year, so 29 February stays a valid choice.
    const probe = new Date(Date.UTC(2024, month - 1, day));
    return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  }, "Not a real calendar day");

export const preferencesInputSchema = z.object({
  timeZone: z.string().refine(isTimeZone, "Unknown timezone"),
  locale: z.enum(["en", "it"]),
  numberFormat: z.enum(["it-IT", "en-US", "fr-FR"]),
  weekStart: z.union([z.literal(0), z.literal(1)]),
  theme: z.enum(["system", "light", "dark"]),
  defaultRange: z.enum(["this_month", "last_30_days", "year_to_date"]),
  monthlySummary: z.boolean(),
  minutesPerDay: z.number().int().min(60).max(720),
  patronSaint: patronSaintSchema.nullable(),
});

export type Preferences = z.infer<typeof preferencesInputSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  timeZone: "Europe/Rome",
  locale: "en",
  numberFormat: "it-IT",
  weekStart: 1,
  theme: "light",
  defaultRange: "this_month",
  monthlySummary: false,
  minutesPerDay: 480,
  patronSaint: null,
};
```

- [ ] **Step 6: Run the rules test**

Run: `npx vitest run src/modules/users/rules.test.ts`
Expected: PASS.

- [ ] **Step 7: Register the tables and generate the first migration**

```ts
// src/platform/db/tables.ts
// Every module's Drizzle tables, re-exported for the client and for Better Auth.
// Each task that adds a `schema.ts` adds one `export * from` line here.
export * from "@/platform/auth/schema";
export * from "@/modules/users/schema";
```

Run: `npm run db:generate -- --name init`
Expected: `drizzle/0000_init.sql` containing `CREATE TABLE "users"`, `"sessions"`, `"auth_accounts"`, `"verifications"`, `"rate_limits"`, `"invitations"`, `"user_preferences"`, each `"id" uuid PRIMARY KEY DEFAULT uuidv7()`; every table except `rate_limits` has `created_at` and `updated_at`; `user_preferences` has `"user_id" uuid NOT NULL` with a unique constraint. Read the SQL once by hand before committing.

- [ ] **Step 8: Write the users test helper, the failing service test and the architecture test**

```ts
// test/users.ts
import { randomUUID } from "node:crypto";
import { getDb } from "@/platform/db/client";
import { users } from "@/platform/auth/schema";

/** Inserts a bare user row (no credentials) for service-level tests. */
export async function createTestUser(email = `${randomUUID()}@example.test`) {
  const [row] = await getDb()
    .insert(users)
    .values({ email, name: email.split("@")[0], role: "user" })
    .returning({ id: users.id, email: users.email });
  return row;
}
```

```ts
// src/modules/users/service.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import { DEFAULT_PREFERENCES } from "./rules";
import { getPreferences, updatePreferences } from "./service";

describe("preferences service", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("returns the defaults before anything is saved", async () => {
    const user = await createTestUser();
    expect(await getPreferences({ userId: user.id })).toEqual(DEFAULT_PREFERENCES);
  });

  it("saves and reads back a full preference set", async () => {
    const user = await createTestUser();
    const saved = await updatePreferences(
      { userId: user.id },
      { ...DEFAULT_PREFERENCES, locale: "it", theme: "dark", patronSaint: { month: 12, day: 7 } },
    );
    expect(saved.locale).toBe("it");
    expect(await getPreferences({ userId: user.id })).toEqual(saved);
  });

  it("rejects invalid input without writing", async () => {
    const user = await createTestUser();
    await expect(
      updatePreferences({ userId: user.id }, { ...DEFAULT_PREFERENCES, minutesPerDay: 5 }),
    ).rejects.toThrow();
    expect(await getPreferences({ userId: user.id })).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps each user's preferences separate", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    await updatePreferences({ userId: alice.id }, { ...DEFAULT_PREFERENCES, locale: "it" });
    await updatePreferences({ userId: bob.id }, { ...DEFAULT_PREFERENCES, theme: "dark" });
    expect((await getPreferences({ userId: alice.id })).theme).toBe("light");
    expect((await getPreferences({ userId: bob.id })).locale).toBe("en");
  });
});
```

```ts
// src/architecture.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const SCHEMA_IMPORT = /from\s+["']@\/modules\/([^/"']+)\/schema["']/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("module boundaries", () => {
  it("only a module itself (and the table barrel) imports its schema", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/");
      if (rel === "platform/db/tables.ts") continue;
      for (const match of readFileSync(file, "utf8").matchAll(SCHEMA_IMPORT)) {
        if (!rel.startsWith(`modules/${match[1]}/`)) violations.push(`${rel} → modules/${match[1]}/schema`);
      }
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **Step 9: Run the service test to verify it fails**

Run: `npm run test:integration -- src/modules/users/service.itest.ts`
Expected: FAIL — `Failed to resolve import "./service"`.

- [ ] **Step 10: Write the service**

```ts
// src/modules/users/service.ts
import "server-only";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Ctx } from "@/platform/context";
import { DEFAULT_PREFERENCES, type Preferences, preferencesInputSchema } from "./rules";
import { userPreferences } from "./schema";

type Row = typeof userPreferences.$inferSelect;

function fromRow(row: Row): Preferences {
  return {
    timeZone: row.timeZone,
    locale: row.locale,
    numberFormat: row.numberFormat,
    weekStart: row.weekStart === 0 ? 0 : 1,
    theme: row.theme,
    defaultRange: row.defaultRange,
    monthlySummary: row.monthlySummary,
    minutesPerDay: row.minutesPerDay,
    patronSaint:
      row.patronMonth !== null && row.patronDay !== null ? { month: row.patronMonth, day: row.patronDay } : null,
  };
}

export async function getPreferences(ctx: Pick<Ctx, "userId">): Promise<Preferences> {
  const [row] = await getDb().select().from(userPreferences).where(userScoped(ctx).owns(userPreferences));
  return row ? fromRow(row) : DEFAULT_PREFERENCES;
}

export async function updatePreferences(ctx: Pick<Ctx, "userId">, input: unknown): Promise<Preferences> {
  const prefs = preferencesInputSchema.parse(input);
  const values = {
    timeZone: prefs.timeZone,
    locale: prefs.locale,
    numberFormat: prefs.numberFormat,
    weekStart: prefs.weekStart,
    theme: prefs.theme,
    defaultRange: prefs.defaultRange,
    monthlySummary: prefs.monthlySummary,
    minutesPerDay: prefs.minutesPerDay,
    patronMonth: prefs.patronSaint?.month ?? null,
    patronDay: prefs.patronSaint?.day ?? null,
  };
  const [row] = await getDb()
    .insert(userPreferences)
    .values(userScoped(ctx).stamp(values))
    .onConflictDoUpdate({ target: userPreferences.userId, set: values })
    .returning();
  return fromRow(row);
}
```

- [ ] **Step 11: Run all tests**

Run: `npm test && npm run test:integration`
Expected: PASS — unit (rules, architecture, platform) and integration (client, preferences service).

- [ ] **Step 12: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/context.ts src/platform/db src/platform/auth/schema.ts src/modules/users \
  src/architecture.test.ts test/users.ts drizzle
git commit -F - <<'EOF'
feat(users): auth tables, Ctx, user scoping and per-user preferences

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 9: Better Auth — password and Authentik sign-in, roles, gates and the proxy

**Files:**
- Create: `src/platform/auth/roles.ts`, `src/platform/auth/provider.ts`, `src/platform/auth/auth.ts`, `src/platform/auth/session.ts`, `src/platform/auth/client.ts`, `src/platform/auth/csp.ts`, `src/app/api/auth/[...all]/route.ts`, `src/proxy.ts`, `scripts/create-admin.ts`
- Modify: `src/platform/env.ts`, `vitest.config.ts` (integration env), `.env.example`, `package.json` (script `user:create-admin`)
- Test: `src/platform/auth/roles.test.ts`, `src/platform/auth/csp.test.ts`, `src/platform/auth/session.test.ts`, `src/platform/auth/auth.itest.ts`

**Interfaces:**
- Consumes: `getDb`, tables (Tasks 7–8); `Ctx`, `Role` (Task 8); `getPreferences` (Task 8).
- Produces:
  - `OIDC_PROVIDER_ID = "authentik"` and `identityProviderUrl(): URL | null` (`src/platform/auth/provider.ts`, no `server-only`: the proxy, Server Components and client components import it; the only place that names the provider or parses `OIDC_DISCOVERY_URL` outside `readEnv`).
  - `createAuth(options: { withNextCookies: boolean }): Auth`; `getAuth(): Auth`; `type Auth`; `applyOidcRole(account: { providerId: string; userId: string; idToken?: string | null }): Promise<void>` (`src/platform/auth/auth.ts`). Ids are generated by Postgres (`uuidv7()`), not by Better Auth.
  - `roleFromIdToken(idToken: string, adminGroup: string): Role | null` — `"admin"` when the groups claim contains the admin group, otherwise `null` (SSO never demotes).
  - `ctxFrom(user: { id: string; role?: string | null }, prefs: Preferences): Ctx`; `getOptionalCtx(): Promise<Ctx | null>`; `requireSession(): Promise<Ctx>` (redirects to `/sign-in`); `requireAdmin(): Promise<Ctx>` (404 for non-admins).
  - `contentSecurityPolicy(options: { authOrigin: string | null; dev: boolean }): string`.
  - `authClient` (`src/platform/auth/client.ts`).
  - Callback URL to register in Authentik: `${BETTER_AUTH_URL}/api/auth/callback/authentik`.

- [ ] **Step 1: Extend the environment**

Replace `envSchema` in `src/platform/env.ts` with:

```ts
export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  OIDC_DISCOVERY_URL: z.url(),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_ADMIN_GROUP: z.string().min(1).default("finance-admins"),
});
```

Add to the integration project's `env` in `vitest.config.ts`:

```ts
            BETTER_AUTH_URL: "http://127.0.0.1:3000",
            BETTER_AUTH_SECRET: "integration-secret-integration-secret-32",
            OIDC_DISCOVERY_URL: "http://127.0.0.1:58090/default/.well-known/openid-configuration",
            OIDC_CLIENT_ID: "finance",
            OIDC_CLIENT_SECRET: "finance-dev",
            OIDC_ADMIN_GROUP: "finance-admins",
```

Append to `.env.example`:

```bash
OIDC_DISCOVERY_URL=http://127.0.0.1:58090/default/.well-known/openid-configuration
OIDC_CLIENT_ID=finance
OIDC_CLIENT_SECRET=finance-dev
OIDC_ADMIN_GROUP=finance-admins
```

- [ ] **Step 2: Write the failing unit tests (roles, CSP, ctx)**

```ts
// src/platform/auth/roles.test.ts
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { roleFromIdToken } from "./roles";

const secret = new TextEncoder().encode("test-secret-test-secret-test-secret");
const token = (claims: Record<string, unknown>) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject("u1").sign(secret);

describe("roleFromIdToken", () => {
  it("grants admin to members of the admin group", async () => {
    expect(roleFromIdToken(await token({ groups: ["finance-admins", "x"] }), "finance-admins")).toBe("admin");
  });

  it("returns null otherwise, so SSO never demotes anyone", async () => {
    expect(roleFromIdToken(await token({ groups: ["finance-users"] }), "finance-admins")).toBeNull();
    expect(roleFromIdToken(await token({}), "finance-admins")).toBeNull();
    expect(roleFromIdToken(await token({ groups: "finance-admins" }), "finance-admins")).toBeNull();
  });
});
```

```ts
// src/platform/auth/csp.test.ts
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";

describe("contentSecurityPolicy", () => {
  it("allows the form post to the identity provider and nothing else", () => {
    const csp = contentSecurityPolicy({ authOrigin: "https://auth.example.test", dev: false });
    expect(csp).toContain("form-action 'self' https://auth.example.test");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("adds unsafe-eval only in development (Next dev needs it)", () => {
    expect(contentSecurityPolicy({ authOrigin: null, dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ authOrigin: null, dev: false })).toMatch(/form-action 'self'$/);
  });
});
```

```ts
// src/platform/auth/session.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import { ctxFrom } from "./session";

describe("ctxFrom", () => {
  it("builds the request context from the user and their preferences", () => {
    const ctx = ctxFrom({ id: "u1", role: "admin" }, { ...DEFAULT_PREFERENCES, locale: "it" });
    expect(ctx).toEqual({
      userId: "u1",
      role: "admin",
      locale: "it",
      timeZone: "Europe/Rome",
      numberFormat: "it-IT",
    });
  });

  it("treats any role other than admin as user", () => {
    expect(ctxFrom({ id: "u1", role: null }, DEFAULT_PREFERENCES).role).toBe("user");
    expect(ctxFrom({ id: "u1", role: "superuser" }, DEFAULT_PREFERENCES).role).toBe("user");
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/platform/auth`
Expected: FAIL — unresolved imports `./roles`, `./csp`, `./session`.

- [ ] **Step 4: Write roles, CSP and the auth instance**

```ts
// src/platform/auth/roles.ts
import { decodeJwt } from "jose";
import type { Role } from "@/platform/context";

/**
 * Admin when the ID token's `groups` claim contains the configured admin group.
 * Returns null otherwise: an SSO login can promote, never demote (demotion is an admin action).
 * The token was already verified by Better Auth against the provider's JWKS.
 */
export function roleFromIdToken(idToken: string, adminGroup: string): Role | null {
  const { groups } = decodeJwt(idToken);
  return Array.isArray(groups) && groups.includes(adminGroup) ? "admin" : null;
}
```

```ts
// src/platform/auth/csp.ts
export function contentSecurityPolicy({ authOrigin, dev }: { authOrigin: string | null; dev: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    `form-action 'self'${authOrigin ? ` ${authOrigin}` : ""}`,
  ].join("; ");
}
```

(`frame-ancestors 'self'` lets the app embed its own document originals in the payslip review; third parties still cannot frame it. `form-action` is the last directive, so it carries no trailing `;`.)

```ts
// src/platform/auth/provider.ts — no `server-only`: the proxy and client components import it too.

/** Better Auth provider id of the Authentik login; also the last segment of its callback URL. */
export const OIDC_PROVIDER_ID = "authentik";

/** The identity provider's discovery URL, or null when unset or malformed (the build has no env). */
export function identityProviderUrl(): URL | null {
  try {
    return new URL(process.env.OIDC_DISCOVERY_URL ?? "");
  } catch {
    return null;
  }
}
```

```ts
// src/platform/auth/auth.ts
import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, genericOAuth } from "better-auth/plugins";
import { count, eq } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import * as tables from "@/platform/db/tables";
import { readEnv } from "@/platform/env";
import { OIDC_PROVIDER_ID } from "./provider";
import { roleFromIdToken } from "./roles";
import { users } from "./schema";

// OWASP argon2id parameters; @node-rs/argon2 uses argon2id by default.
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export async function applyOidcRole(account: { providerId: string; userId: string; idToken?: string | null }) {
  if (account.providerId !== OIDC_PROVIDER_ID || !account.idToken) return;
  const role = roleFromIdToken(account.idToken, readEnv().OIDC_ADMIN_GROUP);
  if (role) await getDb().update(users).set({ role }).where(eq(users.id, account.userId));
}

async function noUsersYet(): Promise<boolean> {
  const [row] = await getDb().select({ n: count() }).from(users);
  return (row?.n ?? 0) === 0;
}

export function createAuth({ withNextCookies }: { withNextCookies: boolean }) {
  const env = readEnv();
  return betterAuth({
    appName: "Finance Dashboard",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(getDb(), { provider: "pg", schema: tables }),
    user: {
      modelName: "users",
      // Sign-up is closed: users come from Authentik, from an accepted invitation or from the
      // server-side bootstrap (`auth.api.createUser`, method "admin"). Nothing else creates users.
      validateUserInfo: async ({ source }) => {
        if (source.action !== "create-user") return;
        if (source.method === "oauth" || source.method === "admin") return;
        return { error: "invitation_required", errorDescription: "An invitation is required to sign up." };
      },
    },
    session: { modelName: "sessions", expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    account: { modelName: "authAccounts" },
    verification: { modelName: "verifications" },
    advanced: {
      // Postgres generates every id (`DEFAULT uuidv7()`, spec §4.3); Better Auth inserts none.
      database: { generateId: false },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      autoSignIn: true,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: (password) => hash(password, ARGON2),
        verify: ({ hash: stored, password }) => verify(stored, password),
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60 * 15, max: 3 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ((await noUsersYet()) ? { data: { ...user, role: "admin" } } : undefined),
        },
      },
      account: {
        create: { after: applyOidcRole },
        update: { after: applyOidcRole },
      },
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      genericOAuth({
        config: [
          {
            providerId: OIDC_PROVIDER_ID,
            name: "Authentik",
            clientId: env.OIDC_CLIENT_ID,
            clientSecret: env.OIDC_CLIENT_SECRET,
            discoveryUrl: env.OIDC_DISCOVERY_URL,
            scopes: ["openid", "profile", "email"],
            pkce: true,
            requireIdTokenVerification: true,
            overrideUserInfo: true,
            mapProfileToUser: (profile) => ({
              name:
                (profile.name as string | undefined) ??
                (profile.preferred_username as string | undefined) ??
                (profile.email as string),
            }),
          },
        ],
      }),
      ...(withNextCookies ? [nextCookies()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const cache = globalThis as unknown as { financeAuth?: Auth };

/** The app-wide instance. `nextCookies()` lets Server Actions set the session cookie. */
export function getAuth(): Auth {
  cache.financeAuth ??= createAuth({ withNextCookies: true });
  return cache.financeAuth;
}
```

If startup throws `Drizzle schema mismatch — Missing tables …` or a `modelName` type error, the reported names are authoritative: rename the Drizzle **export keys** to what Better Auth asks for (keep the SQL table names `auth_accounts` and `rate_limits`), then re-run the test. If `rateLimit.modelName` is rejected by the type checker, remove it and rename the export `rateLimits` → the key Better Auth reports. With `generateId: false` Better Auth leaves the id to the database default; if an insert fails because Better Auth sends a null or empty `id`, stop and escalate to the controller — do not switch to `"uuid"` (that inserts app-generated UUIDv4 values).

```ts
// src/platform/auth/session.ts
import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getPreferences } from "@/modules/users/service";
import type { Preferences } from "@/modules/users/rules";
import type { Ctx } from "@/platform/context";
import { getAuth } from "./auth";

export function ctxFrom(user: { id: string; role?: string | null }, prefs: Preferences): Ctx {
  return {
    userId: user.id,
    role: user.role === "admin" ? "admin" : "user",
    locale: prefs.locale,
    timeZone: prefs.timeZone,
    numberFormat: prefs.numberFormat,
  };
}

/** The signed-in user's context, or null. Cached per request. */
export const getOptionalCtx = cache(async (): Promise<Ctx | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return ctxFrom(session.user, await getPreferences({ userId: session.user.id }));
});

/** Every page, Server Action and route handler behind sign-in starts with this. */
export async function requireSession(): Promise<Ctx> {
  const ctx = await getOptionalCtx();
  if (!ctx) redirect("/sign-in");
  return ctx;
}

/** Admin-only surfaces answer 404 to everyone else, so their existence is not disclosed. */
export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireSession();
  if (ctx.role !== "admin") notFound();
  return ctx;
}
```

```ts
// src/platform/auth/client.ts
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ plugins: [adminClient()] });
```

```ts
// src/app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/platform/auth/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
```

```ts
// src/proxy.ts
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "@/platform/auth/csp";
import { identityProviderUrl } from "@/platform/auth/provider";

const PUBLIC_PREFIXES = ["/sign-in", "/forgot-password", "/reset-password", "/invite"];

/**
 * Convenience only — never the security boundary: every page and action calls
 * requireSession(). Sends anonymous visitors to /sign-in and sets the CSP.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const response =
    isPublic || getSessionCookie(request)
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/sign-in", request.url));
  response.headers.set(
    "Content-Security-Policy",
    contentSecurityPolicy({
      authOrigin: identityProviderUrl()?.origin ?? null,
      dev: process.env.NODE_ENV !== "production",
    }),
  );
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
```

Known risk from the previous version: under `output: "standalone"` a Next 16 `proxy.ts` once failed at runtime with "The Proxy file must export a function". Task 21 runs the e2e suite against the standalone server; if that error appears there, rename the file to `src/middleware.ts`, rename the function to `middleware`, add `export const runtime = "nodejs"`, and record the reason in a one-line comment.

```ts
// scripts/create-admin.ts — bootstrap a password admin when Authentik is not available.
// Usage: npm run user:create-admin -- admin@example.com "Full Name"   (password read from ADMIN_PASSWORD)
import { createAuth } from "../src/platform/auth/auth";

const [email, name] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD ?? "";
if (!email || !name) throw new Error("Usage: create-admin <email> <name> (password in ADMIN_PASSWORD)");
if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

await createAuth({ withNextCookies: false }).api.createUser({
  body: { email, password, name, role: "admin" },
});
console.log(`[create-admin] ${email} created`);
process.exit(0);
```

Script in `package.json`:

```json
    "user:create-admin": "node --env-file-if-exists=.env --conditions=react-server --import tsx scripts/create-admin.ts"
```

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run src/platform/auth`
Expected: PASS (roles, csp, session).

- [ ] **Step 6: Write the failing integration test**

```ts
// src/platform/auth/auth.itest.ts
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { getDb } from "@/platform/db/client";
import { applyOidcRole, createAuth } from "./auth";
import { OIDC_PROVIDER_ID } from "./provider";
import { authAccounts, users } from "./schema";

const auth = () => createAuth({ withNextCookies: false });
const PASSWORD = "correct-horse-battery";
/** RFC 9562 UUIDv7: the version nibble is 7 and the variant bits are 10xx. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function idToken(groups: string[]) {
  return new SignJWT({ groups })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode("unused-signature-unused-signature"));
}

describe("Better Auth configuration", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("makes the first user admin and later users plain users", async () => {
    const first = await auth().api.createUser({ body: { email: "a@example.test", password: PASSWORD, name: "A" } });
    const second = await auth().api.createUser({ body: { email: "b@example.test", password: PASSWORD, name: "B" } });
    const roles = await getDb().select({ email: users.email, role: users.role }).from(users).orderBy(users.email);
    expect(roles).toEqual([
      { email: "a@example.test", role: "admin" },
      { email: "b@example.test", role: "user" },
    ]);
    expect(first.user.id).not.toBe(second.user.id);
  });

  it("lets Postgres generate UUIDv7 ids for users and their accounts", async () => {
    const { user } = await auth().api.createUser({ body: { email: "a@example.test", password: PASSWORD, name: "A" } });
    expect(user.id).toMatch(UUID_V7);
    const [account] = await getDb().select({ id: authAccounts.id }).from(authAccounts);
    expect(account.id).toMatch(UUID_V7);
  });

  it("stores the password as argon2id", async () => {
    await auth().api.createUser({ body: { email: "a@example.test", password: PASSWORD, name: "A" } });
    const [row] = await getDb().select({ password: authAccounts.password }).from(authAccounts);
    expect(row.password).toMatch(/^\$argon2id\$/);
  });

  it("keeps public sign-up closed", async () => {
    await expect(
      auth().api.signUpEmail({ body: { email: "x@example.test", password: PASSWORD, name: "X" } }),
    ).rejects.toThrow();
  });

  it("signs in with the right password only", async () => {
    await auth().api.createUser({ body: { email: "a@example.test", password: PASSWORD, name: "A" } });
    const ok = await auth().api.signInEmail({ body: { email: "a@example.test", password: PASSWORD } });
    expect(ok.token).toBeTruthy();
    await expect(
      auth().api.signInEmail({ body: { email: "a@example.test", password: "wrong-password-123" } }),
    ).rejects.toThrow();
  });

  it("promotes a member of the admin group on SSO sign-in and never demotes", async () => {
    await auth().api.createUser({ body: { email: "first@example.test", password: PASSWORD, name: "First" } });
    const { user } = await auth().api.createUser({
      body: { email: "sso@example.test", password: PASSWORD, name: "SSO" },
    });
    await applyOidcRole({ providerId: OIDC_PROVIDER_ID, userId: user.id, idToken: await idToken(["finance-users"]) });
    const roleOf = async () =>
      (await getDb().select({ role: users.role }).from(users).where(eq(users.id, user.id)))[0].role;
    expect(await roleOf()).toBe("user");
    await applyOidcRole({ providerId: OIDC_PROVIDER_ID, userId: user.id, idToken: await idToken(["finance-admins"]) });
    expect(await roleOf()).toBe("admin");
    await applyOidcRole({ providerId: OIDC_PROVIDER_ID, userId: user.id, idToken: await idToken([]) });
    expect(await roleOf()).toBe("admin");
  });
});
```

- [ ] **Step 7: Run it**

Run: `npm run test:integration -- src/platform/auth/auth.itest.ts`
Expected: PASS (6 tests). The OIDC login itself (browser redirect) is covered end to end in Task 21.

- [ ] **Step 8: Build to confirm the route and the proxy compile**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: the build lists `ƒ /api/auth/[...all]` and `ƒ Proxy (Middleware)`. `/sign-in` does not exist until Task 17; if `typecheck` rejects `redirect("/sign-in")` in `session.ts` under typed routes, write `redirect("/sign-in" as Route)` with `import type { Route } from "next";` (the same cast `navigation.ts` uses in Task 16) — never disable `typedRoutes`.

- [ ] **Step 9: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/auth src/platform/env.ts src/app/api/auth src/proxy.ts scripts/create-admin.ts \
  vitest.config.ts .env.example package.json
git commit -F - <<'EOF'
feat(auth): Better Auth with argon2 passwords, Authentik OIDC, admin role and closed sign-up

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 10: Mail, invitations and password reset

**Files:**
- Create: `src/platform/mail.ts`, `src/platform/auth/invitations.ts`, `src/platform/auth/emails.ts`, `test/mailpit.ts`
- Modify: `src/platform/env.ts`, `src/platform/auth/auth.ts` (`sendResetPassword`), `vitest.config.ts`, `.env.example`
- Test: `src/platform/auth/invitations.test.ts`, `src/platform/auth/invitations.itest.ts`, `src/platform/auth/password-reset.itest.ts`

**Interfaces:**
- Consumes: `getAuth`/`createAuth`, `Auth` (Task 9); `invitations`, `users` tables (Task 8); messages are added in Task 13, so emails here use English strings from `emails.ts` and Task 13 moves them to the catalogue.
- Produces:
  - `sendMail(mail: { to: string; subject: string; text: string }): Promise<void>`.
  - `INVITATION_TTL_DAYS = 7`; `hashToken(token: string): string`; `newToken(): string` (pure, in `invitations.ts`).
  - `createInvitation(input: { email: string; role: Role; invitedBy: string | null }, now?: Date): Promise<{ id: string; token: string }>` — replaces any pending invitation for the same email.
  - `findInvitation(token: string, now?: Date): Promise<{ id: string; email: string; role: Role } | null>`.
  - `acceptInvitation(auth: Auth, input: { token: string; name: string; password: string }, now?: Date): Promise<{ userId: string; email: string }>` — throws `InvitationError` (`"invalid" | "email_taken" | "weak_password"`).
  - `sendInvitationEmail(input: { email: string; token: string }): Promise<void>` — link `${BETTER_AUTH_URL}/invite/<token>`.
  - Test helpers `clearMailbox()`, `waitForMail(to: string): Promise<{ Subject: string; Text: string }>` (`test/mailpit.ts`; it imports nothing, so the Playwright suite of Task 21 reuses it).

- [ ] **Step 1: Extend the environment**

Add to `envSchema`:

```ts
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3),
```

Integration `env` additions: `SMTP_HOST: "127.0.0.1", SMTP_PORT: "51025", MAIL_FROM: "Finance Dashboard <finance@example.test>"`. `.env.example` additions: the same three lines.

- [ ] **Step 2: Write the failing pure test**

```ts
// src/platform/auth/invitations.test.ts
import { describe, expect, it } from "vitest";
import { hashToken, newToken } from "./invitations";

describe("invitation tokens", () => {
  it("are long, URL-safe and unique", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });

  it("are stored only as a SHA-256 hash", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
```

Run: `npx vitest run src/platform/auth/invitations.test.ts` — Expected: FAIL (unresolved `./invitations`).

- [ ] **Step 3: Write mail, invitations and emails**

```ts
// src/platform/mail.ts
import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { readEnv } from "./env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

let transport: Transporter | undefined;

function getTransport(): Transporter {
  const env = readEnv();
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } : undefined,
  });
  return transport;
}

/** Sends one plain-text email. Never call inside a database transaction. */
export async function sendMail(mail: Mail): Promise<void> {
  await getTransport().sendMail({ from: readEnv().MAIL_FROM, ...mail });
}
```

```ts
// src/platform/auth/emails.ts
export function invitationEmail(url: string) {
  return {
    subject: "You are invited to Finance Dashboard",
    text: `You have been invited to Finance Dashboard.\n\nAccept the invitation within 7 days:\n${url}\n`,
  };
}

export function passwordResetEmail(url: string) {
  return {
    subject: "Reset your Finance Dashboard password",
    text: `Someone asked to reset the password of this account.\n\nChoose a new password within 1 hour:\n${url}\n\nIf it was not you, ignore this email.\n`,
  };
}
```

```ts
// src/platform/auth/invitations.ts
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Role } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { readEnv } from "@/platform/env";
import { sendMail } from "@/platform/mail";
import type { Auth } from "./auth";
import { invitationEmail } from "./emails";
import { invitations, users } from "./schema";

export const INVITATION_TTL_DAYS = 7;

export class InvitationError extends Error {
  constructor(readonly reason: "invalid" | "email_taken" | "weak_password") {
    super(reason);
  }
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(
  input: { email: string; role: Role; invitedBy: string | null },
  now: Date = new Date(),
): Promise<{ id: string; token: string }> {
  const email = z.email().parse(input.email.trim().toLowerCase());
  const token = newToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const id = await getDb().transaction(async (tx) => {
    await tx.delete(invitations).where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)));
    const [row] = await tx
      .insert(invitations)
      .values({ email, role: input.role, tokenHash: hashToken(token), invitedBy: input.invitedBy, expiresAt })
      .returning({ id: invitations.id });
    return row.id;
  });
  return { id, token };
}

export async function findInvitation(token: string, now: Date = new Date()) {
  const [row] = await getDb()
    .select({ id: invitations.id, email: invitations.email, role: invitations.role })
    .from(invitations)
    .where(
      and(eq(invitations.tokenHash, hashToken(token)), isNull(invitations.acceptedAt), gt(invitations.expiresAt, now)),
    );
  return row ?? null;
}

export async function sendInvitationEmail({ email, token }: { email: string; token: string }): Promise<void> {
  await sendMail({ to: email, ...invitationEmail(`${readEnv().BETTER_AUTH_URL}/invite/${token}`) });
}

/**
 * Claims the invitation, then creates the account. The claim is released if account
 * creation fails, so the invitee can retry with the same link.
 */
export async function acceptInvitation(
  auth: Auth,
  input: { token: string; name: string; password: string },
  now: Date = new Date(),
): Promise<{ userId: string; email: string }> {
  if (input.password.length < 12) throw new InvitationError("weak_password");
  const db = getDb();
  const [claimed] = await db
    .update(invitations)
    .set({ acceptedAt: now })
    .where(
      and(
        eq(invitations.tokenHash, hashToken(input.token)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .returning({ id: invitations.id, email: invitations.email, role: invitations.role });
  if (!claimed) throw new InvitationError("invalid");

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, claimed.email));
  if (existing) {
    await db.update(invitations).set({ acceptedAt: null }).where(eq(invitations.id, claimed.id));
    throw new InvitationError("email_taken");
  }
  try {
    const { user } = await auth.api.createUser({
      body: { email: claimed.email, password: input.password, name: input.name.trim(), role: claimed.role },
    });
    return { userId: user.id, email: claimed.email };
  } catch (error) {
    await db.update(invitations).set({ acceptedAt: null }).where(eq(invitations.id, claimed.id));
    throw error;
  }
}
```

In `src/platform/auth/auth.ts`, add to `emailAndPassword`:

```ts
      resetPasswordTokenExpiresIn: 60 * 60,
      // Fire and forget: the response time must not reveal whether the address exists.
      sendResetPassword: async ({ user, url }) => {
        void sendMail({ to: user.email, ...passwordResetEmail(url) }).catch((error: unknown) => {
          console.error("[auth] password reset email failed", error);
        });
      },
```

with the imports `import { sendMail } from "@/platform/mail";` and `import { passwordResetEmail } from "./emails";`.

- [ ] **Step 4: Run the pure test**

Run: `npx vitest run src/platform/auth/invitations.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the Mailpit helper and the failing integration tests**

```ts
// test/mailpit.ts — reads the dev SMTP catcher (compose.dev.yml) through its REST API.
// Imports nothing, so Playwright's e2e code (Task 21) reuses it as well as Vitest.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:58025";

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
}

export async function waitForMail(to: string, timeoutMs = 5000): Promise<{ Subject: string; Text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
      return (await message.json()) as { Subject: string; Text: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms`);
}
```

```ts
// src/platform/auth/invitations.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, waitForMail } from "../../../test/mailpit";
import { createAuth } from "./auth";
import {
  acceptInvitation,
  createInvitation,
  findInvitation,
  InvitationError,
  sendInvitationEmail,
} from "./invitations";

const auth = () => createAuth({ withNextCookies: false });

describe("invitations", () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearMailbox();
  });
  afterAll(closeDatabase);

  it("emails a link that finds the invitation until it expires", async () => {
    const now = new Date("2026-09-13T10:00:00Z");
    const { token } = await createInvitation({ email: "Giulia@Example.test", role: "user", invitedBy: null }, now);
    await sendInvitationEmail({ email: "giulia@example.test", token });
    const mail = await waitForMail("giulia@example.test");
    expect(mail.Text).toContain(`/invite/${token}`);
    expect(await findInvitation(token, now)).toMatchObject({ email: "giulia@example.test", role: "user" });
    expect(await findInvitation(token, new Date("2026-09-21T10:00:00Z"))).toBeNull();
  });

  it("creates the account once and invalidates the link", async () => {
    await auth().api.createUser({ body: { email: "owner@example.test", password: "owner-password-1", name: "Owner" } });
    const { token } = await createInvitation({ email: "luca@example.test", role: "user", invitedBy: null });
    const accepted = await acceptInvitation(auth(), { token, name: "Luca", password: "luca-password-12" });
    expect(accepted.email).toBe("luca@example.test");
    expect(await findInvitation(token)).toBeNull();
    await expect(acceptInvitation(auth(), { token, name: "Luca", password: "luca-password-12" })).rejects.toThrow(
      InvitationError,
    );
    const signIn = await auth().api.signInEmail({
      body: { email: "luca@example.test", password: "luca-password-12" },
    });
    expect(signIn.token).toBeTruthy();
  });

  it("refuses weak passwords without consuming the invitation", async () => {
    const { token } = await createInvitation({ email: "x@example.test", role: "user", invitedBy: null });
    await expect(acceptInvitation(auth(), { token, name: "X", password: "short" })).rejects.toMatchObject({
      reason: "weak_password",
    });
    expect(await findInvitation(token)).not.toBeNull();
  });

  it("replaces a pending invitation for the same address", async () => {
    const first = await createInvitation({ email: "x@example.test", role: "user", invitedBy: null });
    const second = await createInvitation({ email: "x@example.test", role: "admin", invitedBy: null });
    expect(await findInvitation(first.token)).toBeNull();
    expect(await findInvitation(second.token)).toMatchObject({ role: "admin" });
  });
});
```

```ts
// src/platform/auth/password-reset.itest.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, waitForMail } from "../../../test/mailpit";
import { createAuth } from "./auth";

const auth = () => createAuth({ withNextCookies: false });

describe("password reset", () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearMailbox();
  });
  afterAll(closeDatabase);

  it("emails a reset link whose token sets a new password", async () => {
    await auth().api.createUser({ body: { email: "a@example.test", password: "old-password-123", name: "A" } });
    await auth().api.requestPasswordReset({ body: { email: "a@example.test", redirectTo: "/reset-password" } });
    const mail = await waitForMail("a@example.test");
    const token = /[?&]token=([^&\s]+)|\/reset-password\/([^?\s]+)/.exec(mail.Text);
    const value = token?.[1] ?? token?.[2];
    expect(value).toBeTruthy();
    await auth().api.resetPassword({ body: { newPassword: "new-password-123", token: value! } });
    const signIn = await auth().api.signInEmail({ body: { email: "a@example.test", password: "new-password-123" } });
    expect(signIn.token).toBeTruthy();
  });
});
```

(The reset URL emailed by Better Auth 1.7 is `${BETTER_AUTH_URL}/api/auth/reset-password/<token>?callbackURL=/reset-password`; the regex accepts both that and a `?token=` form. The browser flow is covered in Task 21.)

- [ ] **Step 6: Run the integration tests**

Run: `npm run test:integration`
Expected: PASS, including 4 invitation tests and 1 password-reset test.

- [ ] **Step 7: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/mail.ts src/platform/auth src/platform/env.ts test/mailpit.ts vitest.config.ts .env.example
git commit -F - <<'EOF'
feat(auth): SMTP mail, invitations with hashed one-time tokens, password reset emails

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 11: S3 document storage

**Files:**
- Create: `src/platform/storage.ts`, `src/platform/storage-keys.ts`
- Modify: `src/platform/env.ts`, `vitest.config.ts`, `.env.example`
- Test: `src/platform/storage-keys.test.ts`, `src/platform/storage.itest.ts`

**Interfaces:**
- Consumes: `readEnv` (Task 7).
- Produces:
  - `assertStorageKey(key: string): string` (pure) — allows `[a-z0-9/_.-]`, no leading `/`, no `//`, no `..`, at most 512 characters.
  - `ensureBucket(): Promise<void>`, `putObject(key: string, body: Uint8Array, contentType: string): Promise<void>`, `getObject(key: string): Promise<Uint8Array | null>`, `deleteObject(key: string): Promise<void>`.

- [ ] **Step 1: Extend the environment**

Add to `envSchema`:

```ts
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3),
```

Integration `env`: `S3_ENDPOINT: "http://127.0.0.1:59000", S3_ACCESS_KEY_ID: "finance", S3_SECRET_ACCESS_KEY: "finance-dev-secret", S3_BUCKET: "finance-test"`. `.env.example`: the same keys with `S3_BUCKET=finance-dev`.

- [ ] **Step 2: Write the failing key test**

```ts
// src/platform/storage-keys.test.ts
import { describe, expect, it } from "vitest";
import { assertStorageKey } from "./storage-keys";

describe("assertStorageKey", () => {
  it("accepts well-formed keys", () => {
    expect(assertStorageKey("payslips/0199a1b2/2026/5f2c.pdf")).toBe("payslips/0199a1b2/2026/5f2c.pdf");
  });

  it.each(["/leading", "a//b", "a/../b", "UPPER.pdf", "space here", "", "x".repeat(513)])("rejects %s", (key) => {
    expect(() => assertStorageKey(key)).toThrow(RangeError);
  });
});
```

Run: `npx vitest run src/platform/storage-keys.test.ts` — Expected: FAIL (unresolved import).

- [ ] **Step 3: Write the implementation**

```ts
// src/platform/storage-keys.ts
const KEY = /^[a-z0-9_.-]+(\/[a-z0-9_.-]+)*$/;

/** Object keys are generated by the app, never taken from user input; this is the last line of defence. */
export function assertStorageKey(key: string): string {
  if (key.length === 0 || key.length > 512 || !KEY.test(key) || key.split("/").some((part) => part === "..")) {
    throw new RangeError(`Invalid storage key: "${key}"`);
  }
  return key;
}
```

```ts
// src/platform/storage.ts
import "server-only";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { readEnv } from "./env";
import { assertStorageKey } from "./storage-keys";

let client: S3Client | undefined;

function s3(): S3Client {
  const env = readEnv();
  client ??= new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    // S3-compatible stores (Silo, MinIO) mishandle the SDK's default CRC32 checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

export async function ensureBucket(): Promise<void> {
  const Bucket = readEnv().S3_BUCKET;
  try {
    await s3().send(new HeadBucketCommand({ Bucket }));
  } catch {
    await s3().send(new CreateBucketCommand({ Bucket }));
  }
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({ Bucket: readEnv().S3_BUCKET, Key: assertStorageKey(key), Body: body, ContentType: contentType }),
  );
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  try {
    const result = await s3().send(new GetObjectCommand({ Bucket: readEnv().S3_BUCKET, Key: assertStorageKey(key) }));
    return result.Body ? await result.Body.transformToByteArray() : null;
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: readEnv().S3_BUCKET, Key: assertStorageKey(key) }));
}
```

- [ ] **Step 4: Write the integration test**

```ts
// src/platform/storage.itest.ts
import { beforeAll, describe, expect, it } from "vitest";
import { deleteObject, ensureBucket, getObject, putObject } from "./storage";

describe("S3 storage", () => {
  beforeAll(ensureBucket);

  it("stores, reads and deletes an object", async () => {
    const key = `tests/${Date.now()}.txt`;
    await putObject(key, new TextEncoder().encode("hello"), "text/plain");
    expect(new TextDecoder().decode((await getObject(key))!)).toBe("hello");
    await deleteObject(key);
    expect(await getObject(key)).toBeNull();
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/platform/storage-keys.test.ts && npm run test:integration -- src/platform/storage.itest.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/storage.ts src/platform/storage-keys.ts src/platform/storage-keys.test.ts \
  src/platform/storage.itest.ts src/platform/env.ts vitest.config.ts .env.example
git commit -F - <<'EOF'
feat(platform): S3 document storage with validated keys

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 12: Jobs, health and metrics

**Files:**
- Create: `src/platform/jobs/schema.ts`, `src/platform/jobs/registry.ts`, `src/platform/jobs/lock.ts`, `src/platform/jobs/heartbeat.ts`, `src/platform/jobs/tick.ts`, `src/platform/jobs/housekeeping.ts`, `src/platform/jobs/secret.ts`, `src/app/api/jobs/tick/route.ts`, `src/app/api/health/route.ts`, `src/app/api/metrics/route.ts`
- Modify: `src/platform/env.ts`, `src/platform/db/tables.ts`, `vitest.config.ts`, `.env.example`
- Generate: `drizzle/0001_*.sql`
- Test: `src/platform/jobs/secret.test.ts`, `src/platform/jobs/jobs.itest.ts`

**Interfaces:**
- Consumes: `getDb`, `getPool` (Task 7).
- Produces:
  - `type Tier = "hourly" | "daily" | "monthly"`; `interface JobDefinition { name: string; tier: Tier; run(): Promise<Record<string, unknown>> }`; `JOBS: readonly JobDefinition[]` — the single registry; later phases append their jobs here.
  - `withJobLock<T>(key: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }>`.
  - `runTier(tier: Tier, jobs?: readonly JobDefinition[]): Promise<Array<{ job: string; status: "success" | "failed" | "skipped" }>>`.
  - `touchHeartbeat(): Promise<void>`, `heartbeatAgeMs(): Promise<number | null>`, `HEARTBEAT_MAX_AGE_MS`.
  - `secretMatches(provided: string | null, expected: string): boolean` (constant time).
  - `jobRuns` table (uuidv7 `id`, `created_at`, `updated_at`).
  - `GET /api/health`; `POST /api/jobs/tick?tier=`; `GET /api/metrics` with `job_last_success_timestamp{job}` (seconds) and `job_runs_total{job,status}` (spec §10.4; `documents_awaiting_review` arrives in F5).

- [ ] **Step 1: Extend the environment**

Add to `envSchema`:

```ts
  CRON_SECRET: z.string().min(16),
  HEARTBEAT_FILE: z.string().min(1).default("/tmp/finance-heartbeat"),
```

Integration `env`: `CRON_SECRET: "integration-cron-secret", HEARTBEAT_FILE: "/tmp/finance-heartbeat-test"`. `.env.example`: `CRON_SECRET=dev-cron-secret-dev-cron-secret`.

- [ ] **Step 2: Write the failing secret test**

```ts
// src/platform/jobs/secret.test.ts
import { describe, expect, it } from "vitest";
import { secretMatches } from "./secret";

describe("secretMatches", () => {
  it("compares in constant time and rejects missing or different secrets", () => {
    expect(secretMatches("s3cret-s3cret-s3cret", "s3cret-s3cret-s3cret")).toBe(true);
    expect(secretMatches("s3cret-s3cret-s3creX", "s3cret-s3cret-s3cret")).toBe(false);
    expect(secretMatches("short", "s3cret-s3cret-s3cret")).toBe(false);
    expect(secretMatches(null, "s3cret-s3cret-s3cret")).toBe(false);
  });
});
```

Run: `npx vitest run src/platform/jobs/secret.test.ts` — Expected: FAIL.

- [ ] **Step 3: Write the jobs platform**

```ts
// src/platform/jobs/secret.ts
import { createHash, timingSafeEqual } from "node:crypto";

export function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
```

```ts
// src/platform/jobs/schema.ts
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    job: text("job").notNull(),
    tier: text("tier", { enum: ["hourly", "daily", "monthly"] }).notNull(),
    status: text("status", { enum: ["running", "success", "failed", "skipped"] }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("job_runs_job_started_idx").on(table.job, table.startedAt.desc())],
);
```

Add `export * from "@/platform/jobs/schema";` to `src/platform/db/tables.ts`, then run `npm run db:generate -- --name job_runs` and read the generated SQL: `drizzle/0001_job_runs.sql` creates `"job_runs"` with `"id" uuid PRIMARY KEY DEFAULT uuidv7()`, `created_at` and `updated_at` (spec §6).

```ts
// src/platform/jobs/lock.ts
import "server-only";
import { getPool } from "@/platform/db/client";

/**
 * Session-level advisory lock on one dedicated connection, with no transaction open, so a
 * job's network calls never run inside a transaction. A second caller gets `{ ran: false }`.
 */
export async function withJobLock<T>(key: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [key]);
    if (!rows[0]?.locked) return { ran: false };
    try {
      return { ran: true, value: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]);
    }
  } finally {
    client.release();
  }
}
```

```ts
// src/platform/jobs/heartbeat.ts
import "server-only";
import { stat, writeFile } from "node:fs/promises";
import { readEnv } from "@/platform/env";

/** Every tick is hourly at most, so two hours without one means the scheduler is gone. */
export const HEARTBEAT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export async function touchHeartbeat(): Promise<void> {
  await writeFile(readEnv().HEARTBEAT_FILE, new Date().toISOString());
}

export async function heartbeatAgeMs(): Promise<number | null> {
  try {
    return Date.now() - (await stat(readEnv().HEARTBEAT_FILE)).mtimeMs;
  } catch {
    return null;
  }
}
```

```ts
// src/platform/jobs/housekeeping.ts
import "server-only";
import { and, isNotNull, lt, or } from "drizzle-orm";
import { invitations } from "@/platform/auth/schema";
import { getDb } from "@/platform/db/client";
import type { JobDefinition } from "./registry";
import { jobRuns } from "./schema";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export const housekeepingJob: JobDefinition = {
  name: "housekeeping",
  tier: "daily",
  async run() {
    const cutoff = new Date(Date.now() - RETENTION_MS);
    const runs = await getDb()
      .delete(jobRuns)
      .where(and(isNotNull(jobRuns.finishedAt), lt(jobRuns.finishedAt, cutoff)))
      .returning({ id: jobRuns.id });
    const invites = await getDb()
      .delete(invitations)
      .where(or(lt(invitations.expiresAt, cutoff), lt(invitations.acceptedAt, cutoff)))
      .returning({ id: invitations.id });
    return { jobRunsDeleted: runs.length, invitationsDeleted: invites.length };
  },
};
```

```ts
// src/platform/jobs/registry.ts
import { housekeepingJob } from "./housekeeping";

export type Tier = "hourly" | "daily" | "monthly";

export interface JobDefinition {
  name: string;
  tier: Tier;
  run(): Promise<Record<string, unknown>>;
}

/** The one list of scheduled jobs. Each phase appends its jobs here. */
export const JOBS: readonly JobDefinition[] = [housekeepingJob];
```

Note the import cycle `registry.ts ↔ housekeeping.ts` is type-only on the housekeeping side (`import type`), so it is safe.

F0 has only the server-level housekeeping job, so the registry stays a plain list with `run()`; spec §10.1's per-user iteration with `run(ctx)`, per-user error isolation and redacted errors in `job_runs` arrive with the first per-user job (F3).

```ts
// src/platform/jobs/tick.ts
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import { touchHeartbeat } from "./heartbeat";
import { withJobLock } from "./lock";
import { JOBS, type JobDefinition, type Tier } from "./registry";
import { jobRuns } from "./schema";

type Outcome = { job: string; status: "success" | "failed" | "skipped" };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
}

/** Runs every job of a tier, one after the other; one failure never stops the others. */
export async function runTier(tier: Tier, jobs: readonly JobDefinition[] = JOBS): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const job of jobs.filter((j) => j.tier === tier)) {
    const locked = await withJobLock(`job:${job.name}`, async () => {
      const [run] = await getDb().insert(jobRuns).values({ job: job.name, tier, status: "running" }).returning();
      try {
        const detail = await job.run();
        await getDb()
          .update(jobRuns)
          .set({ status: "success", finishedAt: new Date(), detail })
          .where(eq(jobRuns.id, run.id));
        return "success" as const;
      } catch (error) {
        await getDb()
          .update(jobRuns)
          .set({ status: "failed", finishedAt: new Date(), error: describeError(error) })
          .where(eq(jobRuns.id, run.id));
        return "failed" as const;
      }
    });
    if (!locked.ran) {
      await getDb()
        .insert(jobRuns)
        .values({ job: job.name, tier, status: "skipped", finishedAt: new Date(), detail: { reason: "already_running" } });
    }
    outcomes.push({ job: job.name, status: locked.ran ? locked.value : "skipped" });
  }
  await touchHeartbeat();
  return outcomes;
}
```

- [ ] **Step 4: Write the route handlers**

```ts
// src/app/api/jobs/tick/route.ts
import { z } from "zod";
import { readEnv } from "@/platform/env";
import { secretMatches } from "@/platform/jobs/secret";
import { runTier } from "@/platform/jobs/tick";

export const dynamic = "force-dynamic";

const tierSchema = z.enum(["hourly", "daily", "monthly"]);

/** Called by the cron sidecar. Any failed check is a bare 404, so the endpoint reveals nothing. */
export async function POST(request: Request) {
  const tier = tierSchema.safeParse(new URL(request.url).searchParams.get("tier"));
  if (!tier.success || !secretMatches(request.headers.get("x-cron-secret"), readEnv().CRON_SECRET)) {
    return new Response(null, { status: 404 });
  }
  return Response.json({ tier: tier.data, outcomes: await runTier(tier.data) });
}
```

```ts
// src/app/api/health/route.ts
import { sql } from "drizzle-orm";
import { getDb } from "@/platform/db/client";
import { HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs } from "@/platform/jobs/heartbeat";

export const dynamic = "force-dynamic";

/**
 * Compose healthcheck target; public, so it exposes liveness only. The heartbeat counts only
 * after the process has been up longer than its window, otherwise a fresh container would be
 * unhealthy before its first tick and autoheal would restart it in a loop.
 */
export async function GET() {
  let dbUp = true;
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch {
    dbUp = false;
  }
  const age = await heartbeatAgeMs();
  const heartbeatStale = age === null || age > HEARTBEAT_MAX_AGE_MS;
  const healthy = dbUp && !(process.uptime() * 1000 > HEARTBEAT_MAX_AGE_MS && heartbeatStale);
  return Response.json(
    { status: healthy ? "ok" : "degraded", db: dbUp ? "up" : "down", heartbeat: age === null ? "absent" : heartbeatStale ? "stale" : "fresh" },
    { status: healthy ? 200 : 503 },
  );
}
```

```ts
// src/app/api/metrics/route.ts
import { sql } from "drizzle-orm";
import { getDb } from "@/platform/db/client";

export const dynamic = "force-dynamic";

/** Prometheus text format for the homelab's Prometheus/Grafana (spec §10.4). */
export async function GET() {
  // `pg` returns bigint columns as strings; the value is printed as is.
  const lastSuccess = await getDb().execute<{ job: string; ts: string }>(
    sql`SELECT job, extract(epoch FROM max(finished_at))::bigint AS ts FROM job_runs WHERE status = 'success' GROUP BY job ORDER BY job`,
  );
  const totals = await getDb().execute<{ job: string; status: string; n: number }>(
    sql`SELECT job, status, count(*)::int AS n FROM job_runs GROUP BY job, status ORDER BY job, status`,
  );
  const lines = [
    "# TYPE job_last_success_timestamp gauge",
    ...lastSuccess.rows.map((r) => `job_last_success_timestamp{job="${r.job}"} ${r.ts}`),
    "# TYPE job_runs_total counter",
    ...totals.rows.map((r) => `job_runs_total{job="${r.job}",status="${r.status}"} ${r.n}`),
  ];
  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/plain; version=0.0.4" } });
}
```

The metric names are the spec's (§10.4): `job_last_success_timestamp` (Unix seconds) and `job_runs_total`. The third metric, `documents_awaiting_review`, is added in F5, when the documents table exists.

- [ ] **Step 5: Write the integration test**

```ts
// src/platform/jobs/jobs.itest.ts
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { POST } from "@/app/api/jobs/tick/route";
import { getDb } from "@/platform/db/client";
import { heartbeatAgeMs } from "./heartbeat";
import { withJobLock } from "./lock";
import type { JobDefinition } from "./registry";
import { jobRuns } from "./schema";
import { runTier } from "./tick";

const job = (name: string, run: JobDefinition["run"]): JobDefinition => ({ name, tier: "hourly", run });

describe("jobs", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("records success and failure independently and touches the heartbeat", async () => {
    const outcomes = await runTier("hourly", [
      job("ok", async () => ({ processed: 3 })),
      job("broken", async () => {
        throw new Error("provider down");
      }),
    ]);
    expect(outcomes).toEqual([
      { job: "ok", status: "success" },
      { job: "broken", status: "failed" },
    ]);
    const runs = await getDb().select().from(jobRuns).orderBy(jobRuns.job);
    expect(runs.map((r) => [r.job, r.status, r.error])).toEqual([
      ["broken", "failed", "provider down"],
      ["ok", "success", null],
    ]);
    expect(await heartbeatAgeMs()).toBeLessThan(5000);
  });

  it("skips a job that is already running elsewhere", async () => {
    let release: () => void = () => {};
    const held = withJobLock("job:slow", () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const outcomes = await runTier("hourly", [job("slow", async () => ({}))]);
    release();
    await held;
    expect(outcomes).toEqual([{ job: "slow", status: "skipped" }]);
    const [run] = await getDb().select().from(jobRuns).where(eq(jobRuns.job, "slow")).orderBy(desc(jobRuns.startedAt));
    expect(run.status).toBe("skipped");
  });

  it("answers 404 to a wrong secret or tier and runs a tier with the right one", async () => {
    const call = (tier: string, secret: string) =>
      POST(new Request(`http://localhost/api/jobs/tick?tier=${tier}`, { method: "POST", headers: { "x-cron-secret": secret } }));
    expect((await call("daily", "wrong-secret-wrong")).status).toBe(404);
    expect((await call("weekly", "integration-cron-secret")).status).toBe(404);
    const ok = await call("daily", "integration-cron-secret");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ tier: "daily", outcomes: [{ job: "housekeeping", status: "success" }] });
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/platform/jobs/secret.test.ts && npm run test:integration`
Expected: PASS.

- [ ] **Step 7: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/platform/jobs src/app/api/jobs src/app/api/health src/app/api/metrics src/platform/env.ts \
  src/platform/db/tables.ts drizzle vitest.config.ts .env.example
git commit -F - <<'EOF'
feat(jobs): tiered job runner with advisory locks, run log, housekeeping, health and metrics

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 13: Design tokens, theme, font and i18n

**Files:**
- Create: `src/platform/theme.ts`, `src/platform/i18n/locales.ts`, `src/platform/i18n/request.ts`, `src/global.d.ts`, `messages/en.json`, `messages/it.json`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `next.config.ts`, `src/platform/auth/emails.ts`
- Test: `src/platform/theme.test.ts`, `src/platform/i18n/messages.test.ts`, `src/platform/auth/emails.test.ts`

**Interfaces:**
- Consumes: `UiLocale` (Task 5); `invitationEmail`, `passwordResetEmail` call sites (Task 10).
- Produces:
  - Tailwind utilities for every design token: colours `bg`, `card`, `side`, `border`, `border2`, `fg`, `muted`, `faint`, `accent`, `primary`, `primary-fg`, `soft`, `pos`, `neg`, `warn`, `pos-bg`, `neg-bg`, `warn-bg`, `hover`, `sel`, `track`, `skel` (e.g. `bg-card`, `text-muted`, `border-border2`); `shadow-overlay`; radii `rounded-ctl` (6px), `rounded-card` (10px), `rounded-modal` (12px); font sizes `text-micro` 10, `text-xs` 11, `text-sm` 12, `text-base` 13, `text-md` 14, `text-lg` 15, `text-xl` 17, `text-2xl` 20, `text-kpi` 22, `text-title` 24, `text-hero-sm` 28, `text-hero` 32, `text-display` 36; animations `animate-in`, `animate-shimmer`.
  - `THEME_COOKIE`, `type ThemePreference`, `parseTheme(value)` (unknown or missing → `"light"`, spec §8.1), `initialThemeAttribute(value): "light" | "dark"`, `THEME_SCRIPT`.
  - Inter through `next/font/local` (spec §8.1), exposed as the CSS variable `--font-inter` behind Tailwind's `font-sans`.
  - Message key `common.product` ("Finance Dashboard"), used for the page title, the sidebar brand (Task 16) and the auth card (Task 17).
  - `LOCALES`, `DEFAULT_LOCALE`, `LOCALE_COOKIE`.
  - Message catalogues `messages/{en,it}.json`; typed keys via `src/global.d.ts`.
  - `invitationEmail(url, locale?)`, `passwordResetEmail(url, locale?)` now read from the catalogues.

- [ ] **Step 1: Write the failing tests**

```ts
// src/platform/theme.test.ts
import { describe, expect, it } from "vitest";
import { initialThemeAttribute, parseTheme, THEME_COOKIE, THEME_SCRIPT } from "./theme";

describe("theme", () => {
  it("parses the cookie, defaulting to light (spec §8.1)", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    expect(parseTheme("neon")).toBe("light");
    expect(parseTheme(undefined)).toBe("light");
  });

  it("renders light for system; the inline script resolves it before paint", () => {
    expect(initialThemeAttribute("dark")).toBe("dark");
    expect(initialThemeAttribute("system")).toBe("light");
    expect(initialThemeAttribute(undefined)).toBe("light");
    expect(THEME_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(THEME_SCRIPT).toContain(`${THEME_COOKIE}=`);
  });
});
```

```ts
// src/platform/i18n/messages.test.ts
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import it_ from "../../../messages/it.json";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe("message catalogues", () => {
  const english = flatten(en as Tree);
  const italian = flatten(it_ as Tree);

  it("have exactly the same keys", () => {
    expect([...italian.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it("use the same placeholders in both languages", () => {
    for (const [key, text] of english) expect(placeholders(italian.get(key) ?? ""), key).toEqual(placeholders(text));
  });

  it("never leave a translation empty", () => {
    for (const [key, text] of italian) expect(text.trim(), key).not.toBe("");
  });
});
```

```ts
// src/platform/auth/emails.test.ts
import { describe, expect, it } from "vitest";
import { invitationEmail, passwordResetEmail } from "./emails";

describe("emails", () => {
  it("include the link and follow the locale", () => {
    const en = invitationEmail("https://x.test/invite/abc");
    const it_ = invitationEmail("https://x.test/invite/abc", "it");
    expect(en.text).toContain("https://x.test/invite/abc");
    expect(it_.text).toContain("https://x.test/invite/abc");
    expect(en.subject).not.toBe(it_.subject);
    expect(passwordResetEmail("https://x.test/r", "it").text).toContain("https://x.test/r");
  });
});
```

Run: `npx vitest run src/platform/theme.test.ts src/platform/i18n src/platform/auth/emails.test.ts`
Expected: FAIL (missing modules and catalogues).

- [ ] **Step 2: Write theme and locale modules**

```ts
// src/platform/theme.ts
export const THEME_COOKIE = "theme";
export type ThemePreference = "system" | "light" | "dark";

/** Light is the default theme (spec §8.1); System and Dark are explicit choices. */
export function parseTheme(value: string | undefined): ThemePreference {
  return value === "system" || value === "dark" ? value : "light";
}

/** Server-rendered attribute. "system" renders light and THEME_SCRIPT corrects it before first paint. */
export function initialThemeAttribute(value: string | undefined): "light" | "dark" {
  return parseTheme(value) === "dark" ? "dark" : "light";
}

export const THEME_SCRIPT = `(()=>{try{const m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)/);const p=m?m[1]:"light";document.documentElement.dataset.theme=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p}catch{}})()`;
```

```ts
// src/platform/i18n/locales.ts
export const LOCALES = ["en", "it"] as const;
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";
```

```ts
// src/platform/i18n/request.ts
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES } from "./locales";

/** The UI language comes from the locale cookie, which saving preferences keeps in sync. */
export default getRequestConfig(async () => {
  const requested = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = hasLocale(LOCALES, requested) ? requested : DEFAULT_LOCALE;
  return {
    locale,
    timeZone: "Europe/Rome",
    messages: (await import(`../../../messages/${locale}.json`)).default,
  };
});
```

```ts
// src/global.d.ts
import type en from "../messages/en.json";
import type { LOCALES } from "@/platform/i18n/locales";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof en;
  }
}
```

In `next.config.ts` wrap the export:

```ts
import createNextIntlPlugin from "next-intl/plugin";
// …nextConfig unchanged…
export default createNextIntlPlugin("./src/platform/i18n/request.ts")(nextConfig);
```

- [ ] **Step 3: Write the catalogues**

```json
{
  "common": {
    "product": "Finance Dashboard",
    "save": "Save",
    "close": "Close",
    "retry": "Try again",
    "or": "or"
  },
  "emails": {
    "invitation": {
      "subject": "You are invited to Finance Dashboard",
      "body": "You have been invited to Finance Dashboard.\n\nAccept the invitation within 7 days:\n{url}\n"
    },
    "passwordReset": {
      "subject": "Reset your Finance Dashboard password",
      "body": "Someone asked to reset the password of this account.\n\nChoose a new password within 1 hour:\n{url}\n\nIf it was not you, ignore this email.\n"
    }
  }
}
```

(That is `messages/en.json`. `messages/it.json`:)

```json
{
  "common": {
    "product": "Finance Dashboard",
    "save": "Salva",
    "close": "Chiudi",
    "retry": "Riprova",
    "or": "oppure"
  },
  "emails": {
    "invitation": {
      "subject": "Sei stato invitato su Finance Dashboard",
      "body": "Hai ricevuto un invito a Finance Dashboard.\n\nAccetta l'invito entro 7 giorni:\n{url}\n"
    },
    "passwordReset": {
      "subject": "Reimposta la password di Finance Dashboard",
      "body": "È stato chiesto di reimpostare la password di questo account.\n\nScegli una nuova password entro 1 ora:\n{url}\n\nSe non sei stato tu, ignora questa email.\n"
    }
  }
}
```

Every later task that adds UI copy adds the same keys to both files; the parity test keeps them aligned. Each key has a user: `product` (page title here, sidebar in Task 16, auth card in Task 17), `close` (toasts, Task 16), `or` (sign-in, Task 17), `save` (settings, Task 18), `retry` (the error state on the Components page, Task 19). A task never adds a key nothing renders.

Rewrite `src/platform/auth/emails.ts`:

```ts
// src/platform/auth/emails.ts
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import it from "../../../messages/it.json";
import type { UiLocale } from "@/platform/format";

const CATALOGUES = { en, it } as const;

function translator(locale: UiLocale, namespace: "emails.invitation" | "emails.passwordReset") {
  return createTranslator({ locale, messages: CATALOGUES[locale], namespace });
}

export function invitationEmail(url: string, locale: UiLocale = "en") {
  const t = translator(locale, "emails.invitation");
  return { subject: t("subject"), text: t("body", { url }) };
}

export function passwordResetEmail(url: string, locale: UiLocale = "en") {
  const t = translator(locale, "emails.passwordReset");
  return { subject: t("subject"), text: t("body", { url }) };
}
```

- [ ] **Step 4: Write the tokens**

```css
/* src/app/globals.css */
@import "tailwindcss";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* Design canvas tokens, verbatim (spec §8.1). */
:root,
[data-theme="light"] {
  --bg: #f7f7f8;
  --card: #ffffff;
  --side: #fbfbfc;
  --border: #e6e7ea;
  --border2: #d3d6db;
  --fg: #15181d;
  --muted: #5f6670;
  --faint: #9aa0a8;
  --accent: #0e7490;
  --primary: #0e7490;
  --primary-fg: #ffffff;
  --soft: #e3f3f7;
  --pos: #047857;
  --neg: #b91c1c;
  --warn: #b45309;
  --pos-bg: #ecfdf5;
  --neg-bg: #fef2f2;
  --warn-bg: #fffbeb;
  --hover: #f2f3f5;
  --sel: #eaf7fa;
  --track: #eceef1;
  --skel: #eef0f2;
  --shadow: 0 8px 24px rgba(16, 20, 28, 0.1), 0 1px 2px rgba(16, 20, 28, 0.06);
  color-scheme: light;
}

[data-theme="dark"] {
  --bg: #0e1012;
  --card: #16181b;
  --side: #111315;
  --border: #25282d;
  --border2: #353941;
  --fg: #e8e9ec;
  --muted: #9da3ab;
  --faint: #6c727b;
  --accent: #5fcbe0;
  --primary: #0e7490;
  --primary-fg: #ffffff;
  --soft: #0f2a31;
  --pos: #4ade80;
  --neg: #f87171;
  --warn: #fbbf24;
  --pos-bg: #0f2a1c;
  --neg-bg: #2c1515;
  --warn-bg: #2a2210;
  --hover: #1c1f24;
  --sel: #0f2a31;
  --track: #25282d;
  --skel: #1f2226;
  --shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4);
  color-scheme: dark;
}

@theme inline {
  --color-bg: var(--bg);
  --color-card: var(--card);
  --color-side: var(--side);
  --color-border: var(--border);
  --color-border2: var(--border2);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-faint: var(--faint);
  --color-accent: var(--accent);
  --color-primary: var(--primary);
  --color-primary-fg: var(--primary-fg);
  --color-soft: var(--soft);
  --color-pos: var(--pos);
  --color-neg: var(--neg);
  --color-warn: var(--warn);
  --color-pos-bg: var(--pos-bg);
  --color-neg-bg: var(--neg-bg);
  --color-warn-bg: var(--warn-bg);
  --color-hover: var(--hover);
  --color-sel: var(--sel);
  --color-track: var(--track);
  --color-skel: var(--skel);
  --shadow-overlay: var(--shadow);
}

@theme {
  --font-sans: var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --text-micro: 10px;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 14px;
  --text-lg: 15px;
  --text-xl: 17px;
  --text-2xl: 20px;
  --text-kpi: 22px;
  --text-title: 24px;
  --text-hero-sm: 28px;
  --text-hero: 32px;
  --text-display: 36px;

  --radius-ctl: 6px;
  --radius-card: 10px;
  --radius-modal: 12px;

  --animate-in: fd-in 0.2s ease;
  --animate-shimmer: fd-shimmer 1.4s infinite;

  @keyframes fd-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes fd-shimmer {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }
}

html,
body {
  height: 100%;
}

body {
  position: relative;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.45;
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}

/* Base UI: portaled popups always stack above page content. */
.root {
  isolation: isolate;
  min-height: 100%;
}
```

- [ ] **Step 5: Update the root layout**

```tsx
// src/app/layout.tsx
import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { initialThemeAttribute, THEME_COOKIE, THEME_SCRIPT } from "@/platform/theme";
import "./globals.css";

// Inter, self-hosted (spec §8.1): the variable-weight latin and latin-ext files shipped by
// @fontsource-variable/inter, by path relative to this file.
const inter = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-inter",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("product") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const theme = (await cookies()).get(THEME_COOKIE)?.value;
  return (
    <html
      lang={locale}
      data-theme={initialThemeAttribute(theme)}
      className={inter.variable}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider>
          <div className="root">{children}</div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

`@fontsource-variable/inter@5.3.0` ships its files as `files/inter-<subset>-<axis>-<style>.woff2`; the two used here are `inter-latin-wght-normal.woff2` and `inter-latin-ext-wght-normal.woff2` (variable `wght` axis, upright). Do not import the package's CSS. If the build rejects a `node_modules` path in `next/font/local`, copy those two woff2 files into `src/app/fonts/`, point `path` at `./fonts/<name>.woff2`, and remove `@fontsource-variable/inter` from `package.json` (with `npm uninstall`).

- [ ] **Step 6: Run tests and build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS; the build succeeds with the next-intl plugin, and `.next/static/media/` contains the two Inter woff2 files.

- [ ] **Step 7: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/app/globals.css src/app/layout.tsx src/platform/theme.ts src/platform/theme.test.ts \
  src/platform/i18n src/global.d.ts messages next.config.ts src/platform/auth/emails.ts src/platform/auth/emails.test.ts
git commit -F - <<'EOF'
feat(ui): design tokens, theme without flash, Inter, English and Italian catalogues

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

If the vendored-font fallback of Step 5 was applied, add `src/app/fonts package.json package-lock.json` to the `git add` line.

---

### Task 14: UI primitives

**Files:**
- Create: `src/ui/cn.ts`, `src/ui/button.tsx`, `src/ui/input.tsx`, `src/ui/field.tsx`, `src/ui/badge.tsx`, `src/ui/card.tsx`, `src/ui/kpi-tile.tsx`, `src/ui/progress-bar.tsx`, `src/ui/avatar.tsx`, `src/ui/skeleton.tsx`, `src/ui/kbd.tsx`, `src/ui/tone.ts`
- Test: `src/ui/primitives.test.tsx`

**Interfaces:**
- Consumes: the Tailwind tokens (Task 13).
- Produces (all presentational; strings are passed in, never translated inside `src/ui`):
  - `cn(...inputs: ClassValue[]): string`
  - `type Tone = "fg" | "muted" | "faint" | "accent" | "pos" | "neg" | "warn"`, `TONE_TEXT: Record<Tone, string>`, `toneOfSign(value: bigint | number | null): Tone`
  - `Button` (`variant?: "primary" | "secondary" | "ghost" | "danger"`, `size?: "xs" | "sm" | "md" | "lg"`, `icon?: ReactNode`, all `<button>` props; `type` defaults to `"button"`), `IconButton` (`label: string`, `size?: 28 | 32`, `bordered?: boolean`), `LinkButton`
  - `Input` (`invalid?`, `warning?`, `numeric?`), `InputGroup` (`prefix?`, `suffix?`), `Select` (native), `Checkbox` (`label: string`)
  - `Field` (`label`, `htmlFor`, `hint?`, `error?`, `children`)
  - `Badge` (`tone: "pos" | "warn" | "neg" | "accent" | "neutral"`), `Tag`
  - `Card` (`padded?`), `CardHeader` (`title`, `actions?`)
  - `KpiTile` (`label`, `value`, `valueTone?`, `delta?`, `deltaTone?`, `note?`)
  - `ProgressBar` (`value: number` 0..1, `tone?`, `height?: 4 | 6 | 8`, `label: string`), `Avatar` (`name`, `size?: 22 | 24 | 28 | 40`), `initials(name)`, `Skeleton`, `Kbd`
  - Every export here, in every variant, is rendered on the Components page (Task 19, spec §8.3).

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/primitives.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Avatar, initials } from "./avatar";
import { Badge } from "./badge";
import { Button, IconButton } from "./button";
import { cn } from "./cn";
import { Field } from "./field";
import { Input } from "./input";
import { KpiTile } from "./kpi-tile";
import { ProgressBar } from "./progress-bar";
import { toneOfSign } from "./tone";

describe("cn", () => {
  it("keeps a font size and a colour together, and resolves conflicts", () => {
    expect(cn("text-fg", "text-kpi")).toBe("text-fg text-kpi");
    expect(cn("text-muted", "text-pos")).toBe("text-pos");
    expect(cn("rounded-ctl", "rounded-card")).toBe("rounded-card");
  });
});

describe("Button", () => {
  it("is a non-submitting button by default and fires clicks", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("gives icon buttons an accessible name and a tooltip", () => {
    render(<IconButton label="Toggle sidebar">x</IconButton>);
    const button = screen.getByRole("button", { name: "Toggle sidebar" });
    expect(button).toHaveAttribute("title", "Toggle sidebar");
  });
});

describe("form controls", () => {
  it("links a field label to its input and marks errors", () => {
    render(
      <Field label="Email" htmlFor="email" error="Required">
        <Input id="email" invalid />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Required")).toBeInTheDocument();
  });
});

describe("display", () => {
  it("renders badges, KPI tiles and progress", () => {
    render(
      <>
        <Badge tone="pos">On track</Badge>
        <KpiTile label="Cash" value="7.135,95 €" delta="+120,00 €" deltaTone="pos" note="2 accounts" />
        <ProgressBar value={1.4} label="Budget" />
      </>,
    );
    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText("7.135,95 €")).toBeInTheDocument();
    expect(screen.getByText("+120,00 €")).toHaveClass("text-pos");
    expect(screen.getByRole("progressbar", { name: "Budget" })).toHaveAttribute("aria-valuenow", "100");
  });

  it("derives initials and sign tones", () => {
    expect(initials("Mattia Longobardo")).toBe("ML");
    expect(initials("  giulia ")).toBe("G");
    expect(toneOfSign(-3n)).toBe("neg");
    expect(toneOfSign(0)).toBe("muted");
    expect(toneOfSign(null)).toBe("muted");
    render(<Avatar name="Mattia Longobardo" />);
    expect(screen.getByText("ML")).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/ui/primitives.test.tsx` — Expected: FAIL (unresolved imports).

- [ ] **Step 2: Write the implementation**

```ts
// src/ui/cn.ts
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know the custom font sizes and radii, otherwise it treats
// `text-kpi` as a colour and silently drops `text-fg` (or the other way round).
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "md", "kpi", "title", "hero-sm", "hero", "display"],
      radius: ["ctl", "card", "modal"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
```

```ts
// src/ui/tone.ts
export type Tone = "fg" | "muted" | "faint" | "accent" | "pos" | "neg" | "warn";

export const TONE_TEXT: Record<Tone, string> = {
  fg: "text-fg",
  muted: "text-muted",
  faint: "text-faint",
  accent: "text-accent",
  pos: "text-pos",
  neg: "text-neg",
  warn: "text-warn",
};

/** Colour for a signed figure: gains green, losses red, zero and unknown muted. */
export function toneOfSign(value: bigint | number | null): Tone {
  if (value === null || value === 0 || value === 0n) return "muted";
  return value > 0 ? "pos" : "neg";
}
```

```tsx
// src/ui/button.tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

const VARIANT = {
  primary: "border-primary bg-primary text-primary-fg hover:brightness-[1.08]",
  secondary: "border-border bg-card text-fg hover:bg-hover",
  ghost: "border-transparent bg-transparent text-muted hover:bg-hover hover:text-fg",
  danger: "border-border bg-card text-neg hover:bg-neg-bg",
} as const;

const SIZE = {
  xs: "h-6 px-2 text-sm rounded-[5px]",
  sm: "h-7 px-2.5 text-sm",
  md: "h-8 px-3 text-base",
  lg: "h-9 px-3.5 text-base rounded-[7px]",
} as const;

const BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border font-medium " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-hover disabled:text-faint disabled:hover:brightness-100";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  icon?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", icon, className, type = "button", children, ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(BASE, VARIANT[variant], SIZE[size], className)} {...props}>
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
  size?: 28 | 32;
  bordered?: boolean;
}

export function IconButton({ label, size = 28, bordered = false, className, type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-ctl text-muted hover:bg-hover hover:text-fg",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        size === 28 ? "size-7" : "size-8",
        bordered ? "border border-border bg-card" : "border border-transparent",
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({ className, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={cn("text-sm font-medium text-accent hover:underline", className)} {...props} />
  );
}
```

```tsx
// src/ui/input.tsx
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const CONTROL =
  "h-8 w-full rounded-ctl border border-border bg-card px-2.5 text-base text-fg placeholder:text-faint " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-soft disabled:bg-hover disabled:text-faint";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  warning?: boolean;
  numeric?: boolean;
}

export function Input({ invalid, warning, numeric, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        numeric && "text-right tabular-nums",
        warning && "border-warn",
        invalid && "border-neg text-neg",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroup({ prefix, suffix, children }: { prefix?: ReactNode; suffix?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-soft [&>input]:h-full [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-0 [&>input]:ring-0">
      {prefix && <span className="text-muted">{prefix}</span>}
      {children}
      {suffix && <span className="text-muted">{suffix}</span>}
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, "px-2", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="size-3.5 accent-primary" {...props} />
      {label}
    </label>
  );
}
```

```tsx
// src/ui/field.tsx
import type { ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? <p className="text-sm text-neg">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
```

```tsx
// src/ui/badge.tsx
import type { ReactNode } from "react";
import { cn } from "./cn";

const TONE = {
  pos: "bg-pos-bg text-pos",
  warn: "bg-warn-bg text-warn",
  neg: "bg-neg-bg text-neg",
  accent: "bg-soft text-accent",
  neutral: "bg-hover text-muted",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-xs font-medium", TONE[tone])}>
      {children}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[4px] border border-border px-[5px] text-xs leading-4 text-muted">
      {children}
    </span>
  );
}
```

```tsx
// src/ui/card.tsx
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ padded = true, className, ...props }: HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return <div className={cn("rounded-card border border-border bg-card", padded && "p-4", className)} {...props} />;
}

export function CardHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {actions && <div className="flex items-center gap-2 text-sm">{actions}</div>}
    </div>
  );
}
```

```tsx
// src/ui/kpi-tile.tsx
import { Card } from "./card";
import { cn } from "./cn";
import { type Tone, TONE_TEXT } from "./tone";

export function KpiTile({
  label,
  value,
  valueTone = "fg",
  delta,
  deltaTone = "muted",
  note,
}: {
  label: string;
  value: string;
  valueTone?: Tone;
  delta?: string;
  deltaTone?: Tone;
  note?: string;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className={cn("text-kpi font-semibold tracking-[-0.02em]", TONE_TEXT[valueTone])}>{value}</span>
      {(delta || note) && (
        <div className="flex items-center justify-between gap-2 text-sm whitespace-nowrap">
          {delta && <span className={cn("font-medium", TONE_TEXT[deltaTone])}>{delta}</span>}
          {note && <span className="truncate text-faint">{note}</span>}
        </div>
      )}
    </Card>
  );
}
```

```tsx
// src/ui/progress-bar.tsx
import { cn } from "./cn";

const FILL = { accent: "bg-accent", warn: "bg-warn", neg: "bg-neg", pos: "bg-pos" } as const;
const HEIGHT = { 4: "h-1", 6: "h-1.5", 8: "h-2" } as const;

export function ProgressBar({
  value,
  label,
  tone = "accent",
  height = 6,
}: {
  value: number;
  label: string;
  tone?: keyof typeof FILL;
  height?: keyof typeof HEIGHT;
}) {
  const percent = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("w-full overflow-hidden rounded-full bg-track", HEIGHT[height])}
    >
      <div className={cn("h-full rounded-full", FILL[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}
```

```tsx
// src/ui/avatar.tsx
import { cn } from "./cn";

const SIZE = { 22: "size-[22px] text-[10px]", 24: "size-6 text-xs", 28: "size-7 text-xs", 40: "size-10 text-md" } as const;

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Avatar({ name, size = 24 }: { name: string; size?: keyof typeof SIZE }) {
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center rounded-full bg-soft font-semibold text-accent", SIZE[size])}>
      {initials(name)}
    </span>
  );
}
```

```tsx
// src/ui/skeleton.tsx
import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-shimmer rounded-[4px] bg-skel", className)} />;
}
```

```tsx
// src/ui/kbd.tsx
import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[4px] border border-border px-1 font-sans text-xs leading-4 text-faint">{children}</kbd>;
}
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/ui/primitives.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/ui
git commit -F - <<'EOF'
feat(ui): primitives — buttons, inputs, fields, badges, cards, KPI tile, progress, avatar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 15: Overlays, table and page states

**Files:**
- Create: `src/ui/modal.tsx`, `src/ui/toast.tsx`, `src/ui/segmented.tsx`, `src/ui/menu.tsx`, `src/ui/popover.tsx`, `src/ui/tab-links.tsx`, `src/ui/table.tsx`, `src/ui/states.tsx`
- Test: `src/ui/overlays.test.tsx`, `src/ui/table.test.tsx`

**Interfaces:**
- Consumes: `cn`, `Button`, `IconButton` (Task 14); Base UI 1.8 subpaths.
- Produces:
  - `Modal` (`open`, `onOpenChange(open)`, `title`, `description?`, `width?: 420 | 440 | 460 | 520`, `footer?`, `children`)
  - `toastManager`, `notify(message: string): void`, `Toaster({ closeLabel })` (bottom-right, inverted, 3.2 s)
  - `Segmented<T extends string>` (`label`, `value`, `onChange(value)`, `options: { value: T; label: string }[]`) — never empty
  - `ActionMenu` (`label`, `items: { label: string; onSelect(): void; danger?: boolean }[]`)
  - `Popover` (`trigger: ReactNode`, `triggerLabel`, `children`)
  - `TabLinks` (`tabs: { href: Route; label: string; active: boolean }[]`, `Route` from `next`)
  - `Table`, `THead`, `Th` (`align?`, `sort?: { direction: "asc" | "desc" | null; onSort(): void }`), `TBody`, `Tr` (`selected?`, `onClick?`), `Td` (`align?`, `muted?`), `GroupRow`, `TotalRow`
  - `EmptyState` (`title`, `description`, `actions?`, `icon?`), `ErrorState` (`title`, `description`, `onRetry?`, `retryLabel?`), `LoadingState` (skeleton page)
  - Every export here is rendered on the Components page (Task 19, spec §8.3), including `TabLinks`, `GroupRow`, `TotalRow` and `LoadingState`, which no F0 product page uses yet.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/ui/overlays.test.tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu } from "./menu";
import { Modal } from "./modal";
import { Segmented } from "./segmented";
import { notify, Toaster } from "./toast";

function ModalHarness() {
  const [open, setOpen] = useState(true);
  return (
    <Modal open={open} onOpenChange={setOpen} title="Add pocket" description="Earmark money">
      <p>Body</p>
    </Modal>
  );
}

describe("overlays", () => {
  it("shows a titled modal and closes it with Escape", async () => {
    render(<ModalHarness />);
    expect(screen.getByRole("dialog", { name: "Add pocket" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps exactly one segment selected", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Period"
        value="month"
        onChange={onChange}
        options={[
          { value: "month", label: "Month" },
          { value: "year", label: "Year" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Year" }));
    expect(onChange).toHaveBeenCalledWith("year");
  });

  it("runs the chosen menu action", async () => {
    const onSelect = vi.fn();
    render(<ActionMenu label="Row actions" items={[{ label: "Edit", onSelect }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Row actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows a toast from anywhere", async () => {
    render(<Toaster closeLabel="Close" />);
    act(() => notify("Preferences saved"));
    expect(await screen.findByText("Preferences saved")).toBeInTheDocument();
  });
});
```

```tsx
// src/ui/table.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState } from "./states";
import { Table, TBody, Td, Th, THead, Tr } from "./table";

describe("table", () => {
  it("marks the sorted column and asks to re-sort", async () => {
    const onSort = vi.fn();
    render(
      <Table>
        <THead>
          <Th sort={{ direction: "desc", onSort }}>Date</Th>
          <Th align="right">Amount</Th>
        </THead>
        <TBody>
          <Tr selected>
            <Td>10 Sep</Td>
            <Td align="right">−12,00 €</Td>
          </Tr>
        </TBody>
      </Table>,
    );
    const header = screen.getByRole("columnheader", { name: /Date/ });
    expect(header).toHaveAttribute("aria-sort", "descending");
    await userEvent.click(screen.getByRole("button", { name: /Date/ }));
    expect(onSort).toHaveBeenCalledOnce();
    expect(screen.getByRole("row", { selected: true })).toBeInTheDocument();
  });
});

describe("states", () => {
  it("renders the empty state with its call to action", () => {
    render(<EmptyState title="No data yet" description="Connect an account" actions={<button>Open Settings</button>} />);
    expect(screen.getByRole("heading", { name: "No data yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
  });

  it("announces errors and offers a retry", async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Could not load" description="The server did not answer" onRetry={onRetry} retryLabel="Try again" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

Run: `npx vitest run src/ui/overlays.test.tsx src/ui/table.test.tsx` — Expected: FAIL.

- [ ] **Step 2: Write the implementation**

```tsx
// src/ui/modal.tsx
"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  width = 460,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  width?: 420 | 440 | 460 | 520;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(10,12,16,0.28)]" />
        <Dialog.Popup
          className="fixed top-1/2 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 animate-in flex-col gap-4 rounded-modal border border-border bg-card p-5 shadow-overlay"
          style={{ width }}
        >
          <div>
            <Dialog.Title className="text-xl font-semibold">{title}</Dialog.Title>
            {description && <Dialog.Description className="mt-0.5 text-muted">{description}</Dialog.Description>}
          </div>
          {children}
          {footer && <div className="flex items-center justify-end gap-2">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

```tsx
// src/ui/toast.tsx
"use client";

import { Toast } from "@base-ui/react/toast";
import { Check, X } from "lucide-react";

/** One manager for the whole app, so a toast can be raised after a Server Action returns. */
export const toastManager = Toast.createToastManager();

export function notify(message: string): void {
  toastManager.add({ title: message });
}

function ToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="flex animate-in items-center gap-2 rounded-lg bg-fg py-2.5 pr-3 pl-3.5 text-base text-card shadow-overlay"
    >
      <Check aria-hidden className="size-3.5 shrink-0 text-pos" />
      <Toast.Title className="flex-1" />
      <Toast.Close aria-label={closeLabel} className="opacity-70 hover:opacity-100">
        <X aria-hidden className="size-3.5" />
      </Toast.Close>
    </Toast.Root>
  ));
}

export function Toaster({ closeLabel }: { closeLabel: string }) {
  return (
    <Toast.Provider toastManager={toastManager} timeout={3200} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="fixed right-5 bottom-5 z-70 flex w-[min(420px,calc(100vw-40px))] flex-col gap-2">
          <ToastList closeLabel={closeLabel} />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
```

```tsx
// src/ui/segmented.tsx
"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(values) => {
        const next = values[0] as T | undefined;
        if (next && next !== value) onChange(next);
      }}
      className="inline-flex gap-0.5 rounded-[7px] bg-hover p-0.5"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className="h-6 rounded-[5px] px-2.5 text-sm font-medium text-muted data-[pressed]:bg-card data-[pressed]:text-fg data-[pressed]:shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
```

```tsx
// src/ui/menu.tsx
"use client";

import { Menu } from "@base-ui/react/menu";
import { Ellipsis } from "lucide-react";
import { cn } from "./cn";

export function ActionMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} title={label} className="inline-grid size-6 place-items-center rounded-[5px] text-faint hover:bg-hover hover:text-fg">
        <Ellipsis aria-hidden className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-30">
          <Menu.Popup className="min-w-40 animate-in rounded-lg border border-border bg-card p-1.5 shadow-overlay">
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                onClick={item.onSelect}
                className={cn(
                  "flex h-7 cursor-default items-center rounded-[5px] px-2 text-base data-[highlighted]:bg-hover",
                  item.danger && "text-neg",
                )}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
```

```tsx
// src/ui/popover.tsx
"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

export function Popover({ trigger, triggerLabel, children }: { trigger: ReactNode; triggerLabel: string; children: ReactNode }) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger
        aria-label={triggerLabel}
        className="inline-flex h-[30px] items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 text-sm hover:bg-hover"
      >
        {trigger}
      </BasePopover.Trigger>
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={4} align="start" className="z-30">
          <BasePopover.Popup className="animate-in rounded-lg border border-border bg-card p-1.5 shadow-overlay">
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
```

```tsx
// src/ui/tab-links.tsx
import Link from "next/link";
import type { Route } from "next";
import { cn } from "./cn";

/** Route-based tabs (Settings sections): each tab is a link; the active one carries aria-current. */
export function TabLinks({ tabs }: { tabs: { href: Route; label: string; active: boolean }[] }) {
  return (
    <nav className="flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex h-[34px] items-center border-b-2 px-3 font-medium",
            tab.active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
```

```tsx
// src/ui/table.tsx
import type { HTMLAttributes, ReactNode, TdHTMLAttributes } from "react";
import { cn } from "./cn";

type Align = "left" | "right";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-base", className)} {...props} />;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border">{children}</tr>
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  sort,
}: {
  children: ReactNode;
  align?: Align;
  sort?: { direction: "asc" | "desc" | null; onSort: () => void };
}) {
  const ariaSort = sort?.direction === "asc" ? "ascending" : sort?.direction === "desc" ? "descending" : undefined;
  return (
    <th
      aria-sort={ariaSort}
      className={cn(
        "h-8 px-2 text-sm font-medium whitespace-nowrap text-muted first:pl-4 last:pr-4",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {sort ? (
        <button type="button" onClick={sort.onSort} className={cn("inline-flex items-center gap-1", sort.direction && "text-fg")}>
          {children}
          {sort.direction && <span aria-hidden className="text-micro">{sort.direction === "asc" ? "↑" : "↓"}</span>}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({ selected, onClick, className, ...props }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      onClick={onClick}
      className={cn(
        "h-8 border-b border-border hover:bg-hover",
        selected && "bg-sel hover:bg-sel",
        onClick && "cursor-pointer",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ align = "left", muted, className, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { align?: Align; muted?: boolean }) {
  return (
    <td
      className={cn(
        "px-2 whitespace-nowrap first:pl-4 last:pr-4",
        align === "right" && "text-right tabular-nums",
        muted && "text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function GroupRow({ colSpan, label, summary }: { colSpan: number; label: ReactNode; summary?: ReactNode }) {
  return (
    <tr className="h-7 border-y border-border bg-bg">
      <td colSpan={colSpan} className="px-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{label}</span>
          {summary && <span className="text-sm text-muted">{summary}</span>}
        </div>
      </td>
    </tr>
  );
}

export function TotalRow({ children }: { children: ReactNode }) {
  return <tr className="h-9 bg-bg font-semibold">{children}</tr>;
}
```

```tsx
// src/ui/states.tsx
import { CircleAlert, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Card } from "./card";
import { Skeleton } from "./skeleton";

export function EmptyState({
  title,
  description,
  actions,
  icon = <Inbox aria-hidden className="size-[18px]" />,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-modal border border-dashed border-border2 bg-card px-6 py-14 text-center">
      <div className="grid size-10 place-items-center rounded-card bg-soft text-accent">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-[380px] text-muted">{description}</p>
      {actions && <div className="mt-1 flex gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-modal border border-dashed border-neg bg-card px-6 py-14 text-center">
      <div className="grid size-10 place-items-center rounded-card bg-neg-bg text-neg">
        <CircleAlert aria-hidden className="size-[18px]" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-[380px] text-muted">{description}</p>
      {onRetry && retryLabel && (
        <Button size="md" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

/** The generic page skeleton from the design (title, four KPI tiles, a table). */
export function LoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-3 w-[120px]" />
      <Skeleton className="h-8 w-[260px] rounded-ctl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="flex h-[92px] flex-col gap-3">
            <Skeleton className="h-2.5 w-2/5" />
            <Skeleton className="h-[22px] w-[65%]" />
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-3">
        <Skeleton className="h-3 w-40" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4">
            <Skeleton className="h-2.5" />
            <Skeleton className="h-2.5" />
            <Skeleton className="h-2.5" />
            <Skeleton className="h-2.5" />
          </div>
        ))}
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/ui`
Expected: PASS. If the menu test cannot find `menuitem` in jsdom, keep the assertion and add `await screen.findByRole("menu")` before clicking; do not replace the component with a hand-rolled menu.

- [ ] **Step 4: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/ui
git commit -F - <<'EOF'
feat(ui): modal, toast, segmented control, menus, table and empty/error/loading states

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 16: App shell — sidebar, topbar, mobile navigation, command palette, theme toggle

**Files:**
- Create: `src/ui/shell/nav-types.ts`, `src/ui/shell/icons.ts`, `src/ui/shell/active.ts`, `src/ui/shell/commands.ts`, `src/ui/shell/shell-context.tsx`, `src/ui/shell/brand.tsx`, `src/ui/shell/sidebar.tsx`, `src/ui/shell/topbar.tsx`, `src/ui/shell/mobile-nav.tsx`, `src/ui/shell/command-palette.tsx`, `src/ui/shell/theme-toggle.tsx`, `src/ui/shell/page.tsx`, `src/app/(app)/navigation.ts`, `src/app/(app)/layout.tsx`, `src/modules/users/actions.ts`
- Modify: `messages/en.json`, `messages/it.json`
- Test: `src/ui/shell/shell.test.tsx`, `src/app/(app)/navigation.test.ts`

**Interfaces:**
- Consumes: `requireSession`, `getAuth`, `OIDC_PROVIDER_ID` (Task 9); `getPreferences`, `updatePreferences` (Task 8); `THEME_COOKIE`, `ThemePreference`, `common.product` (Task 13); `Button`, `IconButton`, `Kbd`, `Avatar`, `Toaster`, `cn` (Tasks 14–15); `authClient` (Task 9).
- Produces:
  - `type IconName`, `interface NavLink { id: string; href: Route; label: string; icon: IconName; group: "finance" | "work" | "system" | "footer"; mobile: boolean }`.
  - `NAV_ITEMS` and `navFor(role: Role): NavItem[]` (`src/app/(app)/navigation.ts`) — the single source for sidebar, mobile tabs and palette. F0 items: Overview (`/`), Settings (`/settings/profile`, footer), Components (`/components`, system, admin only). Each later phase appends its items.
  - `isActive(pathname: string, href: string): boolean`; `filterCommands(links: NavLink[], query: string): NavLink[]`.
  - `ShellProvider`, `useShell()` → `{ collapsed, toggleSidebar, paletteOpen, setPaletteOpen, labels }`; shortcuts ⌘K / Ctrl+K (palette), ⌘\ / Ctrl+\ (sidebar); `SIDEBAR_COOKIE = "sidebar"`.
  - `Page` (`title: string`, `parent?: { href: Route; label: string }`, `actions?: ReactNode`, `children`) — every `(app)` page renders its content through it.
  - `src/modules/users/actions.ts` — the users module's Server Actions file (spec §3: validate → service → revalidate); this task adds `saveTheme(theme: ThemePreference): Promise<void>`, Task 18 adds the settings actions.

- [ ] **Step 1: Add the shell messages**

Add to `messages/en.json`:

```json
  "nav": {
    "primary": "Primary",
    "groups": { "finance": "Finance", "work": "Work", "system": "System" },
    "overview": "Overview",
    "settings": "Settings",
    "components": "Components",
    "more": "More"
  },
  "shell": {
    "toggleSidebar": "Toggle sidebar (⌘\\)",
    "search": "Search or jump to…",
    "toggleTheme": "Toggle theme",
    "signOut": "Sign out",
    "via": { "authentik": "via Authentik", "password": "via password" },
    "palette": {
      "placeholder": "Jump to a page…",
      "pages": "Pages",
      "empty": "No matches",
      "shortcut": "⌘K",
      "escape": "esc"
    }
  }
```

and to `messages/it.json`:

```json
  "nav": {
    "primary": "Principale",
    "groups": { "finance": "Finanza", "work": "Lavoro", "system": "Sistema" },
    "overview": "Panoramica",
    "settings": "Impostazioni",
    "components": "Componenti",
    "more": "Altro"
  },
  "shell": {
    "toggleSidebar": "Mostra/nascondi barra laterale (⌘\\)",
    "search": "Cerca o vai a…",
    "toggleTheme": "Cambia tema",
    "signOut": "Esci",
    "via": { "authentik": "tramite Authentik", "password": "tramite password" },
    "palette": {
      "placeholder": "Vai a una pagina…",
      "pages": "Pagine",
      "empty": "Nessun risultato",
      "shortcut": "⌘K",
      "escape": "esc"
    }
  }
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/app/(app)/navigation.test.ts
import { describe, expect, it } from "vitest";
import { navFor } from "./navigation";

describe("navFor", () => {
  it("hides admin-only items from users", () => {
    expect(navFor("user").map((i) => i.id)).toEqual(["overview", "settings"]);
    expect(navFor("admin").map((i) => i.id)).toEqual(["overview", "components", "settings"]);
  });
});
```

```tsx
// src/ui/shell/shell.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isActive } from "./active";
import { CommandPalette } from "./command-palette";
import { filterCommands } from "./commands";
import type { NavLink } from "./nav-types";
import { ShellProvider } from "./shell-context";
import { Sidebar } from "./sidebar";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/settings/profile", useRouter: () => ({ push }) }));

const LINKS: NavLink[] = [
  { id: "overview", href: "/", label: "Overview", icon: "overview", group: "finance", mobile: true },
  { id: "components", href: "/components", label: "Components", icon: "components", group: "system", mobile: false },
  { id: "settings", href: "/settings/profile", label: "Settings", icon: "settings", group: "footer", mobile: false },
];

const LABELS = {
  product: "Finance Dashboard",
  primary: "Primary",
  groups: { finance: "Finance", work: "Work", system: "System" },
  toggleSidebar: "Toggle sidebar",
  search: "Search or jump to…",
  toggleTheme: "Toggle theme",
  signOut: "Sign out",
  more: "More",
  palette: { placeholder: "Jump to a page…", pages: "Pages", empty: "No matches", shortcut: "⌘K", escape: "esc" },
};

function renderShell() {
  return render(
    <ShellProvider initialCollapsed={false} labels={LABELS}>
      <Sidebar links={LINKS} user={{ name: "Mattia Longobardo", via: "via Authentik" }} />
      <CommandPalette links={LINKS} />
    </ShellProvider>,
  );
}

describe("shell", () => {
  beforeEach(() => push.mockReset());

  it("matches active routes by prefix, the root exactly", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/accounts", "/")).toBe(false);
    expect(isActive("/settings/profile", "/settings/profile")).toBe(true);
    expect(isActive("/accounts/123", "/accounts")).toBe(true);
    expect(isActive("/accountsx", "/accounts")).toBe(false);
  });

  it("filters commands by a case-insensitive substring", () => {
    expect(filterCommands(LINKS, "SET").map((l) => l.id)).toEqual(["settings"]);
    expect(filterCommands(LINKS, "").map((l) => l.id)).toEqual(["overview", "components", "settings"]);
  });

  it("marks the current page and collapses with ⌘\\", async () => {
    renderShell();
    expect(screen.getByRole("link", { name: /Settings/ })).toHaveAttribute("aria-current", "page");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveAttribute("data-collapsed", "false");
    await userEvent.keyboard("{Meta>}\\{/Meta}");
    expect(nav).toHaveAttribute("data-collapsed", "true");
  });

  it("opens the palette with ⌘K and jumps to the first match on Enter", async () => {
    renderShell();
    await userEvent.keyboard("{Meta>}k{/Meta}");
    const input = await screen.findByPlaceholderText("Jump to a page…");
    await userEvent.type(input, "comp{Enter}");
    expect(push).toHaveBeenCalledWith("/components");
  });
});
```

Run: `npx vitest run src/ui/shell "src/app/(app)/navigation.test.ts"` — Expected: FAIL.

- [ ] **Step 3: Write the shell building blocks**

```ts
// src/ui/shell/nav-types.ts
import type { Route } from "next";

export type IconName = "overview" | "settings" | "components";

export interface NavLink {
  id: string;
  href: Route;
  label: string;
  icon: IconName;
  group: "finance" | "work" | "system" | "footer";
  mobile: boolean;
}
```

```ts
// src/ui/shell/icons.ts
import { Component, LayoutDashboard, type LucideIcon, Settings } from "lucide-react";
import type { IconName } from "./nav-types";

/** Nav items carry an icon name (serialisable from Server Components); this maps it to Lucide. */
export const NAV_ICONS: Record<IconName, LucideIcon> = {
  overview: LayoutDashboard,
  settings: Settings,
  components: Component,
};
```

Each later phase extends `IconName` and `NAV_ICONS` together with its nav item (design icon names: `landmark`, `receipt`, `chart-pie`, `trending-up`, `percent`, `wallet-cards`, `repeat`, `banknote`, `calendar-days`).

```ts
// src/ui/shell/active.ts
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

```ts
// src/ui/shell/commands.ts
import type { NavLink } from "./nav-types";

export function filterCommands(links: NavLink[], query: string): NavLink[] {
  const needle = query.trim().toLowerCase();
  return needle ? links.filter((link) => link.label.toLowerCase().includes(needle)) : links;
}
```

```tsx
// src/ui/shell/shell-context.tsx
"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const SIDEBAR_COOKIE = "sidebar";

export interface ShellLabels {
  product: string;
  primary: string;
  groups: { finance: string; work: string; system: string };
  toggleSidebar: string;
  search: string;
  toggleTheme: string;
  signOut: string;
  more: string;
  palette: { placeholder: string; pages: string; empty: string; shortcut: string; escape: string };
}

interface ShellState {
  collapsed: boolean;
  toggleSidebar: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  labels: ShellLabels;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const state = useContext(ShellContext);
  if (!state) throw new Error("useShell must be used inside <ShellProvider>");
  return state;
}

export function ShellProvider({
  initialCollapsed,
  labels,
  children,
}: {
  initialCollapsed: boolean;
  labels: ShellLabels;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // The cookie is written outside the state updater: updaters must stay pure (Strict Mode runs them twice).
  const toggleSidebar = useCallback(() => {
    const next = !collapsed;
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
    setCollapsed(next);
  }, [collapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (event.key === "\\") {
        event.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const value = useMemo(
    () => ({ collapsed, toggleSidebar, paletteOpen, setPaletteOpen, labels }),
    [collapsed, toggleSidebar, paletteOpen, labels],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
```

```tsx
// src/ui/shell/brand.tsx
import { cn } from "@/ui/cn";

export function BrandMark({ size = 24 }: { size?: 24 | 28 }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center bg-fg font-semibold text-card",
        size === 24 ? "size-6 rounded-ctl text-sm" : "size-7 rounded-[7px] text-md",
      )}
    >
      F
    </span>
  );
}
```

```tsx
// src/ui/shell/sidebar.tsx
"use client";

import { LogOut } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/platform/auth/client";
import { Avatar } from "@/ui/avatar";
import { IconButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { isActive } from "./active";
import { BrandMark } from "./brand";
import { NAV_ICONS } from "./icons";
import type { NavLink } from "./nav-types";
import { useShell } from "./shell-context";

const GROUPS = ["finance", "work", "system"] as const;

function Item({ link, active, collapsed }: { link: NavLink; active: boolean; collapsed: boolean }) {
  const Icon = NAV_ICONS[link.icon];
  return (
    <Link
      href={link.href}
      title={link.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-ctl px-2 text-muted hover:bg-hover",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        active && "bg-hover font-medium text-fg",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className={cn("truncate", collapsed ? "hidden" : "hidden xl:inline")}>{link.label}</span>
    </Link>
  );
}

export function Sidebar({ links, user }: { links: NavLink[]; user: { name: string; via: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const { collapsed, labels } = useShell();
  const label = collapsed ? "hidden" : "hidden xl:block";

  async function signOut() {
    await authClient.signOut();
    // `/sign-in` is created in Task 17; typed routes accept it only through the cast until then.
    router.push("/sign-in" as Route);
  }

  return (
    <nav
      aria-label={labels.primary}
      data-collapsed={collapsed}
      className={cn(
        "hidden shrink-0 flex-col gap-1 border-r border-border bg-side px-2 py-3 transition-[width] duration-[180ms] md:flex",
        collapsed ? "w-14" : "w-14 xl:w-60",
      )}
    >
      <div className="mb-2 flex h-8 items-center gap-2.5 px-2">
        <BrandMark />
        <span className={cn("font-semibold whitespace-nowrap", label)}>{labels.product}</span>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto">
        {GROUPS.map((group) => {
          const items = links.filter((link) => link.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="mb-3 flex flex-col gap-0.5">
              <span className={cn("px-2 pt-1.5 pb-1 text-xs font-medium tracking-[0.04em] text-faint uppercase", label)}>
                {labels.groups[group]}
              </span>
              {items.map((link) => (
                <Item key={link.id} link={link} active={isActive(pathname, link.href)} collapsed={collapsed} />
              ))}
            </div>
          );
        })}
      </div>
      {links
        .filter((link) => link.group === "footer")
        .map((link) => (
          <Item key={link.id} link={link} active={isActive(pathname, link.href)} collapsed={collapsed} />
        ))}
      <div className="mt-2 mb-1 h-px bg-border" />
      <div className="flex h-9 items-center gap-2 px-1">
        <Avatar name={user.name} />
        <div className={cn("min-w-0 flex-1 leading-tight", label)}>
          <div className="truncate font-medium">{user.name}</div>
          <div className="truncate text-xs text-muted">{user.via}</div>
        </div>
        <IconButton label={labels.signOut} onClick={signOut} className={label}>
          <LogOut aria-hidden className="size-3.5" />
        </IconButton>
      </div>
    </nav>
  );
}
```

```tsx
// src/ui/shell/theme-toggle.tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { useTransition } from "react";
import { IconButton } from "@/ui/button";
import type { ThemePreference } from "@/platform/theme";
import { useShell } from "./shell-context";

/** Flips between light and dark immediately, then persists the choice as the user's preference. */
export function ThemeToggle({ onSave }: { onSave: (theme: ThemePreference) => Promise<void> }) {
  const { labels } = useShell();
  const [, startTransition] = useTransition();

  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    startTransition(() => onSave(next));
  }

  return (
    <IconButton label={labels.toggleTheme} bordered onClick={toggle}>
      <Moon aria-hidden className="size-3.5 dark:hidden" />
      <Sun aria-hidden className="hidden size-3.5 dark:block" />
    </IconButton>
  );
}
```

```tsx
// src/ui/shell/topbar.tsx
"use client";

import { PanelLeft, Search } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { IconButton } from "@/ui/button";
import { Kbd } from "@/ui/kbd";
import { useShell } from "./shell-context";

export function Topbar({
  title,
  parent,
  actions,
  themeToggle,
}: {
  title: string;
  parent?: { href: Route; label: string };
  actions?: ReactNode;
  themeToggle: ReactNode;
}) {
  const { toggleSidebar, setPaletteOpen, labels } = useShell();
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg pr-5 pl-3 max-md:h-[52px] max-md:px-4">
      <IconButton label={labels.toggleSidebar} onClick={toggleSidebar} className="max-md:hidden">
        <PanelLeft aria-hidden className="size-3.5" />
      </IconButton>
      <div className="flex min-w-0 items-center gap-1.5 text-muted">
        {parent && (
          <>
            <Link href={parent.href} className="hover:text-fg max-md:hidden">
              {parent.label}
            </Link>
            <span aria-hidden className="text-faint max-md:hidden">
              /
            </span>
          </>
        )}
        <span className="truncate font-medium text-fg max-md:text-xl max-md:font-semibold max-md:tracking-[-0.01em]">{title}</span>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-7 w-[220px] items-center gap-2 rounded-ctl border border-border bg-card px-2 text-sm text-muted max-md:hidden"
      >
        <Search aria-hidden className="size-3.5" />
        <span className="flex-1 text-left">{labels.search}</span>
        <Kbd>{labels.palette.shortcut}</Kbd>
      </button>
      <IconButton label={labels.search} bordered size={32} onClick={() => setPaletteOpen(true)} className="md:hidden">
        <Search aria-hidden className="size-4" />
      </IconButton>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
      <span aria-hidden className="mx-1 h-5 w-px bg-border max-md:hidden" />
      <span className="max-md:hidden">{themeToggle}</span>
    </header>
  );
}
```

```tsx
// src/ui/shell/page.tsx
import type { Route } from "next";
import type { ReactNode } from "react";
import { saveTheme } from "@/modules/users/actions";
import { ThemeToggle } from "./theme-toggle";
import { Topbar } from "./topbar";

/** Every signed-in page: the topbar (breadcrumb + actions) and the 1440 px content column. */
export function Page({
  title,
  parent,
  actions,
  children,
}: {
  title: string;
  parent?: { href: Route; label: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar title={title} parent={parent} actions={actions} themeToggle={<ThemeToggle onSave={saveTheme} />} />
      <main className="mx-auto flex w-full max-w-[1440px] animate-in flex-col gap-4 p-6 max-md:p-4 max-md:pb-24">{children}</main>
    </div>
  );
}
```

(`src/ui/shell/page.tsx` importing the users module's `saveTheme` Server Action is the one allowed dependency from `src/ui` to a module: the shell is app chrome. No other `src/ui` file imports from `src/modules` or `src/app`.)

```tsx
// src/ui/shell/command-palette.tsx
"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/ui/cn";
import { Kbd } from "@/ui/kbd";
import { filterCommands } from "./commands";
import type { NavLink } from "./nav-types";
import { useShell } from "./shell-context";

export function CommandPalette({ links }: { links: NavLink[] }) {
  const { paletteOpen, setPaletteOpen, labels } = useShell();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const matches = filterCommands(links, query);

  function close() {
    setPaletteOpen(false);
    setQuery("");
    setCursor(0);
  }

  function go(link: NavLink | undefined) {
    if (!link) return;
    close();
    router.push(link.href);
  }

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={(open) => (open ? setPaletteOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-60 bg-[rgba(10,12,16,0.28)]" />
        <Dialog.Popup className="fixed top-[15vh] left-1/2 z-60 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 animate-in overflow-hidden rounded-modal border border-border bg-card shadow-overlay">
          <Dialog.Title className="sr-only">{labels.search}</Dialog.Title>
          <div className="flex h-11 items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 text-muted" />
            <input
              autoFocus
              value={query}
              placeholder={labels.palette.placeholder}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") go(matches[cursor]);
                if (event.key === "ArrowDown") setCursor((c) => Math.min(c + 1, matches.length - 1));
                if (event.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
              }}
              className="flex-1 bg-transparent text-md outline-none placeholder:text-faint"
            />
            <Kbd>{labels.palette.escape}</Kbd>
          </div>
          <div className="p-1.5">
            <div className="px-2 pt-1 pb-1.5 text-xs font-medium tracking-[0.04em] text-faint uppercase">{labels.palette.pages}</div>
            {matches.length === 0 && <p className="px-2 py-3 text-muted">{labels.palette.empty}</p>}
            {matches.map((link, index) => (
              <button
                key={link.id}
                type="button"
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(link)}
                className={cn("flex h-8 w-full items-center justify-between rounded-ctl px-2 text-left", index === cursor && "bg-hover")}
              >
                <span className="font-medium">{link.label}</span>
                {link.group !== "footer" && <span className="text-sm text-muted">{labels.groups[link.group]}</span>}
              </button>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

```tsx
// src/ui/shell/mobile-nav.tsx
"use client";

import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/ui/cn";
import { isActive } from "./active";
import { NAV_ICONS } from "./icons";
import type { NavLink } from "./nav-types";
import { useShell } from "./shell-context";

/** Below 768 px: bottom tabs for the main pages and a "More" sheet for the rest (design mobile frame). */
export function MobileNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const { labels } = useShell();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = links.filter((link) => link.mobile);
  const rest = links.filter((link) => !link.mobile);

  return (
    <>
      <nav aria-label={labels.primary} className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-border bg-card pb-2 md:hidden">
        {tabs.map((link) => {
          const Icon = NAV_ICONS[link.icon];
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.id}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex flex-col items-center justify-center gap-0.5 text-micro font-medium", active ? "text-accent" : "text-muted")}
            >
              <Icon aria-hidden className="size-5" />
              {link.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} className="col-start-5 flex flex-col items-center justify-center gap-0.5 text-micro font-medium text-muted">
          <Ellipsis aria-hidden className="size-5" />
          {labels.more}
        </button>
      </nav>
      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(10,12,16,0.25)] md:hidden" />
          <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 animate-in rounded-t-2xl border-t border-border bg-card px-4 pt-2 pb-20 md:hidden">
            <Dialog.Title className="sr-only">{labels.more}</Dialog.Title>
            <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-border2" />
            {rest.map((link) => {
              const Icon = NAV_ICONS[link.icon];
              return (
                <Link
                  key={link.id}
                  href={link.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn("flex h-11 items-center gap-3 rounded-lg px-2 font-medium", isActive(pathname, link.href) && "text-accent")}
                >
                  <Icon aria-hidden className="size-[18px] text-muted" />
                  <span className="flex-1">{link.label}</span>
                  <ChevronRight aria-hidden className="size-4 text-faint" />
                </Link>
              );
            })}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
```

- [ ] **Step 4: Write the navigation, the server action and the layout**

```ts
// src/app/(app)/navigation.ts
import type { Route } from "next";
import type { Role } from "@/platform/context";
import type { NavLink } from "@/ui/shell/nav-types";

export interface NavItem extends Omit<NavLink, "label"> {
  labelKey: "overview" | "settings" | "components";
  adminOnly: boolean;
}

/** The single navigation list: sidebar, mobile tabs and command palette all derive from it. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "overview", href: "/" as Route, labelKey: "overview", icon: "overview", group: "finance", mobile: true, adminOnly: false },
  { id: "components", href: "/components" as Route, labelKey: "components", icon: "components", group: "system", mobile: false, adminOnly: true },
  { id: "settings", href: "/settings/profile" as Route, labelKey: "settings", icon: "settings", group: "footer", mobile: false, adminOnly: false },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === "admin");
}
```

```ts
// src/modules/users/actions.ts — the users module's Server Actions (spec §3). Task 18 adds the settings actions.
"use server";

import { cookies } from "next/headers";
import { requireSession } from "@/platform/auth/session";
import { parseTheme, THEME_COOKIE, type ThemePreference } from "@/platform/theme";
import { getPreferences, updatePreferences } from "./service";

export async function saveTheme(theme: ThemePreference): Promise<void> {
  const ctx = await requireSession();
  const next = parseTheme(theme);
  await updatePreferences(ctx, { ...(await getPreferences(ctx)), theme: next });
  (await cookies()).set(THEME_COOKIE, next, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
```

```tsx
// src/app/(app)/layout.tsx
import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getAuth } from "@/platform/auth/auth";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { requireSession } from "@/platform/auth/session";
import { CommandPalette } from "@/ui/shell/command-palette";
import { MobileNav } from "@/ui/shell/mobile-nav";
import type { NavLink } from "@/ui/shell/nav-types";
import { ShellProvider, SIDEBAR_COOKIE } from "@/ui/shell/shell-context";
import { Sidebar } from "@/ui/shell/sidebar";
import { Toaster } from "@/ui/toast";
import { navFor } from "./navigation";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireSession();
  const session = await getAuth().api.getSession({ headers: await headers() });
  const accounts = await getAuth().api.listUserAccounts({ headers: await headers() });
  const viaSso = accounts.some((account) => account.providerId === OIDC_PROVIDER_ID);
  const t = await getTranslations();

  const links: NavLink[] = navFor(ctx.role).map(({ id, href, icon, group, mobile, labelKey }) => ({
    id,
    href,
    icon,
    group,
    mobile,
    label: t(`nav.${labelKey}`),
  }));
  const labels = {
    product: t("common.product"),
    primary: t("nav.primary"),
    groups: { finance: t("nav.groups.finance"), work: t("nav.groups.work"), system: t("nav.groups.system") },
    toggleSidebar: t("shell.toggleSidebar"),
    search: t("shell.search"),
    toggleTheme: t("shell.toggleTheme"),
    signOut: t("shell.signOut"),
    more: t("nav.more"),
    palette: {
      placeholder: t("shell.palette.placeholder"),
      pages: t("shell.palette.pages"),
      empty: t("shell.palette.empty"),
      shortcut: t("shell.palette.shortcut"),
      escape: t("shell.palette.escape"),
    },
  };
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <ShellProvider initialCollapsed={collapsed} labels={labels}>
      <div className="flex h-dvh overflow-hidden">
        <Sidebar
          links={links}
          user={{ name: session?.user.name ?? "", via: t(viaSso ? "shell.via.authentik" : "shell.via.password") }}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
      <MobileNav links={links} />
      <CommandPalette links={links} />
      <Toaster closeLabel={t("common.close")} />
    </ShellProvider>
  );
}
```

`listUserAccounts` is Better Auth's endpoint for the signed-in user's linked providers; if its name differs in 1.7.4, the type checker will say so — use the reported equivalent (`auth.api.listAccounts`), not a raw table query.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/ui/shell "src/app/(app)/navigation.test.ts" src/platform/i18n && npm run typecheck`
Expected: PASS. (`src/app/page.tsx` from Task 1 still exists and conflicts with `(app)/page.tsx` only once Task 19 adds it.)

- [ ] **Step 6: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/ui/shell "src/app/(app)" src/modules/users/actions.ts messages
git commit -F - <<'EOF'
feat(ui): app shell — sidebar, topbar, mobile tabs, command palette, theme toggle

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 17: Auth pages — sign in, forgot and reset password, accept an invitation

**Files:**
- Create: `src/app/(auth)/layout.tsx`, `src/app/(auth)/auth-card.tsx`, `src/app/(auth)/actions.ts`, `src/app/(auth)/sign-in/page.tsx`, `src/app/(auth)/sign-in/sign-in-form.tsx`, `src/app/(auth)/sign-in/errors.ts`, `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/forgot-password/forgot-form.tsx`, `src/app/(auth)/reset-password/page.tsx`, `src/app/(auth)/reset-password/reset-form.tsx`, `src/app/(auth)/invite/[token]/page.tsx`, `src/app/(auth)/invite/[token]/invite-form.tsx`
- Modify: `messages/en.json`, `messages/it.json`
- Test: `src/app/(auth)/sign-in/errors.test.ts`, `src/app/(auth)/sign-in/sign-in-form.test.tsx`

**Interfaces:**
- Consumes: `authClient` (Task 9); `getOptionalCtx` (Task 9); `getAuth` (Task 9); `OIDC_PROVIDER_ID`, `identityProviderUrl` (Task 9, `src/platform/auth/provider.ts`); `findInvitation`, `acceptInvitation`, `InvitationError` (Task 10); `common.product`, `common.or` (Task 13); `Button`, `Input`, `Field` (Task 14); `BrandMark` (Task 16).
- Produces: public routes `/sign-in`, `/forgot-password`, `/reset-password`, `/invite/[token]`; `signInErrorKey(code: string | undefined): SignInErrorKey | null` (`null` when there is no code); server action `acceptInviteAction(token: string, input: { name: string; password: string; confirm: string }): Promise<{ error: "invalid" | "email_taken" | "weak_password" | "mismatch" } | undefined>` (redirects to `/` on success).

- [ ] **Step 1: Add the messages**

`messages/en.json`:

```json
  "auth": {
    "version": "v0.1.0",
    "signIn": {
      "title": "Sign in",
      "description": "Use your Authentik account, or your password if you have one.",
      "authentik": "Continue with Authentik",
      "email": "Email",
      "password": "Password",
      "submit": "Sign in",
      "forgot": "Forgot password?"
    },
    "errors": {
      "credentials": "Wrong email or password.",
      "invitationRequired": "This account needs an invitation. Ask an administrator.",
      "oidc": "Sign-in with Authentik failed. Try again.",
      "generic": "Sign-in failed. Try again."
    },
    "forgot": {
      "title": "Reset your password",
      "description": "We will email you a link to choose a new password.",
      "submit": "Send reset link",
      "sent": "If an account exists for that address, a reset link is on its way.",
      "back": "Back to sign in"
    },
    "reset": {
      "title": "Choose a new password",
      "newPassword": "New password",
      "confirm": "Confirm new password",
      "submit": "Set password",
      "hint": "At least 12 characters.",
      "mismatch": "The two passwords do not match.",
      "invalid": "This reset link is invalid or has expired."
    },
    "invite": {
      "title": "Join Finance Dashboard",
      "description": "Invited as {email}.",
      "name": "Full name",
      "submit": "Create account",
      "invalid": "This invitation is invalid, expired or already used.",
      "emailTaken": "An account with this email already exists. Sign in instead.",
      "authentik": "Use Authentik instead"
    }
  }
```

`messages/it.json`:

```json
  "auth": {
    "version": "v0.1.0",
    "signIn": {
      "title": "Accedi",
      "description": "Usa il tuo account Authentik, oppure la password se ne hai una.",
      "authentik": "Continua con Authentik",
      "email": "Email",
      "password": "Password",
      "submit": "Accedi",
      "forgot": "Password dimenticata?"
    },
    "errors": {
      "credentials": "Email o password errate.",
      "invitationRequired": "Questo account richiede un invito. Chiedi a un amministratore.",
      "oidc": "Accesso con Authentik non riuscito. Riprova.",
      "generic": "Accesso non riuscito. Riprova."
    },
    "forgot": {
      "title": "Reimposta la password",
      "description": "Ti invieremo via email un link per scegliere una nuova password.",
      "submit": "Invia il link",
      "sent": "Se esiste un account con questo indirizzo, il link è in arrivo.",
      "back": "Torna all'accesso"
    },
    "reset": {
      "title": "Scegli una nuova password",
      "newPassword": "Nuova password",
      "confirm": "Conferma la nuova password",
      "submit": "Imposta la password",
      "hint": "Almeno 12 caratteri.",
      "mismatch": "Le due password non coincidono.",
      "invalid": "Questo link non è valido o è scaduto."
    },
    "invite": {
      "title": "Unisciti a Finance Dashboard",
      "description": "Invitato come {email}.",
      "name": "Nome e cognome",
      "submit": "Crea l'account",
      "invalid": "Questo invito non è valido, è scaduto o è già stato usato.",
      "emailTaken": "Esiste già un account con questa email. Accedi.",
      "authentik": "Usa Authentik"
    }
  }
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/app/(auth)/sign-in/errors.test.ts
import { describe, expect, it } from "vitest";
import { signInErrorKey } from "./errors";

describe("signInErrorKey", () => {
  it("maps provider and Better Auth error codes to messages", () => {
    expect(signInErrorKey("oidc")).toBe("oidc");
    expect(signInErrorKey("invitation_required")).toBe("invitationRequired");
    expect(signInErrorKey("INVALID_EMAIL_OR_PASSWORD")).toBe("credentials");
    expect(signInErrorKey("anything-else")).toBe("generic");
    expect(signInErrorKey(undefined)).toBeNull();
  });
});
```

```tsx
// src/app/(auth)/sign-in/sign-in-form.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import { SignInForm } from "./sign-in-form";

const signInEmail = vi.fn();
const signInSocial = vi.fn();
vi.mock("@/platform/auth/client", () => ({
  authClient: { signIn: { email: (...a: unknown[]) => signInEmail(...a), social: (...a: unknown[]) => signInSocial(...a) } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

function renderForm(error: string | null = null) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <SignInForm initialError={error} />
    </NextIntlClientProvider>,
  );
}

describe("SignInForm", () => {
  it("offers Authentik and password sign-in", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Continue with Authentik" }));
    expect(signInSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: "authentik" }));
  });

  it("shows the error returned by a failed password sign-in", async () => {
    signInEmail.mockResolvedValueOnce({ error: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    renderForm();
    await userEvent.type(screen.getByLabelText("Email"), "a@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
  });

  it("shows an error carried in the URL", () => {
    renderForm("invitationRequired");
    expect(screen.getByRole("alert")).toHaveTextContent("needs an invitation");
  });
});
```

Run: `npx vitest run "src/app/(auth)"` — Expected: FAIL.

- [ ] **Step 3: Write the pages**

```ts
// src/app/(auth)/sign-in/errors.ts
export type SignInErrorKey = "credentials" | "invitationRequired" | "oidc" | "generic";

export function signInErrorKey(code: string | undefined): SignInErrorKey | null {
  if (!code) return null;
  if (code === "oidc") return "oidc";
  if (code === "invitation_required") return "invitationRequired";
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "credentials";
  return "generic";
}
```

```tsx
// src/app/(auth)/layout.tsx
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <main className="grid min-h-dvh place-items-center bg-bg p-4">{children}</main>;
}
```

```tsx
// src/app/(auth)/auth-card.tsx
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { identityProviderUrl } from "@/platform/auth/provider";
import { BrandMark } from "@/ui/shell/brand";

export async function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const t = await getTranslations("auth");
  const common = await getTranslations("common");
  const host = identityProviderUrl()?.host ?? "";
  return (
    <div className="flex w-[360px] max-w-full animate-in flex-col gap-5 rounded-modal border border-border bg-card p-8">
      <div className="flex items-center gap-2.5">
        <BrandMark size={28} />
        <span className="text-lg font-semibold">{common("product")}</span>
      </div>
      <div>
        <h1 className="text-title leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1.5 text-muted">{description}</p>}
      </div>
      {children}
      <div className="flex justify-between text-sm text-faint">
        <span>{host}</span>
        <span>{t("version")}</span>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(auth)/sign-in/page.tsx
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getOptionalCtx } from "@/platform/auth/session";
import { AuthCard } from "../auth-card";
import { signInErrorKey } from "./errors";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getOptionalCtx()) redirect("/");
  const { error } = await searchParams;
  const t = await getTranslations("auth.signIn");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <SignInForm initialError={signInErrorKey(typeof error === "string" ? error : undefined)} />
    </AuthCard>
  );
}
```

```tsx
// src/app/(auth)/sign-in/sign-in-form.tsx
"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { authClient } from "@/platform/auth/client";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { type SignInErrorKey, signInErrorKey } from "./errors";

export function SignInForm({ initialError }: { initialError: SignInErrorKey | null }) {
  const t = useTranslations("auth");
  const common = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<SignInErrorKey | null>(initialError);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    const result = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (result.error) {
      setError(signInErrorKey(result.error.code ?? "generic"));
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-lg bg-neg-bg px-3 py-2 text-sm text-neg">
          {t(`errors.${error}`)}
        </p>
      )}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        icon={<KeyRound aria-hidden className="size-4" />}
        onClick={() =>
          authClient.signIn.social({ provider: OIDC_PROVIDER_ID, callbackURL: "/", errorCallbackURL: "/sign-in?error=oidc" })
        }
      >
        {t("signIn.authentik")}
      </Button>
      <div className="flex items-center gap-3 text-sm text-faint">
        <span className="h-px flex-1 bg-border" />
        <span>{common("or")}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={t("signIn.email")} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t("signIn.password")} htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {t("signIn.submit")}
        </Button>
        <Link href="/forgot-password" className="text-sm font-medium text-accent hover:underline">
          {t("signIn.forgot")}
        </Link>
      </form>
    </div>
  );
}
```

```tsx
// src/app/(auth)/forgot-password/page.tsx
import { getTranslations } from "next-intl/server";
import { AuthCard } from "../auth-card";
import { ForgotForm } from "./forgot-form";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgot");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <ForgotForm />
    </AuthCard>
  );
}
```

```tsx
// src/app/(auth)/forgot-password/forgot-form.tsx
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { authClient } from "@/platform/auth/client";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";

export function ForgotForm() {
  const t = useTranslations("auth");
  const [sent, setSent] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true); // same answer whether or not the address exists
  }

  return sent ? (
    <p role="status" className="text-muted">{t("forgot.sent")}</p>
  ) : (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field label={t("signIn.email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Button type="submit" variant="primary" className="w-full">
        {t("forgot.submit")}
      </Button>
      <Link href="/sign-in" className="text-sm font-medium text-accent hover:underline">
        {t("forgot.back")}
      </Link>
    </form>
  );
}
```

```tsx
// src/app/(auth)/reset-password/page.tsx
import { getTranslations } from "next-intl/server";
import { AuthCard } from "../auth-card";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  const t = await getTranslations("auth.reset");
  const valid = typeof token === "string" && !error;
  return (
    <AuthCard title={t("title")}>
      {valid ? <ResetForm token={token} /> : <p role="alert" className="text-neg">{t("invalid")}</p>}
    </AuthCard>
  );
}
```

```tsx
// src/app/(auth)/reset-password/reset-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { authClient } from "@/platform/auth/client";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth.reset");
  const router = useRouter();
  const [error, setError] = useState<"mismatch" | "hint" | "invalid" | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) return setError("mismatch");
    if (newPassword.length < 12) return setError("hint");
    const result = await authClient.resetPassword({ newPassword, token });
    if (result.error) return setError("invalid");
    router.push("/sign-in");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      {error && <p role="alert" className="text-sm text-neg">{t(error)}</p>}
      <Field label={t("newPassword")} htmlFor="password" hint={t("hint")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label={t("confirm")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" variant="primary" className="w-full">
        {t("submit")}
      </Button>
    </form>
  );
}
```

```ts
// src/app/(auth)/actions.ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/platform/auth/auth";
import { acceptInvitation, InvitationError } from "@/platform/auth/invitations";

export async function acceptInviteAction(
  token: string,
  input: { name: string; password: string; confirm: string },
): Promise<{ error: "invalid" | "email_taken" | "weak_password" | "mismatch" } | undefined> {
  if (input.password !== input.confirm) return { error: "mismatch" };
  let email: string;
  try {
    ({ email } = await acceptInvitation(getAuth(), { token, name: input.name, password: input.password }));
  } catch (error) {
    if (error instanceof InvitationError) return { error: error.reason };
    throw error;
  }
  await getAuth().api.signInEmail({ body: { email, password: input.password }, headers: await headers() });
  redirect("/");
}
```

```tsx
// src/app/(auth)/invite/[token]/page.tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { findInvitation } from "@/platform/auth/invitations";
import { AuthCard } from "../../auth-card";
import { InviteForm } from "./invite-form";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const t = await getTranslations("auth");
  const invitation = await findInvitation(token);
  if (!invitation) {
    return (
      <AuthCard title={t("invite.title")}>
        <p role="alert" className="text-neg">{t("invite.invalid")}</p>
        <Link href="/sign-in" className="text-sm font-medium text-accent hover:underline">{t("forgot.back")}</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("invite.title")} description={t("invite.description", { email: invitation.email })}>
      <InviteForm token={token} />
    </AuthCard>
  );
}
```

```tsx
// src/app/(auth)/invite/[token]/invite-form.tsx
"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { authClient } from "@/platform/auth/client";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { acceptInviteAction } from "../../actions";

const ERROR_KEY = {
  invalid: "invite.invalid",
  email_taken: "invite.emailTaken",
  weak_password: "reset.hint",
  mismatch: "reset.mismatch",
} as const;

export function InviteForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [error, setError] = useState<keyof typeof ERROR_KEY | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await acceptInviteAction(token, {
        name: String(form.get("name")),
        password: String(form.get("password")),
        confirm: String(form.get("confirm")),
      });
      if (result) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="text-sm text-neg">{t(ERROR_KEY[error])}</p>}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={t("invite.name")} htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        <Field label={t("signIn.password")} htmlFor="password" hint={t("reset.hint")}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field label={t("reset.confirm")} htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {t("invite.submit")}
        </Button>
      </form>
      <Button onClick={() => authClient.signIn.social({ provider: OIDC_PROVIDER_ID, callbackURL: "/" })} className="w-full">
        {t("invite.authentik")}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and build**

Run: `npx vitest run "src/app/(auth)" src/platform/i18n && npm run typecheck && npm run build`
Expected: PASS; the build lists `/sign-in`, `/forgot-password`, `/reset-password`, `/invite/[token]`.

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add "src/app/(auth)" messages
git commit -F - <<'EOF'
feat(auth): sign-in, forgot/reset password and invitation pages

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 18: Settings — Profile and Security

**Files:**
- Create: `src/ui/section.tsx`, `src/app/(app)/settings/layout.tsx`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/settings-tabs.tsx`, `src/app/(app)/settings/profile/page.tsx`, `src/app/(app)/settings/profile/preferences-form.tsx`, `src/app/(app)/settings/profile/name-form.tsx`, `src/app/(app)/settings/security/page.tsx`, `src/app/(app)/settings/security/password-form.tsx`, `src/app/(app)/settings/security/sessions-list.tsx`
- Modify: `src/modules/users/actions.ts` (the settings Server Actions), `src/modules/users/service.ts` (`findSessionToken`), `src/modules/users/rules.ts` (`describeUserAgent`), `messages/en.json`, `messages/it.json`
- Test: `src/modules/users/rules.test.ts` (extend), `src/modules/users/service.itest.ts` (extend), `src/app/(app)/settings/profile/preferences-form.test.tsx`

**Interfaces:**
- Consumes: `requireSession`, `getAuth`, `authClient`, `OIDC_PROVIDER_ID` (Task 9); `sessions` table (Task 8); `getPreferences`, `updatePreferences`, `Preferences`, `userScoped` (Task 8); `saveTheme` in `src/modules/users/actions.ts` (Task 16); `LOCALE_COOKIE` (Task 13); `THEME_COOKIE` (Task 13); UI (Tasks 14–16).
- Produces: routes `/settings` (→ `/settings/profile`), `/settings/profile`, `/settings/security`; `SettingsSection` (`title`, `description`, `children`); `describeUserAgent(ua: string | null): { browser: string | null; os: string | null }`; `findSessionToken(ctx: Pick<Ctx, "userId">, sessionId: string): Promise<string | null>` (`src/modules/users/service.ts`); Server Actions in `src/modules/users/actions.ts` (spec §3) next to `saveTheme`: `savePreferencesAction(input: Preferences)`, `updateNameAction(name: string)` (refused on the server while an Authentik account is linked, spec §5.1), `revokeSessionAction(sessionId: string)`, `revokeOtherSessionsAction()`. The browser receives session **ids** only; tokens never leave the server. The password change stays a client call to Better Auth (`authClient.changePassword`), not a Server Action.

- [ ] **Step 1: Add the messages**

`messages/en.json`:

```json
  "settings": {
    "title": "Settings",
    "tabs": { "profile": "Profile", "security": "Security" },
    "account": {
      "title": "Account",
      "description": "Your name and the address used for invitations and alerts.",
      "name": "Full name",
      "email": "Email",
      "ssoNote": "Name and email are managed by Authentik while SSO is linked.",
      "saved": "Account saved"
    },
    "preferences": {
      "title": "Preferences",
      "description": "How numbers, dates and the interface look for you.",
      "timeZone": "Timezone",
      "language": "Language",
      "languages": { "en": "English", "it": "Italiano" },
      "numberFormat": "Number format",
      "numberFormats": { "it-IT": "1.234,56 € (it-IT)", "en-US": "€1,234.56 (en-US)", "fr-FR": "1 234,56 € (fr-FR)" },
      "weekStart": "Week starts on",
      "weekStarts": { "monday": "Monday", "sunday": "Sunday" },
      "theme": "Theme",
      "themes": { "system": "System", "light": "Light", "dark": "Dark" },
      "defaultRange": "Default date range",
      "ranges": { "this_month": "This month", "last_30_days": "Last 30 days", "year_to_date": "Year to date" },
      "monthlySummary": "Email me the monthly summary",
      "hoursPerDay": "Working day (hours)",
      "patronSaint": "Patron saint holiday",
      "patronNone": "None",
      "saved": "Preferences saved"
    },
    "password": {
      "title": "Password",
      "description": "Used when you sign in without Authentik.",
      "current": "Current password",
      "new": "New password",
      "confirm": "Confirm new password",
      "submit": "Update password",
      "changed": "Password updated",
      "ssoOnly": "This account signs in with Authentik only; there is no password to change.",
      "failed": "The current password is wrong."
    },
    "sessions": {
      "title": "Sessions",
      "description": "Devices signed in to your account.",
      "thisDevice": "this device",
      "unknownDevice": "Unknown device",
      "signOut": "Sign out",
      "signOutOthers": "Sign out other sessions",
      "since": "since {date}"
    }
  }
```

`messages/it.json`:

```json
  "settings": {
    "title": "Impostazioni",
    "tabs": { "profile": "Profilo", "security": "Sicurezza" },
    "account": {
      "title": "Account",
      "description": "Il tuo nome e l'indirizzo usato per inviti e avvisi.",
      "name": "Nome e cognome",
      "email": "Email",
      "ssoNote": "Nome ed email sono gestiti da Authentik finché l'SSO è collegato.",
      "saved": "Account salvato"
    },
    "preferences": {
      "title": "Preferenze",
      "description": "Come appaiono numeri, date e interfaccia.",
      "timeZone": "Fuso orario",
      "language": "Lingua",
      "languages": { "en": "English", "it": "Italiano" },
      "numberFormat": "Formato dei numeri",
      "numberFormats": { "it-IT": "1.234,56 € (it-IT)", "en-US": "€1,234.56 (en-US)", "fr-FR": "1 234,56 € (fr-FR)" },
      "weekStart": "La settimana inizia di",
      "weekStarts": { "monday": "Lunedì", "sunday": "Domenica" },
      "theme": "Tema",
      "themes": { "system": "Sistema", "light": "Chiaro", "dark": "Scuro" },
      "defaultRange": "Intervallo predefinito",
      "ranges": { "this_month": "Questo mese", "last_30_days": "Ultimi 30 giorni", "year_to_date": "Da inizio anno" },
      "monthlySummary": "Inviami il riepilogo mensile via email",
      "hoursPerDay": "Giornata lavorativa (ore)",
      "patronSaint": "Festa del santo patrono",
      "patronNone": "Nessuna",
      "saved": "Preferenze salvate"
    },
    "password": {
      "title": "Password",
      "description": "Serve quando accedi senza Authentik.",
      "current": "Password attuale",
      "new": "Nuova password",
      "confirm": "Conferma la nuova password",
      "submit": "Aggiorna la password",
      "changed": "Password aggiornata",
      "ssoOnly": "Questo account accede solo con Authentik: non c'è una password da cambiare.",
      "failed": "La password attuale è errata."
    },
    "sessions": {
      "title": "Sessioni",
      "description": "I dispositivi collegati al tuo account.",
      "thisDevice": "questo dispositivo",
      "unknownDevice": "Dispositivo sconosciuto",
      "signOut": "Disconnetti",
      "signOutOthers": "Disconnetti le altre sessioni",
      "since": "dal {date}"
    }
  }
```

- [ ] **Step 2: Write the failing tests**

In `src/modules/users/rules.test.ts`, extend the existing top import (one import per module, never a second one below the tests) to:

```ts
import { DEFAULT_PREFERENCES, describeUserAgent, preferencesInputSchema } from "./rules";
```

and append:

```ts
describe("describeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      { browser: "Safari", os: "macOS" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      { browser: "Chrome", os: "Linux" },
    ],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1", { browser: "Safari", os: "iOS" }],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0", { browser: "Firefox", os: "Windows" }],
    [null, { browser: null, os: null }],
  ])("describes %s", (ua, expected) => {
    expect(describeUserAgent(ua)).toEqual(expected);
  });
});
```

```tsx
// src/app/(app)/settings/profile/preferences-form.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import { PreferencesForm } from "./preferences-form";

const save = vi.fn();
vi.mock("@/modules/users/actions", () => ({ savePreferencesAction: (...a: unknown[]) => save(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("PreferencesForm", () => {
  it("submits the edited preferences", async () => {
    save.mockResolvedValueOnce(undefined);
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <PreferencesForm initial={DEFAULT_PREFERENCES} timeZones={["Europe/Rome", "Europe/London"]} />
      </NextIntlClientProvider>,
    );
    await userEvent.selectOptions(screen.getByLabelText("Language"), "it");
    await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_PREFERENCES, locale: "it", theme: "dark" });
  });
});
```

Add to `src/modules/users/service.itest.ts` — merge these imports into its existing import block (the `./service` line replaces the existing one):

```ts
import { sessions } from "@/platform/auth/schema";
import { getDb } from "@/platform/db/client";
import { findSessionToken, getPreferences, updatePreferences } from "./service";
```

and this test inside `describe("preferences service", …)`, after the last one:

```ts
  it("finds a session token only for the session's owner", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const [session] = await getDb()
      .insert(sessions)
      .values({ userId: alice.id, token: "alice-session-token", expiresAt: new Date(Date.now() + 60_000) })
      .returning({ id: sessions.id });
    expect(await findSessionToken({ userId: alice.id }, session.id)).toBe("alice-session-token");
    expect(await findSessionToken({ userId: bob.id }, session.id)).toBeNull();
  });
```

Run: `npx vitest run src/modules/users "src/app/(app)/settings" && npm run test:integration -- src/modules/users/service.itest.ts` — Expected: FAIL (`describeUserAgent`, `findSessionToken` and the form do not exist yet).

- [ ] **Step 3: Write `describeUserAgent` and `findSessionToken`**

Append to `src/modules/users/rules.ts`:

```ts
/** A short, human label for a session's user agent (Settings › Security › Sessions). */
export function describeUserAgent(ua: string | null): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  const browser = /Firefox\//.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  return { browser, os };
}
```

Add to `src/modules/users/service.ts` (merge the imports into its import block):

```ts
import { and, eq } from "drizzle-orm";
import { sessions } from "@/platform/auth/schema";

/**
 * The token of one of the user's own sessions, or null. The Security page sends only session ids
 * to the browser; the revoke action resolves the token here, by id AND owner.
 */
export async function findSessionToken(ctx: Pick<Ctx, "userId">, sessionId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ token: sessions.token })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), userScoped(ctx).owns(sessions)));
  return row?.token ?? null;
}
```

- [ ] **Step 4: Write the section layout, tabs and pages**

```tsx
// src/ui/section.tsx
import type { ReactNode } from "react";
import { Card } from "./card";

/** Settings-style row: title and description on the left (4fr), the card on the right (8fr). */
export function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-3 border-t border-border pt-6 first:border-0 first:pt-2 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-muted">{description}</p>
      </div>
      <Card className="flex flex-col gap-4">{children}</Card>
    </section>
  );
}
```

```tsx
// src/app/(app)/settings/settings-tabs.tsx
"use client";

import type { Route } from "next";
import { usePathname } from "next/navigation";
import { TabLinks } from "@/ui/tab-links";

export function SettingsTabs({ tabs }: { tabs: { href: Route; label: string }[] }) {
  const pathname = usePathname();
  return <TabLinks tabs={tabs.map((tab) => ({ ...tab, active: pathname === tab.href }))} />;
}
```

```tsx
// src/app/(app)/settings/layout.tsx
import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { Page } from "@/ui/shell/page";
import { SettingsTabs } from "./settings-tabs";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const t = await getTranslations("settings");
  return (
    <Page title={t("title")}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:hidden">{t("title")}</h1>
      <SettingsTabs
        tabs={[
          { href: "/settings/profile" as Route, label: t("tabs.profile") },
          { href: "/settings/security" as Route, label: t("tabs.security") },
        ]}
      />
      {children}
    </Page>
  );
}
```

```tsx
// src/app/(app)/settings/page.tsx
import { redirect } from "next/navigation";

export default function SettingsIndex() {
  redirect("/settings/profile");
}
```

Replace `src/modules/users/actions.ts` (Task 16) with the complete file — `saveTheme` unchanged, the settings actions added:

```ts
// src/modules/users/actions.ts — the users module's Server Actions (spec §3): validate → service → revalidate.
"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/platform/auth/auth";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { requireSession } from "@/platform/auth/session";
import { LOCALE_COOKIE } from "@/platform/i18n/locales";
import { parseTheme, THEME_COOKIE, type ThemePreference } from "@/platform/theme";
import type { Preferences } from "./rules";
import { findSessionToken, getPreferences, updatePreferences } from "./service";

const YEAR = 60 * 60 * 24 * 365;

export async function saveTheme(theme: ThemePreference): Promise<void> {
  const ctx = await requireSession();
  const next = parseTheme(theme);
  await updatePreferences(ctx, { ...(await getPreferences(ctx)), theme: next });
  (await cookies()).set(THEME_COOKIE, next, { path: "/", maxAge: YEAR, sameSite: "lax" });
}

export async function savePreferencesAction(input: Preferences): Promise<void> {
  const ctx = await requireSession();
  const saved = await updatePreferences(ctx, input);
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, saved.locale, { path: "/", maxAge: YEAR, sameSite: "lax" });
  jar.set(THEME_COOKIE, saved.theme, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** With Authentik linked, name and email are managed by the provider (spec §5.1): refused here, not only in the UI. */
export async function updateNameAction(name: string): Promise<void> {
  await requireSession();
  const requestHeaders = await headers();
  const accounts = await getAuth().api.listUserAccounts({ headers: requestHeaders });
  if (accounts.some((account) => account.providerId === OIDC_PROVIDER_ID)) {
    throw new Error("The name is managed by Authentik while SSO is linked");
  }
  const parsed = z.string().trim().min(1).max(120).parse(name);
  await getAuth().api.updateUser({ body: { name: parsed }, headers: requestHeaders });
  revalidatePath("/", "layout");
}

/** Takes a session id from the browser; the token is looked up server-side, by id AND the caller's user id. */
export async function revokeSessionAction(sessionId: string): Promise<void> {
  const ctx = await requireSession();
  const token = await findSessionToken(ctx, z.uuid().parse(sessionId));
  if (!token) return;
  await getAuth().api.revokeSession({ body: { token }, headers: await headers() });
  revalidatePath("/settings/security");
}

export async function revokeOtherSessionsAction(): Promise<void> {
  await requireSession();
  await getAuth().api.revokeOtherSessions({ headers: await headers() });
  revalidatePath("/settings/security");
}
```

(The Save button is hidden while SSO is linked, so the refusal in `updateNameAction` is reached only by a forged request; it throws instead of returning a form error. A session id that is not the caller's resolves to no token, so nothing is revoked.)

```tsx
// src/app/(app)/settings/profile/preferences-form.tsx
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { savePreferencesAction } from "@/modules/users/actions";
import type { Preferences } from "@/modules/users/rules";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { notify } from "@/ui/toast";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function PreferencesForm({ initial, timeZones }: { initial: Preferences; timeZones: string[] }) {
  const t = useTranslations("settings.preferences");
  const common = useTranslations("common");
  const router = useRouter();
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setPrefs((p) => ({ ...p, [key]: value }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      await savePreferencesAction(prefs);
      notify(t("saved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      <Field label={t("timeZone")} htmlFor="timeZone">
        <Select id="timeZone" value={prefs.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
          {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </Select>
      </Field>
      <Field label={t("language")} htmlFor="language">
        <Select id="language" value={prefs.locale} onChange={(e) => set("locale", e.target.value as Preferences["locale"])}>
          <option value="en">{t("languages.en")}</option>
          <option value="it">{t("languages.it")}</option>
        </Select>
      </Field>
      <Field label={t("numberFormat")} htmlFor="numberFormat">
        <Select id="numberFormat" value={prefs.numberFormat} onChange={(e) => set("numberFormat", e.target.value as Preferences["numberFormat"])}>
          <option value="it-IT">{t("numberFormats.it-IT")}</option>
          <option value="en-US">{t("numberFormats.en-US")}</option>
          <option value="fr-FR">{t("numberFormats.fr-FR")}</option>
        </Select>
      </Field>
      <Field label={t("weekStart")} htmlFor="weekStart">
        <Select id="weekStart" value={prefs.weekStart} onChange={(e) => set("weekStart", e.target.value === "0" ? 0 : 1)}>
          <option value={1}>{t("weekStarts.monday")}</option>
          <option value={0}>{t("weekStarts.sunday")}</option>
        </Select>
      </Field>
      <Field label={t("theme")} htmlFor="theme">
        <Select id="theme" value={prefs.theme} onChange={(e) => set("theme", e.target.value as Preferences["theme"])}>
          <option value="system">{t("themes.system")}</option>
          <option value="light">{t("themes.light")}</option>
          <option value="dark">{t("themes.dark")}</option>
        </Select>
      </Field>
      <Field label={t("defaultRange")} htmlFor="defaultRange">
        <Select id="defaultRange" value={prefs.defaultRange} onChange={(e) => set("defaultRange", e.target.value as Preferences["defaultRange"])}>
          <option value="this_month">{t("ranges.this_month")}</option>
          <option value="last_30_days">{t("ranges.last_30_days")}</option>
          <option value="year_to_date">{t("ranges.year_to_date")}</option>
        </Select>
      </Field>
      <Field label={t("hoursPerDay")} htmlFor="hoursPerDay">
        <Input
          id="hoursPerDay"
          numeric
          type="number"
          min={1}
          max={12}
          step={0.25}
          value={prefs.minutesPerDay / 60}
          onChange={(e) => set("minutesPerDay", Math.round(Number(e.target.value) * 60))}
        />
      </Field>
      <Field label={t("patronSaint")} htmlFor="patronMonth">
        <div className="flex gap-2">
          <Select
            id="patronMonth"
            value={prefs.patronSaint?.month ?? ""}
            onChange={(e) => set("patronSaint", e.target.value ? { month: Number(e.target.value), day: prefs.patronSaint?.day ?? 1 } : null)}
          >
            <option value="">{t("patronNone")}</option>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Select
            aria-label={t("patronSaint")}
            disabled={!prefs.patronSaint}
            value={prefs.patronSaint?.day ?? ""}
            onChange={(e) => prefs.patronSaint && set("patronSaint", { month: prefs.patronSaint.month, day: Number(e.target.value) })}
          >
            {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>
      </Field>
      <Checkbox
        className="sm:col-span-2"
        label={t("monthlySummary")}
        checked={prefs.monthlySummary}
        onChange={(e) => set("monthlySummary", e.target.checked)}
      />
      <div className="flex justify-end border-t border-border pt-3 sm:col-span-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {common("save")}
        </Button>
      </div>
    </form>
  );
}
```

```tsx
// src/app/(app)/settings/profile/name-form.tsx
"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useTransition } from "react";
import { updateNameAction } from "@/modules/users/actions";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { notify } from "@/ui/toast";

export function NameForm({ name, email, sso }: { name: string; email: string; sso: boolean }) {
  const t = useTranslations("settings.account");
  const common = useTranslations("common");
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("name"));
    startTransition(async () => {
      await updateNameAction(value);
      notify(t("saved"));
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      <Field label={t("name")} htmlFor="name">
        <Input id="name" name="name" defaultValue={name} readOnly={sso} required />
      </Field>
      <Field label={t("email")} htmlFor="email">
        <Input id="email" value={email} readOnly />
      </Field>
      {sso ? (
        <p className="text-sm text-muted sm:col-span-2">{t("ssoNote")}</p>
      ) : (
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" variant="primary" size="sm" disabled={pending}>{common("save")}</Button>
        </div>
      )}
    </form>
  );
}
```

```tsx
// src/app/(app)/settings/profile/page.tsx
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { getPreferences } from "@/modules/users/service";
import { getAuth } from "@/platform/auth/auth";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { requireSession } from "@/platform/auth/session";
import { SettingsSection } from "@/ui/section";
import { NameForm } from "./name-form";
import { PreferencesForm } from "./preferences-form";

export default async function ProfilePage() {
  const ctx = await requireSession();
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const accounts = await getAuth().api.listUserAccounts({ headers: requestHeaders });
  const t = await getTranslations("settings");
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("account.title")} description={t("account.description")}>
        <NameForm
          name={session?.user.name ?? ""}
          email={session?.user.email ?? ""}
          sso={accounts.some((a) => a.providerId === OIDC_PROVIDER_ID)}
        />
      </SettingsSection>
      <SettingsSection title={t("preferences.title")} description={t("preferences.description")}>
        <PreferencesForm initial={await getPreferences(ctx)} timeZones={Intl.supportedValuesOf("timeZone")} />
      </SettingsSection>
    </div>
  );
}
```

```tsx
// src/app/(app)/settings/security/password-form.tsx
"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { authClient } from "@/platform/auth/client";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Input } from "@/ui/input";
import { notify } from "@/ui/toast";

export function PasswordForm() {
  const t = useTranslations("settings.password");
  const auth = useTranslations("auth.reset");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get("new"));
    if (newPassword !== String(form.get("confirm"))) return setError(auth("mismatch"));
    if (newPassword.length < 12) return setError(auth("hint"));
    const result = await authClient.changePassword({
      currentPassword: String(form.get("current")),
      newPassword,
      revokeOtherSessions: true,
    });
    if (result.error) return setError(t("failed"));
    setError(null);
    formElement.reset();
    notify(t("changed"));
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {error && <p role="alert" className="text-sm text-neg sm:col-span-2">{error}</p>}
      <Field label={t("current")} htmlFor="current">
        <Input id="current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <div className="max-sm:hidden" />
      <Field label={t("new")} htmlFor="new" hint={auth("hint")}>
        <Input id="new" name="new" type="password" autoComplete="new-password" required />
      </Field>
      <Field label={t("confirm")} htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" variant="primary" size="sm">{t("submit")}</Button>
      </div>
    </form>
  );
}
```

```tsx
// src/app/(app)/settings/security/sessions-list.tsx
"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/modules/users/actions";
import { Button } from "@/ui/button";

/** What the browser gets per session: an id, never the bearer token. */
export interface SessionRow {
  id: string;
  device: string;
  detail: string;
  current: boolean;
}

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const t = useTranslations("settings.sessions");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col">
      {sessions.map((session) => (
        <div key={session.id} className="grid grid-cols-[1fr_auto] items-center gap-6 border-b border-border py-2 last:border-0">
          <div>
            <div className="font-medium">{session.device}</div>
            <div className="text-sm text-muted">
              {session.detail}
              {session.current && ` · ${t("thisDevice")}`}
            </div>
          </div>
          {!session.current && (
            <Button size="xs" variant="danger" disabled={pending} onClick={() => startTransition(() => revokeSessionAction(session.id))}>
              {t("signOut")}
            </Button>
          )}
        </div>
      ))}
      {sessions.length > 1 && (
        <div className="flex justify-end pt-3">
          <Button size="sm" variant="danger" disabled={pending} onClick={() => startTransition(() => revokeOtherSessionsAction())}>
            {t("signOutOthers")}
          </Button>
        </div>
      )}
    </div>
  );
}
```

```tsx
// src/app/(app)/settings/security/page.tsx
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { describeUserAgent } from "@/modules/users/rules";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { SettingsSection } from "@/ui/section";
import { PasswordForm } from "./password-form";
import { type SessionRow, SessionsList } from "./sessions-list";

export default async function SecurityPage() {
  const ctx = await requireSession();
  const requestHeaders = await headers();
  const auth = getAuth();
  const current = await auth.api.getSession({ headers: requestHeaders });
  const sessions = await auth.api.listSessions({ headers: requestHeaders });
  const accounts = await auth.api.listUserAccounts({ headers: requestHeaders });
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const t = await getTranslations("settings");

  const rows: SessionRow[] = [...sessions]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((session) => {
      const { browser, os } = describeUserAgent(session.userAgent ?? null);
      const date = formatDate(civilDateIn(session.createdAt, ctx.timeZone), "long", ctx.locale);
      return {
        id: session.id,
        device: browser && os ? `${browser} · ${os}` : t("sessions.unknownDevice"),
        detail: [session.ipAddress, t("sessions.since", { date })].filter(Boolean).join(" · "),
        current: session.id === current?.session.id,
      };
    });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("password.title")} description={t("password.description")}>
        {hasPassword ? <PasswordForm /> : <p className="text-muted">{t("password.ssoOnly")}</p>}
      </SettingsSection>
      <SettingsSection title={t("sessions.title")} description={t("sessions.description")}>
        <SessionsList sessions={rows} />
      </SettingsSection>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests and build**

Run: `npm test && npm run test:integration && npm run typecheck && npm run build`
Expected: PASS, including the session-token ownership test; the build lists `/settings`, `/settings/profile`, `/settings/security`. `grep -rn "token" "src/app/(app)/settings/security"` shows no session token reaching `sessions-list.tsx` or its props.

- [ ] **Step 6: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add src/ui/section.tsx "src/app/(app)/settings" src/modules/users messages
git commit -F - <<'EOF'
feat(settings): profile with preferences and name, security with password and sessions

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 19: Overview placeholder and the Components page

**Files:**
- Delete: `src/app/page.tsx`
- Create: `src/app/(app)/page.tsx`, `src/app/(app)/components/page.tsx`, `src/app/(app)/components/gallery.tsx`
- Modify: `messages/en.json`, `messages/it.json`
- Test: `src/app/(app)/components/gallery.test.tsx`

**Interfaces:**
- Consumes: `requireSession`, `requireAdmin` (Task 9); every `src/ui` component (Tasks 14–15, including `CardHeader`, `Field`, `Avatar`, `Kbd`, `TabLinks`, `GroupRow`, `TotalRow`, `LoadingState`) and `Page` (Task 16); `common.retry` (Task 13); `formatMoney` (Task 5).
- Produces: `/` (Overview empty state until F1) and `/components` (Admin only; 404 for users).

- [ ] **Step 1: Add the messages**

`messages/en.json`:

```json
  "overview": {
    "title": "Overview",
    "empty": {
      "title": "No data yet",
      "description": "Accounts, balances and net worth appear here once the first account exists.",
      "cta": "Open Settings"
    }
  },
  "gallery": {
    "title": "Components",
    "colours": "Colour tokens",
    "type": "Type scale",
    "buttons": "Buttons",
    "inputs": "Inputs",
    "controls": "Segmented control and tabs",
    "badges": "Badges and tags",
    "table": "Table",
    "stats": "KPI, progress and skeleton",
    "identity": "Avatars and shortcuts",
    "overlays": "Overlays",
    "states": "Page states",
    "sample": {
      "primary": "Primary",
      "secondary": "Secondary",
      "ghost": "Ghost",
      "danger": "Delete",
      "disabled": "Disabled",
      "placeholder": "Search merchant…",
      "invalid": "Invalid value",
      "fieldLabel": "Monthly limit",
      "fieldHint": "Close to the account's balance",
      "fieldError": "Required",
      "cardTitle": "Recent expenses",
      "tabActive": "Profile",
      "tabOther": "Security",
      "month": "Month",
      "year": "Year",
      "openModal": "Open modal",
      "modalTitle": "Add to pocket",
      "modalBody": "Earmarks part of a savings account. No money is moved.",
      "toast": "Show toast",
      "toastMessage": "Balance entry saved — history updated",
      "menu": "Row actions",
      "edit": "Edit",
      "popover": "Filter",
      "popoverBody": "Popover content",
      "emptyTitle": "No expenses in this range",
      "emptyDescription": "Try widening the date range or clearing filters.",
      "errorTitle": "Could not load expenses",
      "errorDescription": "The server did not answer. Your data is safe."
    }
  }
```

`messages/it.json`:

```json
  "overview": {
    "title": "Panoramica",
    "empty": {
      "title": "Ancora nessun dato",
      "description": "Conti, saldi e patrimonio compaiono qui dopo aver creato il primo conto.",
      "cta": "Apri le impostazioni"
    }
  },
  "gallery": {
    "title": "Componenti",
    "colours": "Colori",
    "type": "Scala tipografica",
    "buttons": "Pulsanti",
    "inputs": "Campi",
    "controls": "Controllo segmentato e schede",
    "badges": "Badge ed etichette",
    "table": "Tabella",
    "stats": "KPI, avanzamento e scheletro",
    "identity": "Avatar e scorciatoie",
    "overlays": "Sovrapposizioni",
    "states": "Stati della pagina",
    "sample": {
      "primary": "Primario",
      "secondary": "Secondario",
      "ghost": "Discreto",
      "danger": "Elimina",
      "disabled": "Disattivato",
      "placeholder": "Cerca esercente…",
      "invalid": "Valore non valido",
      "fieldLabel": "Limite mensile",
      "fieldHint": "Vicino al saldo del conto",
      "fieldError": "Obbligatorio",
      "cardTitle": "Spese recenti",
      "tabActive": "Profilo",
      "tabOther": "Sicurezza",
      "month": "Mese",
      "year": "Anno",
      "openModal": "Apri finestra",
      "modalTitle": "Aggiungi al pocket",
      "modalBody": "Accantona parte di un conto di risparmio. Il denaro non si sposta.",
      "toast": "Mostra notifica",
      "toastMessage": "Saldo salvato — storico aggiornato",
      "menu": "Azioni riga",
      "edit": "Modifica",
      "popover": "Filtro",
      "popoverBody": "Contenuto del popover",
      "emptyTitle": "Nessuna spesa in questo intervallo",
      "emptyDescription": "Prova ad allargare l'intervallo o a togliere i filtri.",
      "errorTitle": "Impossibile caricare le spese",
      "errorDescription": "Il server non ha risposto. I tuoi dati sono al sicuro."
    }
  }
```

- [ ] **Step 2: Write the failing smoke test**

```tsx
// src/app/(app)/components/gallery.test.tsx
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../../messages/en.json";
import { Gallery } from "./gallery";

describe("Gallery", () => {
  it("shows every section of the design system", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <Gallery />
      </NextIntlClientProvider>,
    );
    for (const title of [
      "Colour tokens",
      "Type scale",
      "Buttons",
      "Inputs",
      "Segmented control and tabs",
      "Badges and tags",
      "Table",
      "KPI, progress and skeleton",
      "Avatars and shortcuts",
      "Overlays",
      "Page states",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });

  it("shows the components no product page uses yet", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
        <Gallery />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Recent expenses" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Monthly limit")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
```

Run: `npx vitest run "src/app/(app)/components"` — Expected: FAIL.

- [ ] **Step 3: Write the pages**

```tsx
// src/app/(app)/page.tsx
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/platform/auth/session";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";

export default async function OverviewPage() {
  await requireSession();
  const t = await getTranslations("overview");
  return (
    <Page title={t("title")}>
      <h1 className="text-title font-semibold tracking-[-0.02em] max-md:hidden">{t("title")}</h1>
      <EmptyState
        title={t("empty.title")}
        description={t("empty.description")}
        actions={
          <Link href="/settings/profile" className="inline-flex h-8 items-center rounded-ctl border border-primary bg-primary px-3 font-medium text-primary-fg hover:brightness-[1.08]">
            {t("empty.cta")}
          </Link>
        }
      />
    </Page>
  );
}
```

```tsx
// src/app/(app)/components/page.tsx
import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/platform/auth/session";
import { Page } from "@/ui/shell/page";
import { Gallery } from "./gallery";

export default async function ComponentsPage() {
  await requireAdmin();
  const t = await getTranslations("gallery");
  return (
    <Page title={t("title")}>
      <Gallery />
    </Page>
  );
}
```

```tsx
// src/app/(app)/components/gallery.tsx
"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { formatMoney } from "@/platform/format";
import { Avatar } from "@/ui/avatar";
import { Badge, Tag } from "@/ui/badge";
import { Button, IconButton, LinkButton } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { Field } from "@/ui/field";
import { Checkbox, Input, InputGroup, Select } from "@/ui/input";
import { Kbd } from "@/ui/kbd";
import { KpiTile } from "@/ui/kpi-tile";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { Popover } from "@/ui/popover";
import { ProgressBar } from "@/ui/progress-bar";
import { Segmented } from "@/ui/segmented";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { TabLinks } from "@/ui/tab-links";
import { GroupRow, Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";

const TOKENS = ["bg", "card", "hover", "sel", "fg", "muted", "border", "primary", "pos", "neg", "warn", "soft"] as const;
const TYPE_SCALE = [
  ["text-display", "36"],
  ["text-hero", "32"],
  ["text-title", "24"],
  ["text-kpi", "22"],
  ["text-lg", "15"],
  ["text-base", "13"],
  ["text-sm", "12"],
  ["text-xs", "11"],
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

export function Gallery() {
  const t = useTranslations("gallery");
  const common = useTranslations("common");
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [modalOpen, setModalOpen] = useState(false);
  const [sort, setSort] = useState<"asc" | "desc">("desc");

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Section title={t("colours")}>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {TOKENS.map((token) => (
            <div key={token} className="flex flex-col gap-1 text-xs text-muted">
              <span className="h-8 rounded-ctl border border-border" style={{ background: `var(--${token})` }} />
              {token}
            </div>
          ))}
        </div>
      </Section>
      <Section title={t("type")}>
        {TYPE_SCALE.map(([className, size]) => (
          <div key={className} className="flex items-baseline justify-between gap-4">
            <span className={`${className} truncate font-semibold`}>{formatMoney(5907712n, "it-IT")}</span>
            <span className="text-sm text-faint">{size}px</span>
          </div>
        ))}
      </Section>
      <Section title={t("buttons")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">{t("sample.primary")}</Button>
          <Button>{t("sample.secondary")}</Button>
          <Button variant="ghost">{t("sample.ghost")}</Button>
          <Button variant="danger">{t("sample.danger")}</Button>
          <Button disabled>{t("sample.disabled")}</Button>
          <Button size="sm" variant="primary">{t("sample.primary")}</Button>
          <Button size="xs">{t("sample.secondary")}</Button>
          <IconButton label={t("sample.menu")} bordered>…</IconButton>
          <LinkButton>{t("sample.edit")}</LinkButton>
        </div>
      </Section>
      <Section title={t("inputs")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input placeholder={t("sample.placeholder")} aria-label={t("sample.placeholder")} />
          <InputGroup suffix="€">
            <Input numeric defaultValue="1.234,56" aria-label="EUR" />
          </InputGroup>
          <Field label={t("sample.fieldLabel")} htmlFor="gallery-warning" hint={t("sample.fieldHint")}>
            <Input id="gallery-warning" numeric warning defaultValue="4.900,00" />
          </Field>
          <Field label={t("sample.invalid")} htmlFor="gallery-invalid" error={t("sample.fieldError")}>
            <Input id="gallery-invalid" invalid defaultValue="12,3,4" />
          </Field>
          <Select aria-label={t("sample.month")} defaultValue="month">
            <option value="month">{t("sample.month")}</option>
            <option value="year">{t("sample.year")}</option>
          </Select>
          <Checkbox label={t("sample.primary")} defaultChecked />
        </div>
      </Section>
      <Section title={t("controls")}>
        <Segmented
          label={t("controls")}
          value={period}
          onChange={setPeriod}
          options={[
            { value: "month", label: t("sample.month") },
            { value: "year", label: t("sample.year") },
          ]}
        />
        <TabLinks
          tabs={[
            { href: "/settings/profile" as Route, label: t("sample.tabActive"), active: true },
            { href: "/settings/security" as Route, label: t("sample.tabOther"), active: false },
          ]}
        />
      </Section>
      <Section title={t("badges")}>
        <div className="flex flex-wrap gap-2">
          <Badge tone="pos">On track</Badge>
          <Badge tone="warn">Near limit</Badge>
          <Badge tone="neg">Over</Badge>
          <Badge tone="accent">13ª</Badge>
          <Badge tone="neutral">Manual</Badge>
          <Tag>Spesa</Tag>
        </div>
      </Section>
      <Section title={t("table")}>
        <Card padded={false} className="overflow-hidden">
          <CardHeader title={t("sample.cardTitle")} actions={<LinkButton>{t("sample.edit")}</LinkButton>} />
          <Table>
            <THead>
              <Th sort={{ direction: sort, onSort: () => setSort(sort === "asc" ? "desc" : "asc") }}>Date</Th>
              <Th>Merchant</Th>
              <Th align="right">Amount</Th>
            </THead>
            <TBody>
              <GroupRow colSpan={3} label="September 2026" summary={formatMoney(202888n, "it-IT", { signed: true })} />
              <Tr>
                <Td muted>10 Sep</Td>
                <Td>Esselunga</Td>
                <Td align="right" className="text-neg">{formatMoney(-6412n, "it-IT")}</Td>
              </Tr>
              <Tr selected>
                <Td muted>09 Sep</Td>
                <Td>Reply S.p.A.</Td>
                <Td align="right" className="text-pos">{formatMoney(209300n, "it-IT", { signed: true })}</Td>
              </Tr>
              <TotalRow>
                <Td>Total</Td>
                <Td />
                <Td align="right">{formatMoney(202888n, "it-IT", { signed: true })}</Td>
              </TotalRow>
            </TBody>
          </Table>
        </Card>
      </Section>
      <Section title={t("stats")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiTile label="Cash" value={formatMoney(713595n, "it-IT")} delta={formatMoney(12000n, "it-IT", { signed: true })} deltaTone="pos" note="2 accounts" />
          <div className="flex flex-col justify-center gap-3">
            <ProgressBar value={0.78} label="78 %" />
            <ProgressBar value={0.9} tone="warn" label="90 %" />
            <ProgressBar value={1} tone="neg" label="112 %" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </Section>
      <Section title={t("identity")}>
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name="Mattia Longobardo" size={22} />
          <Avatar name="Mattia Longobardo" size={24} />
          <Avatar name="Giulia Rossi" size={28} />
          <Avatar name="Giulia Rossi" size={40} />
          <Kbd>⌘K</Kbd>
          <Kbd>esc</Kbd>
        </div>
      </Section>
      <Section title={t("overlays")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setModalOpen(true)}>{t("sample.openModal")}</Button>
          <Button onClick={() => notify(t("sample.toastMessage"))}>{t("sample.toast")}</Button>
          <ActionMenu label={t("sample.menu")} items={[{ label: t("sample.edit"), onSelect: () => notify(t("sample.edit")) }]} />
          <Popover trigger={t("sample.popover")} triggerLabel={t("sample.popover")}>
            <p className="p-2 text-sm">{t("sample.popoverBody")}</p>
          </Popover>
        </div>
        <Modal
          open={modalOpen}
          onOpenChange={setModalOpen}
          title={t("sample.modalTitle")}
          description={t("sample.modalBody")}
          footer={<Button onClick={() => setModalOpen(false)}>{t("sample.secondary")}</Button>}
        >
          <InputGroup suffix="€">
            <Input numeric defaultValue="500,00" aria-label="EUR" />
          </InputGroup>
        </Modal>
      </Section>
      <Section title={t("states")}>
        <EmptyState title={t("sample.emptyTitle")} description={t("sample.emptyDescription")} />
        <ErrorState
          title={t("sample.errorTitle")}
          description={t("sample.errorDescription")}
          onRetry={() => notify(common("retry"))}
          retryLabel={common("retry")}
        />
        <LoadingState />
      </Section>
    </div>
  );
}
```

The sample figures, names and badge words ("On track", "Esselunga", "Cash", "September 2026", the avatar names, the `Kbd` glyphs) are demo data rendered by an Admin-only developer page, not product copy; they intentionally stay literal. The page is the design-system catalogue (spec §8.3): every export of `src/ui` appears in it — including `CardHeader`, `Field` (hint and error), `Input` (warning and invalid), `TabLinks`, `GroupRow`, `TotalRow`, `Avatar` (every size), `Kbd` and `LoadingState` — and a component added to `src/ui` later is added here in the same task.

- [ ] **Step 4: Run tests and build**

Run: `git rm src/app/page.tsx && npm test && npm run typecheck && npm run build`
Expected: PASS; `/` is served by `(app)/page.tsx`, `/components` exists.

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add "src/app/(app)/page.tsx" "src/app/(app)/components" messages
git commit -F - <<'EOF'
feat(ui): Overview empty state and the Admin-only Components page

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 20: Docker images

**Files:**
- Create: `Dockerfile`, `entrypoint.sh`, `.dockerignore`, `cron/Dockerfile`, `cron/crontab`

**Interfaces:**
- Consumes: `scripts/migrate.ts` (Task 7), the standalone build (Task 1), `/api/health` (Task 12), `/api/jobs/tick` (Task 12).
- Produces: image `finance-dashboard` (runs migrations, then `node server.js` on port 3000, non-root, works with a read-only root filesystem) and image `finance-dashboard-cron` (supercronic calling the three tiers on the Europe/Rome clock). No production compose file (spec §3).

- [ ] **Step 1: Write the app image**

This block is the `Dockerfile`; its parser directive must stay on line 1 (a directive after any other line is a plain comment).

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public && npm run build
RUN ./node_modules/.bin/esbuild scripts/migrate.ts --bundle --platform=node --format=esm --target=node22 \
      --external:pg-native \
      --banner:js="import{createRequire}from'node:module';const require=createRequire(import.meta.url);" \
      --outfile=migrate.mjs

FROM node:22-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/migrate.mjs ./migrate.mjs
COPY --chown=1000:1000 drizzle ./drizzle
COPY --chown=1000:1000 entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh && mkdir -p .next/cache && chown -R 1000:1000 .next
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
```

```sh
#!/bin/sh
# entrypoint.sh — apply migrations, then serve. Arguments run instead (e.g. `node /app/migrate.mjs`).
set -e
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
node /app/migrate.mjs
exec node /app/server.js
```

```
# .dockerignore
.git
node_modules
.next
.vitest
coverage
test-results
playwright-report
docs
dev
cron
.env
.env.*
!.env.example
Fondo Cometa
Payroll
UI Recreation and branding decisions
```

`test/` and `tests/` stay in the build context: `next build` type-checks the whole tsconfig program, and `src/**/*.itest.ts`, the jest-dom matcher types (`test/setup-dom.ts`), `playwright.config.ts` and `scripts/seed-e2e.ts` import from them. They never reach the runner stage, which copies only the standalone output.

- [ ] **Step 2: Write the cron image**

```dockerfile
# cron/Dockerfile
FROM alpine:3.21

# supercronic publishes no pullable image; the release binary is vendored with a pinned checksum.
ARG SUPERCRONIC_VERSION=v0.2.33
ARG SUPERCRONIC_SHA256=feefa310da569c81b99e1027b86b27b51e6ee9ab647747b49099645120cfc671
# The schedule is Europe/Rome (spec §10.2); supercronic reads TZ, tzdata provides the zone.
ENV TZ=Europe/Rome
RUN apk add --no-cache curl ca-certificates tzdata \
 && curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
 && echo "${SUPERCRONIC_SHA256}  /usr/local/bin/supercronic" | sha256sum -c - \
 && chmod +x /usr/local/bin/supercronic

COPY crontab /etc/crontab
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/supercronic", "-passthrough-logs", "/etc/crontab"]
```

```
# cron/crontab — times are Europe/Rome (ENV TZ in cron/Dockerfile). Spec §10.2.
7 * * * *  curl -fsS --max-time 600 -H "X-Cron-Secret: ${CRON_SECRET}" -X POST "http://dashboard-app:3000/api/jobs/tick?tier=hourly"
0 12 * * * curl -fsS --retry 3 --max-time 600 -H "X-Cron-Secret: ${CRON_SECRET}" -X POST "http://dashboard-app:3000/api/jobs/tick?tier=daily"
5 0 1 * *  curl -fsS --retry 3 --max-time 600 -H "X-Cron-Secret: ${CRON_SECRET}" -X POST "http://dashboard-app:3000/api/jobs/tick?tier=monthly"
```

- [ ] **Step 3: Build both images**

Run: `docker build -t finance-dashboard:dev . && docker build -t finance-dashboard-cron:dev cron`
Expected: both succeed; the cron build prints `/usr/local/bin/supercronic: OK` (checksum verified).

- [ ] **Step 4: Smoke-test the app image hardened like production**

```bash
docker run --rm -d --name finance-smoke --network host --read-only \
  --tmpfs /tmp --tmpfs /app/.next/cache --cap-drop ALL --security-opt no-new-privileges \
  -e PORT=3200 \
  -e DATABASE_URL=postgres://finance:finance@127.0.0.1:55432/finance_dev \
  -e BETTER_AUTH_URL=http://127.0.0.1:3200 -e BETTER_AUTH_SECRET=smoke-secret-smoke-secret-smoke-secret \
  -e OIDC_DISCOVERY_URL=http://127.0.0.1:58090/default/.well-known/openid-configuration \
  -e OIDC_CLIENT_ID=finance -e OIDC_CLIENT_SECRET=finance-dev \
  -e SMTP_HOST=127.0.0.1 -e SMTP_PORT=51025 -e "MAIL_FROM=Finance <finance@example.test>" \
  -e S3_ENDPOINT=http://127.0.0.1:59000 -e S3_ACCESS_KEY_ID=finance -e S3_SECRET_ACCESS_KEY=finance-dev-secret -e S3_BUCKET=finance-dev \
  -e CRON_SECRET=smoke-cron-secret-000 \
  finance-dashboard:dev
sleep 5
curl -fsS http://127.0.0.1:3200/api/health
curl -sI http://127.0.0.1:3200/ | grep -iE "^(HTTP|location|content-security-policy)"
curl -fsS -H "X-Cron-Secret: smoke-cron-secret-000" -X POST "http://127.0.0.1:3200/api/jobs/tick?tier=daily"
docker logs finance-smoke | head -20
docker stop finance-smoke
```

Expected: health `{"status":"ok","db":"up","heartbeat":"absent"}`; `/` answers `307` with `location: /sign-in` **and** a `content-security-policy` header (this proves `src/proxy.ts` runs under `output: standalone`; if the logs show "The Proxy file must export a function", apply the fallback described in Task 9); the tick returns `{"tier":"daily","outcomes":[{"job":"housekeeping","status":"success"}]}`; the logs show `[migrate] schema is up to date`.

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add Dockerfile entrypoint.sh .dockerignore cron
git commit -F - <<'EOF'
chore(docker): hardened app image with boot migrations and the supercronic sidecar image

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 21: End-to-end tests (desktop and mobile)

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/env.ts`, `tests/e2e/serve.sh`, `tests/e2e/global-setup.ts`, `tests/e2e/helpers.ts`, `scripts/seed-e2e.ts`, `tests/e2e/auth.spec.ts`, `tests/e2e/oidc.spec.ts`, `tests/e2e/invite.spec.ts`, `tests/e2e/reset.spec.ts`, `tests/e2e/preferences.spec.ts`, `tests/e2e/mobile.spec.ts`
- Modify: `package.json` (script `e2e`), `.gitignore` (`tests/e2e/.state/`)

**Interfaces:**
- Consumes: everything above; `createAuth`, `createInvitation` (Tasks 9–10); `ensureBucket` (Task 11); `truncateAllTables` from `test/truncate.ts` (Task 7) and `clearMailbox`, `waitForMail` from `test/mailpit.ts` (Task 10). Both files import nothing from `src/`, so Playwright loads them directly; never import `test/db.ts` from Playwright code — it pulls in the app's `server-only` database client, which throws outside React Server Components.
- Produces: `npm run e2e` — builds, starts the standalone server on `127.0.0.1:3100` against `finance_e2e`, seeds users, runs the desktop (1440×900) and mobile (400×860) projects.

- [ ] **Step 1: Write the shared environment, server script and config**

```ts
// tests/e2e/env.ts — one environment for the e2e server, the seed and the specs.
export const E2E_PORT = 3100;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export const USERS = {
  owner: { email: "owner@example.test", password: "owner-password-123", name: "Owner" },
  prefs: { email: "prefs@example.test", password: "prefs-password-123", name: "Prefs" },
  reset: { email: "reset@example.test", password: "reset-password-123", name: "Reset" },
} as const;

export const E2E_ENV: Record<string, string> = {
  PORT: String(E2E_PORT),
  HOSTNAME: "127.0.0.1",
  DATABASE_URL: "postgres://finance:finance@127.0.0.1:55432/finance_e2e",
  BETTER_AUTH_URL: BASE_URL,
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
  OIDC_DISCOVERY_URL: "http://127.0.0.1:58090/default/.well-known/openid-configuration",
  OIDC_CLIENT_ID: "finance",
  OIDC_CLIENT_SECRET: "finance-dev",
  OIDC_ADMIN_GROUP: "finance-admins",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "51025",
  MAIL_FROM: "Finance Dashboard <finance@example.test>",
  S3_ENDPOINT: "http://127.0.0.1:59000",
  S3_ACCESS_KEY_ID: "finance",
  S3_SECRET_ACCESS_KEY: "finance-dev-secret",
  S3_BUCKET: "finance-e2e",
  CRON_SECRET: "e2e-cron-secret-000000",
};
```

```sh
#!/bin/sh
# tests/e2e/serve.sh — migrate the e2e database and run the standalone build (run `npm run build` first).
set -e
node --conditions=react-server --import tsx scripts/migrate.ts
mkdir -p public .next/standalone/.next
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
exec node .next/standalone/server.js
```

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, E2E_ENV } from "./tests/e2e/env";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: BASE_URL, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en-US", timezoneId: "Europe/Rome" },
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: "sh tests/e2e/serve.sh",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: E2E_ENV,
  },
});
```

Script: `"e2e": "npm run build && playwright test"`. First run only: `npx playwright install chromium`. Add `tests/e2e/.state/` to `.gitignore`.

- [ ] **Step 2: Write the seed and global setup**

```ts
// scripts/seed-e2e.ts — runs after the e2e server has migrated the database.
import { mkdirSync, writeFileSync } from "node:fs";
import { createAuth } from "../src/platform/auth/auth";
import { createInvitation } from "../src/platform/auth/invitations";
import { ensureBucket } from "../src/platform/storage";
import { USERS } from "../tests/e2e/env";

const auth = createAuth({ withNextCookies: false });
for (const user of [USERS.owner, USERS.prefs, USERS.reset]) {
  await auth.api.createUser({ body: user });
}
await ensureBucket();
const { token } = await createInvitation({ email: "invitee@example.test", role: "user", invitedBy: null });
mkdirSync("tests/e2e/.state", { recursive: true });
writeFileSync("tests/e2e/.state/invite-token", token);
process.exit(0);
```

```ts
// tests/e2e/global-setup.ts
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { clearMailbox } from "../../test/mailpit";
import { truncateAllTables } from "../../test/truncate";
import { E2E_ENV } from "./env";

export default async function globalSetup(): Promise<void> {
  const pool = new Pool({ connectionString: E2E_ENV.DATABASE_URL, max: 1 });
  try {
    await truncateAllTables(pool);
  } finally {
    await pool.end();
  }
  await clearMailbox();
  execFileSync("node", ["--conditions=react-server", "--import", "tsx", "scripts/seed-e2e.ts"], {
    stdio: "inherit",
    env: { ...process.env, ...E2E_ENV },
  });
}
```

```ts
// tests/e2e/helpers.ts
import { expect, type Page } from "@playwright/test";

export async function signInWithPassword(page: Page, email: string, password: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/");
}

/** The mock provider's login form (compose.dev.yml `oidc`). The only place that knows its markup. */
export async function signInWithOidc(page: Page, subject: string) {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue with Authentik" }).click();
  await page.locator('input[name="username"]').fill(subject);
  await page.locator('input[type="submit"], button[type="submit"]').first().click();
  await expect(page).toHaveURL("/");
}
```

Mail is read with `waitForMail` from `test/mailpit.ts` (Task 10), which already points at the dev Mailpit (`MAILPIT_URL` or `http://127.0.0.1:58025`); the e2e code keeps no second copy of the Mailpit client or its URL.

If `signInWithOidc` cannot find the form, open `http://127.0.0.1:58090/default/debugger` once, read the login page's markup and fix the two selectors in this helper only. If the ID token lacks `groups` or fails nonce validation, check the mock's response in its debugger before touching the auth config.

- [ ] **Step 3: Write the specs**

```ts
// tests/e2e/auth.spec.ts
import { expect, test } from "@playwright/test";
import { USERS } from "./env";
import { signInWithPassword } from "./helpers";

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/settings/profile");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a wrong password is refused with a message", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(USERS.owner.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong email or password.");
});

test("the first user is admin, reaches the app and signs out", async ({ page }) => {
  await signInWithPassword(page, USERS.owner.email, USERS.owner.password);
  await expect(page.getByRole("heading", { name: "No data yet" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Components" })).toBeVisible();
  await page.goto("/components");
  await expect(page.getByRole("heading", { name: "Colour tokens" })).toBeVisible();
  await nav.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});
```

```ts
// tests/e2e/oidc.spec.ts
import { expect, test } from "@playwright/test";
import { signInWithOidc } from "./helpers";

test("an Authentik admin-group member becomes admin on sign-in", async ({ page }) => {
  await signInWithOidc(page, "admin@example.test");
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Components" })).toBeVisible();
});

test("other Authentik users are plain users", async ({ page }) => {
  await signInWithOidc(page, "someone@example.test");
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Components" })).toHaveCount(0);
  const response = await page.goto("/components");
  expect(response?.status()).toBe(404);
});
```

```ts
// tests/e2e/invite.spec.ts
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("an invitation creates the account and signs the invitee in", async ({ page }) => {
  const token = readFileSync("tests/e2e/.state/invite-token", "utf8");
  await page.goto(`/invite/${token}`);
  await expect(page.getByText("Invited as invitee@example.test.")).toBeVisible();
  await page.getByLabel("Full name").fill("Invitee Person");
  await page.getByLabel("Password", { exact: true }).fill("invitee-password-1");
  await page.getByLabel("Confirm new password").fill("invitee-password-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL("/");
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("alert")).toContainText("invalid, expired or already used");
});
```

```ts
// tests/e2e/reset.spec.ts
import { expect, test } from "@playwright/test";
import { waitForMail } from "../../test/mailpit";
import { USERS } from "./env";
import { signInWithPassword } from "./helpers";

test("a reset email lets the user choose a new password", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(USERS.reset.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("reset link is on its way");
  const link = /(https?:\/\/\S+)/.exec((await waitForMail(USERS.reset.email)).Text)?.[1];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/\/reset-password\?token=/);
  await page.getByLabel("New password", { exact: true }).fill("brand-new-password-1");
  await page.getByLabel("Confirm new password").fill("brand-new-password-1");
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await signInWithPassword(page, USERS.reset.email, "brand-new-password-1");
});
```

```ts
// tests/e2e/preferences.spec.ts
import { expect, test } from "@playwright/test";
import { THEME_COOKIE } from "../../src/platform/theme";
import { USERS } from "./env";
import { signInWithPassword } from "./helpers";

test("language and theme preferences apply and persist", async ({ page }) => {
  await signInWithPassword(page, USERS.prefs.email, USERS.prefs.password);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The toggle saves in a transition; reload only once the action's response has set the cookie.
  await expect
    .poll(async () => (await page.context().cookies()).find((cookie) => cookie.name === THEME_COOKIE)?.value)
    .toBe("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/settings/profile");
  await page.getByLabel("Language").selectOption("it");
  // Profile has two forms with a Save button; take the preferences one (the form holding "Language").
  await page.locator("form", { has: page.getByLabel("Language") }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("navigation", { name: "Principale" }).getByRole("link", { name: "Panoramica" })).toBeVisible();
});
```

```ts
// tests/e2e/mobile.spec.ts
import { expect, test } from "@playwright/test";
import { USERS } from "./env";
import { signInWithPassword } from "./helpers";

test("phones get bottom tabs and a More sheet instead of the sidebar", async ({ page }) => {
  await signInWithPassword(page, USERS.owner.email, USERS.owner.password);
  const tabs = page.getByRole("navigation", { name: "Primary" }).filter({ has: page.getByRole("button", { name: "More" }) });
  await expect(tabs.getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Finance Dashboard", { exact: true })).toBeHidden();
  await tabs.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Settings" })).toBeVisible();
});
```

- [ ] **Step 4: Run the suite**

Run: `npm run dev:services && npm run e2e`
Expected: all specs pass in both projects (desktop: auth ×3, oidc ×2, invite, reset, preferences; mobile: 1). A failure in `oidc.spec.ts` that traces to the mock's login markup is fixed in `helpers.ts` only (Step 2 note).

- [ ] **Step 5: Commit**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add playwright.config.ts tests/e2e scripts/seed-e2e.ts package.json .gitignore
git commit -F - <<'EOF'
test(e2e): sign-in by password and OIDC, invitations, reset, preferences, mobile shell

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
```

---

### Task 22: Dev seed, docs and the phase gate

**Files:**
- Create: `scripts/seed-dev.ts`
- Modify: `package.json` (script `dev:seed`), `README.md`, `CLAUDE.md`, `.env.example` (complete)

**Interfaces:**
- Consumes: `createAuth` (Task 9), `users` table, `getDb`, `getPool` (Tasks 7–8), `ensureBucket` (Task 11).
- Produces: `npm run dev:seed` (idempotent: owner account + bucket); final docs; the F0 gate.

Spec §12 lists "development data from the design's sample data" under F0. F0 has no domain tables, so the F0 seed creates only the owner; each domain phase adds the design's sample data for its own tables to `scripts/seed-dev.ts`.

- [ ] **Step 1: Write the dev seed**

```ts
// scripts/seed-dev.ts — local development data. Idempotent. Later phases add their sample data here.
import { eq } from "drizzle-orm";
import { createAuth } from "../src/platform/auth/auth";
import { users } from "../src/platform/auth/schema";
import { getDb, getPool } from "../src/platform/db/client";
import { ensureBucket } from "../src/platform/storage";

const email = process.env.DEV_OWNER_EMAIL ?? "owner@example.test";
const password = process.env.DEV_OWNER_PASSWORD ?? "owner-password-123";

await ensureBucket();
const [existing] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, email));
if (!existing) {
  await createAuth({ withNextCookies: false }).api.createUser({ body: { email, password, name: "Owner" } });
  console.log(`[seed] created ${email} (password: ${password})`);
} else {
  console.log(`[seed] ${email} already exists`);
}
await getPool().end();
```

Script: `"dev:seed": "node --env-file-if-exists=.env --conditions=react-server --import tsx scripts/seed-dev.ts"`.

- [ ] **Step 2: Complete `.env.example`, `README.md` and `CLAUDE.md`**

`.env.example` must now contain every variable in `envSchema`, with the `compose.dev.yml` values:

```bash
DATABASE_URL=postgres://finance:finance@127.0.0.1:55432/finance_dev
TEST_DATABASE_URL=postgres://finance:finance@127.0.0.1:55432/finance_test
BETTER_AUTH_URL=http://127.0.0.1:3000
BETTER_AUTH_SECRET=change-me-change-me-change-me-change-me
OIDC_DISCOVERY_URL=http://127.0.0.1:58090/default/.well-known/openid-configuration
OIDC_CLIENT_ID=finance
OIDC_CLIENT_SECRET=finance-dev
OIDC_ADMIN_GROUP=finance-admins
SMTP_HOST=127.0.0.1
SMTP_PORT=51025
SMTP_SECURE=false
# Mailpit accepts any login; leave both empty to send without authentication.
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=Finance Dashboard <finance@example.test>
S3_ENDPOINT=http://127.0.0.1:59000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=finance
S3_SECRET_ACCESS_KEY=finance-dev-secret
S3_BUCKET=finance-dev
CRON_SECRET=dev-cron-secret-dev-cron-secret
HEARTBEAT_FILE=/tmp/finance-heartbeat
```

Check it against the final `envSchema` in `src/platform/env.ts`: every key there appears here (optional ones with their default or empty), and nothing here is missing from the schema except `TEST_DATABASE_URL`, which only the test harness reads.

`README.md` — replace the Develop section with: prerequisites (Node ≥22.12, Docker); `npm install`; `cp .env.example .env`; `npm run dev:services`; `npm run db:migrate`; `npm run dev:seed`; `npm run dev`; open `http://127.0.0.1:3000` (use `127.0.0.1`, not `localhost`, so the OIDC issuer matches); sign in as `owner@example.test` / `owner-password-123`, or with **Continue with Authentik** as `admin@example.test` (admin) or any other address (user) on the mock provider; Mailpit at `http://127.0.0.1:58025`, MinIO console at `http://127.0.0.1:59001`. A Check section with `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e`. A Docker section with the two `docker build` commands from Task 20. A Documentation section linking the spec and `docs/plans/`.

`CLAUDE.md` — keep the Task 1 content and add: the dev services and their ports; "every string in `messages/en.json` and `messages/it.json`"; "each phase appends its nav items in `src/app/(app)/navigation.ts`, its icons in `src/ui/shell/icons.ts`, its jobs in `src/platform/jobs/registry.ts`, its tables in `src/platform/db/tables.ts`".

- [ ] **Step 3: Run the full gate**

Run: `npm run format:check && npm run lint && npm run typecheck && npm test && npm run test:integration && npm run e2e`
Expected: every command exits 0.
Run: `docker build -t finance-dashboard:dev . && docker build -t finance-dashboard-cron:dev cron`
Expected: both succeed.

- [ ] **Step 4: Compare the screens with the design**

Serve the canvas (`cd "UI Recreation and branding decisions" && python3 -m http.server 8765`, open `Finance Dashboard.dc.html`) next to the app. Compare, in light and dark, at 1440 px and 400 px: Sign in; the shell (sidebar expanded and collapsed, topbar, ⌘K palette, toast); the empty state; Settings › Profile and Security (layout `4fr/8fr`, tabs); Components. Differences that are not listed in spec §8.4 are fixed now. Stop the server afterwards; never modify the canvas folder.

- [ ] **Step 5: Whole-branch review split by area**

Dispatch four reviewers, each with the file list of its area taken from `git diff --name-only $(git rev-list --max-parents=0 HEAD)..HEAD` (every file must belong to exactly one area):
1. **Platform:** `src/platform/{money,dates,holidays,format,crypto,env,context,storage,storage-keys,mail}.ts` and their `*.test.ts` / `*.itest.ts` siblings, `src/platform/db/**`, `src/platform/jobs/**`, `src/app/api/{health,metrics,jobs}/**`, `scripts/migrate.ts`, `drizzle/**`.
2. **Auth and users:** `src/platform/auth/**`, `src/modules/users/**` (including `actions.ts`, every users-module Server Action), `src/proxy.ts`, `src/app/(auth)/**`, `src/app/api/auth/**`, `src/app/(app)/settings/**`, `scripts/create-admin.ts`.
3. **UI:** `src/ui/**`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/(app)/{layout,page,navigation}.*` (with `navigation.test.ts`), `src/app/(app)/components/**`, `messages/**`, `src/platform/theme.ts`, `src/platform/theme.test.ts`, `src/platform/i18n/**`, `src/global.d.ts`.
4. **Infrastructure, tests and docs:** `Dockerfile`, `entrypoint.sh`, `.dockerignore`, `cron/**`, `compose.dev.yml`, `dev/**`, `vitest.config.ts`, `playwright.config.ts`, `tests/**`, `test/**`, `src/architecture.test.ts`, `scripts/seed-*.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `drizzle.config.ts`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.env.example`, `README.md`, `CLAUDE.md`, `docs/**`.

Before dispatching, list the diff's files and confirm each one matches exactly one area; a file that matches none is assigned before the review starts.

Every reviewer prompt names these defect classes (spec §4.3, lessons of the previous rebuild): a query that forgets `userScoped`; a network call inside a transaction; a civil date derived from UTC; money through `number`; two functions answering the same question; a check that silently returns a "safe" default; a constraint asserted in prose but not in SQL; docs describing something that does not exist; copy missing from one catalogue; a server action without `requireSession()`.

Fix the findings in sequential batches (never two implementers at once), re-run the gate after each batch.

- [ ] **Step 6: Commit and push**

Run: `npm run format && npm run lint && npm run typecheck && npm run format:check`
Expected: all four exit 0 (Prettier may rewrite this task's files first; they are staged below).

```bash
git add scripts/seed-dev.ts package.json README.md CLAUDE.md .env.example
git commit -F - <<'EOF'
docs: development guide, dev seed and F0 gate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Mqa6EW1ovPr8yp7pJu1Weg
EOF
git push origin dev-0.1
```

F0 is done when the gate is green, the review findings are fixed, and `dev-0.1` is pushed. The F1 plan (Accounts + Overview) is written next, from spec §7.1.

