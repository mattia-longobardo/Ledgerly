import { describe, expect, it, vi } from "vitest";
import { createS3DocumentStore } from "./s3-document-store";

const config = {
  endpoint: "https://silo.internal",
  bucket: "payroll",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

const bytes = new TextEncoder().encode("%PDF-1.7 hi");

function storeWith(impl: (req: Request) => Promise<Response>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(new Request(input as URL | string, init)),
  );
  return { store: createS3DocumentStore({ ...config, fetchImpl: fetchImpl as unknown as typeof fetch }), fetchImpl };
}

describe("createS3DocumentStore", () => {
  it("names itself silo, so the import row records which store holds the object", () => {
    expect(storeWith(async () => new Response(null, { status: 200 })).store.provider).toBe("silo");
  });

  it("PUTs to endpoint/bucket/key with a signed Authorization header and the content type", async () => {
    const { store, fetchImpl } = storeWith(async () => new Response(null, { status: 200 }));
    await store.put("payroll/u1/2026/a.pdf", bytes, "application/pdf");
    const req = fetchImpl.mock.calls[0]![0] as unknown as Request;
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("https://silo.internal/payroll/payroll/u1/2026/a.pdf");
    expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(req.headers.get("content-type")).toBe("application/pdf");
    expect(req.headers.get("x-amz-content-sha256")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("GET returns the bytes", async () => {
    const { store } = storeWith(async () => new Response(bytes, { status: 200 }));
    expect(await store.get("payroll/u1/2026/a.pdf")).toEqual(bytes);
  });

  it("GET answers null on 404 rather than throwing — a purged original is expected", async () => {
    const { store } = storeWith(async () => new Response("", { status: 404 }));
    expect(await store.get("payroll/u1/2026/gone.pdf")).toBeNull();
  });

  it("GET throws on 500, so a broken silo never looks like a purged object", async () => {
    const { store } = storeWith(async () => new Response("boom", { status: 500 }));
    await expect(store.get("payroll/u1/2026/a.pdf")).rejects.toThrow(/document store GET failed: 500/);
  });

  it("DELETE treats 204 and 404 alike, so the retention job is idempotent", async () => {
    const { store: s204 } = storeWith(async () => new Response(null, { status: 204 }));
    await expect(s204.delete("payroll/u1/2026/a.pdf")).resolves.toBeUndefined();
    const { store: s404 } = storeWith(async () => new Response("", { status: 404 }));
    await expect(s404.delete("payroll/u1/2026/a.pdf")).resolves.toBeUndefined();
  });

  it("listPrefix pages through continuation tokens and returns full keys", async () => {
    let call = 0;
    const { store } = storeWith(async () => {
      call += 1;
      const body =
        call === 1
          ? `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>` +
            `<Contents><Key>payroll/u1/2026/a.pdf</Key></Contents>` +
            `<NextContinuationToken>tok</NextContinuationToken></ListBucketResult>`
          : `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>` +
            `<Contents><Key>payroll/u1/2025/b.pdf</Key></Contents></ListBucketResult>`;
      return new Response(body, { status: 200 });
    });
    expect(await store.listPrefix("payroll/u1/")).toEqual(["payroll/u1/2026/a.pdf", "payroll/u1/2025/b.pdf"]);
    expect(call).toBe(2);
  });

  it("PUT throws with the status on a rejected write, so a failed upload never records a storage key", async () => {
    const { store } = storeWith(async () => new Response("denied", { status: 403 }));
    await expect(store.put("payroll/u1/2026/a.pdf", bytes, "application/pdf")).rejects.toThrow(
      /document store PUT failed: 403/,
    );
  });
});
