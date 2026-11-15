/**
 * The report a person copies from "Advanced" to ask for help (ux/n2-connection-status.md §8.4):
 * plain lines of `key: value`, not translated.
 *
 * The text is made from a closed list of fields: the types below are the list, and the function
 * reads those fields by name and nothing else of what it is handed. A credential, a key, an
 * access, a session, an account's number, name or balance, an amount, the person's name or mail,
 * and anything a provider said (the old `error` column) are not fields of these types, so no
 * caller can put one in — and a field added to a table tomorrow does not enter by itself.
 */

export interface ReportConnection {
  name: string;
  /** The provider's id, as the connection stores it. */
  provider: string;
  status: string;
  code: string | null;
  failures: number;
  lastOkAt: Date | null;
  nextSyncAt: Date | null;
  schedule: string;
}

export interface ReportRun {
  startedAt: Date;
  connection: string;
  kind: string;
  origin: string | null;
  state: string;
  seconds: number | null;
  code: string | null;
  httpStatus: number | null;
  appVersion: string | null;
}

export interface ReportInput {
  appVersion: string;
  at: Date;
  connections: readonly ReportConnection[];
  runs: readonly ReportRun[];
}

/** A value on a line of the report: one line, no control character, bounded. */
function plain(value: string, max = 80): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const iso = (at: Date | null) => (at === null ? "-" : at.toISOString().replace(/\.\d{3}Z$/, "Z"));

/** A schedule as the report says it: how many times a day, an interval, or that it is off. */
export function scheduleSummary(schedule: {
  rules: readonly (
    | { kind: "times"; times: readonly string[] }
    | { kind: "interval"; everyMinutes: number }
    | { kind: "cron" }
  )[];
}): string {
  if (schedule.rules.length === 0) return "off";
  return schedule.rules
    .map((rule) =>
      rule.kind === "times"
        ? `${rule.times.length} per day`
        : rule.kind === "interval"
          ? `every ${rule.everyMinutes} min`
          : "cron",
    )
    .join(", ");
}

export function connectionReport(input: ReportInput): string {
  const lines = [`Ledgerly ${plain(input.appVersion, 20)} · ${iso(input.at)}`];
  for (const one of input.connections) {
    lines.push(
      `connection: ${plain(one.name)} (${plain(one.provider, 40)})`,
      `status: ${plain(one.status, 20)} · code: ${plain(one.code ?? "-", 30)} · failures: ${Number(one.failures) || 0}`,
      `last_ok: ${iso(one.lastOkAt)} · next: ${iso(one.nextSyncAt)}`,
      `schedule: ${plain(one.schedule, 60)}`,
    );
  }
  lines.push(`runs (last ${input.runs.length}):`);
  const many = input.connections.length !== 1;
  for (const run of input.runs) {
    lines.push(
      [
        iso(run.startedAt),
        ...(many ? [`[${plain(run.connection, 40)}]`] : []),
        plain(run.kind, 20),
        plain(run.origin ?? "-", 10),
        plain(run.state, 10),
        run.seconds === null ? "-" : `${Math.max(0, Math.round(run.seconds))}s`,
        plain(run.code ?? "-", 30),
        `http=${run.httpStatus ?? "-"}`,
        `v${plain(run.appVersion ?? "-", 20)}`,
      ].join(" "),
    );
  }
  return `${lines.join("\n")}\n`;
}
