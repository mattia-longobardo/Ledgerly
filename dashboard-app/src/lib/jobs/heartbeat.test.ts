import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_MAX_AGE_MS,
  heartbeatAgeMs,
  heartbeatPath,
  isHeartbeatStale,
  readHeartbeat,
  touchHeartbeat,
} from "@/lib/jobs/heartbeat";

let dir: string;
const original = process.env.HEARTBEAT_FILE;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dashboard-heartbeat-"));
  process.env.HEARTBEAT_FILE = join(dir, "nested", "beat");
});

afterEach(async () => {
  if (original === undefined) delete process.env.HEARTBEAT_FILE;
  else process.env.HEARTBEAT_FILE = original;
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("heartbeatPath", () => {
  it("defaults under /tmp and honours the override", () => {
    delete process.env.HEARTBEAT_FILE;
    expect(heartbeatPath()).toBe("/tmp/dashboard-sweep-heartbeat");

    process.env.HEARTBEAT_FILE = "/tmp/elsewhere";
    expect(heartbeatPath()).toBe("/tmp/elsewhere");
  });

  it("ignores a blank override rather than writing to an empty path", () => {
    process.env.HEARTBEAT_FILE = "   ";
    expect(heartbeatPath()).toBe("/tmp/dashboard-sweep-heartbeat");
  });
});

describe("touch and read", () => {
  it("creates the parent directory and round-trips the timestamp", async () => {
    const now = new Date("2026-09-01T21:59:00.000Z");

    expect(await touchHeartbeat(now)).toBe(true);
    expect(await readHeartbeat()).toEqual(now);
    expect(await heartbeatAgeMs(new Date("2026-09-01T22:59:00.000Z"))).toBe(3_600_000);
  });

  it("reports a never-touched heartbeat as absent, not as an error", async () => {
    expect(await readHeartbeat()).toBeNull();
    expect(await heartbeatAgeMs()).toBeNull();
  });

  it("treats unreadable contents as absent", async () => {
    process.env.HEARTBEAT_FILE = join(dir, "beat");
    await writeFile(join(dir, "beat"), "not a timestamp\n", "utf8");

    expect(await readHeartbeat()).toBeNull();
  });
});

describe("staleness", () => {
  it("is stale beyond two hours and fresh inside them", async () => {
    const now = new Date("2026-09-01T12:00:00.000Z");
    await touchHeartbeat(new Date(now.getTime() - HEARTBEAT_MAX_AGE_MS + 1000));
    expect(await isHeartbeatStale(HEARTBEAT_MAX_AGE_MS, now)).toBe(false);

    await touchHeartbeat(new Date(now.getTime() - HEARTBEAT_MAX_AGE_MS - 1000));
    expect(await isHeartbeatStale(HEARTBEAT_MAX_AGE_MS, now)).toBe(true);
  });

  it("counts a never-touched heartbeat as stale", async () => {
    expect(await isHeartbeatStale()).toBe(true);
  });
});

describe("read-only filesystem", () => {
  it("returns false instead of throwing when the write is refused", async () => {
    // /dev/null is a file, so any path below it fails with ENOTDIR — the same
    // shape of failure as a read_only container filesystem.
    process.env.HEARTBEAT_FILE = "/dev/null/impossible/beat";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(touchHeartbeat()).resolves.toBe(false);
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
