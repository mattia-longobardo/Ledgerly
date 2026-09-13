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
