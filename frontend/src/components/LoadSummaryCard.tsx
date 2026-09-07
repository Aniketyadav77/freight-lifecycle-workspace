import { Link } from "react-router-dom";

import { StatusBadge } from "./StatusBadge";
import { formatDate, formatPickupWindow, formatRate, formatWeight } from "../lib/format";
import { useLowestBid } from "../store/useFreightStore";
import type { Load } from "../types";

/**
 * One row on a board. Reads its own lowest bid from the store rather than
 * taking it as a prop, so a bid landing on one lane re-renders only that row.
 *
 * The whole card links to the load's detail route: every list in this app is a
 * way into the same load record, which is what stops the modules feeling like
 * separate apps.
 */
export function LoadSummaryCard({ load }: { load: Load }) {
  const lowest = useLowestBid(load.id);

  return (
    <Link
      to={`/loads/${load.id}`}
      className="neu-raised neu-toggle block rounded-xl p-4 hover:shadow-[3px_3px_7px_var(--neu-dark),-3px_-3px_7px_var(--neu-light)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {load.origin} <span className="text-ink/35">→</span> {load.destination}
          </p>
          <p className="mt-1 text-sm text-ink/55">
            {formatWeight(load.weight)} · pickup {formatDate(load.pickupDate)}{" "}
            <span className="text-ink/40">({formatPickupWindow(load.pickupDate)})</span>
          </p>
        </div>
        <StatusBadge status={load.status} />
      </div>

      {/* The live figure sits on flat white: a number that changes under the
          reader needs contrast, not soft edges. */}
      <div className="mt-3 flex items-baseline justify-between rounded-lg bg-card px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-ink/45">Lowest bid</span>
        {lowest ? (
          <span className="text-right">
            <span
              data-num
              className={`text-lg font-semibold ${
                lowest.sync === "pending" ? "text-warn" : "text-ink"
              }`}
            >
              {formatRate(lowest.rate)}
            </span>
            <span className="ml-2 text-xs text-ink/50">
              {lowest.sync === "pending" ? "sending…" : lowest.transporterName}
            </span>
          </span>
        ) : (
          <span className="text-sm text-ink/40">No bids yet</span>
        )}
      </div>
    </Link>
  );
}
