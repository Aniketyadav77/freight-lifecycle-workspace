import { formatDateTime, formatRate } from "../../lib/format";
import type { Bid, Invoice, Load, LoadStatus } from "../../types";
import { hasMismatch, rateGap } from "../../types";

const LIFECYCLE: LoadStatus[] = [
  "posted",
  "bidding",
  "assigned",
  "in_transit",
  "delivered",
  "settled",
];

const LABELS: Record<LoadStatus, string> = {
  posted: "Posted",
  bidding: "Open for bidding",
  assigned: "Assigned",
  in_transit: "In transit",
  delivered: "Delivered",
  settled: "Settled",
};

/**
 * The load's whole life, in order.
 *
 * Every stage is drawn, including ones the load has not reached — the point of
 * this view is that a load has a *shape* it moves through, so showing only what
 * has happened would hide the half that has not. Reached stages carry the
 * server's timestamp; the rest are dimmed.
 *
 * Detail lines are assembled from whatever the shared store already holds — the
 * bid list, the invoice, the live position. Nothing here fetches.
 */
export function LifecycleTimeline({
  load,
  bids,
  invoice,
}: {
  load: Load;
  bids: Bid[];
  invoice: Invoice | undefined;
}) {
  const reachedIndex = LIFECYCLE.indexOf(load.status);
  const byStatus = new Map(load.history.map((entry) => [entry.status, entry.at]));

  return (
    <ol className="relative">
      {LIFECYCLE.map((status, index) => {
        const at = byStatus.get(status);
        const isCurrent = index === reachedIndex;
        const isReached = index <= reachedIndex;
        const isLast = index === LIFECYCLE.length - 1;

        return (
          <li key={status} className="relative flex gap-4 pb-6 last:pb-0">
            {/* Connector, drawn behind the dot and stopping at the last stage. */}
            {!isLast && (
              <span
                aria-hidden
                className={`absolute top-5 left-[7px] h-full w-px ${
                  index < reachedIndex ? "bg-accent/40" : "bg-ink/15"
                }`}
              />
            )}

            <span
              aria-hidden
              className={`relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 ${
                isCurrent
                  ? "border-accent bg-accent ring-4 ring-accent/15"
                  : isReached
                    ? "border-accent/70 bg-accent/70"
                    : "border-ink/20 bg-card"
              }`}
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <p
                  className={`font-medium ${
                    isReached ? "text-ink" : "text-ink/40"
                  }`}
                >
                  {LABELS[status]}
                </p>
                {isCurrent && (
                  <span className="rounded-full bg-accent/12 px-2 py-0.5 text-xs font-semibold text-accent">
                    Current
                  </span>
                )}
                {at && (
                  <time className="text-xs tabular-nums text-ink/40">
                    {formatDateTime(at)}
                  </time>
                )}
              </div>

              <p
                className={`mt-1 text-sm ${isReached ? "text-ink/65" : "text-ink/40"}`}
              >
                {detailFor(status, { load, bids, invoice, isReached })}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function detailFor(
  status: LoadStatus,
  {
    load,
    bids,
    invoice,
    isReached,
  }: { load: Load; bids: Bid[]; invoice: Invoice | undefined; isReached: boolean },
): string {
  if (!isReached) return UPCOMING[status];

  switch (status) {
    case "posted":
      return `${load.origin} → ${load.destination}, ${load.weight.toLocaleString("en-IN")} kg.`;

    case "bidding": {
      const confirmed = bids.filter((bid) => bid.sync === "confirmed");
      if (confirmed.length === 0) {
        return load.status === "bidding"
          ? "No bids yet."
          : "Bids were taken on the procurement board.";
      }
      const lowest = confirmed[0]!;
      return `${confirmed.length} bid${confirmed.length === 1 ? "" : "s"} received · lowest ${formatRate(lowest.rate)} from ${lowest.transporterName}.`;
    }

    case "assigned":
      return load.assignedTransporterName && load.contractedRate !== null
        ? `Awarded to ${load.assignedTransporterName} at ${formatRate(load.contractedRate)}.`
        : "Awarded.";

    case "in_transit": {
      const pct = Math.round(load.progress * 100);
      return load.status === "in_transit"
        ? `Under way — ${pct}% of the lane covered.`
        : "Departed and completed the run.";
    }

    case "delivered":
      if (!invoice) return "Delivered; invoice pending.";
      return hasMismatch(invoice)
        ? `Invoice ${invoice.id} raised at ${formatRate(invoice.invoicedRate)} — ${
            rateGap(invoice) > 0 ? "over" : "under"
          } contract by ${formatRate(Math.abs(rateGap(invoice)))}.`
        : `Invoice ${invoice.id} raised at ${formatRate(invoice.invoicedRate)}, matching contract.`;

    case "settled":
      return invoice
        ? `Invoice approved and closed at ${formatRate(invoice.invoicedRate)}.`
        : "Closed.";
  }
}

/** What each stage is waiting on, shown before the load gets there. */
const UPCOMING: Record<LoadStatus, string> = {
  posted: "Not yet posted.",
  bidding: "Not yet open for bids.",
  assigned: "Awaiting a bid to be accepted.",
  in_transit: "Awaiting departure.",
  delivered: "Awaiting proof of delivery.",
  settled: "Awaiting invoice approval.",
};
