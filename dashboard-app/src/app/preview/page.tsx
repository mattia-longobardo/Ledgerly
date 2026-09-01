"use client";

/*
 * DEV-ONLY PREVIEW. Not linked from the app; renders the whole design system
 * with sample data so it can be eyeballed at 360 px and in both palettes.
 */

import { useState } from "react";
import type { Series } from "@/lib/contracts";
import { formatDateLine, formatDays } from "@/lib/format";
import { Sparkline } from "@/components/chart/Sparkline";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountRow } from "@/components/ui/AccountRow";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { MonthGrid } from "@/components/ui/MonthGrid";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { RangeSelector, type MonthRange, type RangeKey } from "@/components/ui/RangeSelector";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { Sheet } from "@/components/ui/Sheet";
import {
  AmountField,
  ConfirmSummary,
  SheetForm,
  type SheetFormStep,
} from "@/components/ui/SheetForm";
import {
  Skeleton,
  SkeletonChart,
  SkeletonHero,
  SkeletonRows,
  SkeletonText,
  SkeletonTile,
} from "@/components/ui/Skeleton";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { StatTile } from "@/components/ui/StatTile";
import { Toast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";

/*
 * The token layer keys the dark palette off `:root[data-theme]`, so a second
 * palette cannot be scoped to a subtree without restating the raw values. This
 * duplication lives here, in the dev harness, and nowhere in the app.
 */
const PANEL_CSS = `
.pv-light {
  --c-bg:#f4f5f7; --c-surface:#ffffff; --c-surface-raised:#ffffff;
  --c-fg:#15181d; --c-fg-muted:#5c6572; --c-accent:#0e7490; --c-accent-contrast:#ffffff;
  --c-positive:#047857; --c-negative:#b91c1c; --c-warning:#b45309;
  --c-border:#dfe3e8; --c-focus-ring:#0e7490;
  --c-chart-1:#0e7490; --c-chart-2:#047857; --c-chart-3:#b45309;
  --c-chart-4:#6d28d9; --c-chart-5:#be123c; --c-chart-6:#4d7c0f;
  color-scheme: light;
}
.pv-dark {
  --c-bg:#0c0e12; --c-surface:#14171d; --c-surface-raised:#191d24;
  --c-fg:#e6eaf0; --c-fg-muted:#8b94a3; --c-accent:#22d3ee; --c-accent-contrast:#05202a;
  --c-positive:#34d399; --c-negative:#f87171; --c-warning:#fbbf24;
  --c-border:#232830; --c-focus-ring:#22d3ee;
  --c-chart-1:#22d3ee; --c-chart-2:#34d399; --c-chart-3:#fbbf24;
  --c-chart-4:#a78bfa; --c-chart-5:#fb7185; --c-chart-6:#a3e635;
  color-scheme: dark;
}
`;

const MONTHS = [
  "2024-09",
  "2024-10",
  "2024-11",
  "2024-12",
  "2025-01",
  "2025-02",
  "2025-03",
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
] as const;

const TOTALS = [
  41200, 42150, 41980, 45300, 46110, 46980, 47420, null, 49010, 50240, 51120, 52380,
] as const;

const FUND = [
  8100, 8260, 8190, 8540, 8720, 8810, 8950, 9040, 9180, 9310, 9420, 9605,
] as const;

const SAMPLE_SERIES: readonly Series[] = [
  {
    key: "total",
    label: "Total wealth",
    points: MONTHS.map((month, i) => ({ month, value: TOTALS[i] ?? null })),
  },
  {
    key: "cometa",
    label: "Fondo Cometa",
    points: MONTHS.map((month, i) => ({ month, value: FUND[i] ?? null })),
  },
];

const SHORT_SERIES: readonly Series[] = [
  { key: "total", label: "Total wealth", points: [{ month: "2025-08", value: 52380 }] },
];

const NOW = new Date("2025-08-31T18:40:00Z");
const FRESH = new Date("2025-08-31T18:25:00Z");
const OLD = new Date("2025-08-27T09:05:00Z");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 py-6 hairline-b">
      <h2 className="px-4 text-caption tracking-widest text-fg-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Gallery() {
  const [range, setRange] = useState<RangeKey>("12M");
  const [custom, setCustom] = useState<MonthRange | null>(null);
  const [view, setView] = useState<"overview" | "funds" | "vacation">("overview");
  const [months, setMonths] = useState<"3" | "6" | "12">("6");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [toastOpen, setToastOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const steps: readonly SheetFormStep[] = [
    {
      id: "amount",
      title: "Amount",
      valid: amount.trim() !== "",
      content: (
        <AmountField
          value={amount}
          onChange={setAmount}
          max={2400}
          hint="Available in the vacation fund: 2.400,00 €"
        />
      ),
    },
    {
      id: "details",
      title: "Details",
      content: (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption tracking-wide text-fg-muted uppercase">Label</span>
            <input
              placeholder="Flights to Lisbon"
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-body text-fg"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption tracking-wide text-fg-muted uppercase">Month</span>
            <input
              type="month"
              defaultValue="2025-08"
              className="num min-h-11 rounded-md border border-border bg-surface px-3 text-body text-fg"
            />
          </label>
        </div>
      ),
    },
    {
      id: "confirm",
      title: "Confirm",
      content: (
        <ConfirmSummary
          rows={[
            { label: "Amount", value: <MoneyValue value={600} /> },
            { label: "Label", value: "Flights to Lisbon" },
            { label: "Month", value: "Aug 2025" },
          ]}
          resultValue={1800}
        />
      ),
    },
  ];

  return (
    <div className="bg-bg text-fg">
      <PageHeader
        title="Home"
        eyebrow={formatDateLine(NOW)}
        action={<ThemeToggle />}
        segmented={
          <SegmentedControl
            options={[
              { value: "overview", label: "Overview" },
              { value: "funds", label: "Funds" },
              { value: "vacation", label: "Vacation fund" },
            ]}
            value={view}
            onChange={setView}
            label="Finance sub-view"
            fullWidth
          />
        }
      />

      <Section title="Hero + money">
        <div className="flex flex-col gap-2 px-4">
          <MoneyValue value={52380.44} size="display" />
          <div className="flex flex-wrap items-center gap-2">
            <DeltaBadge value={1260.12} percent={2.47} context="versus last month" />
            <DeltaBadge value={-318.4} percent={-0.61} context="versus last month" />
            <DeltaBadge value={0} context="versus last month" />
          </div>
          <div className="flex flex-wrap items-baseline gap-4">
            <MoneyValue value={9605.2} size="display-sm" />
            <MoneyValue value={412.99} />
            <MoneyValue value={52380.44} cents="hide" />
            <MoneyValue value={null} />
          </div>
        </div>
      </Section>

      <Section title="Stat tiles">
        <div className="grid grid-cols-2 gap-3 px-4">
          <StatTile label="Days taken YTD" value={formatDays(11.5)} sub="of 26 d" />
          <StatTile
            label="Days remaining"
            value={formatDays(14.5)}
            sub="Ferie 12 d · ROL 2,5 d"
          />
          <StatTile
            label="Avg net · 3 m"
            value={<MoneyValue value={2214.33} size="display-sm" />}
            delta={<DeltaBadge value={62.5} />}
          />
          <StatTile label="RAL" value={<MoneyValue value={38500} size="display-sm" cents="hide" />} />
        </div>
      </Section>

      <Section title="Accounts">
        <div className="hairline-t">
          <AccountRow
            name="Revolut"
            value={12480.9}
            capturedAt={FRESH}
            sparkline={<Sparkline values={[...FUND]} area />}
            defaultExpanded
          >
            <AccountRow name="Main" value={3210.4} nested capturedAt={FRESH} />
            <AccountRow name="Savings" value={7070.5} nested capturedAt={FRESH} />
            <AccountRow name="Holidays" value={2200} nested capturedAt={FRESH} />
          </AccountRow>
          <AccountRow
            name="ING"
            value={8940.12}
            capturedAt={OLD}
            stale
            sparkline={<Sparkline values={[8100, 8400, null, 8700, 8940]} tone="positive" />}
          />
          <AccountRow name="Fondo Cometa" value={9605.2} capturedAt={FRESH} href="#" />
          <AccountRow name="Mediolanum" value={8393.13} capturedAt={OLD} stale />
        </div>
        <div className="flex flex-wrap items-center gap-4 px-4">
          <StaleBadge capturedAt={FRESH} />
          <StaleBadge capturedAt={OLD} stale />
          <StaleBadge capturedAt={null} stale compact />
        </div>
      </Section>

      <Section title="Range selector + chart">
        <RangeSelector
          value={range}
          custom={custom}
          onChange={(next, nextCustom) => {
            if (next !== "custom") setRange(next);
            setCustom(nextCustom);
          }}
          minMonth="2023-01"
          maxMonth="2025-08"
        />
        <div className="px-4">
          <TimeSeriesChart series={SAMPLE_SERIES} label="Total wealth by month" height={200} />
        </div>
        <div className="px-4">
          <TimeSeriesChart series={SHORT_SERIES} label="A series with one point" height={140} />
        </div>
        <div className="flex items-center gap-4 px-4">
          <Sparkline values={[...TOTALS]} />
          <Sparkline values={[...FUND]} tone="positive" area />
          <Sparkline values={[1]} />
        </div>
      </Section>

      <Section title="Vacation">
        <div className="flex items-center gap-4 px-4">
          <ProgressRing value={14.5} max={26} label="Ferie and ROL remaining">
            <span className="text-body-sm">14,5</span>
          </ProgressRing>
          <div className="flex flex-col">
            <span className="text-body text-fg">Ferie + ROL</span>
            <span className="text-body-sm text-fg-muted">14,5 of 26 days left</span>
          </div>
        </div>
        <SegmentedControl
          options={[
            { value: "3", label: "3 m" },
            { value: "6", label: "6 m" },
            { value: "12", label: "12 m" },
          ]}
          value={months}
          onChange={setMonths}
          label="Salary window"
          className="mx-4"
        />
        <div className="hairline-t">
          <MonthGrid
            month="2025-08"
            defaultExpanded
            days={[
              { day: 11, kind: "full" },
              { day: 12, kind: "full" },
              { day: 13, kind: "full" },
              { day: 22, kind: "half", hours: 4 },
            ]}
          />
          <MonthGrid month="2025-07" days={[{ day: 4, kind: "half", hours: 2 }]} />
          <MonthGrid month="2025-06" days={[]} />
        </div>
      </Section>

      <Section title="Settings section">
        {/*
          `SettingsSection` drops its own gutter at `lg:` because the settings
          page's grid wrapper owns it there; the wrapper below stands in for
          that grid so the component is shown as it is actually used.
        */}
        <div className="flex flex-col gap-8 lg:px-4">
          <SettingsSection title="Leave">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption tracking-wide text-fg-muted uppercase">
                Hours per day
              </span>
              <input
                readOnly
                value="8"
                className="num min-h-11 w-full max-w-48 min-w-0 rounded-md border border-border bg-surface px-3 text-body text-fg"
              />
              <span className="text-body-sm text-fg-muted">
                Payslips state ferie and ROL in hours; days are hours ÷ this number.
              </span>
            </label>
          </SettingsSection>

          <SettingsSection
            title="Recent runs"
            description="Every settings block is heading → description → body → footnote."
            footnote="A poisoned month has stopped retrying on its own."
          >
            <ul className="hairline-t">
              {[
                {
                  id: 1,
                  label: "Monthly snapshot",
                  meta: "31/08, 03:00 · cron",
                  status: "success",
                  tone: "text-positive",
                },
                {
                  id: 2,
                  label: "Sweep",
                  meta: "31/08, 03:05 · cron · attempt 3",
                  status: "poisoned",
                  tone: "text-negative",
                  error:
                    "wallet: GET /api/v1/accounts failed after 3 attempts — ECONNREFUSED 10.0.0.4:8080",
                },
              ].map((run) => (
                <li key={run.id} className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-fg">{run.label}</span>
                    <span className="num block truncate text-caption text-fg-muted">{run.meta}</span>
                    {run.error !== undefined && (
                      <span title={run.error} className="block truncate text-caption text-fg-muted">
                        {run.error}
                      </span>
                    )}
                  </span>
                  <span className={cn("num shrink-0 text-caption whitespace-nowrap", run.tone)}>
                    {run.status}
                  </span>
                </li>
              ))}
            </ul>
          </SettingsSection>
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2 px-4">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg"
          >
            Open sheet
          </button>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"
          >
            Record withdrawal
          </button>
          <button
            type="button"
            onClick={() => setToastOpen(true)}
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg"
          >
            Show toast
          </button>
        </div>
        <p className="px-4 text-body-sm text-fg-muted">
          Overlays portal to the document, so they follow the page theme rather than this panel.
        </p>
      </Section>

      <Section title="States">
        <div className="flex flex-col gap-4 px-4">
          <ErrorInline
            message="Could not reach the Wallet API."
            detail="Last successful sync 27/08, 09:05"
            onRetry={() => undefined}
          />
          <EmptyState
            title="No withdrawals yet"
            description="Money set aside for holidays shows up here once you record the first one."
            action={
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"
              >
                Record withdrawal
              </button>
            }
          />
          <SkeletonHero />
          <div className="grid grid-cols-2 gap-3">
            <SkeletonTile />
            <SkeletonTile />
          </div>
          <SkeletonChart />
          <SkeletonText lines={3} />
          <Skeleton className="h-11 w-40" />
        </div>
        <SkeletonRows rows={3} />
      </Section>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Payslip · Aug 2025"
        description="Drag the header down to dismiss."
      >
        <div className="flex flex-col gap-3">
          <p className="text-body text-fg">
            The workhorse mobile surface: 60 % height by default, drag-to-dismiss on the header,
            safe-area padded, scrollable body.
          </p>
          <SkeletonText lines={8} />
        </div>
      </Sheet>

      <SheetForm
        open={formOpen}
        onOpenChange={setFormOpen}
        title="Withdrawal"
        steps={steps}
        submitLabel="Confirm withdrawal"
        onSubmit={() => {
          setFormOpen(false);
          setToastOpen(true);
        }}
      />

      <Toast
        open={toastOpen}
        onOpenChange={setToastOpen}
        message="Withdrawal recorded"
        detail="600,00 € · Flights to Lisbon"
        onUndo={() => undefined}
      />
    </div>
  );
}

export default function PreviewPage() {
  return (
    <AppShell>
      <style href="preview-panels" precedence="low">
        {PANEL_CSS}
      </style>

      <div className="hairline-b bg-warning/10 px-4 py-3">
        <p className="text-body-sm text-fg">
          <span className="font-semibold">Dev-only preview.</span> Every design-system component
          with sample data, rendered in both palettes.
        </p>
        <div className="mt-2">
          <ThemeToggle variant="segmented" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-4 xl:grid-cols-2">
        <div className="pv-light overflow-hidden rounded-md border border-border">
          <div className="bg-surface px-4 py-2 text-caption tracking-widest text-fg-muted uppercase hairline-b">
            Light
          </div>
          <Gallery />
        </div>
        <div className="pv-dark overflow-hidden rounded-md border border-border">
          <div className="bg-surface px-4 py-2 text-caption tracking-widest text-fg-muted uppercase hairline-b">
            Dark
          </div>
          <Gallery />
        </div>
      </div>
    </AppShell>
  );
}
