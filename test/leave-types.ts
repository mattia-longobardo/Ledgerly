// The four types of leave a person had before R5g, as migration 0074 made them (rewrite plan R5g):
// for the tests, the seeds and the probes, whose people are made after the migration and so start
// with none. Their names are English, as the seeds' people are.
import { eq } from "drizzle-orm";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { userScoped } from "@domain/platform/db/scope";
import { leaveSettings, leaveTypes } from "@domain/modules/timeoff/schema";

const OLD_TYPES = [
  {
    word: "vacation",
    name: "Vacation",
    color: "primary",
    allowance: true,
    calendar: true,
    balance: true,
    held: true,
  },
  { word: "rol", name: "ROL", color: "warn", allowance: true, calendar: true, balance: true, held: false },
  {
    word: "comp",
    name: "Time off in lieu",
    color: "accent",
    allowance: false,
    calendar: true,
    balance: false,
    held: true,
  },
  {
    word: "other",
    name: "Other",
    color: "faint",
    allowance: false,
    calendar: false,
    balance: false,
    held: false,
  },
] as const;

export type OldTypes = Record<(typeof OLD_TYPES)[number]["word"], string>;

/** The person's four types (made once), by their old kind. */
export async function oldLeaveTypes(ctx: Pick<Ctx, "userId">): Promise<OldTypes> {
  await getDb()
    .insert(leaveSettings)
    .values(userScoped(ctx).stamp({ workDays: [1, 2, 3, 4, 5] }))
    .onConflictDoNothing();
  const existing = await getDb()
    .select({ id: leaveTypes.id, name: leaveTypes.name })
    .from(leaveTypes)
    .where(eq(leaveTypes.userId, ctx.userId));
  if (existing.length === 0) {
    await getDb()
      .insert(leaveTypes)
      .values(
        OLD_TYPES.map((type, position) =>
          userScoped(ctx).stamp({
            name: type.name,
            color: type.color,
            unit: "half_day" as const,
            hasAllowance: type.allowance,
            toCalendar: type.calendar,
            balanceKey: type.balance ? type.word : null,
            calendarKind: type.held ? type.word : null,
            position,
          }),
        ),
      );
    return oldLeaveTypes(ctx);
  }
  return Object.fromEntries(
    existing.map((one) => [OLD_TYPES.find((type) => type.name === one.name)?.word, one.id]),
  ) as OldTypes;
}

/** The old word of a row's type, as the tests name it. */
export function wordOf(types: OldTypes, typeId: string): string | null {
  return Object.entries(types).find(([, id]) => id === typeId)?.[0] ?? null;
}
