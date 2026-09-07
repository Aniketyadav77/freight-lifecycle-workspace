/**
 * PORTED FROM: fleet-control-tower / src/components/table/StatusCell.tsx
 *
 * Changed: the status vocabulary (on_time/delayed -> the freight lifecycle
 * statuses), and the SLA-breach badge is gone — this project has no equivalent
 * signal, so that subscription was dropped rather than faked. The memo boundary
 * and the reason for it are unchanged.
 */

import { memo } from "react";

import { useTrackedLoadStatus } from "../trackedLoads";
import type { LoadStatus } from "../../types";

/**
 * Flat, saturated, no shadow. Badges are the thing an operator scans a moving
 * table for, and a neumorphic badge would be a soft grey lozenge among other
 * soft grey lozenges.
 */
const STATUS_STYLE: Record<LoadStatus, { label: string; className: string }> = {
  posted: { label: "posted", className: "bg-ink/8 text-ink/70" },
  bidding: { label: "bidding", className: "bg-warn/18 text-warn" },
  assigned: { label: "assigned", className: "bg-accent/12 text-accent" },
  in_transit: { label: "in transit", className: "bg-accent/15 text-accent" },
  delivered: { label: "delivered", className: "bg-ok/12 text-ok" },
  settled: { label: "settled", className: "bg-ok/18 text-ok" },
};

/**
 * The status cell, subscribed to exactly one thing: this load's status.
 *
 * This component exists as its own memo'd unit for one reason. Its subscription
 * returns a value that is stable while a load is merely moving -- a string --
 * so a cell only re-renders at the moment its load actually changes state. The
 * progress and timestamp cells beside it re-render every tick; this one does
 * not, and neither does any other load's status cell.
 *
 * memo() is what keeps the parent row from dragging it along: the row does
 * re-render every tick (its progress and timestamp genuinely changed), but the
 * only prop it passes down is a loadId that has not.
 */
export const StatusCell = memo(function StatusCell({ loadId }: { loadId: string }) {
  const status = useTrackedLoadStatus(loadId);

  if (!status) return <span />;

  const style = STATUS_STYLE[status];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        // status-transition is deliberate motion: a colour change here is
        // information, and fading it makes the change noticeable in a table
        // where the numbers beside it are already moving.
        className={`status-transition rounded-lg px-2 py-0.5 text-xs font-semibold ${style.className}`}
      >
        {style.label}
      </span>
    </span>
  );
});
