/**
 * The calls of the contract, one function each: read the body through the contract's schema, open
 * Trek with the machine client of that body, answer in the contract's shape. Nothing is kept
 * between two calls; a failure of Trek becomes a code of the contract in `server.ts`.
 */
import type { z } from "zod";
import {
  type LeaveDay,
  type LeaveOutcome,
  type LeaveWriteResponse,
  leaveFiguresRequestSchema,
  leaveReadRequestSchema,
  leaveWriteRequestSchema,
  verifyRequestSchema,
  type VerifyResponse,
} from "@ledgerly/plugin-contract";
import { type ToggleResult, TrekClient, type TrekClientOptions } from "./client";
import { PluginFailure } from "./failure";
import { type DesiredDay, planToggles, type TogglePlanStep, type TrekEntry } from "./plan";

export type Deps = TrekClientOptions;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PluginFailure("invalid_request");
  return parsed.data;
}

/** Tab, the visible ASCII range and `obs-text`: everything an HTTP header value may carry. */
function isHeaderValueCode(code: number): boolean {
  return code === 0x09 || (code >= 0x20 && code <= 0x7e) || (code >= 0x80 && code <= 0xff);
}

/**
 * Whether a credential can be sent at all. One pasted out of a wrapped page keeps a line break in
 * the middle, where `trim()` cannot reach it: refused before any request instead of being quoted
 * into an error.
 */
function isUsableToken(token: string): boolean {
  const trimmed = token.trim();
  return (
    trimmed !== "" && [...trimmed].every((character) => isHeaderValueCode(character.codePointAt(0) ?? 0))
  );
}

/** Trek, opened with the machine client of one call's credentials: the person's own Trek. */
function trekOf(credentials: Record<string, string>, deps: Deps): TrekClient {
  const { baseUrl, clientId, clientSecret } = credentials;
  if (baseUrl === undefined || clientId === undefined || clientSecret === undefined) {
    throw new PluginFailure("invalid_request");
  }
  if (!/^https:\/\/\S+$/.test(baseUrl.trim()) || !isUsableToken(clientId) || !isUsableToken(clientSecret)) {
    throw new PluginFailure("key_format");
  }
  return new TrekClient(
    { baseUrl: baseUrl.trim(), clientId: clientId.trim(), clientSecret: clientSecret.trim() },
    deps,
  );
}

function dayOf(entry: TrekEntry): LeaveDay {
  return { day: entry.date, fraction: entry.fraction, kind: entry.kind };
}

/** One read of this year proves the machine client and the address; the grant says what it may do. */
export async function verify(body: unknown, deps: Deps = {}): Promise<VerifyResponse> {
  const trek = trekOf(parse(verifyRequestSchema, body).credentials, deps);
  await trek.getEntries(new Date((deps.now ?? Date.now)()).getUTCFullYear());
  if (trek.writeAllowed === null) return { access: "unverifiable" };
  return { access: trek.writeAllowed ? "write" : "read-only" };
}

export async function read(body: unknown, deps: Deps = {}): Promise<{ days: LeaveDay[] }> {
  const request = parse(leaveReadRequestSchema, body);
  return { days: (await trekOf(request.credentials, deps).getEntries(request.year)).map(dayOf) };
}

export async function figures(body: unknown, deps: Deps = {}) {
  const request = parse(leaveFiguresRequestSchema, body);
  return { figures: await trekOf(request.credentials, deps).getStats(request.year) };
}

const OUTCOMES: Record<ToggleResult["outcome"], (day: string) => LeaveOutcome> = {
  applied: (day) => ({ day, state: "done", reason: null }),
  weekend_blocked: (day) => ({ day, state: "refused", reason: "not_bookable" }),
  scope_refused: (day) => ({ day, state: "refused", reason: "permission" }),
  unexpected_action: (day) => ({ day, state: "failed", reason: "changed" }),
  failed: (day) => ({ day, state: "failed", reason: "unknown" }),
};

/**
 * Each step once and in order. Once Trek has refused a write for its scope — or the token is known
 * to be a reading one — nothing more is sent: every other write would be refused the same way.
 */
async function sendSteps(trek: TrekClient, steps: readonly TogglePlanStep[]) {
  const outcomes: LeaveOutcome[] = [];
  let sent = 0;
  for (const step of steps) {
    if (trek.writeAllowed === false || outcomes.some((one) => one.reason === "permission")) {
      outcomes.push(OUTCOMES.scope_refused(step.date));
      continue;
    }
    sent += 1;
    outcomes.push(OUTCOMES[(await trek.toggleEntry(step)).outcome](step.date));
  }
  return { outcomes, sent };
}

/** The days of the request as Trek's own, or a refusal: Trek knows two kinds and one row per date. */
function desiredOf(request: z.infer<typeof leaveWriteRequestSchema>): DesiredDay[] {
  const dates = [...request.desired.map((one) => one.day), ...request.remove];
  // A date twice would be toggled twice, and the second toggle undoes the first.
  if (new Set(dates).size !== dates.length || dates.some((date) => !date.startsWith(`${request.year}-`))) {
    throw new PluginFailure("invalid_request");
  }
  return request.desired.map((one) => {
    if (one.kind !== "vacation" && one.kind !== "comp") throw new PluginFailure("invalid_request");
    return { date: one.day, fraction: one.fraction, kind: one.kind };
  });
}

/**
 * Read, plan the fewest toggles, send each once, and read again when something was sent: the core
 * settles from what Trek holds after the writes, never from what the toggles answered.
 */
export async function write(body: unknown, deps: Deps = {}): Promise<LeaveWriteResponse> {
  const request = parse(leaveWriteRequestSchema, body);
  const desired = desiredOf(request);
  const trek = trekOf(request.credentials, deps);
  const before = await trek.getEntries(request.year);
  const plan = planToggles(before, desired, request.remove);
  const { outcomes, sent } = await sendSteps(trek, plan.steps);
  const untouched = [...plan.unchanged, ...plan.alreadyAbsent].map((day): LeaveOutcome => ({
    day,
    state: "unchanged",
    reason: null,
  }));
  const after = sent > 0 ? await trek.getEntries(request.year) : before;
  return { outcomes: [...untouched, ...outcomes], days: after.map(dayOf) };
}
