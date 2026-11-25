import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { CSV_MAX_BYTES } from "@ledgerly/api-contract";
import { imports } from "@ledgerly/api-contract/imports";
import { MAX_DOCUMENT_BYTES } from "@ledgerly/domain/imports";
import { type ApiEnv, BODY_MAX_BYTES, serve } from "./serve";

const multipart = imports.uploadDocument;
const json = { ...multipart, id: "json_body", bodyFormat: "json" as const, path: "/json" };

function appWith(handler: () => Promise<unknown>) {
  const app = new Hono<ApiEnv>();
  const guard = () => async (_context: unknown, next: () => Promise<void>) => next();
  serve(app, guard, multipart, handler as never);
  serve(app, guard, json, handler as never);
  return app;
}

/** A body sent in chunks with no `content-length`, which counts how much of it was read. */
function chunked(chunks: number, size: number) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks) return controller.close();
      pulled += 1;
      controller.enqueue(new Uint8Array(size));
    },
  });
  return { body, pulled: () => pulled };
}

describe("serve: the size of a body (SEC-04)", () => {
  it("leaves room for the largest file a use case takes", () => {
    expect(BODY_MAX_BYTES.multipart).toBeGreaterThan(Math.max(CSV_MAX_BYTES, MAX_DOCUMENT_BYTES));
  });

  it("is below the limit of the proxy on every body of /api, which the routes outside serve() have too", () => {
    const compose = readFileSync(join(__dirname, "../../../docker-compose.yml"), "utf8");
    expect(compose).toMatch(/ledgerly-router\.middlewares=[\w,-]*ledgerly-body-limit/);
    const proxyLimit = Number(/ledgerly-body-limit\.buffering\.maxRequestBodyBytes=(\d+)/.exec(compose)?.[1]);
    expect(proxyLimit).toBeGreaterThan(BODY_MAX_BYTES.multipart);
  });

  it.each([
    ["multipart", multipart.path, BODY_MAX_BYTES.multipart],
    ["json", "/json", BODY_MAX_BYTES.json],
  ])(
    "answers 413 to a %s body over the limit, from its content-length, before the handler",
    async (_, path, max) => {
      const handler = vi.fn(async () => ({}));
      const stream = chunked(1, 16);
      const response = await appWith(handler).request(path, {
        method: "POST",
        body: stream.body,
        headers: { "content-length": String(max + 1), "content-type": "application/json" },
        duplex: "half",
      } as RequestInit);
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "too_large" });
      expect(handler).not.toHaveBeenCalled();
      expect(stream.pulled()).toBeLessThan(2);
    },
  );

  it("stops reading a body without content-length once it passes the limit", async () => {
    const handler = vi.fn(async () => ({}));
    const chunk = 64 * 1024;
    const stream = chunked(1000, chunk); // ~64 MiB offered
    const response = await appWith(handler).request("/json", {
      method: "POST",
      body: stream.body,
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
    expect(stream.pulled() * chunk).toBeLessThan(BODY_MAX_BYTES.json + 4 * chunk);
  });
});
