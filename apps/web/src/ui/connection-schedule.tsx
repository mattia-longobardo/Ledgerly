"use client";

// The schedule of one connection on the web (audit UI-INV-10: shared by Settings › Integrations, a
// service's Connection tab and Time off › Settings, so not in the folder of one route): the control of
// `packages/ui`, previewed and saved through `/api/v1/connections/{id}/schedule`. The pages around it
// are still drawn on the server, so a saved schedule draws them again.
import { useRouter } from "next/navigation";
import { connections } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import {
  type PreviewSchedule,
  type SaveSchedule,
  ScheduleControl,
  type SyncSchedule,
} from "@ledgerly/ui/schedule";

export function ConnectionSchedule({
  connectionId,
  name,
  schedule,
  recommended,
  next,
  timeZone,
  maxPerDay,
}: {
  connectionId: string;
  name: string;
  schedule: SyncSchedule;
  recommended: SyncSchedule;
  next: string | null;
  timeZone: string;
  /** The most passes a day the server accepts (a bank's connection); none when unset. */
  maxPerDay?: number;
}) {
  const router = useRouter();
  const preview: PreviewSchedule = (rules) =>
    call(connections.previewSchedule, { params: { id: connectionId }, body: rules });
  const save: SaveSchedule = async (rules) => {
    try {
      await call(connections.setSchedule, { params: { id: connectionId }, body: rules });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500)
        return { ok: false, tooMany: error.reason === "tooMany" };
      throw error;
    }
    router.refresh();
    return { ok: true };
  };
  return (
    <ScheduleControl
      name={name}
      schedule={schedule}
      recommended={recommended}
      next={next}
      timeZone={timeZone}
      maxPerDay={maxPerDay}
      save={save}
      preview={preview}
    />
  );
}
