// Funds, the entry of the Funds pages (rule M3): the tabs of a fund, the forms they open and the calls
// they write through. Every screen reads `/api/v1` (rewrite plan R3).
export * from "./calls";
export { ContributionButton } from "./ui/contribution-dialog";
export { contributionSetupOf, useMovements, usePeriodLabel } from "./ui/contribution-setup";
export { FundContributions } from "./ui/fund-contributions";
export { FundStateButton, ValuationButton } from "./ui/fund-forms";
export { FundOverview } from "./ui/fund-overview";
export { FundSettings } from "./ui/fund-settings";
export { FundValuations } from "./ui/fund-valuations";
export { type Say, useSay } from "./ui/say";
export { FundChart } from "./ui/fund-chart";
export {
  FundsCard,
  type Home,
  type HomeFund,
  HomeKpis,
  type HomeWords,
  WhoPaidCard,
  YearsCard,
} from "./ui/home-cards";
export { FundWizard } from "./ui/fund-wizard";
