import type { LoadStatus } from "../types";

/**
 * Shared across all six views — one visual vocabulary for load status.
 *
 * Flat and saturated, never neumorphic. Status is the thing a reader scans for,
 * and a soft-edged badge would be a grey lozenge among other grey lozenges.
 */
const STYLES: Record<LoadStatus, string> = {
  posted: "bg-ink/8 text-ink/70",
  bidding: "bg-warn/20 text-[#8a5a00]",
  assigned: "bg-accent/12 text-accent",
  in_transit: "bg-accent/18 text-accent",
  delivered: "bg-ok/14 text-[#0f7a4d]",
  settled: "bg-ink/85 text-white",
};

const LABELS: Record<LoadStatus, string> = {
  posted: "Posted",
  bidding: "Bidding",
  assigned: "Assigned",
  in_transit: "In transit",
  delivered: "Delivered",
  settled: "Settled",
};

export function StatusBadge({ status }: { status: LoadStatus }) {
  return (
    <span
      className={`status-transition inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-semibold ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
