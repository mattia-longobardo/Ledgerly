"use client";

// The schedule of one connection on the web (audit UI-INV-10: shared by Settings › Integrations, a
// service's Connection tab and Time off › Settings, so not in the folder of one route): the control of
// `packages/ui`, previewed and saved through `/api/v1/connections/{id}/schedule`. The pages around it
// are still drawn on the server, so a saved schedule draws them again.
import { useRouter } from "next/navigation";
import { SETTINGS } from "@ledgerly/api-contract";
import { ApiError, call } from "@ledgerly/api-client";
import {
  type PreviewSchedule,
  type SaveSchedule,
  ScheduleControl,
  type SyncSchedule,
} from "@ledgerly/ui/schedule";

const { connections } = SETTINGS;

export function ConnectionSchedule({
  connectionId,
  name,
  schedule,
  recommended,
  next,
  timeZone,
}: {
  connectionId: string;
  name: string;
  schedule: SyncSchedule;
  recommended: SyncSchedule;
  next: string | null;
  timeZone: string;
}) {
  const router = useRouter();
  const preview: PreviewSchedule = (rules) =>
    call(connections.previewSchedule, { params: { id: connectionId }, body: rules });
  const save: SaveSchedule = async (rules) => {
    try {
      await call(connections.setSchedule, { params: { id: connectionId }, body: rules });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) return { ok: false };
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
      save={save}
      preview={preview}
    />
  );
}
