"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { formatMoney } from "@/platform/format";
import { Avatar } from "@/ui/avatar";
import { Badge, Tag } from "@/ui/badge";
import { Button, IconButton, LinkButton } from "@/ui/button";
import { Card, CardHeader } from "@/ui/card";
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
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { TabLinks } from "@/ui/tab-links";
import { GroupRow, Table, TBody, Td, Th, THead, TotalRow, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";

const TOKENS = [
  "bg",
  "card",
  "hover",
  "sel",
  "fg",
  "muted",
  "border",
  "primary",
  "pos",
  "neg",
  "warn",
  "soft",
] as const;
const TYPE_SCALE = [
  ["text-display", "36"],
  ["text-hero", "32"],
  ["text-title", "24"],
  ["text-kpi", "22"],
  ["text-lg", "15"],
  ["text-base", "13"],
  ["text-sm", "12"],
  ["text-xs", "11"],
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
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [modalOpen, setModalOpen] = useState(false);
  const [sort, setSort] = useState<"asc" | "desc">("desc");

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Section title={t("colours")}>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {TOKENS.map((token) => (
            <div key={token} className="flex flex-col gap-1 text-xs text-muted">
              <span
                className="h-8 rounded-ctl border border-border"
                style={{ background: `var(--${token})` }}
              />
              {token}
            </div>
          ))}
        </div>
      </Section>
      <Section title={t("type")}>
        {TYPE_SCALE.map(([className, size]) => (
          <div key={className} className="flex items-baseline justify-between gap-4">
            <span className={`${className} truncate font-semibold`}>{formatMoney(5907712n, "it-IT")}</span>
            <span className="text-sm text-faint">{size}px</span>
          </div>
        ))}
      </Section>
      <Section title={t("buttons")}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">{t("sample.primary")}</Button>
          <Button>{t("sample.secondary")}</Button>
          <Button variant="ghost">{t("sample.ghost")}</Button>
          <Button variant="danger">{t("sample.danger")}</Button>
          <Button disabled>{t("sample.disabled")}</Button>
          <Button size="sm" variant="primary">
            {t("sample.primary")}
          </Button>
          <Button size="xs">{t("sample.secondary")}</Button>
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
      <Section title={t("table")}>
        <Card padded={false} className="overflow-hidden">
          <CardHeader title={t("sample.cardTitle")} actions={<LinkButton>{t("sample.edit")}</LinkButton>} />
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
              <Tr selected>
                <Td muted>09 Sep</Td>
                <Td>Reply S.p.A.</Td>
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
      </Section>
      <Section title={t("stats")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiTile
            label="Cash"
            value={formatMoney(713595n, "it-IT")}
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
          <Button onClick={() => setModalOpen(true)}>{t("sample.openModal")}</Button>
          <Button onClick={() => notify(t("sample.toastMessage"))}>{t("sample.toast")}</Button>
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
