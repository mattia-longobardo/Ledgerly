import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PayslipExtraction } from "@/lib/contracts";
import { TEST_ENCRYPTION_KEY } from "@/test/encryption-key";

interface RunRow {
  id: number;
  jobName: string;
  trigger: string;
  dedupeKey: string | null;
  status: string;
  error: string | null;
  detail: Record<string, unknown> | null;
}

const store = vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgres://dashboard@localhost/dashboard",
    AUTH_URL: "https://dash.example.test",
    AUTH_SECRET: "a".repeat(40),
    OIDC_ISSUER: "https://auth.example.test/application/o/dashboard/",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
    AUTHORIZED_SUB: "sub-123",
    PAPERLESS_URL: "https://paperless.example.test",
    PAPERLESS_TOKEN: "paperless-token",
    CRON_SECRET: "c".repeat(20),
    WEBHOOK_SECRET: "w".repeat(20),
    // `vi.hoisted()`'s callback runs before any import binding in this file
    // is initialized (that is the whole point of the hoist), so
    // TEST_ENCRYPTION_KEY cannot be referenced from in here — it is set
    // right below instead, still ahead of the static imports that trigger
    // `env()`.
    GOTIFY_URL: "https://gotify.example.test",
    GOTIFY_TOKEN: "gotify-token",
  });
  return { runs: [] as RunRow[], nextRunId: 1 };
});
process.env.APP_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;

vi.mock("@/lib/repo/jobs", () => ({
  startRun: vi.fn(
    async (input: { jobName: string; trigger: string; dedupeKey?: string | null }) => {
      const row: RunRow = {
        id: store.nextRunId++,
        jobName: input.jobName,
        trigger: input.trigger,
        dedupeKey: input.dedupeKey ?? null,
        status: "running",
        error: null,
        detail: null,
      };
      store.runs.push(row);
      return row;
    },
  ),
  finishRun: vi.fn(
    async (
      id: number,
      status: string,
      extra?: { error?: string; detail?: Record<string, unknown> },
    ) => {
      const row = store.runs.find((r) => r.id === id);
      if (!row) throw new Error(`finishRun for unknown run ${id}`);
      row.status = status;
      row.error = extra?.error ?? null;
      row.detail = extra?.detail ?? null;
    },
  ),
}));

vi.mock("@/lib/repo/payslips", () => ({
  knownDocIds: vi.fn(async () => [] as number[]),
  discover: vi.fn(async () => ({ id: 77 })),
  storeExtraction: vi.fn(async () => ({ id: 77 })),
  verifiedPayslips: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/clients/paperless", () => ({
  getDocument: vi.fn(),
  downloadOriginal: vi.fn(),
}));

vi.mock("@/lib/payroll/text", () => ({ extractPdfText: vi.fn(async () => null) }));

vi.mock("@/lib/payroll/parse", () => ({ parsePayslip: vi.fn() }));

/** Keeps the ingest suite off the database when it resolves the LLM config. */
vi.mock("@/lib/payroll/llm-config", () => ({ llmOptionsFromConfig: vi.fn(async () => ({})) }));

/** Real Gotify, cut at the HTTP boundary, so the priority is actually asserted. */
vi.mock("@/lib/clients/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clients/http")>();
  return { ...actual, httpRequest: vi.fn(async () => new Response("{}", { status: 200 })) };
});

import { httpRequest } from "@/lib/clients/http";
import { downloadOriginal, getDocument } from "@/lib/clients/paperless";
import { parsePayslip } from "@/lib/payroll/parse";
import { extractPdfText } from "@/lib/payroll/text";
import { discover, knownDocIds, storeExtraction, verifiedPayslips } from "@/lib/repo/payslips";
import { ingestPayslipDocument } from "@/lib/jobs/payslip-ingest";

const DOC = {
  id: 4242,
  title: "Busta Paga di Agosto 2026",
  added: "2026-09-03T07:12:00Z",
  created: "2026-08-31",
  content: "NETTO BUSTA 2.145,33\nTOTALE LORDO 3.400,00",
  tags: [22],
};

