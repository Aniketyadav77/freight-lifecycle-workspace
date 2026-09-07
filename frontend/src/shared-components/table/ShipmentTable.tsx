/**
 * PORTED FROM: fleet-control-tower / src/components/table/ShipmentTable.tsx
 *
 * Changed: the id-list selector it reads, the column headers, and the filter
 * placeholder. The virtualizer setup, the two-mechanism design, and the keying
 * rationale are unchanged.
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState, type ComponentType } from "react";

import { ShipmentRow } from "./ShipmentRow";
import { GRID_COLUMNS, GRID_COLUMNS_WITH_ACTION, ROW_HEIGHT } from "./tableLayout";
import { useSortedFilteredTrackedIds } from "../trackedLoads";

const VIEWPORT_HEIGHT = 420;

/**
 * Rows rendered beyond the visible window, above and below. Enough to cover a
 * fast scroll before React catches up, few enough that the DOM stays small.
 */
const OVERSCAN = 8;

/**
 * The shipment table.
 *
 * Two independent mechanisms keep this cheap at 500+ rows, and they solve
 * different problems -- worth separating when explaining it:
 *
 *  1. Virtualization bounds how many rows *exist*. Only the ~20 rows in view
 *     (plus overscan) are mounted, so the DOM does not grow with the fleet.
 *  2. The selector pattern bounds how often each row *updates*. This component
 *     subscribes only to the ordered list of ids, so position updates do not
 *     re-render the table; each mounted row reads its own load and re-renders
 *     alone.
 *
 * Either one without the other still gives you a slow table: virtualization
 * alone would re-render all 20 visible rows plus the container every tick, and
 * selectors alone would leave 500 rows mounted.
 */
export function ShipmentTable({
  action,
  actionLabel = "",
}: {
  /**
   * Optional trailing action cell, rendered per row. Kept as an opt-in prop so
   * the table stays the general-purpose component it was in the source project
   * — this file gained an extension point, not a freight-specific feature.
   *
   * Must be a stable module-level component, not an inline arrow: the row is
   * memo'd and compares this by reference.
   */
  action?: ComponentType<{ loadId: string }>;
  actionLabel?: string;
} = {}) {
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Sorted closest-to-arrival first. See the selector for why this returns ids
  // rather than loads.
  const loadIds = useSortedFilteredTrackedIds(query);

  const virtualizer = useVirtualizer({
    count: loadIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const virtualRows = virtualizer.getVirtualItems();

  return (
    // Only the outer container is neumorphic. The rows inside sit on flat
    // white, so live-updating cells keep full contrast against a soft shell.
    <section className="neu-raised w-full overflow-hidden rounded-xl p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">In transit</h2>
        <span data-num className="text-xs text-ink/50">
          {loadIds.length} rows · {virtualRows.length} mounted
        </span>
      </header>

      <div className="py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by load id, lane or transporter…"
          // Inputs are inset: in this system, a field you type into is pressed
          // into the surface rather than raised off it.
          className="neu-inset w-full rounded-lg px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/35"
        />
      </div>

      <div className="overflow-hidden rounded-lg bg-card">
        <div
          className={`border-b border-ink/8 px-4 py-2 text-[11px] font-semibold tracking-wide text-ink/45 uppercase ${
            action ? GRID_COLUMNS_WITH_ACTION : GRID_COLUMNS
          }`}
        >
          <span>Load</span>
          <span>Lane</span>
          <span>Status</span>
          <span>Progress</span>
          <span>Updated</span>
          {action && <span>{actionLabel}</span>}
        </div>

        {/* The scroll container. Its height is fixed; the spacer inside carries
            the full scrollable height so the scrollbar reflects every row. */}
        <div ref={scrollRef} style={{ height: VIEWPORT_HEIGHT }} className="overflow-y-auto">
          {loadIds.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink/55">
              {query
                ? `Nothing matches “${query}”. Try a city, a load id, or a transporter name.`
                : "Nothing in transit right now."}
            </p>
          ) : (
            <div style={{ height: virtualizer.getTotalSize() }} className="relative w-full">
              {virtualRows.map((virtualRow) => (
                // Keyed by load id, not by index: when sorting moves a load
                // (progress promotes it up the list), React moves that row's
                // component rather than re-labelling whichever row sits at that
                // index, so its subscription and DOM node survive.
                <ShipmentRow
                  key={loadIds[virtualRow.index]}
                  loadId={loadIds[virtualRow.index]!}
                  top={virtualRow.start}
                  Action={action}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
