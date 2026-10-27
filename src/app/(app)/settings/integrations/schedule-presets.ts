import { DEFAULT_SYNC_SCHEDULE, type SyncRule } from "@/platform/integrations/schedule";

/**
 * The quick choices above the rule editor (docs/scheduler.md). A preset only fills the editor:
 * every rule it writes can be changed before saving. The names are `presets.*` catalogue keys.
 */
export const PRESETS = [
  { key: "hourly", rules: DEFAULT_SYNC_SCHEDULE.rules },
  {
    key: "officeHours",
    rules: [
      {
        kind: "interval",
        everyMinutes: 30,
        from: "08:00",
        until: "19:00",
        days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] },
      },
    ],
  },
  { key: "twiceDaily", rules: [{ kind: "times", times: ["08:00", "20:00"], days: { kind: "every" } }] },
  {
    key: "weekdays8",
    rules: [{ kind: "times", times: ["08:00"], days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } }],
  },
  {
    key: "monthStart",
    rules: [{ kind: "times", times: ["07:00"], days: { kind: "monthDays", monthDays: [1] } }],
  },
  { key: "manual", rules: [] },
] as const satisfies readonly { key: string; rules: readonly SyncRule[] }[];

export type PresetKey = (typeof PRESETS)[number]["key"];
