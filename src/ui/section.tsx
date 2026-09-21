import type { ReactNode } from "react";
import { Card } from "./card";

/**
 * The sections of a Settings page, one under the other, each taking the whole width.
 *
 * They were paired two by two for a while; putting two sections side by side halves the room each
 * one has, so neither reaches the width at which its title moves beside its card and both fall
 * back to a title stacked over a narrow card — the layout the pairing was meant to avoid. One
 * section per row is what the design asks for and what the owner asked for twice (2026-09-20).
 */
export function SettingsGrid({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>;
}

/**
 * Settings-style row: title and description on the left (240 px), the card taking all the rest;
 * below 672 px of section they stack. Measured on the section itself, so it answers to its own
 * width and not to the window's. `padded={false}` is for a card of full-bleed rows (sessions).
 *
 * `action` is the button the design puts under the description rather than inside the card —
 * "Invite user", "New token" — the one thing a section offers that is not about a row of it.
 */
export function SettingsSection({
  title,
  description,
  action,
  padded = true,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="@container min-w-0">
      <div className="grid grid-cols-1 items-start gap-3 @2xl:grid-cols-[240px_minmax(0,1fr)] @2xl:gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-muted">{description}</p>
          {action && <div className="mt-1 flex">{action}</div>}
        </div>
        <Card padded={padded} className={padded ? "flex flex-col gap-3.5" : "overflow-hidden"}>
          {children}
        </Card>
      </div>
    </section>
  );
}
