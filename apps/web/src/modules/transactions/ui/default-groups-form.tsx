"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/input";
import { FIELD_GRID } from "@/ui/section";

/** A default group as the form offers it: its name and its examples in the person's language. */
export interface DefaultGroupView {
  key: string;
  name: string;
  examples: string;
  color: string;
}

/**
 * The choice of the default groups (decision K4; ux/n3-categories-manual.md §7.3): every group
 * ticked, the button says how many it creates. For a person with no category only — the page
 * decides who sees it.
 */
export function DefaultGroupsForm({
  groups,
  onCreate,
  onLater,
  onCreated,
}: {
  groups: readonly DefaultGroupView[];
  /** Creates the chosen groups; answers how many, or `null` when it could not. */
  onCreate: (keys: string[]) => Promise<number | null>;
  /** "Not now": left out where there is nothing to skip to. */
  onLater?: () => void;
  onCreated: (count: number) => void;
}) {
  const t = useTranslations("settings.categories.defaults");
  const ids = useId();
  const [chosen, setChosen] = useState<readonly string[]>(groups.map((group) => group.key));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || chosen.length === 0) return;
    setSaving(true);
    setFailed(false);
    onCreate([...chosen])
      .then((count) => {
        if (count === null) setFailed(true);
        else onCreated(count);
      })
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  }

  return (
    <form onSubmit={onSubmit} aria-busy={saving} className="flex flex-col gap-3">
      {failed && (
        <p role="alert" className="text-sm text-neg">
          {t("failed")}
        </p>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 font-semibold">{t("title")}</legend>
        <p className="pb-1 text-sm text-muted">{t("description")}</p>
        <div className={FIELD_GRID}>
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-xs"
                  style={{ background: group.color }}
                />
                <Checkbox
                  label={group.name}
                  className="font-medium"
                  checked={chosen.includes(group.key)}
                  disabled={saving}
                  aria-describedby={`${ids}-${group.key}-examples`}
                  onChange={() =>
                    setChosen((current) =>
                      current.includes(group.key)
                        ? current.filter((key) => key !== group.key)
                        : [...current, group.key],
                    )
                  }
                />
              </span>
              <span id={`${ids}-${group.key}-examples`} className="pl-3.5 text-sm text-muted">
                {group.examples}
              </span>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 max-sm:flex-col-reverse">
        {onLater && (
          <Button size="sm" onClick={onLater} disabled={saving}>
            {t("later")}
          </Button>
        )}
        <Button type="submit" size="sm" variant="primary" disabled={saving || chosen.length === 0}>
          {t("create", { count: chosen.length })}
        </Button>
      </div>
    </form>
  );
}
