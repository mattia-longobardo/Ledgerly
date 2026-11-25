// The sections of the page of a plugin that is on (H55; plugin-settings.md §2.2), in a fixed order:
// its connection, its accounts, its categories, its schedule, its history, what Ledgerly writes to it,
// and «Deactivate» at the end. A plugin that is off has none of them (PERS-615 §4).
import type { ReactNode } from "react";
import type { getTranslations } from "next-intl/server";
import type { RouteOutput } from "@ledgerly/api-client";
import {
  categories as categoryRoutes,
  labels as labelRoutes,
  sources,
} from "@ledgerly/api-contract/settings";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { ButtonLink } from "@ledgerly/ui/button";
import { SettingsSection } from "@ledgerly/ui/section";
import { apiRead } from "@/platform/api-read";
import { SourceCategories } from "../finance/source-categories";
import { FocusOnArrival } from "./activate-button";
import { HistoryDepth } from "./advanced/history-depth";
import { BanksCard } from "./banks-card";
import type { ConnectionRowProps } from "./connection-row";
import { DeactivateZone } from "./deactivate-zone";
import { DeletedAccounts } from "./deleted-accounts";
import { engineSections } from "./engine-sections";
import { pageOf, type PluginView } from "./plugin-facts";
import { ScheduleCell } from "./schedule-cell";
import { sourceCategoryRowsOf } from "./source-category-rows";

type Words = Awaited<ReturnType<typeof getTranslations<"settings.plugin">>>;
type SourcePage = RouteOutput<typeof sources.getSource> | null;

export interface SectionsInput {
  ctx: Pick<Ctx, "locale" | "timeZone">;
  view: PluginView;
  words: Words;
  /** Open the dialog that replaces the bank plugin's credentials (`?replace=1`). */
  replace: boolean;
  day: (instant: string) => string;
  /** The row of a connection that does not exist yet: «Not connected», and «Connect». */
  absent: (id: string, name: string, detail: string | null) => ConnectionRowProps;
}

/** The bank plugin: its card with the banks, and «Choose the accounts» of each bank. */
function bankParts(input: SectionsInput, page: SourcePage) {
  const { view, words, replace, day } = input;
  const { plugin, own } = view;
  const leaveOf = (id: string) =>
    page?.connections.find((one) => one.id === id)?.leave ?? { accounts: 0, excluded: 0 };
  const { credentials } = plugin;
  const connection = (
    <BanksCard
      pluginId={plugin.id}
      credentials={{
        saved: credentials.saved,
        savedAt: credentials.savedAt ? day(credentials.savedAt) : null,
        invalid: credentials.invalid,
      }}
      returnAddress={plugin.returnAddress}
      banks={own.map((bank) => bank.row)}
      openReplace={replace}
      leave={Object.fromEntries(own.map((bank) => [bank.connection.id, leaveOf(bank.connection.id)]))}
      provider={{ name: plugin.name, href: `${pageOf(plugin.id)}#deactivate` }}
    />
  );
  const accounts =
    own.length === 0 ? null : (
      <>
        <ul className="flex flex-col">
          {own.map((bank) => (
            <li
              key={bank.connection.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3.5 first:border-t-0"
            >
              <span className="min-w-0 font-semibold break-words">{bank.row.name}</span>
              <ButtonLink
                href={`/banks/connect?step=accounts&c=${bank.connection.id}&all=1`}
                size="sm"
                aria-label={words("accounts.chooseFor", { name: bank.row.name })}
              >
                {words("accounts.choose")}
              </ButtonLink>
            </li>
          ))}
        </ul>
        <DeletedAccounts slug={plugin.id} rows={page?.deletedAccounts ?? []} />
      </>
    );
  return { connection, accounts, writes: null };
}

/** The card, the accounts and the writes: the bank plugin's, or a plugin read by an engine of the core. */
async function partsOf(input: SectionsInput, page: SourcePage) {
  const { view, absent } = input;
  const { plugin, own } = view;
  if (plugin.kind === "bank") return bankParts(input, page);
  const single = own[0] ?? {
    connection: null,
    row: absent(`plugin:${plugin.id}`, plugin.name, plugin.description),
  };
  const built = await engineSections({
    plugin,
    single,
    page,
    deactivateHref: `${pageOf(plugin.id)}#deactivate`,
  });
  return { connection: built.connection, accounts: built.accounts, writes: built.writes };
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <SettingsSection title={title} description={hint} padded={false}>
      {children}
    </SettingsSection>
  );
}

