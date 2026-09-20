import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import {
  DOCUMENT_KINDS,
  DOCUMENT_STATES,
  EVIDENCE_ORIGINS,
  EVIDENCE_UNITS,
  MAX_DOCUMENT_BYTES,
  VERIFICATION_STATES,
} from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * An imported document (spec §6, §9.3): one row per file a person sent, found again by its SHA-256
 * so the same file twice is one document. `storage_key` is null once the original is deleted at
 * the end of its retention (`original_deleted_at`); the data read from it stays.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    sha256: text("sha256").notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key"),
    state: text("state", { enum: DOCUMENT_STATES }).notNull().default("received"),
    parserVersion: text("parser_version"),
    error: text("error"),
    retainUntil: date("retain_until").notNull(),
    originalDeletedAt: timestamp("original_deleted_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("documents_user_sha_uq").on(table.userId, table.sha256),
    index("documents_user_state_idx").on(table.userId, table.state),
    check("documents_kind_ck", sql`${table.kind} in (${sql.raw(inList(DOCUMENT_KINDS))})`),
    check("documents_state_ck", sql`${table.state} in (${sql.raw(inList(DOCUMENT_STATES))})`),
    check("documents_sha_ck", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check("documents_size_ck", sql`${table.sizeBytes} between 1 and ${sql.raw(String(MAX_DOCUMENT_BYTES))}`),
    check("documents_name_ck", sql`length(${table.fileName}) between 1 and 200`),
    check(
      "documents_original_ck",
      sql`(${table.storageKey} is null) = (${table.originalDeletedAt} is not null)`,
    ),
  ],
);

/**
 * One value read from a document, with the proof of where it came from (spec §6, §7.8; owner's
 * spec L32): the page and the box on it (fractions of the page, origin top left), the label and
 * raw text it was read from, whether it was printed, derived from other fields or inferred by the
 * LLM, and what the person made of it. A correction sits beside the original, never over it.
 * `value` is the normalised value as text (`2345.67`, `51.66`, `2031-03-27`), null when the
 * document does not show it.
 */
export const documentEvidence = pgTable(
  "document_evidence",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    value: text("value"),
    unit: text("unit", { enum: EVIDENCE_UNITS }).notNull(),
    sourceLabel: text("source_label"),
    page: smallint("page"),
    bbox: doublePrecision("bbox").array(),
    origin: text("origin", { enum: EVIDENCE_ORIGINS }).notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
    rawText: text("raw_text"),
    derivedFrom: text("derived_from").array(),
    verification: text("verification", { enum: VERIFICATION_STATES }).notNull().default("unverified"),
    correctedValue: text("corrected_value"),
    correctedBy: uuid("corrected_by").references(() => users.id, { onDelete: "set null" }),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("document_evidence_field_uq").on(table.documentId, table.field),
    check("document_evidence_unit_ck", sql`${table.unit} in (${sql.raw(inList(EVIDENCE_UNITS))})`),
    check("document_evidence_origin_ck", sql`${table.origin} in (${sql.raw(inList(EVIDENCE_ORIGINS))})`),
    check(
      "document_evidence_verification_ck",
      sql`${table.verification} in (${sql.raw(inList(VERIFICATION_STATES))})`,
    ),
    check("document_evidence_confidence_ck", sql`${table.confidence} between 0 and 1`),
    check(
      "document_evidence_bbox_ck",
      sql`${table.bbox} is null or (cardinality(${table.bbox}) = 4 and ${table.page} is not null)`,
    ),
    check(
      "document_evidence_corrected_ck",
      sql`(${table.verification} = 'corrected') = (${table.correctedAt} is not null)`,
    ),
  ],
);
