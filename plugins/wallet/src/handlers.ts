/**
 * The calls of the contract, one function each: read the body through the contract's schema, open
 * Wallet with the token of that body, answer in the contract's shape. Nothing is kept between two
 * calls; a failure of Wallet becomes a code of the contract in `server.ts`.
 */
import type { z } from "zod";
import {
  editRequestSchema,
  type EditResponse,
  pushRequestSchema,
  type PushResponse,
  sourceAccountsRequestSchema,
  type SourceAccountsResponse,
  sourceCategoriesRequestSchema,
  type SourceCategoriesResponse,
  sourceMovementsRequestSchema,
  type SourceMovementsResponse,
  sourceRecordRequestSchema,
  type SourceRecordResponse,
  verifyRequestSchema,
  type VerifyResponse,
  writeCategoriesRequestSchema,
  type WriteCategoriesResponse,
} from "@ledgerly/plugin-contract";
import { readAccounts } from "./accounts";
import { readCategories, writeCategories } from "./categories";
import { windowDays } from "./days";
import { editRecord } from "./edit";
import { PluginFailure } from "./failure";
import { openWallet, type Wallet, type WalletDeps } from "./http";
import { pushMovement } from "./push";
import { readMovements, readRecord } from "./records";

export type Deps = WalletDeps;

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
 * Whether a token can be sent at all. A token pasted out of a wrapped page keeps a line break in
 * the middle, where `trim()` cannot reach it, and a header built from it fails with an error that
 * quotes the whole value: refused before any request instead.
 */
export function isUsableToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed === "") return false;
  return [...trimmed].every((character) => isHeaderValueCode(character.codePointAt(0) ?? 0));
}

/** Wallet, opened with the token of one call's credentials. */
function walletOf(credentials: Record<string, string>, deps: Deps): Wallet {
  const token = credentials.token;
  if (token === undefined) throw new PluginFailure("invalid_request");
  if (!isUsableToken(token)) throw new PluginFailure("key_format");
  return openWallet(token, deps);
}

/** A Wallet token reads and writes alike: one cheap read says whether Wallet takes it. */
export async function verify(body: unknown, deps: Deps = {}): Promise<VerifyResponse> {
  const request = parse(verifyRequestSchema, body);
  await readAccounts(walletOf(request.credentials, deps));
  return { access: "write" };
}

export async function accounts(body: unknown, deps: Deps = {}): Promise<SourceAccountsResponse> {
  const request = parse(sourceAccountsRequestSchema, body);
  return readAccounts(walletOf(request.credentials, deps));
}

export async function categories(body: unknown, deps: Deps = {}): Promise<SourceCategoriesResponse> {
  const request = parse(sourceCategoriesRequestSchema, body);
  return { categories: await readCategories(walletOf(request.credentials, deps)) };
}

export async function movements(body: unknown, deps: Deps = {}): Promise<SourceMovementsResponse> {
  const request = parse(sourceMovementsRequestSchema, body);
  const window = { from: request.from, to: request.to };
  if (windowDays(window) === null) throw new PluginFailure("invalid_request");
  return { movements: await readMovements(walletOf(request.credentials, deps), window) };
}

export async function record(body: unknown, deps: Deps = {}): Promise<SourceRecordResponse> {
  const request = parse(sourceRecordRequestSchema, body);
  const found = await readRecord(walletOf(request.credentials, deps), request.externalId);
  return { movement: found?.movement ?? null };
}

export async function push(body: unknown, deps: Deps = {}): Promise<PushResponse> {
  const request = parse(pushRequestSchema, body);
  return pushMovement(walletOf(request.credentials, deps), request);
}

export async function edit(body: unknown, deps: Deps = {}): Promise<EditResponse> {
  const request = parse(editRequestSchema, body);
  return editRecord(walletOf(request.credentials, deps), request.externalId, request.edit);
}

export async function writeCategoriesCall(body: unknown, deps: Deps = {}): Promise<WriteCategoriesResponse> {
  const request = parse(writeCategoriesRequestSchema, body);
  return writeCategories(walletOf(request.credentials, deps), request);
}
