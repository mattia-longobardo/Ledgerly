"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; disabled?: boolean }[];
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(values) => {
        const next = values[0] as T | undefined;
        if (next && next !== value) onChange(next);
      }}
      className="inline-flex gap-0.5 self-start rounded-[7px] bg-hover p-0.5"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className="focus-ring h-6 rounded-[5px] px-2.5 text-sm font-medium text-muted data-[pressed]:bg-card data-[pressed]:text-fg data-[pressed]:shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