function extraction(over: Partial<PayslipExtraction> = {}): PayslipExtraction {
  return {
    parserVersion: "payroll-1.0.0",
    month: "2026-08-01",
    isThirteenth: false,
    textSource: "ocr",
    fields: {
      net: { value: 2145.33, confidence: "high", rules: 2145.33, llm: 2145.33 },
      gross: { value: 3400, confidence: "medium", rules: 3400, llm: null },
      ferieBalance: { value: null, confidence: "low", rules: null, llm: null },
    },
    checks: [],
    ...over,
  };
}

function alerts(): Array<{ title: string; message: string; priority: number }> {
  return vi.mocked(httpRequest).mock.calls.map((call) =>
    JSON.parse(String(call[2]?.body ?? "{}")) as {
      title: string;
      message: string;
      priority: number;
    },
  );
}

function pdf(text: string): { data: ArrayBuffer; contentType: string; bytes: number } {
  const data = new TextEncoder().encode(text);
  return { data: data.buffer as ArrayBuffer, contentType: "application/pdf", bytes: data.byteLength };
}

beforeEach(() => {
  store.runs.length = 0;
  store.nextRunId = 1;
  vi.clearAllMocks();
  vi.mocked(knownDocIds).mockResolvedValue([]);
  vi.mocked(verifiedPayslips).mockResolvedValue([]);
  vi.mocked(discover).mockResolvedValue({ id: 77 } as Awaited<ReturnType<typeof discover>>);
  vi.mocked(storeExtraction).mockResolvedValue({ id: 77 } as Awaited<
    ReturnType<typeof storeExtraction>
  >);
  vi.mocked(getDocument).mockResolvedValue(DOC);
  vi.mocked(downloadOriginal).mockResolvedValue(pdf("%PDF-1.7"));
  vi.mocked(extractPdfText).mockResolvedValue(null);
  vi.mocked(parsePayslip).mockResolvedValue(extraction());
  vi.mocked(httpRequest).mockResolvedValue(new Response("{}", { status: 200 }));
});

describe("idempotency", () => {
  it("is a no-op for a paperless_doc_id already ingested", async () => {
    vi.mocked(knownDocIds).mockResolvedValue([4242]);

    const result = await ingestPayslipDocument({ docId: 4242, trigger: "webhook" });

    expect(result.status).toBe("already_done");
    expect(getDocument).not.toHaveBeenCalled();
    expect(downloadOriginal).not.toHaveBeenCalled();
    expect(discover).not.toHaveBeenCalled();
    expect(storeExtraction).not.toHaveBeenCalled();
    expect(alerts()).toEqual([]);
    // Even the no-op is observable in job_runs.
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({ status: "already_done", dedupeKey: "4242" });
  });

  it("treats a lost discovery race as already_done", async () => {
    vi.mocked(discover).mockResolvedValue(null);

    const result = await ingestPayslipDocument({ docId: 4242, trigger: "sweep" });

    expect(result.status).toBe("already_done");
    expect(storeExtraction).not.toHaveBeenCalled();
    expect(alerts()).toEqual([]);
  });
});

describe("text acquisition", () => {
  it("falls back to the Paperless OCR content and flags the source", async () => {
    const result = await ingestPayslipDocument({ docId: 4242, trigger: "webhook" });

    expect(result.status).toBe("success");
    expect(parsePayslip).toHaveBeenCalledWith(
      expect.objectContaining({ text: DOC.content, textSource: "ocr" }),
    );
    expect(result.detail?.textSource).toBe("ocr");
  });

  it("prefers the PDF text layer when the original carries one", async () => {
    vi.mocked(extractPdfText).mockResolvedValue("FERIE RES. 120,00\nROL. RES. 8,00");

    const result = await ingestPayslipDocument({ docId: 4242, trigger: "webhook" });

    expect(parsePayslip).toHaveBeenCalledWith(
      expect.objectContaining({ text: "FERIE RES. 120,00\nROL. RES. 8,00", textSource: "pdf" }),
    );
    expect(result.detail?.textSource).toBe("pdf");
  });

  it("still ingests when the download fails", async () => {
    vi.mocked(downloadOriginal).mockRejectedValue(new Error("paperless 503"));

    const result = await ingestPayslipDocument({ docId: 4242, trigger: "sweep" });

    expect(result.status).toBe("success");
    expect(parsePayslip).toHaveBeenCalledWith(
      expect.objectContaining({ text: DOC.content, textSource: "ocr" }),
    );
    expect(String(result.detail?.note)).toContain("paperless 503");
  });
});

