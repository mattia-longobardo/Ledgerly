"use client";

// The data of a screen (rewrite plan R3): a read of `/api/v1` through `@ledgerly/api-client`, kept in a
// cache by route and input. A write invalidates the routes it changed, by key, where a Server Action
// called `revalidatePath`: every screen that reads one of them reads it again and keeps showing what
// it had meanwhile.
import { type RouteContract } from "@ledgerly/api-contract/core";
import { call, type RouteInput, type RouteOutput } from "@ledgerly/api-client";
import { useCallback, useState, useSyncExternalStore } from "react";

interface Snapshot {
  data: unknown;
  error: unknown;
  loading: boolean;
}

interface Entry {
  route: RouteContract;
  input: unknown;
  snapshot: Snapshot;
  listeners: Set<() => void>;
  loaded: boolean;
}

const cache = new Map<string, Entry>();

const keyOf = (route: RouteContract, input: unknown) => `${route.id} ${JSON.stringify(input)}`;

function publish(entry: Entry, snapshot: Snapshot) {
  entry.snapshot = snapshot;
  for (const listener of entry.listeners) listener();
}

function load(entry: Entry) {
  entry.loaded = true;
  publish(entry, { ...entry.snapshot, loading: true });
  call(entry.route, entry.input).then(
    (data) => publish(entry, { data, error: null, loading: false }),
    (error: unknown) => publish(entry, { data: entry.snapshot.data, error, loading: false }),
  );
}

function entryOf(route: RouteContract, input: unknown): Entry {
  const key = keyOf(route, input);
  let entry = cache.get(key);
  if (!entry) {
    entry = {
      route,
      input,
      snapshot: { data: undefined, error: null, loading: true },
      listeners: new Set(),
      loaded: false,
    };
    cache.set(key, entry);
  }
  return entry;
}

const SERVER_SNAPSHOT: Snapshot = { data: undefined, error: null, loading: true };

export interface ApiState<T> {
  /** The last answer; it stays while the route is read again. */
  data: T | undefined;
  /** The refusal of the last read, or null. */
  error: unknown;
  loading: boolean;
  /** Reads the route again. */
  reload: () => void;
}

/** Reads one route and keeps the screen in step with it. */
export function useApi<R extends RouteContract>(route: R, input: RouteInput<R>): ApiState<RouteOutput<R>> {
  const entry = entryOf(route, input);
  const subscribe = useCallback(
    (listener: () => void) => {
      // A screen that opens again reads again, showing what it had meanwhile, as a page drawn on the
      // server did on every visit: a write elsewhere may have changed the answer since.
      if (!entry.loaded || entry.listeners.size === 0) load(entry);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [entry],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => entry.snapshot,
    () => SERVER_SNAPSHOT,
  );
  return {
    data: isOutput<R>(snapshot.data) ? snapshot.data : undefined,
    error: snapshot.error,
    loading: snapshot.loading,
    reload: () => load(entry),
  };
}

/**
 * The read with what it showed last while a new input is read: a filter that changes keeps the screen
 * on the previous answer until the new one arrives, as a page drawn on the server did on navigation.
 */
export function useLatest<T>(state: ApiState<T>): ApiState<T> {
  // The answer of an earlier render, kept as React keeps information from previous renders.
  const [last, setLast] = useState(state.data);
  if (state.data !== undefined && state.data !== last) setLast(state.data);
  return state.data !== undefined || state.error ? state : { ...state, data: last };
}

/** The cache holds only what `call` answered for that route: its declared output. */
function isOutput<R extends RouteContract>(data: unknown): data is RouteOutput<R> {
  return data !== undefined;
}

/** The answer of one route as a write needs it: the one in the cache, or a read of it. */
export async function read<R extends RouteContract>(route: R, input: RouteInput<R>): Promise<RouteOutput<R>> {
  const entry = entryOf(route, input);
  if (isOutput<R>(entry.snapshot.data)) return entry.snapshot.data;
  const data = await call(route, input);
  publish(entry, { data, error: null, loading: false });
  entry.loaded = true;
  return data;
}

/** Reads again every cached read of these routes; a read nobody shows any more is dropped. */
export function invalidate(...routes: RouteContract[]): void {
  const ids = new Set(routes.map((route) => route.id));
  for (const [key, entry] of cache) {
    if (!ids.has(entry.route.id)) continue;
    if (entry.listeners.size === 0) cache.delete(key);
    else load(entry);
  }
}
