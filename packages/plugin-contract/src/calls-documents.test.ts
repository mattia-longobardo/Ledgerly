import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkPlugin } from "./kit";
import { DOCUMENT_PATHS, documentReadRequestSchema, documentReadResponseSchema } from "./index";

// E1 (10-modularity.md §10.11): the call of a document reader, its request and its answer, and the
// kit's check for a plugin that declares `documents.read`.

const file = { name: "payslip.pdf", mediaType: "application/pdf", content: "JVBERi0=" };

const answer = {
  kind: "payslip",
  confidence: 0.92,
  data: { netPay: 2140.5, employer: "Acme", lines: [{ code: "1000", amount: 2500 }], sealed: null },
  evidence: [
    { field: "netPay", page: 1, box: { left: 420, top: 700, width: 80, height: 12 }, text: "2.140,50" },
  ],
};

describe("the call of a document reader", () => {
  it("takes a file as base64 with its media type, and a profile or none", () => {
    expect(documentReadRequestSchema.safeParse({ file }).success).toBe(true);
    expect(documentReadRequestSchema.safeParse({ file, profile: null }).success).toBe(true);
    const profile = { id: "acme-2026", data: { columns: ["code", "amount"] } };
    expect(documentReadRequestSchema.safeParse({ file, profile }).success).toBe(true);
    expect(documentReadRequestSchema.safeParse({}).success).toBe(false);
    expect(documentReadRequestSchema.safeParse({ file: { ...file, content: "not base64!" } }).success).toBe(
      false,
    );
    expect(documentReadRequestSchema.safeParse({ file: { ...file, mediaType: "PDF file" } }).success).toBe(
      false,
    );
  });

  it("refuses a file larger than the core's upload", () => {
    const large = "A".repeat(Math.ceil((10 * 1024 * 1024) / 3) * 4 + 4);
    expect(documentReadRequestSchema.safeParse({ file: { ...file, content: large } }).success).toBe(false);
  });

  it("answers a kind of an open vocabulary, a confidence, typed data and the evidence", () => {
    expect(documentReadResponseSchema.safeParse(answer).success).toBe(true);
    expect(documentReadResponseSchema.safeParse({ ...answer, kind: "bank-statement" }).success).toBe(true);
    expect(documentReadResponseSchema.safeParse({ ...answer, kind: "Bank statement" }).success).toBe(false);
    expect(documentReadResponseSchema.safeParse({ ...answer, confidence: 1.2 }).success).toBe(false);
    expect(documentReadResponseSchema.safeParse({ ...answer, data: { nested: { deep: 1 } } }).success).toBe(
      false,
    );
    const noBox = { ...answer, evidence: [{ field: "employer", page: null, box: null, text: null }] };
    expect(documentReadResponseSchema.safeParse(noBox).success).toBe(true);
  });
});

/** A plugin that declares `documents.read` and answers its call with `status`. */
function fakeReader(status: number): Promise<Server> {
  const manifest = {
    id: "reader",
    version: "1.0.0",
    contract: "2",
    labels: { name: { en: "Reader", it: "Lettore" }, description: { en: "Reads", it: "Legge" } },
    capabilities: ["documents.read"],
    userSettings: [],
    connectionFields: [],
    egress: [],
    schedule: { recommendedPerDay: 1, minIntervalMinutes: 60 },
    providesCategories: false,
  };
  const server = createServer((request, response) => {
    const body =
      request.url === "/manifest"
        ? manifest
        : {
            error: {
              code: request.url === DOCUMENT_PATHS.read && status === 200 ? "none" : "invalid_request",
            },
          };
    response.writeHead(request.url === "/manifest" ? 200 : status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

let server: Server | undefined;
afterEach(() => server?.close());

const documentFailures = async (status: number) => {
  server = await fakeReader(status);
  const { port } = server.address() as AddressInfo;
  const failures = await checkPlugin({ origin: `http://127.0.0.1:${port}`, secret: "kit", id: "reader" });
  return failures.filter((failure) => failure.includes(DOCUMENT_PATHS.read));
};

describe("the kit", () => {
  it("asks a plugin that declares documents.read to refuse an empty request with 400", async () => {
    expect(await documentFailures(400)).toEqual([]);
    expect(await documentFailures(200)).toEqual([
      "POST /documents/read with an empty object must answer 400 invalid_request",
    ]);
  });
});
