import { imports } from "@ledgerly/api-contract/imports";
import { profile, security } from "@ledgerly/api-contract/settings";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, call } from "./index";

const PROFILE = {
  id: "7d4f1c2e-9b8a-4c3d-8e5f-1a2b3c4d5e6f",
  name: "Alex Example",
  email: "alex@example.test",
  role: "user",
  managedByProvider: false,
  twoFactor: false,
};

function answer(status: number, body: unknown) {
  const fetcher = vi.fn(
    async (...request: [string, RequestInit]) =>
      request && new Response(body === null ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

describe("call", () => {
  it("reads with the session and no proof of origin, and checks the answer's shape", async () => {
    const fetcher = answer(200, PROFILE);
    await expect(call(profile.getProfile, {})).resolves.toEqual(PROFILE);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/profile");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).not.toHaveProperty("x-ledgerly-csrf");
  });

  it("reads from a server: the API's origin and the person's cookie", async () => {
    const fetcher = answer(200, PROFILE);
    const transport = { origin: "http://api.internal:3000", headers: { cookie: "session=abc" } };
    await call(profile.getProfile, {}, transport);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("http://api.internal:3000/api/v1/profile");
    expect(init?.headers).toMatchObject({ cookie: "session=abc", accept: "application/json" });
  });

  it("writes with the header that proves the app sent it, and a JSON body", async () => {
    const fetcher = answer(200, { ...PROFILE, name: "Alex Sample" });
    await call(profile.updateProfile, { body: { name: "Alex Sample" } });
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toMatchObject({ "x-ledgerly-csrf": "1", "content-type": "application/json" });
    expect(init?.body).toBe(JSON.stringify({ name: "Alex Sample" }));
  });

  it("puts the path parameters in the address and answers nothing for a 204", async () => {
    const fetcher = answer(204, null);
    const id = "0b6c3f9e-2d41-4a7b-9c8e-5f1a2b3c4d5e";
    await expect(call(security.revokeSession, { params: { id } })).resolves.toBeNull();
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/sessions/${id}`);
  });

  it("throws the refusal's code and reason", async () => {
    answer(409, { error: "conflict", reason: "sso" });
    await expect(call(profile.updateProfile, { body: { name: "x" } })).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      reason: "sso",
    });
  });

  it("carries the name of the account a refusal is about", async () => {
    answer(409, { error: "conflict", reason: "iban_exists", other: "Bills" });
    await expect(call(profile.updateProfile, { body: { name: "x" } })).rejects.toMatchObject({
      reason: "iban_exists",
      other: "Bills",
    });
  });

  it("carries the dates a booking refused, and drops an entry that is not one", async () => {
    answer(409, {
      error: "conflict",
      reason: "not_bookable",
      refused: [{ on: "2026-08-15", reason: "holiday" }, { on: 15 }],
    });
    await expect(call(profile.updateProfile, { body: { name: "x" } })).rejects.toMatchObject({
      reason: "not_bookable",
      refused: [{ on: "2026-08-15", reason: "holiday" }],
    });
  });

  it("carries since when a reading runs, for the refusal of «Deactivate» (H56)", async () => {
    answer(409, { error: "conflict", reason: "reading_in_progress", startedAt: "2026-11-25T13:02:00.000Z" });
    await expect(call(profile.updateProfile, { body: { name: "x" } })).rejects.toMatchObject({
      reason: "reading_in_progress",
      startedAt: "2026-11-25T13:02:00.000Z",
    });
  });

  it("refuses an answer that is not the declared shape", async () => {
    answer(200, { name: 1 });
    await expect(call(profile.getProfile, {})).rejects.toBeInstanceOf(ApiError);
  });
});

describe("call with a multipart body", () => {
  it("sends a form, with the file as it is and no JSON content type", async () => {
    const fetcher = answer(201, {
      id: "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
      kind: "payslip",
      fileName: "payslip.pdf",
      state: "received",
      duplicate: false,
    });
    const file = new File([new Uint8Array([37, 80, 68, 70])], "payslip.pdf");
    await call(imports.uploadDocument, { body: { kind: "payslip", file } });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/imports");
    expect(init?.headers).toMatchObject({ "x-ledgerly-csrf": "1" });
    expect(init?.headers).not.toHaveProperty("content-type");
    const form = init?.body;
    expect(form).toBeInstanceOf(FormData);
    if (!(form instanceof FormData)) return;
    expect(form.get("kind")).toBe("payslip");
    expect(form.get("file")).toMatchObject({ name: "payslip.pdf", size: 4 });
  });
});
