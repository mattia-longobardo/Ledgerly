import Link from "next/link";
import { redirect } from "next/navigation";
import {
  removeTimeoffEventAction,
  setTimeoffEventAction,
  syncTimeoffNowAction,
} from "@/app/actions/timeoff";
import type { TimeoffWorkspace, WorkspaceDay } from "@/modules/timeoff/application/get-workspace";
import { loadWorkspace } from "@/modules/timeoff/ui/load-workspace";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Time Off" };

/**
 * The bare Time Off page (reduced Phase 7).
 *
 * Deliberately unstyled and component-free: native `<form>` elements bound to
 * server actions, plain `<table>`s, no client component at all. The redesign
 * replaces this file wholesale — the point of it is that the owner can book,
 * change and remove a day by hand before that lands, not that it looks like
 * anything.
 *
 * A missing balance renders as "—", never as `0.00`: nothing has written a
 * figure for that type, and inventing a zero would report a balance the
 * payslips never stated.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

interface PageSearchParams {
  year?: string;
  day?: string;
  error?: string;
}

function parseYear(raw: string | undefined, fallback: number): number {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : fallback;
}

function parseDay(raw: string | undefined): string | null {
  return raw !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function isoOf(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Monday-first, computed in UTC so it agrees with the ISO date strings. */
function monthMeta(year: number, monthIndex: number): { length: number; offset: number } {
  return {
    length: new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate(),
    offset: (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7,
  };
}

/** The marker a booked day carries: its type code, `½` for a half day, `*` while a sync is owed. */
function markerFor(day: WorkspaceDay): string {
  return `${day.typeCode}${day.fraction === "0.50" ? " ½" : ""}${day.pendingOp !== "none" ? " *" : ""}`;
}

/** Where a failed action sends the owner back to, with the message in the URL. */
function backTo(formData: FormData, error: string): string {
  const year = String(formData.get("year") ?? "");
  const day = String(formData.get("date") ?? "");
  const params = new URLSearchParams();
  if (year !== "") params.set("year", year);
  if (day !== "") params.set("day", day);
  params.set("error", error);
  return `/company/time-off?${params.toString()}`;
}

export default async function TimeOffPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  await requirePrincipalOrRedirect();
  const params = await searchParams;
  const year = parseYear(params.year, new Date().getFullYear());
  const selectedDate = parseDay(params.day);
  const workspace = await loadWorkspace({ year, selectedDate });

  /**
   * Thin wrappers around the exported actions: a `<form action>` handler must
   * resolve to `void`, and a failure has to reach the owner rather than being
   * swallowed — so it comes back as `?error=` on this same page.
   */
  async function saveDay(formData: FormData): Promise<void> {
    "use server";
    const result = await setTimeoffEventAction(formData);
    if (!result.ok) redirect(backTo(formData, result.error));
  }

  async function removeDay(formData: FormData): Promise<void> {
    "use server";
    const result = await removeTimeoffEventAction(formData);
    if (!result.ok) redirect(backTo(formData, result.error));
  }

  async function syncNow(formData: FormData): Promise<void> {
    "use server";
    const result = await syncTimeoffNowAction(formData);
    if (!result.ok) redirect(backTo(formData, result.error));
  }

  return (
    <main>
      <h1>Time Off {workspace.year}</h1>

      <p>
        <Link href={`/company/time-off?year=${workspace.year - 1}`}>← {workspace.year - 1}</Link>{" "}
        <Link href={`/company/time-off?year=${workspace.year + 1}`}>{workspace.year + 1} →</Link>
      </p>

      {params.error !== undefined && <p role="alert">{params.error}</p>}

      <Balances workspace={workspace} />

      <h2>Trek</h2>
      {workspace.trekConnected ? (
        <form action={syncNow}>
          <input type="hidden" name="year" value={workspace.year} />
          <button type="submit">Sync now</button>
        </form>
      ) : (
        <p>
          Trek is not connected. <Link href="/settings/integrations">Connect it</Link> to sync days
          both ways.
        </p>
      )}
      <p>
        Planned so far this year: {workspace.plannedDaysYtd} days · waiting for the sync:{" "}
        {workspace.pendingCount}
        {workspace.cachedStats !== null && (
          <>
            {" "}
            · Trek says {workspace.cachedStats.stats.remaining} days remaining (as of{" "}
            {workspace.cachedStats.fetchedAt.slice(0, 10)})
          </>
        )}
      </p>

      {workspace.selected !== null && (
        <DayForm workspace={workspace} save={saveDay} remove={removeDay} />
      )}

      <h2>Upcoming</h2>
      {workspace.upcoming.length === 0 ? (
        <p>Nothing booked ahead.</p>
      ) : (
        <ul>
          {workspace.upcoming.map((event) => (
            <li key={event.id}>
              <Link href={`/company/time-off?year=${workspace.year}&day=${event.date}`}>
                {event.date}
              </Link>{" "}
              — {event.typeCode}
              {event.fraction === "0.50" ? " ½" : ""}
              {event.pendingOp !== "none" ? " *" : ""}
              {event.note !== null ? ` — ${event.note}` : ""}
            </li>
          ))}
        </ul>
      )}

      <h2>Calendar</h2>
      <p>½ = half day · * = waiting for the Trek sync</p>
      {MONTHS.map((name, monthIndex) => (
        <MonthTable key={name} workspace={workspace} monthIndex={monthIndex} name={name} />
      ))}
    </main>
  );
}

