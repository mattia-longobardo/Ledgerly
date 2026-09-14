"use client";

import { LayoutDashboard } from "lucide-react";
import type { Route } from "next";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { formatMoney } from "@/platform/format";
import { Avatar } from "@/ui/avatar";
import { Badge, Tag } from "@/ui/badge";
import { Button, Chip, IconButton, LinkButton } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Checkbox, Input, InputGroup, Select } from "@/ui/input";
import { Kbd } from "@/ui/kbd";
import { KpiTile } from "@/ui/kpi-tile";
import { ActionMenu } from "@/ui/menu";
import { Modal } from "@/ui/modal";
import { Popover } from "@/ui/popover";
import { ProgressBar } from "@/ui/progress-bar";
import { SettingsSection } from "@/ui/section";
import { Segmented } from "@/ui/segmented";
import { useShell } from "@/ui/shell/shell-context";
import { navItemClassName } from "@/ui/shell/sidebar";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { TabLinks } from "@/ui/tab-links";
import { GroupRow, Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";

/** Every design token (spec §8.1); light surfaces get a hairline so they show on the card. */
const TOKENS = [
  ["bg", true],
  ["card", true],
  ["side", true],
  ["fg", false],
  ["muted", false],
  ["faint", false],
  ["border", false],
  ["border2", false],
  ["accent", false],
  ["primary", false],
  ["primary-fg", true],
  ["soft", false],
  ["pos", false],
  ["neg", false],
  ["warn", false],
  ["pos-bg", true],
  ["neg-bg", true],
  ["warn-bg", true],
  ["hover", true],
  ["sel", true],
  ["track", true],
  ["skel", true],
  ["shadow", true],
] as const;

const MAIN_VALUE = formatMoney(8803185n, "it-IT");
const KPI_VALUE = formatMoney(713595n, "it-IT");

/** Every type size, with the weight and role it has in the app. */
const TYPE_SCALE = [
  {
    size: "36 / 600",
    role: "display",
    className: "text-display leading-[1.1] font-semibold tracking-[-0.02em]",
    value: MAIN_VALUE,
  },
  {
    size: "32 / 600",
    role: "hero",
    className: "text-hero leading-[1.1] font-semibold tracking-[-0.02em]",
    value: MAIN_VALUE,
  },
  {
    size: "28 / 600",
    role: "heroSm",
    className: "text-hero-sm leading-[1.1] font-semibold tracking-[-0.02em]",
    value: MAIN_VALUE,
  },
  { size: "24 / 600", role: "title", className: "text-title font-semibold tracking-[-0.02em]" },
  { size: "22 / 600", role: "kpi", className: "text-kpi font-semibold tracking-[-0.02em]", value: KPI_VALUE },
  {
    size: "20 / 600",
    role: "kpiSm",
    className: "text-2xl font-semibold tracking-[-0.02em]",
    value: KPI_VALUE,
  },
  { size: "17 / 600", role: "mobileTitle", className: "text-xl font-semibold tracking-[-0.01em]" },
  { size: "15 / 600", role: "cardTitle", className: "text-lg font-semibold" },
  { size: "14 / 400", role: "input", className: "text-md" },
  { size: "13 / 400", role: "body", className: "text-base" },
  { size: "12 / 400", role: "secondary", className: "text-sm text-muted" },
  {
    size: "11 / 500",
    role: "label",
    className: "text-xs font-medium tracking-[0.04em] text-faint uppercase",
  },
  { size: "10 / 500", role: "micro", className: "text-micro font-medium" },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

export function Gallery() {
  const t = useTranslations("gallery");
  const common = useTranslations("common");
  const settings = useTranslations("settings");
  const { setPaletteOpen } = useShell();
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [chip, setChip] = useState<"spesa" | "casa">("spesa");
  const [modalOpen, setModalOpen] = useState(false);
  const [sort, setSort] = useState<"asc" | "desc">("desc");

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <Section title={t("colours")}>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {TOKENS.map(([token, outlined]) => (
            <div key={token} className="min-w-0">
              <span
                className={cn("block h-9 rounded-ctl", outlined && "border border-border")}
                style={
                  token === "shadow" ? { boxShadow: "var(--shadow)" } : { background: `var(--${token})` }
                }
              />
              <div className="mt-1 truncate font-medium">--{token}</div>
              <div className="truncate text-muted">{t(`tokens.${token}`)}</div>
            </div>
          ))}
        </div>
      </Section>
      <Section title={t("type")}>
        <div className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2">
          {TYPE_SCALE.map(({ size, role, className, ...sample }) => (
            <div key={size} className="contents">
              <span className="text-xs text-muted">{size}</span>
              <span className={cn("truncate", className)}>
                {t(`typeRoles.${role}`)}
                {"value" in sample && ` ${sample.value}`}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm text-muted">
          <span>{t("scaleNotes.spacing")}</span>
          <span>{t("scaleNotes.radii")}</span>
          <span>{t("scaleNotes.shadow")}</span>
        </div>
      </Section>
      <Section title={t("buttons")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="lg">
            {t("sample.primary")} lg
          </Button>
          <Button variant="primary">{t("sample.primary")} md</Button>
          <Button>{t("sample.secondary")} md</Button>
          <Button variant="ghost">{t("sample.ghost")} md</Button>
          <Button variant="danger">{t("sample.danger")} md</Button>
          <Button size="sm" variant="primary">
            {t("sample.primary")} sm
          </Button>
          <Button size="sm">{t("sample.secondary")} sm</Button>
          <Button size="xs">{t("sample.secondary")} xs</Button>
          <Button size="sm" disabled>
            {t("sample.disabled")}
          </Button>
          <Button className="outline-2 outline-offset-2 outline-accent">{t("sample.focusRing")}</Button>
          <IconButton label={t("sample.menu")} bordered>
            …
          </IconButton>
          <LinkButton>{t("sample.edit")}</LinkButton>
        </div>
      </Section>
      <Section title={t("inputs")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input placeholder={t("sample.placeholder")} aria-label={t("sample.placeholder")} />
          <InputGroup suffix="€">
            <Input numeric defaultValue="1.234,56" aria-label="EUR" />
          </InputGroup>
          <Field label={t("sample.fieldLabel")} htmlFor="gallery-warning" hint={t("sample.fieldHint")}>
            <Input id="gallery-warning" numeric warning defaultValue="4.900,00" />
          </Field>
          <Field label={t("sample.invalid")} htmlFor="gallery-invalid" error={t("sample.fieldError")}>
            <Input id="gallery-invalid" invalid defaultValue="12,3,4" />
          </Field>
          <Select aria-label={t("sample.month")} defaultValue="month">
            <option value="month">{t("sample.month")}</option>
            <option value="year">{t("sample.year")}</option>
          </Select>
          <Checkbox label={t("sample.primary")} defaultChecked />
        </div>
      </Section>
      <Section title={t("controls")}>
        <Segmented
          label={t("controls")}
          value={period}
          onChange={setPeriod}
          options={[
            { value: "month", label: t("sample.month") },
            { value: "year", label: t("sample.year") },
          ]}
        />
        <TabLinks
          label={t("controls")}
          tabs={[
            { href: "/settings/profile" as Route, label: t("sample.tabActive"), active: true },
            { href: "/settings/security" as Route, label: t("sample.tabOther"), active: false },
          ]}
        />
        <div className="flex gap-1.5">
          <Chip active={chip === "spesa"} onClick={() => setChip("spesa")}>
            Spesa
          </Chip>
          <Chip active={chip === "casa"} onClick={() => setChip("casa")}>
            Casa
          </Chip>
        </div>
      </Section>
      <Section title={t("badges")}>
        <div className="flex flex-wrap gap-2">
          <Badge tone="pos">On track</Badge>
          <Badge tone="warn">Near limit</Badge>
          <Badge tone="neg">Over</Badge>
          <Badge tone="accent">13ª</Badge>
          <Badge tone="neutral">Manual</Badge>
          <Tag>Spesa</Tag>
        </div>
      </Section>
      <Card padded={false} className="overflow-hidden">
        <CardHeader title={t("table")} actions={<LinkButton>{t("sample.edit")}</LinkButton>} />
        <Table>
          <THead>
            <Th sort={{ direction: sort, onSort: () => setSort(sort === "asc" ? "desc" : "asc") }}>Date</Th>
            <Th>Merchant</Th>
            <Th align="right">Amount</Th>
          </THead>
          <TBody>
            <GroupRow
              colSpan={3}
              label="September 2026"
              summary={formatMoney(202888n, "it-IT", { signed: true })}
            />
            <Tr>
              <Td muted>10 Sep</Td>
              <Td>Esselunga</Td>
              <Td align="right" className="text-neg">
                {formatMoney(-6412n, "it-IT")}
              </Td>
            </Tr>
            <Tr className="bg-hover">
              <Td muted>10 Sep</Td>
              <Td>
                Trenord <span className="text-xs text-faint">{t("sample.hover")}</span>
              </Td>
              <Td align="right" className="text-neg">
                {formatMoney(-8630n, "it-IT")}
              </Td>
            </Tr>
            <Tr selected>
              <Td muted>09 Sep</Td>
              <Td>
                Reply S.p.A. <span className="text-xs text-faint">{t("sample.selected")}</span>
              </Td>
              <Td align="right" className="text-pos">
                {formatMoney(209300n, "it-IT", { signed: true })}
              </Td>
            </Tr>
            <Tr>
              <Td muted>—</Td>
              <Td>{t("sample.pending")}</Td>
              <Td align="right" className="text-muted">
                {formatMoney(null, "it-IT")}
              </Td>
            </Tr>
            <TotalRow label="Total">
              <Td />
              <Td align="right">{formatMoney(202888n, "it-IT", { signed: true })}</Td>
            </TotalRow>
          </TBody>
        </Table>
      </Card>
      <Section title={t("stats")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiTile
            label="Cash"
            value={KPI_VALUE}
            delta={formatMoney(12000n, "it-IT", { signed: true })}
            deltaTone="pos"
            note="2 accounts"
          />
          <div className="flex flex-col justify-center gap-3">
            <ProgressBar value={0.78} label="78 %" />
            <ProgressBar value={0.9} tone="warn" label="90 %" />
            <ProgressBar value={1} tone="neg" label="112 %" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </Section>
      <Section title={t("identity")}>
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name="Mattia Longobardo" size={22} />
          <Avatar name="Mattia Longobardo" size={24} />
          <Avatar name="Giulia Rossi" size={28} />
          <Avatar name="Giulia Rossi" size={40} />
          <span className="inline-flex items-center gap-1.5">
            <Avatar name="Mattia Longobardo" size={24} decorative />
            <span className="text-sm">Mattia Longobardo</span>
          </span>
          <Kbd>⌘K</Kbd>
          <Kbd>esc</Kbd>
        </div>
      </Section>
      <Section title={t("overlays")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setModalOpen(true)}>
            {t("sample.openModal")}
          </Button>
          <Button size="sm" onClick={() => notify(t("sample.toastMessage"))}>
            {t("sample.toast")}
          </Button>
          <Button size="sm" onClick={() => setPaletteOpen(true)}>
            {t("sample.commandPalette")}
          </Button>
          <ActionMenu
            label={t("sample.menu")}
            items={[{ label: t("sample.edit"), onSelect: () => notify(t("sample.edit")) }]}
          />
          <Popover trigger={t("sample.popover")} triggerLabel={t("sample.popover")}>
            <p className="p-2 text-sm">{t("sample.popoverBody")}</p>
          </Popover>
        </div>
        <Modal
          open={modalOpen}
          onOpenChange={setModalOpen}
          title={t("sample.modalTitle")}
          description={t("sample.modalBody")}
          footer={<Button onClick={() => setModalOpen(false)}>{t("sample.secondary")}</Button>}
        >
          <InputGroup suffix="€">
            <Input numeric defaultValue="500,00" aria-label="EUR" />
          </InputGroup>
        </Modal>
        <h3 className="mt-1 text-lg font-semibold">{t("navStates")}</h3>
        <div className="grid grid-cols-3 gap-2">
          <span className={navItemClassName(false)}>
            <LayoutDashboard aria-hidden className="size-4 shrink-0" />
            {t("sample.navDefault")}
          </span>
          <span className={cn(navItemClassName(false), "bg-hover text-fg")}>
            <LayoutDashboard aria-hidden className="size-4 shrink-0" />
            {t("sample.navHover")}
          </span>
          <span className={cn(navItemClassName(true), "outline-2 -outline-offset-2 outline-accent")}>
            <LayoutDashboard aria-hidden className="size-4 shrink-0" />
            {t("sample.navActiveFocus")}
          </span>
        </div>
      </Section>
      <Section title={t("states")}>
        <EmptyState title={t("sample.emptyTitle")} description={t("sample.emptyDescription")} />
        <ErrorState
          title={t("sample.errorTitle")}
          description={t("sample.errorDescription")}
          onRetry={() => notify(common("retry"))}
          retryLabel={common("retry")}
        />
        <LoadingState label={common("loading")} />
      </Section>
      <div className="xl:col-span-2">
        <h2 className="mb-3 text-lg font-semibold">{t("layout")}</h2>
        <SettingsSection
          title={settings("preferences.title")}
          description={settings("preferences.description")}
        >
          <Checkbox label={settings("preferences.monthlySummary")} defaultChecked />
        </SettingsSection>
      </div>
    </div>
  );
}
