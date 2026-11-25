// scripts/openapi.ts — `npm run openapi [-- --check | -- --release]` (rewrite plan R2). Writes the
// OpenAPI document of `/api/v1` from the contract's descriptors into `docs/openapi.json`; `--check`
// fails when the file is not what the contract gives. `--release` also copies it to
// `baselines/contract/openapi.json`, the document of the last release that `tools/contract.test.ts`
// holds the next one to: a release may only add (03-releases.md R2, criterion 11).
import { readFileSync, writeFileSync } from "node:fs";
import { API_LEVEL, CONTRACT_ROUTES, openApiDocument } from "@ledgerly/api-contract";

export const DOCUMENT = "docs/openapi.json";
export const RELEASED = "baselines/contract/openapi.json";

export const generated = (): string =>
  `${JSON.stringify(openApiDocument(CONTRACT_ROUTES, String(API_LEVEL)), null, 2)}\n`;

type Schema = Record<string, unknown>;
const object = (value: unknown): Schema => (value && typeof value === "object" ? (value as Schema) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * What `next` takes away from a client written against `before`. A request may not ask for more
 * (a new required field, a value it refused); an answer may not give less (a field or a value
 * gone, a field no longer always there). `direction` says which side the schema is on.
 */
function schemaBreaks(
  before: Schema,
  next: Schema,
  where: string,
  direction: "request" | "response",
): string[] {
  const found: string[] = [];
  if (before.type !== undefined && JSON.stringify(before.type) !== JSON.stringify(next.type)) {
    return [`${where}: type ${JSON.stringify(before.type)} → ${JSON.stringify(next.type)}`];
  }
  const values = list(before.enum);
  const nextValues = list(next.enum);
  for (const value of values) {
    if (!nextValues.includes(value)) found.push(`${where}: value ${JSON.stringify(value)} gone`);
  }
  const properties = object(before.properties);
  const nextProperties = object(next.properties);
  for (const [name, schema] of Object.entries(properties)) {
    if (!(name in nextProperties)) found.push(`${where}.${name}: gone`);
    else
      found.push(
        ...schemaBreaks(object(schema), object(nextProperties[name]), `${where}.${name}`, direction),
      );
  }
  const required = list(before.required);
  const nextRequired = list(next.required);
  if (direction === "response") {
    for (const name of required)
      if (!nextRequired.includes(name)) found.push(`${where}.${name}: no longer always there`);
  } else {
    for (const name of nextRequired)
      if (!required.includes(name)) found.push(`${where}.${name}: newly required`);
  }
  if (before.items !== undefined)
    found.push(...schemaBreaks(object(before.items), object(next.items), `${where}[]`, direction));
  for (const key of ["anyOf", "oneOf"] as const) {
    const options = list(before[key]);
    const nextOptions = list(next[key]);
    if (options.length > nextOptions.length) found.push(`${where}: ${key} lost an option`);
    else
      options.forEach((option, index) =>
        found.push(
          ...schemaBreaks(object(option), object(nextOptions[index]), `${where}|${index}`, direction),
        ),
      );
  }
  return found;
}

/** Every change of `next` that is not an addition to `before`: empty means «solo additivo». */
export function breakingChanges(before: Schema, next: Schema): string[] {
  const found: string[] = [];
  const paths = object(before.paths);
  const nextPaths = object(next.paths);
  for (const [path, item] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(object(item))) {
      const where = `${method.toUpperCase()} ${path}`;
      const nextOperation = object(object(nextPaths[path])[method]);
      if (Object.keys(nextOperation).length === 0) {
        found.push(`${where}: gone`);
        continue;
      }
      const op = object(operation);
      if (op["x-scope"] !== nextOperation["x-scope"]) found.push(`${where}: scope changed`);
      const params = new Map(
        list(op.parameters).map((p) => [`${object(p).in}:${object(p).name}`, object(p)]),
      );
      for (const parameter of list(nextOperation.parameters).map(object)) {
        const key = `${parameter.in}:${parameter.name}`;
        const old = params.get(key);
        if (!old && parameter.required) found.push(`${where}: new required parameter ${key}`);
        if (old)
          found.push(
            ...schemaBreaks(object(old.schema), object(parameter.schema), `${where} ${key}`, "request"),
          );
      }
      for (const key of params.keys()) {
        if (!list(nextOperation.parameters).some((p) => `${object(p).in}:${object(p).name}` === key)) {
          found.push(`${where}: parameter ${key} gone`);
        }
      }
      const body = (o: Schema) =>
        object(object(object(object(o.requestBody).content)["application/json"]).schema);
      // A new body the route may go without (`required: false`) asks nothing more of an old client.
      if (
        op.requestBody === undefined &&
        nextOperation.requestBody !== undefined &&
        object(nextOperation.requestBody).required !== false
      ) {
        found.push(`${where}: a body is now required`);
      } else if (op.requestBody !== undefined) {
        found.push(...schemaBreaks(body(op), body(nextOperation), `${where} body`, "request"));
      }
      const responses = object(op.responses);
      const nextResponses = object(nextOperation.responses);
      for (const [status, response] of Object.entries(responses)) {
        if (!(status in nextResponses)) {
          found.push(`${where}: answer ${status} gone`);
          continue;
        }
        const schema = (r: unknown) => object(object(object(object(r).content)["application/json"]).schema);
        found.push(
          ...schemaBreaks(schema(response), schema(nextResponses[status]), `${where} ${status}`, "response"),
        );
      }
    }
  }
  return found;
}

if (process.argv[1]?.endsWith("openapi.ts")) {
  const text = generated();
  if (process.argv.includes("--check")) {
    if (readFileSync(DOCUMENT, "utf8") !== text) {
      console.error(`${DOCUMENT} is not what the contract gives: run npm run openapi`);
      process.exit(1);
    }
    console.log(`${DOCUMENT}: unchanged`);
  } else {
    writeFileSync(DOCUMENT, text);
    if (process.argv.includes("--release")) writeFileSync(RELEASED, text);
    console.log(`${DOCUMENT} written${process.argv.includes("--release") ? `, and ${RELEASED}` : ""}`);
  }
}
