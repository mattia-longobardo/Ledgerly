"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useState } from "react";
import { Button, LinkButton } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { CategoryPicker } from "@ledgerly/ui/category-picker";
import { cn } from "@ledgerly/ui/cn";
import { Checkbox } from "@ledgerly/ui/input";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { useCategoryActions } from "./category-actions";
import type { CategoryOption } from "./view";

/** One movement of a group, with its day, its account and its amount already formatted. */
interface ReviewRowView {
  id: string;
  date: string;
  account: string;
  amount: string;
}

/** A group of "To review": movements with the same text and the same suggestion. */
export interface ReviewGroupView {
  id: string;
  text: string;
  count: number;
  total: string;
  suggestion: { id: string; name: string; color: string } | null;
  reason: { code: string; params: Readonly<Record<string, string>> } | null;
  rows: readonly ReviewRowView[];
}

/** How many groups a section shows before "Show more", and how many examples a closed group. */
const PAGE = 20;
const EXAMPLES = 3;
const REASONS = ["memory", "group", "similar", "merchant_type", "brand", "salary", "fee"] as const;

/** A group a person dealt with: the line that takes its card's place, with its "Undo". */
interface Done {
  id: string;
  text: string;
  count: number;
  category: string;
  undoId: string | null;
}

function ReviewGroupCard({
  group,
  categories,
  onDone,
}: {
  group: ReviewGroupView;
  categories: readonly CategoryOption[];
  onDone: (done: Done) => void;
}) {
  const t = useTranslations("expenses");
  const actions = useCategoryActions();
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const [excluded, setExcluded] = useState<readonly string[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = group.rows.filter((row) => !excluded.includes(row.id));
  const count = chosen.length;

  function reasonText(): string | null {
    if (group.reason === null) return null;
    const code = REASONS.find((one) => one === group.reason?.code);
    if (code === undefined) return t("auto.reason.other");
    return t(`auto.reason.${code}`, {
      text: group.reason.params.text ?? "",
      brand: group.reason.params.brand ?? "",
      group: group.suggestion?.name ?? "",
    });
  }

  /** One action for the whole selection: all of it or none. */
  function run(
    work: () => Promise<{ ok: true; count: number; undoId: string | null } | { ok: false }>,
    category: string,
  ) {
    if (saving || count === 0) return;
    setSaving(true);
    setFailed(false);
    work()
      .then((result) => {
        if (!result.ok) {
          setFailed(true);
          return;
        }
        onDone({ id: group.id, text: group.text, count: result.count, category, undoId: result.undoId });
      })
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  }

  const ids = chosen.map((row) => row.id);
  const suggestion = group.suggestion;

  return (
    <Card>
      <article
        data-testid="review-group"
        aria-labelledby={headingId}
        aria-busy={saving}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 id={headingId} className="min-w-0 font-semibold break-words">
            {group.text}
          </h3>
          <span className="text-sm text-muted tabular-nums">
            {t("review.group.summary", { count: group.count, total: group.total })}
          </span>
        </div>
        {suggestion && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted">{t("review.group.suggestion")}</span>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-xs"
                style={{ background: suggestion.color }}
              />
              <span className="font-medium break-words">{suggestion.name}</span>
            </p>
            <p className="text-muted">{reasonText()}</p>
          </div>
        )}

        <ul
          className={cn(
            "flex flex-col text-sm",
            expanded && group.rows.length > 50 && "max-h-80 overflow-y-auto",
          )}
        >
          {(expanded ? group.rows : group.rows.slice(0, EXAMPLES)).map((row) => (
            <li
              key={row.id}
              className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 border-b border-border py-1 last:border-0"
            >
              {expanded ? (
                <Checkbox
                  label={t("review.group.row", { date: row.date, account: row.account })}
                  aria-label={t("review.group.select", { date: row.date })}
                  checked={!excluded.includes(row.id)}
                  disabled={saving}
                  onChange={() =>
                    setExcluded((current) =>
                      current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id],
                    )
                  }
                />
              ) : (
                <span className="min-w-0 break-words text-muted">
                  {t("review.group.row", { date: row.date, account: row.account })}
                </span>
              )}
              <span className="ml-auto tabular-nums">{row.amount}</span>
            </li>
          ))}
        </ul>
        {/* Always there, for a group of two as well: the list it opens is where a row is left out. */}
        {group.rows.length > 1 && (
          <Button
            size="xs"
            variant="ghost"
            className="self-start"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t("review.group.hide") : t("review.group.showAll", { count: group.rows.length })}
          </Button>
        )}

        {failed && (
          <p role="alert" className="text-sm text-neg">
            {t("review.group.failed")}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse max-sm:[&>*]:w-full">
          <CategoryPicker
            categories={categories}
            currentId={null}
            open={picking}
            onOpenChange={setPicking}
            onPick={(categoryId) => {
              if (categoryId === null || !actions) return;
              const name = categories.find((one) => one.id === categoryId)?.name ?? "";
              run(() => actions.commands.choose(ids, categoryId), name);
            }}
            searchLabel={t("row.searchCategory")}
            noMatchLabel={t("row.noCategoryMatch")}
            triggerLabel={t("review.group.chooseLabel", { count, text: group.text })}
            disabled={saving || count === 0 || !actions}
            triggerClassName={cn(
              "focus-ring inline-flex h-7 items-center justify-center gap-1.5 rounded-ctl border px-2.5 text-sm font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:border-border disabled:bg-hover disabled:text-faint",
              suggestion
                ? "border-border bg-card text-fg hover:bg-hover"
                : "border-primary bg-primary text-primary-fg hover:brightness-[1.08]",
            )}
          >
            {suggestion ? t("review.group.change") : t("review.group.choose")}
          </CategoryPicker>
          {suggestion && (
            <Button
              size="sm"
              variant="primary"
              data-testid="review-group-confirm"
              disabled={saving || count === 0 || !actions}
              aria-label={t("review.group.confirmLabel", {
                category: suggestion.name,
                count,
                text: group.text,
              })}
              onClick={() => actions && run(() => actions.commands.confirm(ids), suggestion.name)}
            >
              {saving ? t("review.group.saving") : t("review.group.confirm", { count })}
            </Button>
          )}
        </div>
      </article>
    </Card>
  );
}

