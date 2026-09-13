# Repository conventions

- The design and every binding decision: `docs/specs/2026-09-13-dev-0.1-design.md`. Phase plans: `docs/plans/`.
- `Fondo Cometa/`, `Payroll/` and `UI Recreation and branding decisions/` are the owner's local reference
  material: read-only, never committed, deleted at the end of development.
- Layout: `src/app` routes, `src/modules/<name>` domain modules, `src/platform` shared services, `src/ui` design system.
- Money is `bigint` cents, unknown is `null`, dates go through `src/platform/dates.ts`, services take `(ctx, input)`.
- Before committing: `npm run lint && npm run typecheck && npm test`.
