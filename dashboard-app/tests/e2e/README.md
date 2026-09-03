# End-to-end tests

## `smoke.spec.ts` (implemented)

One test, no login required: `/api/health` answers 2xx, `/api/v1/openapi.json`
is gated (401 without a session), and `/` redirects an unauthenticated visitor
to `/signin`. This is the only spec that runs today, and it is the one the
Phase 1 runbook and CI-shaped workflows should rely on — it needs nothing but
a running app (no Authentik identity, no seeded data).

Run against a dev server (`npm run dev`, `E2E_BASE_URL` defaults to
`http://localhost:3000`) or a built one (`npm run build && npm run start`):

```bash
npm run e2e
```

## Planned flows (not yet written)

Two critical flows, per PLAN.md §8 M8, both needing a live stack with a real
Authentik identity and are why they are not part of `npm test`:

1. **login** — unauthenticated request redirects to Authentik, round-trips back
   with a session, and a second (non-allowlisted) identity is rejected.
2. **verify-commit** — a parsed payslip appears in the verification queue, the
   form commits, and the Work page statistics move.

These land with the payroll upload pipeline (Phase 4) and the Settings ›
Security session list (Phase 2/8), once there is a page and a test identity to
exercise them against.