/** When Ledgerly reads each connection by itself. */
function Schedules({ input }: { input: SectionsInput }) {
  const { view, words, ctx } = input;
  if (view.own.length === 0) return null;
  return (
    <Section title={words("sections.schedule")} hint={words("sections.scheduleHint")}>
      <ul className="flex flex-col">
        {view.own.map(({ connection: one }) => (
          <li key={one.id} className="border-t border-border first:border-t-0" data-testid="schedule-row">
            <div className="flex flex-col gap-x-5 gap-y-1.5 px-4 py-3.5 md:flex-row md:items-start md:justify-between">
              <span className="min-w-0 font-semibold break-words">{one.name}</span>
              <div className="min-w-0 text-sm md:text-right">
                <ScheduleCell connection={one} name={one.name} provider={one.providerName} active ctx={ctx} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** «Download the history again»: the depth read today, for a provider that reads a chosen depth. */
function Depths({ input }: { input: SectionsInput }) {
  const { view, words } = input;
  const depths = view.own.flatMap(({ connection: one }) =>
    one.historyDepth === null
      ? []
      : [{ id: one.id, months: one.historyDepth, choices: one.capabilities.historyMonths }],
  );
  if (depths.length === 0) return null;
  return (
    <Section
      title={words("sections.history")}
      hint={words("sections.historyHint", { provider: view.plugin.name })}
    >
      {depths.map((depth) => (
        <HistoryDepth key={depth.id} connectionId={depth.id} months={depth.months} choices={depth.choices} />
      ))}
    </Section>
  );
}

/** The categories the plugin gives its movements, each matched to one of Ledgerly. */
async function Categories({ input }: { input: SectionsInput }) {
  const { view, words } = input;
  const [sourceRows, allCategories] = await Promise.all([
    apiRead(labelRoutes.listSourceCategories, {}),
    apiRead(categoryRoutes.listCategories, { query: { archived: "true" } }),
  ]);
  const categories = sourceCategoryRowsOf(
    `plugin:${view.plugin.id}`,
    sourceRows?.sourceCategories ?? [],
    allCategories?.categories ?? [],
  );
  if (categories === null) return null;
  const name = view.plugin.name;
  return (
    <Section
      title={words("sections.categories", { provider: name })}
      hint={words("sections.categoriesHint", { provider: name })}
    >
      <SourceCategories source={categories.name} rows={categories.rows} />
    </Section>
  );
}

export async function OnSections({ input }: { input: SectionsInput }) {
  const { view, words } = input;
  const { plugin, own } = view;
  const name = plugin.name;
  const page = await apiRead(sources.getSource, { params: { slug: plugin.id } });
  const parts = await partsOf(input, page);
  const left = Object.values(plugin.leftovers).some((count) => count > 0);
  return (
    <>
      <div id="connection" className="scroll-mt-4">
        <Section
          title={words("sections.connection")}
          hint={words("sections.connectionHint", { provider: name })}
        >
          {parts.connection}
        </Section>
        <FocusOnArrival target="connection" />
      </div>
      {parts.accounts !== null && (
        <Section title={words("sections.accounts")} hint={words("sections.accountsHint", { provider: name })}>
          {parts.accounts}
        </Section>
      )}
      <Categories input={input} />
      <Schedules input={input} />
      <Depths input={input} />
      {parts.writes !== null && (
        <Section
          title={words("sections.writes", { provider: name })}
          hint={words("sections.writesHint", { provider: name })}
        >
          {parts.writes}
        </Section>
      )}
      <div id="deactivate" className="scroll-mt-4">
        <Section
          title={words("sections.deactivate", { provider: name })}
          hint={words("sections.deactivateHint", { provider: name })}
        >
          <DeactivateZone
            slug={plugin.id}
            provider={name}
            calendar={plugin.kind === "calendar"}
            empty={!left && own.length === 0}
          />
        </Section>
      </div>
    </>
  );
}
