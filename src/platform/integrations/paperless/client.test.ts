import { describe, expect, it, vi } from "vitest";
import {
  createPaperlessClient,
  fileNameOf,
  isTokenRejected,
  normalizeBaseUrl,
  PaperlessError,
} from "./client";

const BASE = "http://paperless-ngx:8000";

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) return new Response("not found", { status: 404 });
    expect(new Headers(init?.headers).get("authorization")).toBe("Token secret-token");
    return routes[key]();
  });
}

const json = (body: unknown) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("createPaperlessClient", () => {
  it("lists the document types across pages, following next on its own address", async () => {
    const fetch = fakeFetch({
      [`${BASE}/api/document_types/?page_size=100&ordering=id`]: json({
        next: "https://paperless.example.test/api/document_types/?page=2&page_size=100",
        results: [{ id: 48, name: "Payroll" }],
      }),
      [`${BASE}/api/document_types/?page=2`]: json({ next: null, results: [{ id: 64, name: "CU" }] }),
    });
    const client = createPaperlessClient({ baseUrl: `${BASE}/`, token: "secret-token" }, { fetch });
    expect(await client.documentTypes()).toEqual([
      { id: 48, name: "Payroll" },
      { id: 64, name: "CU" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("asks for documents of the types, modified after the cursor, oldest first", async () => {
    const fetch = fakeFetch({
      [`${BASE}/api/documents/?`]: json({
        next: null,
        results: [
          {
            id: 7,
            title: "Cedolino",
            document_type: 48,
            modified: "2026-10-11T10:00:00+02:00",
            original_file_name: "c.pdf",
          },
        ],
      }),
    });
    const client = createPaperlessClient({ baseUrl: BASE, token: "secret-token" }, { fetch });
    const documents = await client.documents({
      typeIds: [48],
      modifiedAfter: "2026-10-01T00:00:00Z",
      limit: 10,
    });
    expect(documents).toEqual([
      {
        id: 7,
        title: "Cedolino",
        documentType: 48,
        modified: "2026-10-11T10:00:00+02:00",
        originalFileName: "c.pdf",
      },
    ]);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get("document_type__id__in")).toBe("48");
    expect(url.searchParams.get("modified__gt")).toBe("2026-10-01T00:00:00Z");
    expect(url.searchParams.get("ordering")).toBe("modified");
    expect(await client.documents({ typeIds: [], modifiedAfter: "x", limit: 10 })).toEqual([]);
  });

  it("downloads the original with its file name", async () => {
    const fetch = fakeFetch({
      [`${BASE}/api/documents/7/download/?original=true`]: () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          status: 200,
          headers: { "content-disposition": "attachment; filename*=UTF-8''Cedolino%20ottobre.pdf" },
        }),
    });
    const client = createPaperlessClient({ baseUrl: BASE, token: "secret-token" }, { fetch });
    const file = await client.download(7);
    expect(file.name).toBe("Cedolino ottobre.pdf");
    expect([...file.bytes]).toEqual([37, 80, 68, 70]);
  });

  it("calls a 401 or 403 a refused token, and anything else what it is", async () => {
    const refused = createPaperlessClient(
      { baseUrl: BASE, token: "secret-token" },
      { fetch: fakeFetch({ [BASE]: () => new Response("", { status: 403 }) }) },
    );
    const error = await refused.documentTypes().catch((caught: unknown) => caught);
    expect(isTokenRejected(error)).toBe(true);
    const broken = createPaperlessClient(
      { baseUrl: BASE, token: "secret-token" },
      { fetch: fakeFetch({ [BASE]: () => new Response("", { status: 502 }) }) },
    );
    await expect(broken.documentTypes()).rejects.toMatchObject({ kind: "http", status: 502 });
    const down = createPaperlessClient(
      { baseUrl: BASE, token: "secret-token" },
      { fetch: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) },
    );
    await expect(down.documentTypes()).rejects.toMatchObject({ kind: "network" });
  });

  it("never puts the token in an error message", async () => {
    const client = createPaperlessClient(
      { baseUrl: BASE, token: "secret-token" },
      { fetch: fakeFetch({ [BASE]: () => new Response("", { status: 401 }) }) },
    );
    const error = (await client.documentTypes().catch((caught: unknown) => caught)) as PaperlessError;
    expect(error.message).not.toContain("secret-token");
  });
});

describe("helpers", () => {
  it("accepts an http(s) origin with an optional path, and nothing with credentials or a query", () => {
    expect(normalizeBaseUrl("http://paperless-ngx:8000/")).toBe("http://paperless-ngx:8000");
    expect(normalizeBaseUrl("https://docs.example.test/paperless/")).toBe(
      "https://docs.example.test/paperless",
    );
    expect(normalizeBaseUrl("ftp://x")).toBeNull();
    expect(normalizeBaseUrl("http://user:pw@x")).toBeNull();
    expect(normalizeBaseUrl("http://x/?a=1")).toBeNull();
    expect(normalizeBaseUrl("not a url")).toBeNull();
  });

  it("reads both forms of content-disposition", () => {
    expect(fileNameOf('attachment; filename="a b.pdf"')).toBe("a b.pdf");
    expect(fileNameOf("attachment; filename*=UTF-8''%C3%A8.pdf")).toBe("è.pdf");
    expect(fileNameOf(null)).toBeNull();
  });
});
