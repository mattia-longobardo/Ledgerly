"use client";

// Settings › Addons (rewrite plan R5a, 13-plugins-addons.md §13.3-§13.5): one switch per addon,
// Payroll and Time Off under Work. Before an addon goes off the screen lists what stops (PA12); once
// it changed, the shell is drawn again, so the menu follows with no reload of the page.
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { type AddonId, ADDONS, getAddons, setAddon } from "@ledgerly/api-contract";
import { call, type RouteOutput } from "@ledgerly/api-client";
import { Button } from "@ledgerly/ui/button";
import { remember, useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Modal } from "@ledgerly/ui/modal";
import { useRouter } from "@ledgerly/ui/router";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { Switch } from "@ledgerly/ui/switch";
import { notify } from "@ledgerly/ui/toast";

type Addon = RouteOutput<typeof getAddons>["addons"][number];
type Stop = Addon["stops"][number];

/** The addon a page sent the person here for (`?off=`), when it is one. */
function offOf(value: string | null): AddonId | null {
  return ADDONS.find((one) => one === value) ?? null;
}

/** The switches' writes: on at once, off only after the person read what stops. */
function useAddonSwitch() {
  const text = useTranslations("settings.addons");
  const names = useTranslations("nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** The addons waiting for the person's confirmation before they go off. */
  const [asking, setAsking] = useState<Addon[] | null>(null);

  function apply(ids: AddonId[], active: boolean) {
    setAsking(null);
    startTransition(async () => {
      try {
        let answer: RouteOutput<typeof getAddons> | null = null;
        for (const id of ids) answer = await call(setAddon, { params: { id }, body: { active } });
        if (answer) remember(getAddons, {}, answer);
        // The menu, the phone's tabs and the palette are the layout's: it reads the session again.
        router.refresh();
        notify(text(active ? "turnedOn" : "turnedOff", { name: ids.map((id) => names(id)).join(", ") }));
      } catch {
        notify(text("failed"), "error");
      }
    });
  }

  const change = (addons: Addon[], active: boolean) =>
    active
      ? apply(
          addons.map((one) => one.id),
          true,
        )
      : setAsking(addons);
  return { pending, asking, change, apply, cancel: () => setAsking(null) };
}

export function AddonsScreen() {
  const text = useTranslations("settings.addons");
  const names = useTranslations("nav");
  const off = offOf(useSearchParams().get("off"));
  const state = useApi(getAddons, {});
  const { pending, asking, change, apply, cancel } = useAddonSwitch();

  return (
    <SettingsGrid>
      {off && (
        <p
          role="status"
          className="rounded-md border border-border bg-card p-3 text-sm"
          data-testid="addon-off"
        >
          {text("offNotice", { name: names(off) })}
        </p>
      )}
      <Loaded state={state}>
        {({ addons }) => <AddonSections addons={addons} pending={pending} onChange={change} />}
      </Loaded>
      {asking && (
        <TurnOffDialog
          addons={asking}
          pending={pending}
          onCancel={cancel}
          onConfirm={() =>
            apply(
              asking.map((one) => one.id),
              false,
            )
          }
        />
      )}
    </SettingsGrid>
  );
}

/** The addons that stand alone, then Work with its two (§13.3). */
function AddonSections({
  addons,
  pending,
  onChange,
}: {
  addons: Addon[];
  pending: boolean;
  onChange: (addons: Addon[], active: boolean) => void;
}) {
  const text = useTranslations("settings.addons");
  const names = useTranslations("nav");
  const work = addons.filter((one) => one.group === "work");
  const alone = addons.filter((one) => one.group === null);
  return (
    <>
      <SettingsSection title={text("title")} description={text("description")}>
        <ul className="flex flex-col divide-y divide-border">
          {alone.map((addon) => (
            <AddonRow key={addon.id} addon={addon} pending={pending} onChange={onChange} />
          ))}
        </ul>
      </SettingsSection>
      <SettingsSection title={names("groups.work")} description={text("work.description")}>
        <ul className="flex flex-col divide-y divide-border">
          {/* Work is on while one of its two is; turned off, both go, turned on, both come back. */}
          <Row
            id="work"
            name={names("groups.work")}
            hint={text("work.hint")}
            checked={work.some((one) => one.active)}
            pending={pending}
            onChange={(active) =>
              onChange(
                work.filter((one) => one.active !== active),
                active,
              )
            }
          />
          {work.map((addon) => (
            <AddonRow key={addon.id} addon={addon} pending={pending} onChange={onChange} inner />
          ))}
        </ul>
      </SettingsSection>
    </>
  );
}

function AddonRow({
  addon,
  pending,
  onChange,
  inner = false,
}: {
  addon: Addon;
  pending: boolean;
  onChange: (addons: Addon[], active: boolean) => void;
  inner?: boolean;
}) {
  const text = useTranslations("settings.addons");
  const names = useTranslations("nav");
  return (
    <Row
      id={addon.id}
      name={names(addon.id)}
      hint={text(`items.${addon.id}`)}
      checked={addon.active}
      pending={pending}
      onChange={(active) => onChange([addon], active)}
      inner={inner}
    />
  );
}

function Row({
  id,
  name,
  hint,
  checked,
  pending,
  onChange,
  inner = false,
}: {
  id: string;
  name: string;
  hint: string;
  checked: boolean;
  pending: boolean;
  onChange: (active: boolean) => void;
  inner?: boolean;
}) {
  return (
    <li
      className={
        inner
          ? "flex items-start justify-between gap-4 py-3 pl-6"
          : "flex items-start justify-between gap-4 py-3"
      }
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={`addon-${id}`} className="font-medium">
          {name}
        </span>
        <span id={`addon-${id}-hint`} className="text-sm text-muted">
          {hint}
        </span>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        labelledBy={`addon-${id}`}
        describedBy={`addon-${id}-hint`}
        disabled={pending}
        data-testid={`addon-switch-${id}`}
      />
    </li>
  );
}

function TurnOffDialog({
  addons,
  pending,
  onCancel,
  onConfirm,
}: {
  addons: Addon[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const text = useTranslations("settings.addons");
  const names = useTranslations("nav");
  const common = useTranslations("common");
  const name = addons.map((one) => names(one.id)).join(", ");
  // What another addon loses (PA12); an addon that goes off with this one loses nothing it still shows.
  const going = new Set(addons.map((one) => one.id));
  const stops: Stop[] = addons.flatMap((one) => one.stops).filter((stop) => !going.has(stop.addon));
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onCancel()}
      title={text("confirm.title", { name })}
      description={text("confirm.description")}
      width={460}
      footer={
        <>
          <Button onClick={onCancel}>{common("cancel")}</Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {text("confirm.action")}
          </Button>
        </>
      }
    >
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" data-testid="addon-stops">
        <li>{text("confirm.pages", { name })}</li>
        <li>{text("confirm.jobs")}</li>
        <li>{text("confirm.data")}</li>
        {stops.map((stop) => (
          <li key={`${stop.addon}:${stop.what}`}>
            {text(`stops.${stop.what}`, { addon: names(stop.addon) })}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
