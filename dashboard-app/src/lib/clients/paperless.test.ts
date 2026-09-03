import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/contracts";
import {
  clearPayslipTagIdCache,
  downloadOriginal,
  getDocument,
  listPayslipDocuments,
  previewStream,
  resolvePayslipTagId,
} from "./paperless";

process.env.DATABASE_URL = "postgres://dashboard@localhost/dashboard";
process.env.AUTH_URL = "https://dash.example.test";
process.env.AUTH_SECRET = "a".repeat(40);
process.env.OIDC_ISSUER = "https://auth.example.test/application/o/dashboard/";
process.env.OIDC_CLIENT_ID = "client";
process.env.OIDC_CLIENT_SECRET = "secret";
process.env.AUTHORIZED_SUB = "sub-123";
process.env.PAPERLESS_URL = "https://paperless.example.test/";
process.env.PAPERLESS_TOKEN = "paperless-token";
process.env.PAPERLESS_PAYSLIP_TAG_ID = "22";
process.env.CRON_SECRET = "c".repeat(20);
process.env.WEBHOOK_SECRET = "w".repeat(20);

const fetchMock = vi.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function call(i: number): { url: string; init: RequestInit } {
  const c = fetchMock.mock.calls[i];
  if (!c) throw new Error(`no fetch call #${i}`);
  return { url: String(c[0]), init: (c[1] ?? {}) as RequestInit };
}

function doc(id: number, extra: Record<string, unknown> = {}) {
  return { id, title: `Busta Paga di ${id}`, added: "2026-08-01T10:00:00Z", tags: [22], ...extra };
}

beforeEach(() => {
  fetchMock.mockReset();
  clearPayslipTagIdCache();
});

describe("auth", () => {
  it("uses the `Token` scheme, never Bearer", async () => {
    fetchMock.mockImplementation(async () => json({ next: null, results: [] }));
    await listPayslipDocuments();
    const headers = call(0).init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Token paperless-token");
    expect(headers.authorization).not.toContain("Bearer");
  });
});

describe("listPayslipDocuments", () => {
  it("filters by tag, orders by -added and follows DRF paging", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          count: 3,
          next: "https://paperless.example.test/api/documents/?page=2&tags__id__in=22",
          results: [doc(1), doc(2)],
        }),
      )
      .mockResolvedValueOnce(json({ count: 3, next: null, results: [doc(3)] }));

    const docs = await listPayslipDocuments();

    expect(docs.map((d) => d.id)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(0).url).toContain("tags__id__in=22");
    expect(call(0).url).toContain("ordering=-added");
    expect(call(0).url).toContain("https://paperless.example.test/api/documents/");
    expect(call(1).url).toContain("page=2");
  });

  it("passes `since` as added__gt", async () => {
    fetchMock.mockImplementation(async () => json({ next: null, results: [] }));
    await listPayslipDocuments({ since: "2026-08-01T00:00:00Z" });
    expect(decodeURIComponent(call(0).url)).toContain("added__gt=2026-08-01T00:00:00Z");
  });
});

describe("getDocument", () => {
  it("returns the OCR content", async () => {
    fetchMock.mockResolvedValueOnce(json(doc(7, { content: "RETRIBUZIONE LORDA 2.500,00" })));
    const document = await getDocument(7);
    expect(document.content).toContain("RETRIBUZIONE");
    expect(call(0).url).toBe("https://paperless.example.test/api/documents/7/");
  });
});

describe("downloadOriginal", () => {
  it("returns the bytes and content type", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([37, 80, 68, 70]), {
        headers: { "content-type": "application/pdf", "content-length": "4" },
      }),
    );

    const file = await downloadOriginal(9);

    expect(file.contentType).toBe("application/pdf");
    expect(file.bytes).toBe(4);
    expect(new Uint8Array(file.data)[0]).toBe(37);
    expect(call(0).url).toBe("https://paperless.example.test/api/documents/9/download/");
  });

  it("refuses an oversized document declared by Content-Length", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "application/pdf", "content-length": String(11 * 1024 * 1024) },
      }),
    );
    await expect(downloadOriginal(9)).rejects.toThrow(/over the/);
  });

  it("refuses an oversized body that lied about its length", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array(2048), { headers: { "content-type": "application/pdf" } }),
    );
    await expect(downloadOriginal(9, { maxBytes: 1024 })).rejects.toThrow(UpstreamError);
  });
});

describe("previewStream", () => {
  it("hands back the unread response for server-side proxying", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("%PDF-preview", { headers: { "content-type": "application/pdf" } }),
    );
    const res = await previewStream(3);
    expect(res.bodyUsed).toBe(false);
    expect(await res.text()).toBe("%PDF-preview");
    expect(call(0).url).toBe("https://paperless.example.test/api/documents/3/preview/");
  });
});

describe("resolvePayslipTagId", () => {
  it("looks the tag up case-insensitively and caches it", async () => {
    fetchMock.mockImplementation(async () => json({ results: [{ id: 22, name: "Payroll" }] }));
    expect(await resolvePayslipTagId()).toBe(22);
    expect(await resolvePayslipTagId()).toBe(22);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call(0).url).toContain("name__iexact=payroll");
  });

  it("throws when the tag is gone", async () => {
    fetchMock.mockImplementation(async () => json({ results: [] }));
    await expect(resolvePayslipTagId()).rejects.toThrow(UpstreamError);
  });
});
