/**
 * The test kit of contract v1 (docs/design/rewrite-plan/04-now.md §4.1): what every plugin has to
 * do whatever its provider is. A plugin's own test starts its server and hands the address here;
 * the kit returns the list of what the plugin got wrong — empty for a plugin that keeps the
 * contract. It needs no provider: every check is about the plugin's own door.
 *
 * It imports `zod` schemas of this folder and nothing else, so a plugin outside this repository
 * can run it as it is.
 */
import { PLUGIN_PATHS, SECRET_HEADER } from "./calls";
import { SOURCE_PATHS } from "./calls-source";
import { CALENDAR_PATHS } from "./calls-calendar";
import { errorBodySchema, PLUGIN_ERROR_STATUS } from "./errors";
import { acceptsContract, manifestSchema, type PluginManifest } from "./manifest";

interface KitTarget {
  /** Where the plugin listens, with no path. */
  origin: string;
  /** The secret the plugin was started with. */
  secret: string;
  /** The id the plugin is configured under. */
  id: string;
}

const POSTS = [
  PLUGIN_PATHS.verify,
  PLUGIN_PATHS.institutions,
  PLUGIN_PATHS.authStart,
  PLUGIN_PATHS.authComplete,
  PLUGIN_PATHS.authRevoke,
  PLUGIN_PATHS.sync,
  PLUGIN_PATHS.prices,
];

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Whether a failed answer is the contract's: the status of its code, and a body with the code only. */
function isContractError(status: number, body: unknown, code: keyof typeof PLUGIN_ERROR_STATUS): boolean {
  const parsed = errorBodySchema.safeParse(body);
  return (
    parsed.success &&
    parsed.data.error.code === code &&
    status === PLUGIN_ERROR_STATUS[code] &&
    Object.keys(body as object).join() === "error"
  );
}

/** Runs every check and returns what failed, one sentence each. */
export async function checkPlugin(target: KitTarget): Promise<string[]> {
  const failures: string[] = [];
  const call = (path: string, init: RequestInit = {}, secret: string | null = target.secret) =>
    fetch(`${target.origin}${path}`, {
      ...init,
      headers: { ...(secret === null ? {} : { [SECRET_HEADER]: secret }), ...init.headers },
    });
  const post = (path: string, body: string, secret: string | null = target.secret) =>
    call(path, { method: "POST", headers: { "content-type": "application/json" }, body }, secret);

  const health = await call(PLUGIN_PATHS.health, {}, null);
  if (health.status !== 200) failures.push("GET /health must answer 200 without the secret");

  const manifest = await call(PLUGIN_PATHS.manifest);
  const parsed = manifestSchema.safeParse(await json(manifest));
  if (manifest.status !== 200 || !parsed.success) {
    failures.push("GET /manifest must answer a manifest of the contract");
  } else {
    if (parsed.data.id !== target.id) failures.push("the manifest must carry the plugin's own id");
    if (!acceptsContract(parsed.data.contract))
      failures.push("the manifest must name a contract the core speaks");
    const secrets = parsed.data.userSettings.filter((field) => field.type === "secret" && !field.writeOnly);
    if (secrets.length > 0) failures.push("a secret field of the manifest must be write-only");
  }

  for (const [what, secret] of [
    ["no secret", null],
    ["a wrong secret", `${target.secret}x`],
  ] as const) {
    const refused = await call(PLUGIN_PATHS.manifest, {}, secret);
    if (!isContractError(refused.status, await json(refused), "unauthorized")) {
      failures.push(`GET /manifest with ${what} must answer 401 unauthorized`);
    }
    const posted = await post(PLUGIN_PATHS.verify, "{}", secret);
    if (!isContractError(posted.status, await json(posted), "unauthorized")) {
      failures.push(`POST /verify with ${what} must answer 401 unauthorized`);
    }
  }

  for (const path of POSTS) {
    for (const [what, body] of [
      ["an empty object", "{}"],
      ["a body that is not JSON", "{not json"],
    ] as const) {
      const refused = await post(path, body);
      if (!isContractError(refused.status, await json(refused), "invalid_request")) {
        failures.push(`POST ${path} with ${what} must answer 400 invalid_request`);
      }
    }
  }

  if (parsed.success) failures.push(...(await checkSource(parsed.data, post)));
  if (parsed.success) failures.push(...(await checkCalendar(parsed.data, post)));

  const unknown = await post("/not-in-the-contract", "{}");
  if (!isContractError(unknown.status, await json(unknown), "invalid_request")) {
    failures.push("a path that is not in the contract must answer 400 invalid_request");
  }
  return failures;
}

type Post = (path: string, body: string) => Promise<Response>;

/** A push the contract would take, but for its idempotency key: the source must refuse it. */
const PUSH_WITHOUT_KEY = JSON.stringify({
  credentials: { token: "kit" },
  askedOn: null,
  movement: {
    accountExternalId: "kit",
    day: "2026-01-01",
    amount: "-1.00",
    payee: null,
    note: null,
    categoryExternalId: null,
  },
});

/** Contract 2: the calls of a source read with a token, for a plugin that declares them. */
async function checkSource(manifest: PluginManifest, post: Post): Promise<string[]> {
  if (!manifest.capabilities.includes("source.read")) return [];
  const failures: string[] = [];
  for (const path of Object.values(SOURCE_PATHS)) {
    const refused = await post(path, "{}");
    if (!isContractError(refused.status, await json(refused), "invalid_request")) {
      failures.push(`POST ${path} with an empty object must answer 400 invalid_request`);
    }
  }
  const unkeyed = await post(SOURCE_PATHS.push, PUSH_WITHOUT_KEY);
  if (!isContractError(unkeyed.status, await json(unkeyed), "invalid_request")) {
    failures.push(`POST ${SOURCE_PATHS.push} without an idempotency key must answer 400 invalid_request`);
  }
  return failures;
}

/** Contract 2: the calls of an external calendar of days off, for a plugin that declares them. */
async function checkCalendar(manifest: PluginManifest, post: Post): Promise<string[]> {
  if (!manifest.capabilities.includes("leaveCalendar")) return [];
  const answers = await Promise.all(
    Object.values(CALENDAR_PATHS).map(async (path) => {
      const answer = await post(path, "{}");
      return { path, kept: isContractError(answer.status, await json(answer), "invalid_request") };
    }),
  );
  return answers
    .filter((one) => !one.kept)
    .map((one) => `POST ${one.path} with an empty object must answer 400 invalid_request`);
}
