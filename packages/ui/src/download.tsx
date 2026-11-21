"use client";

// A file the browser saves from data the screen already holds (audit UI-SUB-2): no route of its own,
// the link stays a link (`<a download>`) and keeps its name for the keyboard and for screen readers.
// shortcut: the browser's download only; the native containers (phase C) give their own save through
// an adapter, as `router.tsx` does for navigation, when they ship.
import { type ReactNode, useEffect, useMemo } from "react";

export function DownloadLink({
  name,
  type,
  content,
  className,
  children,
}: {
  /** The file's name. */
  name: string;
  type: string;
  /** Null while the data is not read yet: the link has no target. */
  content: string | null;
  className?: string;
  children: ReactNode;
}) {
  const href = useMemo(
    () => (content === null ? undefined : URL.createObjectURL(new Blob([content], { type }))),
    [content, type],
  );
  useEffect(
    () => () => {
      if (href) URL.revokeObjectURL(href);
    },
    [href],
  );
  return (
    <a href={href} download={name} className={className}>
      {children}
    </a>
  );
}
