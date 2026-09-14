import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const CONTROL =
  "h-8 w-full rounded-ctl border border-border bg-card px-2.5 text-base text-fg placeholder:text-faint " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-soft disabled:bg-hover disabled:text-faint";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  warning?: boolean;
  numeric?: boolean;
}

export function Input({ invalid, warning, numeric, className, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        CONTROL,
        numeric && "text-right tabular-nums",
        warning && "border-warn",
        invalid && "border-neg text-neg",
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
    <div className="flex h-8 items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-soft [&>input]:h-full [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-0 [&>input]:ring-0">
      {prefix && <span className="text-muted">{prefix}</span>}
      {children}
      {suffix && <span className="text-muted">{suffix}</span>}
    </div>
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(CONTROL, "px-2", className)} {...props} />;
}

export function Checkbox({
  label,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="size-3.5 accent-primary" {...props} />
      {label}
    </label>
  );
}
