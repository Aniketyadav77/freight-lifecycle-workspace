/**
 * PORTED FROM: fleet-control-tower / src/components/table/ShipmentRow.tsx
 *
 * Changed: the cells (vehicle id / speed / last update -> load id, lane,
 * progress, last update) and the per-entity hook it reads. The subscription
 * shape, the memo, and the inline transform are unchanged.
 */

import { memo, type ComponentType } from "react";

import { StatusCell } from "./StatusCell";
import { GRID_COLUMNS, GRID_COLUMNS_WITH_ACTION, ROW_HEIGHT } from "./tableLayout";
import { useTrackedLoad } from "../trackedLoads";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * One row, subscribed to one load -- it takes an id and reads its own slice, so
 * one load moving re-renders one row rather than the visible window.
 *
 * This row does re-render every tick, because progress and last-update
 * genuinely change every tick and it renders both. The status cell is carved
 * out into its own memo'd component precisely so that it does not.
 */
export const ShipmentRow = memo(function ShipmentRow({
  loadId,
  top,
  Action,
}: {
  loadId: string;
  /** Absolute offset from the virtualizer. */
  top: number;
  /**
   * Optional trailing action cell. A component type rather than a render
   * callback so memo() can compare it by reference — an inline arrow would
   * change identity every render and defeat the row's memoization.
   */
  Action?: ComponentType<{ loadId: string }>;
}) {
  const load = useTrackedLoad(loadId);

  if (!load) return null;

  const progressPct = Math.round(load.progress * 100);

  return (
    <div
      // height and transform stay inline: both are computed by the virtualizer,
      // and Tailwind cannot generate classes for values it never sees in source.
      // translateY rather than `top` keeps the row on the compositor and avoids
      // a layout pass per row on every scroll frame.
      style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
      // Flat white, not neumorphic. Every cell here updates every second, and
      // soft-edged rows would make live text harder to read, not softer.
      className={`absolute inset-x-0 top-0 items-center border-b border-ink/6 bg-card px-4 text-sm ${
        Action ? GRID_COLUMNS_WITH_ACTION : GRID_COLUMNS
      }`}
    >
      <span data-num className="font-mono text-xs text-ink/60">
        {load.id}
      </span>

      <span className="truncate text-ink/80">
        {load.origin} <span className="text-ink/35">→</span> {load.destination}
        {load.assignedTransporterName && (
          <span className="ml-2 text-xs text-ink/45">{load.assignedTransporterName}</span>
        )}
      </span>

      <StatusCell loadId={loadId} />

      {/* A bar rather than a bare number: progress is the one cell here that is
          scanned across rows, and relative length reads faster than digits. */}
      <span className="flex items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
          <span
            className="status-transition block h-full rounded-full bg-accent"
            style={{ width: `${progressPct}%` }}
          />
        </span>
        <span data-num className="w-9 text-right text-xs text-ink/70">
          {progressPct}%
        </span>
      </span>

      <span data-num className="text-xs text-ink/50">
        {load.positionUpdatedAt ? timeFormat.format(load.positionUpdatedAt) : "—"}
      </span>

      {Action && <Action loadId={loadId} />}
    </div>
  );
});
