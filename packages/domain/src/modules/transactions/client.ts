// The browser's entry of this unit: the pure names the client components use (R0). Nothing here
// may reach the database, the network or a secret: a client component bundles every file it names.
export {
  AMOUNT_OPS,
  COUNTERPARTY_OPS,
  DIRECTIONS,
  MAX_CONDITIONS,
  MAX_TEXT_CONDITIONS,
  NOTE_MAX,
  RULE_FIELDS,
  RULE_SOURCES,
  TEXT_OPS,
} from "./categorize/user-rules";
export type { RuleCondition, RuleField } from "./categorize/user-rules";
export { CATEGORY_COLORS, NAME_MAX, TRANSACTION_TYPES } from "./rules";
export type { CategoryType, TransactionOrigin, TransactionState, TransactionType } from "./rules";
