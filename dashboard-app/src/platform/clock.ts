/**
 * The one clock interface the platform passes around. Structurally identical
 * to the accounts module's `Clock`, so either can be handed to the other.
 */
export interface Clock {
  now(): Date;
}
