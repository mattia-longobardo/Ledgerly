import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";
import { useFieldState } from "./field";

/**
 * Focus (design: accent border and a 2 px soft halo): the soft halo alone is too faint to see
 * (about 1.1:1), so a 1 px accent outline doubles the accent border into a visible 2 px ring.
 */
const FIELD_FOCUS =
  "focus:border-accent focus:outline-1 focus:outline-accent focus:ring-[3px] focus:ring-soft";

const CONTROL =
  "h-8 w-full rounded-ctl border border-border bg-card px-2.5 text-base text-fg placeholder:text-faint " +
  `${FIELD_FOCUS} disabled:bg-hover disabled:text-faint`;

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  warning?: boolean;
  numeric?: boolean;
}

export function Input({ invalid, warning, numeric, className, ...props }: InputProps) {
  const field = useFieldState();
  const isInvalid = invalid ?? field.invalid;
  return (
    <input
      aria-invalid={isInvalid || undefined}
      aria-describedby={field.describedBy}
      className={cn(
        CONTROL,
        numeric && "text-right tabular-nums",
        warning && "border-warn",
        isInvalid && "border-neg text-neg",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroup({
  prefix,
  suffix,
  children,
}: {
  prefix?: ReactNode;
  suffix?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-8 items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 focus-within:border-accent focus-within:outline-1 focus-within:outline-accent focus-within:ring-[3px] focus-within:ring-soft [&>input]:h-full [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-0 [&>input]:focus:ring-0 [&>input]:focus:outline-none">
      {prefix && <span className="text-muted">{prefix}</span>}
      {children}
      {suffix && <span className="text-muted">{suffix}</span>}
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useFieldState();
  return (
    <select
      aria-invalid={field.invalid || undefined}
      aria-describedby={field.describedBy}
      className={cn(CONTROL, "px-2", className)}
      {...props}
    />
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  const field = useFieldState();
  return (
    <label className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <input
        type="checkbox"
        className="focus-ring m-0 size-3.5 accent-primary"
        aria-invalid={field.invalid || undefined}
        aria-describedby={field.describedBy}
        {...props}
      />
      {label}
    </label>
  );
}
