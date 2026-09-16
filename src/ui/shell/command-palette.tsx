"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { cn } from "@/ui/cn";
import { Kbd } from "@/ui/kbd";
import { filterCommands, type PaletteOption, type PayeeMatch, paletteOptions } from "./commands";
import type { NavLink } from "./nav-types";
import { useShell } from "./shell-context";

/** How long the typing has to settle before the payee search is asked (spec §7.2). */
const DEBOUNCE_MS = 200;

export function CommandPalette({
  links,
  searchPayees,
}: {
  links: NavLink[];
  /**
   * Looks up payees for the palette. A Server Action the app layout hands down, the same way
   * `saveTheme` is, so `src/ui` needs no domain module. Left out, the palette is pages only.
   */
  searchPayees?: (query: string) => Promise<PayeeMatch[]>;
}) {
  const { paletteOpen, setPaletteOpen, labels } = useShell();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  /**
   * The payees found, kept with the query that found them. Showing them is then a comparison
   * rather than a second piece of state to clear: an answer to an older query is simply not this
   * query's answer, so a stale list can never be displayed under a new one.
   */
  const [found, setFound] = useState<{ query: string; payees: PayeeMatch[] }>({ query: "", payees: [] });
  const needle = query.trim();
  const pages = filterCommands(links, query);
  const options = paletteOptions(
    pages,
    found.query === needle ? found.payees : [],
    (link) => labels.groups[link.group === "footer" ? "system" : link.group],
  );
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const pagesLabelId = `${baseId}-pages-label`;
  const payeesLabelId = `${baseId}-payees-label`;
  const optionId = (id: string) => `${baseId}-option-${id}`;
  const activeOption = options[cursor];

  // Every way of closing (Escape, the backdrop, ⌘K again, choosing an option) starts the next
  // opening afresh. Emptying the query is enough to hide the payees, since they are shown by
  // comparison with it.
  const [wasOpen, setWasOpen] = useState(paletteOpen);
  if (paletteOpen !== wasOpen) {
    setWasOpen(paletteOpen);
    if (!paletteOpen) {
      setQuery("");
      setCursor(0);
    }
  }

  /**
   * Asks for payees once the typing has settled. The answer is dropped when a newer keystroke has
   * already superseded it, so a slow reply cannot overwrite a faster one that came after it.
   */
  useEffect(() => {
    if (!paletteOpen || searchPayees === undefined || needle === "") return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const payees = await searchPayees(needle);
        if (current) setFound({ query: needle, payees });
      } catch {
        // A failed lookup leaves the pages alone: the palette still navigates.
        if (current) setFound({ query: needle, payees: [] });
      }
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [needle, paletteOpen, searchPayees]);

  function go(option: PaletteOption | undefined) {
    if (!option) return;
    setPaletteOpen(false);
    router.push(option.href);
  }

  const pageOptions = options.filter((option) => option.group === "pages");
  const payeeOptions = options.filter((option) => option.group === "payees");

  function renderOption(option: PaletteOption) {
    const index = options.indexOf(option);
    return (
      <div
        key={option.id}
        id={optionId(option.id)}
        role="option"
        aria-selected={index === cursor}
        onMouseEnter={() => setCursor(index)}
        onClick={() => go(option)}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center justify-between rounded-ctl px-2 text-left",
          index === cursor && "bg-hover",
        )}
      >
        <span className="truncate font-medium">{option.label}</span>
        <span className="shrink-0 pl-2 text-sm text-muted">{option.hint}</span>
      </div>
    );
  }

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-60 bg-[rgba(10,12,16,0.28)]" />
        <Dialog.Popup className="fixed top-[15vh] left-1/2 z-60 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 animate-in overflow-hidden rounded-modal border border-border bg-card shadow-overlay">
          <Dialog.Title className="sr-only">{labels.search}</Dialog.Title>
          <div className="flex h-11 items-center gap-2.5 border-b border-border px-3.5">
            <Search aria-hidden className="size-4 text-muted" />
            <input
              autoFocus
              role="combobox"
              aria-label={labels.search}
              aria-expanded={paletteOpen}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeOption ? optionId(activeOption.id) : undefined}
              value={query}
              placeholder={labels.palette.placeholder}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") go(options[cursor]);
                if (event.key === "ArrowDown") setCursor((c) => Math.min(c + 1, options.length - 1));
                if (event.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
              }}
              className="flex-1 bg-transparent text-md outline-none placeholder:text-faint"
            />
            <Kbd>{labels.palette.escape}</Kbd>
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            <div
              id={pagesLabelId}
              className="px-2 py-1.5 text-xs font-medium tracking-[0.04em] text-faint uppercase"
            >
              {labels.palette.pages}
            </div>
            <p role="status" className={cn("px-2 text-muted", options.length === 0 && "py-3")}>
              {options.length === 0 && labels.palette.empty}
            </p>
            <div role="listbox" id={listboxId} aria-labelledby={pagesLabelId}>
              {pageOptions.map(renderOption)}
              {payeeOptions.length > 0 && (
                <>
                  <div
                    id={payeesLabelId}
                    role="presentation"
                    className="px-2 py-1.5 text-xs font-medium tracking-[0.04em] text-faint uppercase"
                  >
                    {labels.palette.payees}
                  </div>
                  {payeeOptions.map(renderOption)}
                </>
              )}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
