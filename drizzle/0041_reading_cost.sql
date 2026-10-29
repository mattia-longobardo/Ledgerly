-- PERS-119 (U4): what a provider position cost (docs/design/investments-ux.md §4.7). Additive: null = the
-- provider gave no cost, as for every reading written before it; eToro fills it from `amount` on sync.
ALTER TABLE "investment_reading_positions" ADD COLUMN "cost_cents" bigint;