/** What the guided review says in the summary card: how far the person is. */
interface GuideProgress {
  /** Movements of the bank that already have a category. */
  categorised: number;
}

/**
 * The groups of "To review" (ux/n3-categories-manual.md §4): the groups with a suggestion, the
 * groups without, each with one action for all its movements, and the summary beside them. The
 * single movements are the caller's (`singles`): the table of Expenses, with its own actions.
 *
 * A group that was dealt with becomes a line with "Undo", which stays until the page is loaded
 * again; the counts come from the server at every action.
 */
export function ReviewList({
  suggested,
  unsuggested,
  singlesCount,
  categories,
  singles,
  aside,
  guide,
}: {
  suggested: readonly ReviewGroupView[];
  unsuggested: readonly ReviewGroupView[];
  singlesCount: number;
  categories: readonly CategoryOption[];
  /** The section of the single movements, drawn by the page. */
  singles: ReactNode;
  /** What the page adds under the summary: the link to the merge proposals. */
  aside?: ReactNode;
  guide?: GuideProgress;
}) {
  const t = useTranslations("expenses");
  const router = useRouter();
  const actions = useCategoryActions();
  const [done, setDone] = useState<readonly Done[]>([]);
  const [shown, setShown] = useState({ suggested: PAGE, unsuggested: PAGE });

  function onDone(one: Done) {
    setDone((current) => [...current.filter((other) => other.id !== one.id), one]);
    router.refresh();
    // The next group takes the focus: its first button, or nothing when it was the last one.
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="review-group"] button:not([disabled])')?.focus();
    });
  }

  function undo(one: Done) {
    if (one.undoId === null || !actions) return;
    actions.commands
      .undo(one.undoId)
      .then((result) => {
        if (!result.ok) return;
        setDone((current) => current.filter((other) => other.id !== one.id));
        router.refresh();
      })
      .catch(() => undefined);
  }

  const doneIds = new Set(done.map((one) => one.id));
  const sections = [
    { key: "suggested" as const, groups: suggested.filter((group) => !doneIds.has(group.id)) },
    { key: "unsuggested" as const, groups: unsuggested.filter((group) => !doneIds.has(group.id)) },
  ];
  const groupsLeft = sections[0].groups.length + sections[1].groups.length;
  const movementsLeft =
    [...sections[0].groups, ...sections[1].groups].reduce((sum, group) => sum + group.count, 0) +
    singlesCount;

  return (
    <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        {done.length > 0 && (
          <ul className="flex flex-col gap-2">
            {done.map((one) => (
              <li
                key={one.id}
                role="status"
                data-testid="review-done-row"
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border bg-card px-4 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Check aria-hidden className="size-4 shrink-0 text-pos" />
                  <span className="min-w-0 break-words">
                    {t("review.group.done", { text: one.text, count: one.count, category: one.category })}
                  </span>
                </span>
                {one.undoId !== null && (
                  <LinkButton onClick={() => undo(one)}>{t("review.group.undo")}</LinkButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {suggested.length === 0 && (unsuggested.length > 0 || singlesCount > 0) && (
          <p className="rounded-ctl bg-hover px-3 py-2 text-sm">{t("review.noSuggestions")}</p>
        )}
        {sections.map(({ key, groups }) =>
          groups.length === 0 ? null : (
            <section key={key} id={`review-${key}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="text-lg font-semibold">{t(`review.sections.${key}`)}</h2>
                <span className="text-sm text-muted">
                  {t("review.sections.count", {
                    groups: groups.length,
                    count: groups.reduce((sum, group) => sum + group.count, 0),
                  })}
                </span>
              </div>
              {groups.slice(0, shown[key]).map((group) => (
                <ReviewGroupCard key={group.id} group={group} categories={categories} onDone={onDone} />
              ))}
              {groups.length > shown[key] && (
                <Button
                  className="self-start"
                  onClick={() => setShown((current) => ({ ...current, [key]: current[key] + PAGE }))}
                >
                  {t("review.sections.more", { count: Math.min(PAGE, groups.length - shown[key]) })}
                </Button>
              )}
            </section>
          ),
        )}
        {singlesCount > 0 && (
          <section id="review-singles" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-lg font-semibold">{t("review.sections.singles")}</h2>
              <span className="text-sm text-muted">
                {t("review.sections.singlesCount", { count: singlesCount })}
              </span>
            </div>
            {singles}
          </section>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-4 @4xl:sticky @4xl:top-16 @max-4xl:order-first">
        <Card className="flex flex-col gap-2">
          <h2 className="font-semibold">{t("review.aside.title")}</h2>
          {guide && (
            <div className="flex flex-col gap-1.5" aria-live="polite">
              <p className="text-sm">
                {t("review.guide.progress.text", { done: done.length, total: done.length + groupsLeft })}
              </p>
              <ProgressBar
                value={done.length + groupsLeft === 0 ? 1 : done.length / (done.length + groupsLeft)}
                label={t("review.guide.progress.label")}
              />
              <p className="text-sm text-muted">
                {t("review.guide.progress.detail", {
                  done: guide.categorised + done.reduce((sum, one) => sum + one.count, 0),
                  left: movementsLeft,
                })}
              </p>
            </div>
          )}
          <dl className="flex flex-col gap-1 text-sm @max-4xl:flex-row @max-4xl:flex-wrap @max-4xl:gap-x-4">
            {(
              [
                ["suggested", sections[0].groups.reduce((sum, group) => sum + group.count, 0)],
                ["unsuggested", sections[1].groups.reduce((sum, group) => sum + group.count, 0)],
                ["singles", singlesCount],
              ] as const
            ).map(([key, count]) => (
              <div key={key} className="flex items-baseline justify-between gap-2">
                <dt>
                  <a
                    href={`#review-${key}`}
                    className="focus-ring inline-flex min-h-6 items-center underline"
                  >
                    {t(`review.sections.${key}`)}
                  </a>
                </dt>
                <dd className="tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
          {aside}
        </Card>
      </aside>
    </div>
  );
}
