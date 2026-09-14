import type { Route } from "next";
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

const VARIANT = {
  primary: "border-primary bg-primary text-primary-fg hover:brightness-[1.08]",
  secondary: "border-border bg-card text-fg hover:bg-hover",
  ghost: "border-transparent bg-transparent text-muted hover:bg-hover hover:text-fg",
  danger: "border-border bg-card text-neg hover:bg-neg-bg",
} as const;

const SIZE = {
  xs: "h-6 px-2 text-sm rounded-[5px]",
  sm: "h-7 px-2.5 text-sm",
  md: "h-8 px-3 text-base",
  lg: "h-9 px-3.5 text-base rounded-[7px]",
} as const;

const BASE =
  "focus-ring inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border font-medium " +
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-hover disabled:text-faint disabled:hover:brightness-100";

type Variant = keyof typeof VARIANT;
type Size = keyof typeof SIZE;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={cn(BASE, VARIANT[variant], SIZE[size], className)} {...props}>
      {icon}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: Route;
  variant?: Variant;
  size?: Size;
}

/** A navigation that looks like a button (e.g. an empty state's call to action). */
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonLinkProps) {
  return <Link href={href} className={cn(BASE, VARIANT[variant], SIZE[size], className)} {...props} />;
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
  size?: 28 | 32;
  bordered?: boolean;
}

export function IconButton({
  label,
  size = 28,
  bordered = false,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "focus-ring inline-grid shrink-0 place-items-center rounded-ctl text-muted hover:bg-hover hover:text-fg",
        size === 28 ? "size-7" : "size-8",
        bordered ? "border border-border bg-card" : "border border-transparent",
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn("focus-ring rounded-[2px] text-sm font-medium text-accent hover:underline", className)}
      {...props}
    />
  );
}

/** A filter chip: a pill that toggles on and off. */
export function Chip({
  active,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "focus-ring inline-flex h-[26px] items-center rounded-[13px] border border-border px-2.5 text-sm",
        active ? "bg-fg font-medium text-card" : "bg-card text-fg hover:bg-hover",
        className,
      )}
      {...props}
    />
  );
}
