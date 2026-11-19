// The browser's entry of this unit: the pure names the client components use (R0). Nothing here
// may reach the database, the network or a secret: a client component bundles every file it names.
export {
  ACCOUNT_TYPES,
  CONNECTION_CHANNELS,
  REMINDERS,
  TRENDS,
  changeBetween,
  hasIbanField,
  shareOf,
} from "./rules";
export type { AccountType, ConnectionChannel, EntrySource } from "./rules";
