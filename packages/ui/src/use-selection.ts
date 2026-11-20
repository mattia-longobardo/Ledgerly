"use client";

// The rows a list has selected, by id (audit UI-EXP-4). A list that changes under the selection (a write
// takes a row away) keeps only the ids it still shows, in its own order.
import { useCallback, useMemo, useState } from "react";

interface Selection {
  /** The selected ids the list still shows, in the list's order. */
  selected: readonly string[];
  /** Every id of the list is selected (and the list is not empty). */
  all: boolean;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Selects the whole list, or clears it when it was all selected. */
  toggleAll: () => void;
  clear: () => void;
}

export function useSelection(present: readonly string[]): Selection {
  const [ids, setIds] = useState<readonly string[]>([]);
  const selected = useMemo(() => present.filter((id) => ids.includes(id)), [present, ids]);
  const all = present.length > 0 && selected.length === present.length;
  // Stable, so a keyboard handler that toggles does not have to be bound again on every render.
  const toggle = useCallback(
    (id: string) =>
      setIds((current) => (current.includes(id) ? current.filter((one) => one !== id) : [...current, id])),
    [],
  );
  const clear = useCallback(() => setIds([]), []);
  return {
    selected,
    all,
    has: (id) => selected.includes(id),
    toggle,
    toggleAll: () => setIds(all ? [] : [...present]),
    clear,
  };
}
