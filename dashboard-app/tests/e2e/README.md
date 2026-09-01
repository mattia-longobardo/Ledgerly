# End-to-end tests

Two critical flows only, per PLAN.md §8 M8:

1. **login** — unauthenticated request redirects to Authentik, round-trips back
   with a session, and a second (non-allowlisted) identity is rejected.
2. **verify-commit** — a parsed payslip appears in the verification queue, the
   form commits, and the Work page statistics move.

Both need a live stack (`E2E_BASE_URL`) and a test identity in Authentik, so
they are not part of `npm test`. Run with `npm run e2e`.
