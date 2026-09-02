import { boolean, check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  policies: jsonb("policies").notNull().default({}),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    email: text("email"),
    displayName: text("display_name").notNull(),
    locale: text("locale").notNull().default("en-GB"),
    timezone: text("timezone").notNull().default("Europe/Rome"),
    currency: text("currency").notNull().default("EUR"),
    status: text("status").notNull().default("active"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    deletedAt: tz("deleted_at"),
  },
  (t) => [
    check("users_status_ck", sql`${t.status} IN ('invited','active','suspended','deleted')`),
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`).where(sql`email IS NOT NULL`),
  ],
);

export const userIdentities = pgTable(
  "user_identities",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    linkedAt: tz("linked_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_identities_provider_subject_uq").on(t.provider, t.subject)],
);

export const roles = pgTable("roles", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleCode: text("role_code").notNull().references(() => roles.code),
    grantedAt: tz("granted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleCode] })],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    ip: text("ip"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId, t.createdAt.desc())],
);
