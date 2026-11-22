// The alerts of a person (rewrite plan R5e, 01-decisions.md G4, G5): one event, three channels (in
// the app, email, the device). A notification carries the code of its event and its parameters,
// never a text: each client writes the sentence from its own catalogue, so no amount, bank or
// account ever travels in a notification (G4). An event of an addon that is off is not listed (PA10).
import { z } from "zod";
import { ADDONS, type AddonId } from "./addons";
import { defineRoute } from "./route";
import { civilDate, id, instant } from "./primitives";

/**
 * Where an event shows: `action` asks for something a person does in Ledgerly and is also in «Da
 * fare»; `reminder` tells a fact and asks nothing; `report` is the monthly summary. `action` and
 * `reminder` are the two categories of the system on a device (07-apps.md §7.4, C2).
 */
export const NOTIFICATION_CATEGORIES = ["action", "reminder", "report"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_EVENT_NAMES = [
  "connection_failed",
  "connection_stale",
  "connection_expiring",
  "account_low_balance",
  "budget_threshold",
  "monthly_summary",
  "transactions_to_categorize",
  "payslips_to_review",
  "transfers_to_confirm",
  "fund_to_verify",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENT_NAMES)[number];

/** Every event of the service: its category and the addon it belongs to (`null`: a base module). */
export const NOTIFICATION_EVENTS = {
  connection_failed: { category: "action", addon: null },
  connection_stale: { category: "action", addon: null },
  connection_expiring: { category: "action", addon: null },
  account_low_balance: { category: "reminder", addon: null },
  budget_threshold: { category: "reminder", addon: "budgets" },
  monthly_summary: { category: "report", addon: null },
  transactions_to_categorize: { category: "action", addon: null },
  payslips_to_review: { category: "action", addon: "payroll" },
  transfers_to_confirm: { category: "action", addon: "investments" },
  fund_to_verify: { category: "action", addon: "funds" },
} as const satisfies Record<NotificationEvent, { category: NotificationCategory; addon: AddonId | null }>;

/** The page a client opens for an event, with the id of what the event is about when it has one. */
export const NOTIFICATION_PAGES = [
  "connection",
  "account",
  "budget",
  "expenses_review",
  "payroll_review",
  "investments_transfers",
  "fund",
  "overview",
] as const;

/**
 * What a client needs to write the sentence. Counts, whole percents, days and dates only: never an
 * amount, a bank, an account or any name (G4). A field the event does not use is left out.
 */
const params = z
  .object({
    /** Movements to categorise, payslips to review, transfers to confirm. */
    count: z.number().int().min(1).optional(),
    /** The budget threshold reached, in whole percent. */
    percent: z.number().int().min(1).optional(),
    /** The days left before an access ends (14, 3, …). */
    days: z.number().int().min(0).optional(),
    /** The civil date the event is about: the end of an access, the month of a summary. */
    date: civilDate().optional(),
  })
  .strict();

export type NotificationParams = z.infer<typeof params>;

const target = z.object({
  page: z.enum(NOTIFICATION_PAGES),
  /** The connection, account, budget or fund; `null` for a page without one. */
  id: z.string().nullable(),
});

const todoItem = z.object({
  id: id(),
  event: z.enum(NOTIFICATION_EVENT_NAMES),
  addon: z.enum(ADDONS).nullable(),
  params,
  target,
  /** When the fact was first seen; the list is oldest first. */
  since: instant(),
});

const notification = z.object({
  id: id(),
  event: z.enum(NOTIFICATION_EVENT_NAMES),
  category: z.enum(NOTIFICATION_CATEGORIES),
  params,
  target,
  openedAt: instant(),
  readAt: instant().nullable(),
});

const channels = z.object({ inApp: z.boolean(), email: z.boolean(), device: z.boolean() });

const preference = z.object({
  event: z.enum(NOTIFICATION_EVENT_NAMES),
  category: z.enum(NOTIFICATION_CATEGORIES),
  addon: z.enum(ADDONS).nullable(),
  /** False while the event's addon is off: the event sends nothing, the choice stays. */
  addonActive: z.boolean(),
  channels,
  /** The channels a person cannot turn off: `inApp` of an event that asks for an action. */
  locked: z.array(z.enum(["inApp", "email", "device"])),
});

const preferencesBody = z.object({ events: z.array(preference) });

const TODO_EXAMPLE = {
  items: [
    {
      id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f70",
      event: "connection_expiring",
      addon: null,
      params: { days: 3, date: "2026-12-01" },
      target: { page: "connection", id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f71" },
      since: "2026-11-28T07:00:00.000Z",
    },
    {
      id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f72",
      event: "transactions_to_categorize",
      addon: null,
      params: { count: 12 },
      target: { page: "expenses_review", id: null },
      since: "2026-11-29T07:00:00.000Z",
    },
  ],
};

const PREFERENCES_EXAMPLE = {
  events: [
    {
      event: "connection_failed",
      category: "action",
      addon: null,
      addonActive: true,
      channels: { inApp: true, email: true, device: true },
      locked: ["inApp"],
    },
    {
      event: "budget_threshold",
      category: "reminder",
      addon: "budgets",
      addonActive: false,
      channels: { inApp: true, email: true, device: false },
      locked: [],
    },
  ],
};

export const listTodo = defineRoute({
  id: "list_todo",
  method: "GET",
  path: "/todo",
  scope: "read",
  capability: "notifications",
  summary:
    "«Da fare»: the open facts that ask the person for an action, oldest first. One item per fact; an item goes when its fact is no longer true.",
  actions: [],
  response: z.object({ items: z.array(todoItem) }),
  errors: [],
  mcp: {
    title: "To do",
    description:
      "What the user has to do in Ledgerly, as GET /api/v1/todo: a connection to repair or renew, movements " +
      "to categorise, payslips to review, transfers to confirm. Each item has an event code, counts or " +
      "dates, and the page that resolves it; no amounts and no names.",
  },
  example: { response: TODO_EXAMPLE },
});

export const listNotifications = defineRoute({
  id: "list_notifications",
  method: "GET",
  path: "/notifications",
  scope: "read",
  capability: "notifications",
  summary:
    "The notifications for the device, newer than the cursor: the read of the apps' periodic check (G4). Only events with the device channel on.",
  actions: [],
  query: z.object({
    /** The `cursor` of the previous answer; left out, the open notifications of the last 7 days. */
    since: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
  response: z.object({
    items: z.array(notification),
    /** What to send as `since` next time; the same value when nothing is new. */
    cursor: z.string(),
  }),
  errors: ["invalid"],
  example: {
    query: { since: "c2026-11-28T07:00:00.000Z" },
    response: {
      items: [
        {
          id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f70",
          event: "connection_expiring",
          category: "action",
          params: { days: 3, date: "2026-12-01" },
          target: { page: "connection", id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f71" },
          openedAt: "2026-11-28T07:00:00.000Z",
          readAt: null,
        },
      ],
      cursor: "c2026-11-28T07:00:00.000Z",
    },
  },
});

export const markNotificationRead = defineRoute({
  id: "mark_notification_read",
  method: "POST",
  path: "/notifications/{id}/read",
  scope: "write",
  capability: "notifications",
  summary:
    "Marks one notification read: the device does not show it again. A second call changes nothing. The item stays in «Da fare» while its fact is true.",
  actions: [],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: ["not_found"],
  example: { params: { id: "0190c3c2-7a3e-7c1a-9f4e-2b3c4d5e6f70" } },
});

export const getNotificationPreferences = defineRoute({
  id: "get_notification_preferences",
  method: "GET",
  path: "/notification-preferences",
  scope: "read",
  capability: "notifications",
  summary:
    "For every event, the channels it uses: in the app, email, the device. The thresholds stay on the budget and on the account.",
  actions: [],
  response: preferencesBody,
  errors: [],
  example: { response: PREFERENCES_EXAMPLE },
});

export const setNotificationPreference = defineRoute({
  id: "set_notification_preference",
  method: "PUT",
  path: "/notification-preferences/{event}",
  scope: "write",
  capability: "notifications",
  summary:
    "Turns the channels of one event on or off; a channel left out keeps its value. Answers every event.",
  actions: [],
  params: z.object({ event: z.enum(NOTIFICATION_EVENT_NAMES) }),
  body: channels.partial().strict(),
  response: preferencesBody,
  errors: ["invalid", "module_inactive"],
  example: {
    params: { event: "connection_failed" },
    body: { device: false },
    response: {
      events: [
        { ...PREFERENCES_EXAMPLE.events[0], channels: { inApp: true, email: true, device: false } },
        PREFERENCES_EXAMPLE.events[1],
      ],
    },
  },
});
