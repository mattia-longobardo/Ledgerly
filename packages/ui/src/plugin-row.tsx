"use client";

// One plugin in Settings › Plugins (PERS-615 §3): the name, a link to its page; the dot and the word
// of its state; one line with the main fact; what it reads (solid chips) and writes (dashed chips);
// the main action and the menu «⋯». The row is not a link as a whole, so its action and its menu
// always work. It draws what it is given: the words, the action and the menu come from the page.
import type { ReactNode } from "react";
import { Tag } from "./badge";
import { cn } from "./cn";
import { ActionMenu } from "./menu";
import { Link } from "./router";
import { type Tone, TONE_TEXT } from "./tone";

const DOT: Record<Tone, string> = {
  pos: "bg-pos",
  neg: "bg-neg",
  warn: "bg-warn",
  accent: "bg-accent",
  muted: "bg-faint",
  faint: "bg-faint",
  fg: "bg-fg",
};

/** The dot and the word of a state: the state is always a word, never a colour alone (§7). */
export function StateWord({ word, tone }: { word: string; tone: Tone }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[tone])} />
      <span className={cn("text-sm font-medium", TONE_TEXT[tone])}>{word}</span>
    </span>
  );
}

/** What a plugin reads and writes, one chip each; nothing when it says nothing. */
export function PluginChips({ reads, writes }: { reads: readonly string[]; writes: readonly string[] }) {
  if (reads.length + writes.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1" data-testid="plugin-chips">
      {reads.map((one) => (
        <Tag key={`r-${one}`}>{one}</Tag>
      ))}
      {writes.map((one) => (
        <Tag key={`w-${one}`} dashed>
          {one}
        </Tag>
      ))}
    </span>
  );
}

export interface PluginRowProps {
  slug: string;
  name: string;
  href: string;
  /** The value the row is in, for the tests (`not_active`, `error`…). */
  status: string;
  word: string;
  tone: Tone;
  text: string;
  reads: readonly string[];
  writes: readonly string[];
  /** The main action, already built (a button or a link); null when the state asks for nothing. */
  primary: ReactNode;
  /** The menu «⋯»: its name («More actions for {X}») and its items. */
  menu: { label: string; items: { label: string; onSelect: () => void; danger?: boolean }[] };
  /** What follows the row: a refusal, a dialog. */
  children?: ReactNode;
}

export function PluginRow(props: PluginRowProps) {
  const { slug, name, href, status, word, tone, text, reads, writes, primary, menu, children } = props;
  return (
    <div className="flex flex-col" data-testid="plugin-row" data-plugin={slug} data-status={status}>
      <div className="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <Link
              href={href}
              className="focus-ring inline-flex min-h-6 items-center rounded-xs font-semibold break-words hover:underline"
            >
              {name}
            </Link>
            <StateWord word={word} tone={tone} />
          </div>
          <p className="mt-0.5 text-sm text-muted" data-testid="plugin-text">
            {text}
          </p>
          <PluginChips reads={reads} writes={writes} />
        </div>
        <div className="flex items-center gap-2">
          {/* At 400 px the action takes the width, and the menu stays beside it (§7). */}
          {primary !== null && (
            <div className="min-w-0 flex-1 md:flex-none max-md:[&_:is(a,button)]:h-10 max-md:[&_:is(a,button)]:w-full">
              {primary}
            </div>
          )}
          <div className={cn(primary === null && "ml-auto md:ml-0")}>
            <ActionMenu label={menu.label} items={menu.items} />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
