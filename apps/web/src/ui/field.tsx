"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

interface FieldState {
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldState | null>(null);

/** The enclosing Field's association state (aria-describedby, aria-invalid); empty outside a Field. */
export function useFieldState(): FieldState {
  return useContext(FieldContext) ?? { invalid: false };
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  hintBeside = false,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  /**
   * The hint to the right of the control instead of under it: for the one field of a card, which
   * would otherwise sit in a corner of a wide card. On a narrow card the hint wraps under it.
   */
  hintBeside?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  const hintLine = hint ? (
    <p
      id={hintId}
      className={hintBeside ? "max-w-[560px] min-w-48 flex-1 text-sm text-muted" : "text-sm text-muted"}
    >
      {hint}
    </p>
  ) : null;
  const control = (
    <FieldContext.Provider value={{ describedBy, invalid: Boolean(error) }}>{children}</FieldContext.Provider>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {hintBeside ? (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-1.5">
          <div className="w-72 max-w-full">{control}</div>
          {!error && hintLine}
        </div>
      ) : (
        control
      )}
      {error ? (
        <p id={errorId} className="text-sm text-neg">
          {error}
        </p>
      ) : hintBeside ? null : (
        hintLine
      )}
    </div>
  );
}
