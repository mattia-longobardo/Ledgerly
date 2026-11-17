// The tests of a file that reads "today" more than once (test analysis, S-8).
//
// A test reads the day when it prepares its data, and the code under test reads it again a moment
// later. Both are the real time, but a test that starts a moment before a midnight in Rome reads
// two days and fails. `dayClock()` makes each test of the file wait for that midnight when it is
// less than five seconds away: a test of these files takes well under five seconds, so it then
// reads one day.
//
// The clock is not faked. A faked `Date` moves away from the database's clock (`now()` in SQL), and
// the fake timers of vitest move in steps, so two writes in one step get the same instant: both
// break tests of these files.
import { beforeEach } from "vitest";

const ZONE = "Europe/Rome";
const MARGIN_MS = 5_000;

/** How long until the next midnight in Rome. */
export function toMidnightInRome(now: number): number {
  const [hour, minute, second] = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(now))
    .split(":")
    .map(Number);
  return (24 * 3600 - (hour * 3600 + minute * 60 + second)) * 1000 - (now % 1000);
}

/** How long a test that starts at `now` waits: until the midnight, when it is that close. */
export function waitBeforeTest(now: number): number {
  const left = toMidnightInRome(now);
  return left <= MARGIN_MS ? left + 50 : 0;
}

/** Every test of the file starts and ends on the same day in Rome. */
export function dayClock(): void {
  beforeEach(async () => {
    const wait = waitBeforeTest(Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  });
}
