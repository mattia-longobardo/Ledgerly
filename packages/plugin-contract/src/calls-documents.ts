/**
 * The call of a document reader (rewrite plan R5c, extension point E1 of 10-modularity.md §10.11):
 * a plugin that declares `documents.read` reads a file the core hands it and answers what kind of
 * document it is, how sure it is, the data it found and where it found each value. The reader is
 * the E1 `DocumentReader { id, kind, label, detect(file) → confidence, read(file, profile?) }`:
 * `detect` and `read` are one call, the confidence comes back with the data.
 *
 * The plugin keeps nothing between two calls. The core keeps the file, the profile and the
 * evidence. No plugin implements the call in this release, and the core does not call it yet.
 */
import { z } from "zod";

export const DOCUMENT_PATHS = { read: "/documents/read" } as const;

/** The largest file a plugin reads, as the core's own upload takes it (10 MiB). */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** The same limit as base64 text: 4 characters for every 3 bytes. */
const MAX_BASE64_CHARS = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4;

/** A word of an open vocabulary (rule M13): a kind of document, a field. Checked by form only. */
const word = z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,59}$/);
/** A media type by its form (`application/pdf`, `text/csv`): no list of the ones allowed. */
const mediaType = z.string().regex(/^[a-z]+\/[a-z0-9.+-]{1,100}$/);

const fileSchema = z.object({
  name: z.string().min(1).max(255),
  mediaType,
  /** The bytes of the file, as base64. */
  content: z.base64().min(1).max(MAX_BASE64_CHARS),
});

/**
 * A profile: what a reader reads in a document of a given issuer (labels, columns, formats, codes,
 * checks), as data and never as code. Its shape is the reader's own.
 */
const profileSchema = z.object({ id: word, data: z.record(word, z.unknown()) });

export const documentReadRequestSchema = z.object({
  file: fileSchema,
  /** No profile: the reader uses its own default, or finds one from the file. */
  profile: profileSchema.nullable().optional(),
});

/** One value the reader found: a text, a number, a yes or no, or nothing. */
const scalar = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]);
const MAX_FIELDS = 500;
const MAX_LINES = 1000;
/** A value of the data: one value, or the lines of a table (the items of a payslip, say). */
const value = z.union([scalar, z.array(z.record(word, scalar)).max(MAX_LINES)]);

/** Where on a page a value is, in the page's own units from its top left corner. */
const box = z.object({
  left: z.number().finite().min(0),
  top: z.number().finite().min(0),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});

/** Where the reader found one field: the page, the box on it, and the text it read there. */
const evidenceSchema = z.object({
  field: word,
  page: z.number().int().min(1).nullable(),
  box: box.nullable(),
  text: z.string().max(4000).nullable(),
});

export const documentReadResponseSchema = z.object({
  kind: word,
  /** How sure the reader is that the file is of `kind`: 0 not at all, 1 certain. */
  confidence: z.number().min(0).max(1),
  /** The data in the reader's own field names: typed values, an open set of fields. */
  data: z.record(word, value).refine((data) => Object.keys(data).length <= MAX_FIELDS),
  evidence: z.array(evidenceSchema).max(MAX_FIELDS * 4),
});
