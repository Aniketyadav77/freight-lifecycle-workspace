/**
 * THE ADAPTER SEAM — new in this project (see ./index.ts for the reuse story).
 *
 * The Control Tower components were written against a `Vehicle` shape in a
 * `useFleetStore`. Rather than rewrite them for this project's `Load`, this
 * module presents the freight store through the same *shape* of API they
 * already expected: a keyed map of positioned entities, an id-list selector, a
 * per-entity selector, and a non-reactive subscribe.
 *
 * The selector rules from the source project carry over unchanged, and they are
 * the reason this file returns what it returns:
 *
 *  - Select the narrowest thing you actually render. A status is a string; it
 *    survives a position tick, so a component selecting it does not re-render
 *    when the truck merely moves.
 *  - Never build a new object or array in a selector without useShallow — a
 *    fresh one fails Object.is every time.
 *  - Return *ids* from list selectors. Position updates do not reorder the
 *    list, so the table container ignores them and each row updates alone.
 *
 * `useTrackedLoad` deliberately returns the store's own `Load` object rather
 * than mapping it into a new shape. Mapping would mint a fresh object on every
 * store update and re-render every row on every tick — the exact failure these
 * selectors exist to prevent.
 */

import { useShallow } from "zustand/react/shallow";

import { useFreightStore } from "../store/useFreightStore";
import type { Load, LoadPosition } from "../types";

/** A load that is actually on the road, so it is guaranteed to have a position. */
export type TrackedLoad = Load & { position: LoadPosition };

const isTracked = (load: Load): load is TrackedLoad =>
  load.status === "in_transit" && load.position !== null;

/**
 * Non-reactive read of everything currently moving. Used by the cluster index
 * rebuild, which runs on its own interval and must not subscribe to the store.
 */
export function getTrackedLoads(): Map<string, TrackedLoad> {
  const tracked = new Map<string, TrackedLoad>();
  for (const load of useFreightStore.getState().loads.values()) {
    if (isTracked(load)) tracked.set(load.id, load);
  }
  return tracked;
}

/** Vanilla subscribe: notifies without rendering. */
export const subscribeTracked = (listener: () => void) => useFreightStore.subscribe(listener);

/**
 * One load. Object identity is preserved by the store for loads that did not
 * change, so a row subscribed here re-renders only when *its* load moves.
 */
export const useTrackedLoad = (loadId: string): Load | undefined =>
  useFreightStore((state) => state.loads.get(loadId));

/** Just the status — a string, and so stable across position ticks. */
export const useTrackedLoadStatus = (loadId: string) =>
  useFreightStore((state) => state.loads.get(loadId)?.status);

export const useTrackedCount = (): number =>
  useFreightStore((state) => {
    let count = 0;
    for (const load of state.loads.values()) if (isTracked(load)) count += 1;
    return count;
  });

/**
 * The ordered, filtered id list the table renders.
 *
 * Closest to arrival sorts first — the freight equivalent of the source
 * project's "delayed vehicles first": it is what someone watching this screen
 * is actually waiting on. Ties break by id so the order is total and stable.
 */
export function useSortedFilteredTrackedIds(query: string): string[] {
  const needle = query.trim().toLowerCase();

  return useFreightStore(
    useShallow((state) => {
      const matches: TrackedLoad[] = [];

      for (const load of state.loads.values()) {
        if (!isTracked(load)) continue;

        if (
          needle === "" ||
          load.id.toLowerCase().includes(needle) ||
          load.origin.toLowerCase().includes(needle) ||
          load.destination.toLowerCase().includes(needle) ||
          (load.assignedTransporterName ?? "").toLowerCase().includes(needle)
        ) {
          matches.push(load);
        }
      }

      matches.sort((a, b) => b.progress - a.progress || a.id.localeCompare(b.id));
      return matches.map((load) => load.id);
    }),
  );
}
