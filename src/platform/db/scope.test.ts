import { eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { userScoped } from "./scope";

const table = pgTable("scope_test", { userId: text("user_id").notNull() });

describe("userScoped", () => {
  it("stamp: the caller's ctx.userId wins over any userId already on the values", () => {
    const scoped = userScoped({ userId: "ctx-user" });
    expect(scoped.stamp({ userId: "other-user", note: "x" })).toEqual({ userId: "ctx-user", note: "x" });
  });

  it("owns: the where clause targets ctx.userId, not any other id", () => {
    const scoped = userScoped({ userId: "ctx-user" });
    expect(scoped.owns(table)).toEqual(eq(table.userId, "ctx-user"));
    expect(scoped.owns(table)).not.toEqual(eq(table.userId, "someone-else"));
  });
});