/** One line per type. "—" whenever a figure is absent — never `0.00`. */
function Balances({ workspace }: { workspace: TimeoffWorkspace }) {
  return (
    <>
      <h2>Balances</h2>
      <ul>
        {workspace.balances.map((balance) => (
          <li key={balance.type.id}>
            {balance.type.label} —{" "}
            {balance.remainingDays === null || balance.remainingHours === null || balance.asOf === null
              ? "remaining: —"
              : `remaining: ${balance.remainingDays} days (${balance.remainingHours} h) as of ${balance.asOf}`}
          </li>
        ))}
      </ul>
    </>
  );
}

function MonthTable({
  workspace,
  monthIndex,
  name,
}: {
  workspace: TimeoffWorkspace;
  monthIndex: number;
  name: string;
}) {
  const { length, offset } = monthMeta(workspace.year, monthIndex);
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <table>
      <caption>
        {name} {workspace.year}
      </caption>
      <thead>
        <tr>
          {WEEKDAYS.map((weekday) => (
            <th key={weekday} scope="col">
              {weekday}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, w) => (
          <tr key={w}>
            {week.map((day, d) => {
              if (day === null) return <td key={d} />;
              const date = isoOf(workspace.year, monthIndex, day);
              const booked = workspace.byDate[date];
              return (
                <td key={d}>
                  <Link href={`/company/time-off?year=${workspace.year}&day=${date}`}>{day}</Link>
                  {booked !== undefined && ` ${markerFor(booked)}`}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DayForm({
  workspace,
  save,
  remove,
}: {
  workspace: TimeoffWorkspace;
  save: (formData: FormData) => Promise<void>;
  remove: (formData: FormData) => Promise<void>;
}) {
  const selected = workspace.selected!;
  const event = selected.event;

  return (
    <>
      <h2>{selected.date}</h2>
      {event !== null && (
        <p>
          {selected.status} · {event.origin}
          {event.pendingOp !== "none" ? ` · waiting for the sync (${event.pendingOp})` : ""}
        </p>
      )}

      <form action={save}>
        <input type="hidden" name="date" value={selected.date} />
        <input type="hidden" name="year" value={workspace.year} />

        <p>
          <label htmlFor="typeCode">Type</label>{" "}
          <select id="typeCode" name="typeCode" defaultValue={event?.typeCode ?? "vacation"}>
            {workspace.types.map((type) => (
              <option key={type.id} value={type.code}>
                {type.label}
              </option>
            ))}
          </select>
        </p>

        <fieldset>
          <legend>Length</legend>
          <label>
            <input
              type="radio"
              name="fraction"
              value="1.00"
              defaultChecked={event?.fraction !== "0.50"}
            />{" "}
            Full day
          </label>{" "}
          <label>
            <input
              type="radio"
              name="fraction"
              value="0.50"
              defaultChecked={event?.fraction === "0.50"}
            />{" "}
            Half day
          </label>
        </fieldset>

        <p>
          <label htmlFor="note">Note</label>{" "}
          <input id="note" name="note" type="text" maxLength={200} defaultValue={event?.note ?? ""} />
        </p>

        <button type="submit">Save</button>
      </form>

      {event !== null && (
        <form action={remove}>
          <input type="hidden" name="date" value={selected.date} />
          <input type="hidden" name="year" value={workspace.year} />
          <button type="submit">Remove</button>
        </form>
      )}
    </>
  );
}
