// The browser's entry of this unit: the pure names the client components use (R0). Nothing here
// may reach the database, the network or a secret: a client component bundles every file it names.
export { PRODUCTS } from "./rules";
export type { AssetClass, InvestmentCategory } from "./rules";
export { describeEvent, priceText, quantityText } from "./activity";
export { PROVIDER_SCHEDULE } from "./catalog";
// The period of the address (§1.2): pure, for the web's pages and their redirects.
export { legacyPeriodQuery, sectionPeriod } from "./period";
