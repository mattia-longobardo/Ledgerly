"use client";

// The settings of a service (§3.6): how it keeps its value, since when, its periods, its own web
// address, and the way to the account's own settings.
import { useTranslations } from "next-intl";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { Link } from "@ledgerly/ui/router";
import type { ServicePage } from "../service/service-view";
import { ServiceUrlForm } from "../settings-forms";
import type { Connection } from "./connection-view";

export function SettingsCard({ page, connection }: { page: ServicePage; connection: Connection }) {
  const text = useTranslations("investments");
  const { settings } = connection;
  const long = (day: string) => formatDate(day, "long", page.say.locale);
  return (
    <Card className="flex min-w-0 flex-col gap-3" data-testid="service-settings">
      <h2 className="text-lg font-semibold">{text("settings.title")}</h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">{text("connection.settings.keeps")}</dt>
        <dd>{settings.mode ? text(`connection.settings.modes.${settings.mode}`) : NULL_DISPLAY}</dd>
        <dt className="text-muted">{text("connection.settings.managedSince")}</dt>
        <dd>{long(settings.managedSince)}</dd>
      </dl>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{text("settings.periods")}</h3>
        <ul className="flex flex-col text-sm text-muted">
          {settings.periods.map((period) => (
            <li key={`${period.fromOn}-${period.reason}-${period.mode}`}>
              {text("settings.period", {
                mode: text(`modes.${period.mode}`),
                origin: text(`origins.${period.origin}`),
                date: long(period.fromOn),
              })}
            </li>
          ))}
        </ul>
      </div>
      <ServiceUrlForm accountId={page.id} url={settings.url} />
      <p className="text-sm text-muted">
        {text("settings.flags")}{" "}
        <Link
          href={`/accounts/${page.id}?tab=settings`}
          className="focus-ring inline-flex min-h-6 items-center rounded-sm text-accent hover:underline"
        >
          {text("connection.settings.inAccounts", { name: connection.name })}
        </Link>
      </p>
    </Card>
  );
}
