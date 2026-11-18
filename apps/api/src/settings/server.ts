// Users and settings · Admin › Server (rewrite plan R2, spec §7.10): behind the scope `admin` and
// the admin role. The settings are the domain's; the maintenance (backups, jobs, the last export)
// is still the web process's, lent like the guard until R4.
import type { Hono } from "hono";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import {
  llmFallbackView,
  oidcView,
  removeLlmFallback,
  removeOidc,
  removeSmtp,
  saveLlmFallback,
  saveOidc,
  saveSmtp,
  sendTestEmail,
  SettingsError,
  smtpView,
  testLlmFallback,
  testOidc,
} from "@ledgerly/domain/platform/settings";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";

const { server } = SETTINGS;

/** The maintenance of the instance, which the web process still holds. */
export interface ServerCases {
  maintenance(): Promise<{
    version: string;
    postgres: string | null;
    lastBackup: { at: Date; size: number } | null;
    backupsKept: number;
    lastExport: Date | null;
  }>;
  backupNow(ctx: Ctx): Promise<{ ok: true; size: number } | { ok: false; error: string }>;
  jobs(ctx: Ctx): Promise<
    {
      name: string;
      tier: "minute" | "hourly" | "daily" | "monthly" | "manual" | "afterSync";
      lastRun: {
        startedAt: Date;
        finishedAt: Date | null;
        status: "running" | "success" | "failed" | "skipped";
        error: string | null;
      } | null;
    }[]
  >;
  /** False when no job has that name. */
  runJob(name: string): Promise<boolean>;
}

const instant = (moment: Date | null) => moment?.toISOString() ?? null;

async function settled<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SettingsError)
      throw new ApiRefusal(error.code === "forbidden" ? "forbidden" : "invalid");
    throw error;
  }
}

async function serverSettings(ctx: Ctx, cases: ServerCases) {
  const [llm, oidc, smtp, maintenance] = await Promise.all([
    llmFallbackView(ctx),
    oidcView(ctx),
    smtpView(ctx),
    cases.maintenance(),
  ]);
  return {
    llm: llm && { ...llm, updatedAt: llm.updatedAt.toISOString() },
    oidc: {
      ...oidc,
      updatedAt: instant(oidc.updatedAt),
      lastCheck: oidc.lastCheck && { ...oidc.lastCheck, checkedAt: oidc.lastCheck.checkedAt.toISOString() },
    },
    smtp: { ...smtp, updatedAt: instant(smtp.updatedAt) },
    maintenance: {
      ...maintenance,
      lastBackup: maintenance.lastBackup && {
        ...maintenance.lastBackup,
        at: maintenance.lastBackup.at.toISOString(),
      },
      lastExport: instant(maintenance.lastExport),
    },
  };
}

function serveSettings(app: Hono<ApiEnv>, guard: Guard, cases: ServerCases): void {
  serve(app, guard, server.getServerSettings, ({ ctx }) => settled(() => serverSettings(ctx, cases)));
  serve(app, guard, server.saveLlm, ({ ctx, body }) => settled(() => saveLlmFallback(ctx, body)));
  serve(app, guard, server.testLlm, ({ ctx }) => settled(() => testLlmFallback(ctx)));
  serve(app, guard, server.removeLlm, ({ ctx }) => settled(() => removeLlmFallback(ctx)));
  serve(app, guard, server.saveOidc, ({ ctx, body }) => settled(() => saveOidc(ctx, body)));
  serve(app, guard, server.testOidc, async ({ ctx }) => ({
    outcome: (await settled(() => testOidc(ctx))).outcome,
  }));
  serve(app, guard, server.removeOidc, ({ ctx }) => settled(() => removeOidc(ctx)));
  serve(app, guard, server.saveSmtp, ({ ctx, body }) => settled(() => saveSmtp(ctx, body)));
  serve(app, guard, server.testSmtp, ({ ctx }) => settled(() => sendTestEmail(ctx)));
  serve(app, guard, server.removeSmtp, ({ ctx }) => settled(() => removeSmtp(ctx)));
}

function serveMaintenance(app: Hono<ApiEnv>, guard: Guard, cases: ServerCases): void {
  serve(app, guard, server.backUpNow, async ({ ctx }) => {
    const answer = await cases.backupNow(ctx);
    if (!answer.ok)
      throw new ApiRefusal(answer.error === "forbidden" ? "forbidden" : "conflict", answer.error);
    return { size: answer.size };
  });
  serve(app, guard, server.listJobs, async ({ ctx }) => ({
    jobs: (await cases.jobs(ctx)).map((job) => ({
      ...job,
      lastRun: job.lastRun && {
        ...job.lastRun,
        startedAt: job.lastRun.startedAt.toISOString(),
        finishedAt: instant(job.lastRun.finishedAt),
      },
    })),
  }));
  serve(app, guard, server.runJob, async ({ params }) => {
    if (!(await cases.runJob(params.name))) throw new ApiRefusal("not_found");
  });
}

export function serveServer(app: Hono<ApiEnv>, guard: Guard, cases: ServerCases): readonly RouteContract[] {
  serveSettings(app, guard, cases);
  serveMaintenance(app, guard, cases);
  return Object.values(server);
}
