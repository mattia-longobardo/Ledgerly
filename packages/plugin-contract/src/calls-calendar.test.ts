import { describe, expect, it } from "vitest";
import { leaveReadResponseSchema, leaveWriteRequestSchema, leaveWriteResponseSchema } from "./calls-calendar";

const day = { day: "2026-06-16", fraction: 1, kind: "vacation" };

describe("contract 2, an external calendar of days off", () => {
  it("takes half a day or a whole one, and nothing else", () => {
    expect(leaveReadResponseSchema.safeParse({ days: [day, { ...day, fraction: 0.5 }] }).success).toBe(true);
    expect(leaveReadResponseSchema.safeParse({ days: [{ ...day, fraction: 0.25 }] }).success).toBe(false);
  });

  it("keeps the calendar's kind open, as a word and never a sentence", () => {
    expect(leaveReadResponseSchema.safeParse({ days: [{ ...day, kind: "comp" }] }).success).toBe(true);
    expect(leaveReadResponseSchema.safeParse({ days: [{ ...day, kind: null }] }).success).toBe(true);
    expect(leaveReadResponseSchema.safeParse({ days: [{ ...day, kind: "Paid leave" }] }).success).toBe(false);
  });

  it("asks a write for its days to take away by name, never by absence", () => {
    const request = { credentials: { baseUrl: "https://x" }, year: 2026, desired: [day] };
    expect(leaveWriteRequestSchema.safeParse({ ...request, remove: [] }).success).toBe(true);
    expect(leaveWriteRequestSchema.safeParse(request).success).toBe(false);
  });

  it("says why a day was refused with a code, never the calendar's words", () => {
    const refused = (reason: string) => ({
      outcomes: [{ day: day.day, state: "refused", reason }],
      days: [],
    });
    expect(leaveWriteResponseSchema.safeParse(refused("permission")).success).toBe(true);
    expect(leaveWriteResponseSchema.safeParse(refused("Cannot book a weekend")).success).toBe(false);
    const done = { outcomes: [{ day: day.day, state: "done", reason: "permission" }], days: [] };
    expect(leaveWriteResponseSchema.safeParse(done).success).toBe(false);
  });
});
