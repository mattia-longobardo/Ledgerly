import type { ReactNode } from "react";
import { Card } from "./card";

/** Settings-style row: title and description on the left (4fr), the card on the right (8fr). */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-3 border-t border-border pt-6 first:border-0 first:pt-2 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-muted">{description}</p>
      </div>
      <Card className="flex flex-col gap-4">{children}</Card>
    </section>
  );
}
