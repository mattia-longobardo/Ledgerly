import type { ReactNode } from "react";
import { cn } from "./cn";

export interface ProgressRingProps {
  value: number;
  max: number;
  label: string;
  size?: number;
  thickness?: number;
  /** Centre content; defaults to the rounded percentage. */
  children?: ReactNode;
  className?: string;
}

export function ProgressRing({
  value,
  max,
  label,
  size = 72,
  thickness = 6,
  children,
  className,
}: ProgressRingProps) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuemin={0}
      aria-valuemax={safeMax}
    >
      <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="stroke-accent transition-[stroke-dashoffset] duration-200 ease-out"
        />
      </svg>
      <span className="num absolute inset-0 flex items-center justify-center text-body-sm text-fg">
        {children ?? `${Math.round(ratio * 100)}%`}
      </span>
    </div>
  );
}
