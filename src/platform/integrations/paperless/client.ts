/**
 * A small client of the Paperless-ngx REST API (docs/auth-design.md D5): Ledgerly reads the
 * documents Paperless has filed instead of waiting for a webhook, which can only send a static
 * header and so could never hold an OAuth token. Read-only — list document types, list documents,
 * download an original — with the token of a dedicated read-only Paperless user.
 *
 * No `server-only` here so the unit tests can drive it with a fake `fetch`; only the sync engine
 * imports it.
 */

/** API version 9 is the oldest the homelab's Paperless (3.2.1) still serves; its shape is enough. */
const API_VERSION = 9;
const DEFAULT_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100;
/** One megabyte over the largest document an import takes: what is bigger is refused unread. */
export const MAX_DOWNLOAD_BYTES = 11 * 1024 * 1024;
/** A JSON page of 100 documents is a few tens of kilobytes; this is far above it. */
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export type PaperlessErrorKind =
  "network" | "timeout" | "token_rejected" | "http" | "shape" | "not_allowed" | "too_large";

export class PaperlessError extends Error {
  constructor(
    readonly kind: PaperlessErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "PaperlessError";
  }
}

/**
 * What a person is told, whatever went wrong: one sentence per kind, with no status code, host or
 * path. The detail goes to the server log; the UI would otherwise answer "what is listening on
 * this address" for anyone allowed to save a URL (PERS-49 SEC-04).
 */
export function publicMessage(error: unknown): string {
  if (!(error instanceof PaperlessError)) return "The Paperless sync failed";
  switch (error.kind) {
    case "network":
    case "timeout":
      return "Paperless could not be reached";
    case "token_rejected":
      return "Paperless refused the token";
    case "not_allowed":
      return "This Paperless address is not allowed";
    case "too_large":
      return "Paperless sent a file that is too large";
    default:
      return "Paperless sent an answer this app could not use";
  }
}

/** 401 or 403: the token is wrong or the user lost its rights; waiting will not fix either. */
export function isTokenRejected(error: unknown): boolean {
  return error instanceof PaperlessError && error.kind === "token_rejected";
}

export interface PaperlessDocumentType {
  id: number;
  name: string;
}

export interface PaperlessDocument {
  id: number;
  title: string;
  documentType: number | null;
  /** ISO 8601 with offset, exactly as Paperless sent it: the sync cursor is this string. */
  modified: string;
  originalFileName: string | null;
}

export interface PaperlessClient {
  documentTypes(): Promise<PaperlessDocumentType[]>;
  /** Every document of these types modified strictly after `modifiedAfter`, oldest first. */
  documents(input: { typeIds: number[]; modifiedAfter: string; limit: number }): Promise<PaperlessDocument[]>;
  /** The original file, byte for byte what was consumed (so its sha256 is the webhook's). */
  download(id: number): Promise<{ name: string | null; bytes: Uint8Array }>;
}

type Fetch = typeof fetch;

/** Paperless's own URL, from the connection: `http(s)://host[:port]`, no path, no credentials. */
export function normalizeBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Whether a Paperless URL is on the operator's list (`PAPERLESS_ALLOWED_ORIGINS`): the server only
 * ever calls the Paperless it was told about, never an address a user typed (PERS-49 SEC-04).
 */
export function originAllowed(baseUrl: string, allowedOrigins: readonly string[]): boolean {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return false;
  const origin = new URL(base).origin;
  return allowedOrigins.some((allowed) => URL.canParse(allowed) && new URL(allowed).origin === origin);
}

/**
 * The body of a response, refused as soon as it passes `maxBytes` (PERS-49 SEC-09): a declared
 * length is checked before reading, and the stream is counted as it comes, so neither a lying
 * header nor a chunked body can fill the memory.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new PaperlessError("too_large", `Paperless sent more than ${maxBytes} bytes`);
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new PaperlessError("too_large", `Paperless sent more than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** `filename*=UTF-8''…` or `filename="…"`, whichever Paperless sent. */
export function fileNameOf(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return null;
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : null;
}

