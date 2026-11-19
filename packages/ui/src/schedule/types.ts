// The shapes of a schedule as the wire carries them (`@ledgerly/api-contract`): the editor checks a
// rule against the contract's schema, and asks the server for its next passes and its problems.
import type { RouteOutput } from "@ledgerly/api-client";
import type { SETTINGS, syncRuleSchema, syncScheduleSchema } from "@ledgerly/api-contract";
import type { z } from "zod";
import type { useTranslations } from "use-intl";

export type SyncSchedule = z.infer<typeof syncScheduleSchema>;
export type SyncRule = z.infer<typeof syncRuleSchema>;
export type SyncDays = Extract<SyncRule, { days: unknown }>["days"];
export type RuleKind = SyncRule["kind"];

/** What the server answers about a schedule not saved yet: its next passes, or what is wrong with it. */
export type SchedulePreview = RouteOutput<typeof SETTINGS.connections.previewSchedule>;
export type ScheduleProblem = SchedulePreview["problems"][number];

/** The texts of the editor. */
export type ScheduleText = ReturnType<typeof useTranslations<"settings.integrations.scheduleControl">>;
