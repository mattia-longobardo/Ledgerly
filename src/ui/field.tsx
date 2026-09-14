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
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      <FieldContext.Provider value={{ describedBy, invalid: Boolean(error) }}>
        {children}
      </FieldContext.Provider>
      {error ? (
        <p id={errorId} className="text-sm text-neg">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
