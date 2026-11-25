// The page of one plugin (PERS-615 §2): one page per state. «Not active» says what the plugin does and
// offers «Activate»; «Needs cleanup» lists what still depends on it and offers «Activate» or
// «Deactivate»; a plugin that is on has every section of H55 (plugin-sections.tsx), a banner for an
// error or an action needed, and «Deactivate» at its end. A plugin that is off leaves nothing to change.
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Banner } from "@ledgerly/ui/banner";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { PluginChips, StateWord } from "@ledgerly/ui/plugin-row";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { ActivateButton } from "./activate-button";
import { DeactivateButton } from "./deactivate-zone";
import { alerts } from "./plugin-model";
import { PLUGINS, type PluginView } from "./plugin-facts";
import { PrimaryAction } from "./plugin-row";
import { OnSections, type SectionsInput } from "./plugin-sections";

type Words = SectionsInput["words"];

function Heading({ view, back, extra }: { view: PluginView; back: string; extra: string | null }) {
  const { plugin } = view;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="flex flex-wrap items-center gap-x-3"
          data-testid="source-heading"
          data-status={view.status}
        >
          <h2 className="text-lg font-semibold" data-testid="source-title">
            {plugin.name}
          </h2>
          <StateWord word={view.word} tone={view.tone} />
        </div>
        <ButtonLink href={PLUGINS} size="sm">
          ← {back}
        </ButtonLink>
      </div>
      <p className="text-muted">{extra === null ? plugin.description : `${plugin.description} ${extra}`}</p>
    </div>
  );
}

/** «Not active»: what the plugin reads, writes and needs, where it shows, and «Activate {X}». */
function NotActive({ view, words }: { view: PluginView; words: Words }) {
  const { plugin } = view;
  const name = plugin.name;
  const needs =
    plugin.fields.length > 0
      ? plugin.fields.map((field) => field.label).join(", ")
      : words("about.needsBank", { name });
  const writes =
    view.writes.length > 0 ? <PluginChips reads={[]} writes={view.writes} /> : words("about.nothing");
  const where = plugin.kind === "calendar" ? words("about.whereCalendar") : words("about.whereAccounts");
  const facts: [string, ReactNode][] = [
    [words("about.reads"), <PluginChips key="reads" reads={view.reads} writes={[]} />],
    [words("about.writes"), writes],
    [words("about.needs"), needs],
    [words("about.where"), where],
  ];
  return (
    <SettingsSection
      title={words("about.title")}
      description={words("about.hint")}
      action={
        <div className="flex flex-col gap-2">
          <ActivateButton pluginId={plugin.id} provider={name} label={words("about.activate", { name })} />
          <p className="text-sm text-muted">{words("about.after", { name })}</p>
        </div>
      }
    >
      <dl
        className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-[140px_minmax(0,1fr)]"
        data-testid="plugin-about"
      >
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted">{term}</dt>
            <dd className="mb-2 md:mb-1">{value}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  );
}

/** One of the two ways out of «Needs cleanup»: one under the other at 400 px (§7). */
function Choice({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted">{body}</p>
      <div className="mt-auto">{children}</div>
    </Card>
  );
}

/** «Needs cleanup» (D1 = A): what still depends on the plugin, and its two ways out. */
function NeedsCleanup({ view, words }: { view: PluginView; words: Words }) {
  const { plugin } = view;
  const name = plugin.name;
  return (
    <>
      <Banner tone="warn" title={words("cleanup.title", { name })} testId="cleanup-banner">
        <p>{words("cleanup.body", { name })}</p>
        {view.leftovers.length > 0 ? (
          <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-5" data-testid="cleanup-leftovers">
            {view.leftovers.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5">{words("cleanup.access", { name })}</p>
        )}
      </Banner>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Choice
          title={words("cleanup.activateTitle", { name })}
          body={words("cleanup.activateBody", { name })}
        >
          <ActivateButton pluginId={plugin.id} provider={name} label={words("cleanup.activate", { name })} />
        </Choice>
        <Choice
          title={words("cleanup.deactivateTitle", { name })}
          body={words("cleanup.deactivateBody", { name })}
        >
          <DeactivateButton slug={plugin.id} provider={name} />
        </Choice>
      </div>
    </>
  );
}

/** The banner of an error or of an action needed (§2, §5): `role="alert"`, with the action. */
function Alert({ view, words }: { view: PluginView; words: Words }) {
  const worst = view.own[0]?.row ?? null;
  if (!alerts(view.status) || worst === null) return null;
  const { plugin } = view;
  return (
    <Banner
      tone="neg"
      alert
      title={view.status === "error" ? words("banner.error") : words("banner.action", { name: plugin.name })}
      action={<PrimaryAction primary={view.primary} slug={plugin.id} name={plugin.name} />}
      testId="plugin-alert"
    >
      {worst.status.text}
    </Banner>
  );
}

export async function PluginPage(props: Omit<SectionsInput, "words">) {
  const words = await getTranslations("settings.plugin");
  const { view, day } = props;
  const { plugin, status } = view;
  let extra: string | null = null;
  if (status === "not_active" && plugin.deactivatedAt !== null)
    extra = words("page.deactivated", { date: day(plugin.deactivatedAt) });
  if (status === "disconnected") extra = words("page.disconnected");

  let body: ReactNode;
  if (status === "not_active") body = <NotActive view={view} words={words} />;
  else if (status === "needs_cleanup") body = <NeedsCleanup view={view} words={words} />;
  else body = <OnSections input={{ ...props, words }} />;

  return (
    <SettingsGrid>
      <Heading view={view} back={words("page.back")} extra={extra} />
      <Alert view={view} words={words} />
      {body}
    </SettingsGrid>
  );
}