function asDocument(raw: unknown): PaperlessDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "number" || typeof row.modified !== "string") return null;
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : String(row.id),
    documentType: typeof row.document_type === "number" ? row.document_type : null,
    modified: row.modified,
    originalFileName: typeof row.original_file_name === "string" ? row.original_file_name : null,
  };
}

export function createPaperlessClient(
  input: { baseUrl: string; token: string; allowedOrigins: readonly string[] },
  options: { fetch?: Fetch; timeoutMs?: number } = {},
): PaperlessClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = normalizeBaseUrl(input.baseUrl);
  if (!base) throw new PaperlessError("shape", "The Paperless URL is not valid");
  // Checked again here, not only when the URL is saved: a connection saved before the list, or
  // after the list changed, must not be called either.
  if (!originAllowed(base, input.allowedOrigins)) {
    throw new PaperlessError("not_allowed", `${new URL(base).origin} is not in PAPERLESS_ALLOWED_ORIGINS`);
  }
  const basePath = new URL(base).pathname.replace(/\/+$/, "");

  async function call(path: string, accept: string): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        headers: {
          authorization: `Token ${input.token}`,
          accept: accept === "json" ? `application/json; version=${API_VERSION}` : "*/*",
        },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new PaperlessError("timeout", `Paperless did not answer within ${timeoutMs / 1000} s`);
      }
      throw new PaperlessError("network", "Paperless could not be reached");
    }
    if (response.status === 401 || response.status === 403) {
      throw new PaperlessError(
        "token_rejected",
        `Paperless refused the token (HTTP ${response.status})`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new PaperlessError(
        "http",
        `Paperless answered HTTP ${response.status} to ${path.split("?")[0]}`,
        response.status,
      );
    }
    return response;
  }

  async function json(path: string): Promise<Record<string, unknown>> {
    const response = await call(path, "json");
    const body = await readCapped(response, MAX_JSON_BYTES);
    try {
      return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    } catch {
      throw new PaperlessError("shape", "Paperless sent something that is not JSON");
    }
  }

  /** Walks a paginated list by its own `next` links, which stay on the same server. */
  async function pages(first: string, limit: number): Promise<unknown[]> {
    const rows: unknown[] = [];
    let path: string | null = first;
    while (path && rows.length < limit) {
      const page = await json(path);
      if (!Array.isArray(page.results))
        throw new PaperlessError("shape", "Paperless sent a list without results");
      rows.push(...page.results);
      // Only the path and query of `next` are kept: its host is whatever Paperless thinks it is
      // called, which is not necessarily the address this client was given.
      const next = typeof page.next === "string" ? new URL(page.next, base as string) : null;
      path = next ? `${next.pathname.slice(basePath.length)}${next.search}` : null;
    }
    return rows.slice(0, limit);
  }

  return {
    async documentTypes() {
      const rows = await pages(`/api/document_types/?page_size=${PAGE_SIZE}&ordering=id`, 1000);
      return rows.flatMap((raw) => {
        const row = raw as Record<string, unknown>;
        return typeof row?.id === "number" && typeof row.name === "string"
          ? [{ id: row.id, name: row.name }]
          : [];
      });
    },

    async documents({ typeIds, modifiedAfter, limit }) {
      if (typeIds.length === 0) return [];
      const query = new URLSearchParams({
        document_type__id__in: typeIds.join(","),
        modified__gt: modifiedAfter,
        ordering: "modified",
        page_size: String(PAGE_SIZE),
        fields: "id,title,document_type,modified,original_file_name",
      });
      const rows = await pages(`/api/documents/?${query.toString()}`, limit);
      const documents = rows.map(asDocument);
      if (documents.some((one) => one === null))
        throw new PaperlessError("shape", "Paperless sent a document without id or modified");
      return documents as PaperlessDocument[];
    },

    async download(id) {
      const response = await call(`/api/documents/${id}/download/?original=true`, "file");
      const bytes = await readCapped(response, MAX_DOWNLOAD_BYTES);
      return { name: fileNameOf(response.headers.get("content-disposition")), bytes };
    },
  };
}
