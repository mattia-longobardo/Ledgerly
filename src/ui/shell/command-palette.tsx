"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { cn } from "@/ui/cn";
import { Kbd } from "@/ui/kbd";
import { filterCommands } from "./commands";
import type { NavLink } from "./nav-types";
import { useShell } from "./shell-context";

export function CommandPalette({ links }: { links: NavLink[] }) {
  const { paletteOpen, setPaletteOpen, labels } = useShell();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const matches = filterCommands(links, query);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const pagesLabelId = `${baseId}-pages-label`;
  const optionId = (id: string) => `${baseId}-option-${id}`;
  const activeOption = matches[cursor];

  function close() {
    setPaletteOpen(false);
    setQuery("");
    setCursor(0);
  }

  function go(link: NavLink | undefined) {
    if (!link) return;
    close();
    router.push(link.href);
  }

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={(open) => (open ? setPaletteOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-60 bg-[rgba(10,12,16,0.28)]" />
        <Dialog.Popup className="fixed top-[15vh] left-1/2 z-60 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 animate-in overflow-hidden rounded-modal border border-border bg-card shadow-overlay">
          <Dialog.Title className="sr-only">{labels.search}</Dialog.Title>
          <div className="flex h-11 items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 text-muted" />
            <input
              autoFocus
              role="combobox"
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
                if (event.key === "Enter") go(matches[cursor]);
                if (event.key === "ArrowDown") setCursor((c) => Math.min(c + 1, matches.length - 1));
                if (event.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
              }}
              className="flex-1 bg-transparent text-md outline-none placeholder:text-faint"
            />
            <Kbd>{labels.palette.escape}</Kbd>
          </div>
          <div className="p-1.5">
            <div
              id={pagesLabelId}
              className="px-2 pt-1 pb-1.5 text-xs font-medium tracking-[0.04em] text-faint uppercase"
            >
              {labels.palette.pages}
            </div>
            {matches.length === 0 && <p className="px-2 py-3 text-muted">{labels.palette.empty}</p>}
            <div role="listbox" id={listboxId} aria-labelledby={pagesLabelId}>
              {matches.map((link, index) => (
                <div
                  key={link.id}
                  id={optionId(link.id)}
                  role="option"
                  aria-selected={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => go(link)}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center justify-between rounded-ctl px-2 text-left",
                    index === cursor && "bg-hover",
                  )}
                >
                  <span className="font-medium">{link.label}</span>
                  {link.group !== "footer" && (
                    <span className="text-sm text-muted">{labels.groups[link.group]}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