describe("parse and store", () => {
  it("passes prior verified payslips as history", async () => {
    vi.mocked(verifiedPayslips).mockResolvedValue([
      {
        month: "2026-07-01",
        isThirteenth: false,
        net: "2100.00",
        gross: "3380.00",
        taxes: "980.00",
        ferieBalance: "112.00",
        rolBalance: "6.00",
      },
    ] as unknown as Awaited<ReturnType<typeof verifiedPayslips>>);

    await ingestPayslipDocument({ docId: 4242, trigger: "webhook" });

    expect(parsePayslip).toHaveBeenCalledWith(
      expect.objectContaining({
        history: [
          {
            month: "2026-07-01",
            isThirteenth: false,
            net: 2100,
            gross: 3380,
            taxes: 980,
            ferieBalance: 112,
            rolBalance: 6,
          },
        ],
      }),
    );
  });

  it("stores the extraction against the discovered row and alerts at priority 5", async () => {
    const result = await ingestPayslipDocument({ docId: 4242, trigger: "webhook" });

    expect(discover).toHaveBeenCalledWith(4242, "2026-08-01", false);
    expect(storeExtraction).toHaveBeenCalledWith(
      77,
      expect.objectContaining({ month: "2026-08-01", parserVersion: "payroll-1.0.0" }),
    );

    const sent = alerts();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.priority).toBe(5);
    expect(sent[0]?.message).toContain("https://dash.example.test/payroll/verify/77");
    expect(sent[0]?.message).toContain(DOC.title);
    expect(result.detail).toMatchObject({ payslipId: 77, month: "2026-08-01" });
  });

  it("carries the tredicesima flag into discovery", async () => {
    vi.mocked(parsePayslip).mockResolvedValue(
      extraction({ month: "2026-12-01", isThirteenth: true }),
    );

    await ingestPayslipDocument({ docId: 4243, trigger: "sweep" });

    expect(discover).toHaveBeenCalledWith(4243, "2026-12-01", true);
  });

  it("falls back to the Paperless date when the parser detects no period", async () => {
    vi.mocked(parsePayslip).mockResolvedValue(extraction({ month: null }));

    await ingestPayslipDocument({ docId: 4242, trigger: "webhook" });

    expect(discover).toHaveBeenCalledWith(4242, "2026-08-01", false);
  });
});

describe("failure handling", () => {
  it("never throws when Paperless is down, and records the failed run", async () => {
    vi.mocked(getDocument).mockRejectedValue(new Error("paperless 500"));

    const result = await ingestPayslipDocument({ docId: 4242, trigger: "webhook" });

    expect(result).toMatchObject({ job: "payslip_ingest", status: "failed" });
    expect(result.error).toContain("paperless 500");
    expect(store.runs[0]?.status).toBe("failed");
    // The sweep retries the same document within the hour; alerting here would
    // fire once per hour for a single outage.
    expect(alerts()).toEqual([]);
  });

  it("keeps a garbage document as a low-confidence pending row", async () => {
    vi.mocked(getDocument).mockResolvedValue({ ...DOC, content: "" });
    vi.mocked(parsePayslip).mockResolvedValue(
      extraction({
        fields: {
          net: { value: null, confidence: "low", rules: null, llm: null },
          gross: { value: null, confidence: "low", rules: null, llm: null },
        },
      }),
    );

    const result = await ingestPayslipDocument({ docId: 4242, trigger: "sweep" });

    expect(result.status).toBe("success");
    expect(result.detail?.lowConfidenceFields).toBe(2);
    expect(storeExtraction).toHaveBeenCalled();
    expect(alerts()[0]?.priority).toBe(5);
  });
});
