"use client";

import { createContext, type ReactNode, useContext } from "react";

export type WeekStart = 0 | 1;

const WeekStartContext = createContext<WeekStart>(1);

/** The first day of the week of the person's preferences, for every calendar under the app layout. */
export function WeekStartProvider({ value, children }: { value: WeekStart; children: ReactNode }) {
  return <WeekStartContext.Provider value={value}>{children}</WeekStartContext.Provider>;
}

export function useWeekStart(): WeekStart {
  return useContext(WeekStartContext);
}
