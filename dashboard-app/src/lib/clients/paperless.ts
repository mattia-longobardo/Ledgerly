import { z } from "zod";
import { UpstreamError } from "@/lib/contracts";
import { env } from "@/lib/env";
import { httpRequest, requestJson } from "./http";

const documentSchema = z.object({
  id: z.number(),
  title: z.string(),
  added: z.string(),
  created: z.string().optional(),
  correspondent: z.number().nullable().optional(),
  document_type: z.number().nullable().optional(),
  tags: z.array(z.number()).default([]),
  content: z.string().optional(),
  original_file_name: z.string().nullable().optional(),
});

const pageSchema = z.object({
  count: z.number().optional(),
  next: z.string().nullable().default(null),
  results: z.array(documentSchema),
});

const tagSchema = z.object({ id: z.number(), name: z.string() });
const tagPageSchema = z.object({ results: z.array(tagSchema) });

export type PaperlessDocument = z.infer<typeof documentSchema>;

const DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_PAGES = 100;

function baseUrl(): string {
  return env().PAPERLESS_URL.replace(/\/+$/, "");
}

/** Paperless uses `Token <key>`, not `Bearer`. */
function headers(): Record<string, string> {
  return { authorization: `Token ${env().PAPERLESS_TOKEN}` };
}

export interface ListPayslipOptions {
  /** ISO timestamp; only documents added strictly after it are returned. */
  since?: string;
  tagId?: number;
  signal?: AbortSignal;
}

export async function listPayslipDocuments(
  opts: ListPayslipOptions = {},
): Promise<PaperlessDocument[]> {
  const tagId = opts.tagId ?? env().PAPERLESS_PAYSLIP_TAG_ID;
  const qs = new URLSearchParams({
    tags__id__in: String(tagId),
    ordering: "-added",
  });
  if (opts.since) qs.set("added__gt", opts.since);

  let url: string | null = `${baseUrl()}/api/documents/?${qs}`;
  const out: PaperlessDocument[] = [];

  for (let page = 0; page < MAX_PAGES && url; page += 1) {
    const body: z.infer<typeof pageSchema> = await requestJson("paperless", url, pageSchema, {
      headers: headers(),
      signal: opts.signal,
    });
    out.push(...body.results);
    url = body.next;
  }
  return out;
}

export async function getDocument(
  id: number,
  opts: { signal?: AbortSignal } = {},
): Promise<PaperlessDocument> {
  return requestJson("paperless", `${baseUrl()}/api/documents/${id}/`, documentSchema, {
    headers: headers(),
    signal: opts.signal,
  });
}

export interface DownloadedDocument {
  data: ArrayBuffer;
  contentType: string;
  bytes: number;
}

/** Capped and timed out — a PDF parser should never be handed an unbounded blob. */
export async function downloadOriginal(
  id: number,
  opts: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<DownloadedDocument> {
  const maxBytes = opts.maxBytes ?? DOWNLOAD_MAX_BYTES;
  const res = await httpRequest("paperless", `${baseUrl()}/api/documents/${id}/download/`, {
    headers: headers(),
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    signal: opts.signal,
  });

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UpstreamError(
      "paperless",
      `document ${id} is ${declared} bytes, over the ${maxBytes} byte cap`,
      { id, declared },
      false,
    );
  }

  const data = await res.arrayBuffer();
  if (data.byteLength > maxBytes) {
    throw new UpstreamError(
      "paperless",
      `document ${id} is ${data.byteLength} bytes, over the ${maxBytes} byte cap`,
      { id, bytes: data.byteLength },
      false,
    );
  }

  return {
    data,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    bytes: data.byteLength,
  };
}

/** Returned unread so a route handler can pipe it — the token stays server-side. */
export async function previewStream(
  id: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Response> {
  return httpRequest("paperless", `${baseUrl()}/api/documents/${id}/preview/`, {
    headers: headers(),
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    signal: opts.signal,
  });
}

let payslipTagIdCache: number | null = null;

export async function resolvePayslipTagId(opts: { signal?: AbortSignal } = {}): Promise<number> {
  if (payslipTagIdCache !== null) return payslipTagIdCache;
  const body = await requestJson(
    "paperless",
    `${baseUrl()}/api/tags/?name__iexact=payroll`,
    tagPageSchema,
    { headers: headers(), signal: opts.signal },
  );
  const tag = body.results[0];
  if (!tag) {
    throw new UpstreamError("paperless", "no tag named 'payroll' exists", body, false);
  }
  payslipTagIdCache = tag.id;
  return tag.id;
}

export function clearPayslipTagIdCache(): void {
  payslipTagIdCache = null;
}
