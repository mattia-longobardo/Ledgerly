"use client";

import type { ComponentProps } from "react";
import { cn } from "../cn";
import { Input } from "../input";
import { normalizeTime } from "./form";

/**
 * A time of day in 24 hours, written the way the summary and the preview write it. Text and not
 * `type="time"`: see `normalizeTime`. It is put in its proper form when the field is left.
 */
export function TimeInput({
  value,
  onValue,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onValue: (value: string) => void;
}) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder="HH:MM"
      value={value}
      onChange={(event) => onValue(event.target.value)}
      onBlur={() => onValue(normalizeTime(value) ?? value)}
      className={cn("w-[72px] tabular-nums", className)}
    />
  );
}
