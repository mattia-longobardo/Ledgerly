// The OpenAPI document of `/api/v1`, generated from the descriptors (rewrite plan R2). zod 4 writes
// the JSON Schemas itself (`z.toJSONSchema`): no generator package (decision H11).
import { z } from "zod";
import { API_ERRORS } from "./errors";
import { errorBody } from "./errors";
import { addonOf } from "./routes";
import type { RouteContract } from "./route";

type Json = Record<string, unknown>;

function schemaOf(schema: z.ZodType, side: "input" | "output"): Json {
  const json: Json = z.toJSONSchema(schema, { io: side, unrepresentable: "any" });
  // The document names the draft once, not once per schema.
  delete json.$schema;
  return json;
}

/**
 * An answer may gain fields in a later release (OpenAPI «solo additivo»): a client that refused an
 * unknown field would break on the first addition, so no answer says `additionalProperties: false`.
 */
function open(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(open);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key, value]) => !(key === "additionalProperties" && value === false))
      .map(([key, value]) => [key, open(value)]),
  );
}

function parameters(route: RouteContract): Json[] {
  const fields = (where: "path" | "query", shape: z.ZodObject | undefined): Json[] => {
    if (!shape) return [];
    const json = schemaOf(shape, "input");
    const required = Array.isArray(json.required) ? json.required : [];
    return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
      name,
      in: where,
      required: where === "path" || required.includes(name),
      schema,
    }));
  };
  return [...fields("path", route.params), ...fields("query", route.query)];
}

function responses(route: RouteContract): Json {
  const status = String(route.status ?? 200);
  const success: Json =
    route.response === null
      ? { description: "Done" }
      : {
          description: "Done",
          content: { "application/json": { schema: open(schemaOf(route.response, "output")) } },
        };
  const codes = [
    ...(route.scope === null ? [] : (["unauthorized", "forbidden", "rate_limited"] as const)),
    ...route.errors,
    // A body over the limit of its format is refused before it is read (SEC-04).
    ...(route.body && !route.errors.includes("too_large") ? (["too_large"] as const) : []),
    // A route of an addon answers this one while the person has the addon off (H52).
    ...(addonOf(route) ? (["module_inactive"] as const) : []),
  ];
  // Two codes of one status share its entry: `conflict` and `module_inactive` are both 409.
  const byStatus = new Map<string, string[]>();
  for (const code of codes)
    byStatus.set(String(API_ERRORS[code]), [...(byStatus.get(String(API_ERRORS[code])) ?? []), code]);
  const failures = Object.fromEntries(
    [...byStatus].map(([status, named]) => [
      status,
      {
        description: named.join(", "),
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    ]),
  );
  const other = route.otherStatus
    ? { [String(route.otherStatus.status)]: { ...success, description: route.otherStatus.when } }
    : {};
  return { [status]: success, ...other, ...failures };
}

function operation(route: RouteContract): Json {
  const params = parameters(route);
  return {
    operationId: route.id,
    summary: route.summary,
    tags: [route.capability],
    ...(params.length > 0 ? { parameters: params } : {}),
    ...(route.body
      ? {
          requestBody: {
            // A body the route may go without (`.optional()`) is not required.
            required: !route.body.safeParse(undefined).success,
            content: {
              [route.bodyFormat === "multipart" ? "multipart/form-data" : "application/json"]: {
                schema: schemaOf(route.body, "input"),
              },
            },
          },
        }
      : {}),
    responses: responses(route),
    ...(route.scope === null ? { security: [] } : { security: [{ bearer: [] }], "x-scope": route.scope }),
    ...(addonOf(route) ? { "x-addon": addonOf(route) } : {}),
  };
}

/** The whole document, paths and methods in a fixed order so the file in the repository is stable. */
export function openApiDocument(routes: readonly RouteContract[], version: string): Json {
  const paths: Record<string, Json> = {};
  const sorted = [...routes].sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
  for (const route of sorted) {
    paths[route.path] = { ...paths[route.path], [route.method.toLowerCase()]: operation(route) };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Ledgerly API", version },
    servers: [{ url: "/api/v1" }],
    paths,
    components: {
      schemas: { Error: open(schemaOf(errorBody, "output")) },
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
    },
  };
}
