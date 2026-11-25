import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The repo is public and the e2e seed runs on the deployed site: a password of a test user written
// here would be a way in for anybody (scripts/seed-e2e/users.ts). The seed draws them for each run.
const ROOTS = ["tests/e2e", "scripts/seed-e2e", "scripts/seed-e2e.ts", "playwright.config.ts"];
const PASSWORD_LITERAL = /password\s*[:=]\s*["'`][^"'`]+["'`]|-password-\d+/i;

function files(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
      entry.name === ".state" ? [] : files(join(path, entry.name)),
    );
  } catch {
    return /\.tsx?$/.test(path) ? [path] : [];
  }
}

describe("the e2e users' passwords", () => {
  it("are written nowhere in the seed and the specs", () => {
    const found = ROOTS.flatMap(files).filter((file) => PASSWORD_LITERAL.test(readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });

  it("are caught by the check when they are", () => {
    expect(PASSWORD_LITERAL.test('owner: { email: "o@example.test", password: "owner-password-123" }')).toBe(
      true,
    );
    expect(PASSWORD_LITERAL.test("const p = 'secret';".replace("const p", "password"))).toBe(true);
    expect(PASSWORD_LITERAL.test("body: { email: user.email, password: user.password }")).toBe(false);
  });
});
