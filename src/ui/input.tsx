"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
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

/** Several lines of text: the field's look, a height of its own, and a user-resizable height. */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useFieldState();
  return (
    <textarea
      aria-invalid={field.invalid || undefined}
      aria-describedby={field.describedBy}
      className={cn(CONTROL, "h-auto min-h-24 resize-y py-1.5 leading-snug", className)}
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
    // The whole row is the target — the box is 14 px by design, the label around it is 24 px tall.
    <label className={cn("inline-flex min-h-6 items-center gap-1.5 text-sm", className)}>
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
