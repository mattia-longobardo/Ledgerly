// The header of a detail page (audit UI-ACC-2): the meta line with its parts apart by «·», the title,
// and what the page puts beside or under them. An account, a service of Investments and a fund draw
// it the same; every word and figure is the caller's.
import { Fragment, type ReactNode } from "react";

export function DetailHeader({
  meta,
  tags,
  metaTestId,
  above,
  title,
  titleAside,
  actions,
  children,
}: {
  /** The parts of the meta line, in order; an empty one is left out. */
  meta: readonly ReactNode[];
  /** Badges and links after the meta line's parts, without a separator. */
  tags?: ReactNode;
  metaTestId?: string;
  /** Between the meta line and the title: the state of the connection. */
  above?: ReactNode;
  title: ReactNode;
  /** Beside the title, on its row. */
  titleAside?: ReactNode;
  /** Beside the whole block: the page's commands. */
  actions?: ReactNode;
  /** Under the title: the figure of the page. */
  children?: ReactNode;
}) {
  const parts = meta.filter((part) => part !== null && part !== undefined && part !== false && part !== "");
  const heading = (
    <h1 className="flex flex-wrap items-center gap-2 text-title font-semibold tracking-title">{title}</h1>
  );
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p
          data-testid={metaTestId}
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted"
        >
          {parts.map((part, index) => (
            <Fragment key={index}>
              {index > 0 && <span aria-hidden>{" · "}</span>}
              {part}
            </Fragment>
          ))}
          {tags}
        </p>
        {above}
        {titleAside ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {heading}
            {titleAside}
          </div>
        ) : (
          heading
        )}
        {children}
      </div>
      {actions}
    </header>
  );
}
