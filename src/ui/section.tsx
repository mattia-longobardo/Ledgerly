import type { ReactNode } from "react";
import { Card } from "./card";
import { cn } from "./cn";

/**
 * The sections of a Settings page: one column, and two past the wide threshold (spec §8.2), where
 * a short form beside another reads better than a 1600 px stretch of one.
 */
export function SettingsGrid({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-6 @wide:grid-cols-2">{children}</div>;
}

/**
 * Settings-style row: title and description on the left (240 px), the card taking the rest; below
 * 672 px of section they stack. Measured on the section itself, so it answers to the column of the
 * grid it sits in. `wide` spans both columns of a `SettingsGrid` (tables); `padded={false}` is for
 * a card of full-bleed rows (sessions).
 */
export function SettingsSection({
  title,
  description,
  padded = true,
  wide = false,
  children,
}: {
  title: string;
  description: string;
  padded?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("@container min-w-0", wide && "@wide:col-span-2")}>
      <div className="grid grid-cols-1 items-start gap-3 @2xl:grid-cols-[240px_minmax(0,1fr)] @2xl:gap-6">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-muted">{description}</p>
        </div>
        <Card padded={padded} className={padded ? "flex flex-col gap-3.5" : "overflow-hidden"}>
          {children}
        </Card>
      </div>
    </section>
  );
}
