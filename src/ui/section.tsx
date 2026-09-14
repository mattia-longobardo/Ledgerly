import type { ReactNode } from "react";
import { Card } from "./card";

/**
 * Settings-style row: title and description on the left (4fr), the card on the right (8fr). A page
 * stacks its sections 24 px apart. `padded={false}` is for a card of full-bleed rows (sessions).
 */
export function SettingsSection({
  title,
  description,
  padded = true,
  children,
}: {
  title: string;
  description: string;
  padded?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted">{description}</p>
      </div>
      <Card padded={padded} className={padded ? "flex flex-col gap-3.5" : "overflow-hidden"}>
        {children}
      </Card>
    </section>
  );
}
