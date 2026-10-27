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

export type PaperlessErrorKind = "network" | "timeout" | "token_rejected" | "http" | "shape";

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
  input: { baseUrl: string; token: string },
  options: { fetch?: Fetch; timeoutMs?: number } = {},
): PaperlessClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = normalizeBaseUrl(input.baseUrl);
  if (!base) throw new PaperlessError("shape", "The Paperless URL is not valid");
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
    try {
      return (await response.json()) as Record<string, unknown>;
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
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { name: fileNameOf(response.headers.get("content-disposition")), bytes };
    },
  };
}
