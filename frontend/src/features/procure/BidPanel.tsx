import { BidForm } from "./BidForm";
import { formatDateTime, formatRate } from "../../lib/format";
import { useBidsForLoad, useFreightStore } from "../../store/useFreightStore";
import type { Bid, Load } from "../../types";

/**
 * The bid board for one load. Lives on the load detail route rather than in a
 * side panel, so acting on a load and reading its history are the same place.
 * Renders no header — the detail page already says which load this is.
 */
export function BidPanel({ load }: { load: Load }) {
  const bids = useBidsForLoad(load.id);
  const acceptBid = useFreightStore((state) => state.acceptBid);
  const acceptingBidIds = useFreightStore((state) => state.acceptingBidIds);
  const bidError = useFreightStore((state) => state.bidErrors[load.id]);
  const dismissBidError = useFreightStore((state) => state.dismissBidError);

  return (
    <aside className="neu-raised overflow-hidden rounded-xl">
      {bidError && (
        <div className="flex items-start justify-between gap-3 bg-bad/10 px-5 py-3">
          <p className="text-sm text-bad">
            <span className="font-semibold">Bid rejected.</span> {bidError}
          </p>
          <button
            type="button"
            onClick={() => dismissBidError(load.id)}
            className="shrink-0 text-bad/60 transition hover:text-bad"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink">
            Bids <span className="text-ink/40">({bids.length})</span>
          </h3>
          <span className="text-xs text-ink/45">Lowest first</span>
        </div>

        {bids.length === 0 ? (
          <p className="neu-inset rounded-lg px-4 py-8 text-center text-sm text-ink/55">
            No bids on this load yet. Enter a transporter and a rate below to place the
            first one — it appears here immediately.
          </p>
        ) : (
          <ul className="space-y-2">
            {bids.map((bid, index) => (
              <BidRow
                key={bid.clientRef ?? bid.id}
                bid={bid}
                isLowest={index === 0}
                accepting={acceptingBidIds.includes(bid.id)}
                onAccept={() => acceptBid(load.id, bid.id)}
              />
            ))}
          </ul>
        )}

        <div className="mt-4">
          <BidForm loadId={load.id} />
        </div>
      </div>
    </aside>
  );
}

interface BidRowProps {
  bid: Bid;
  isLowest: boolean;
  accepting: boolean;
  onAccept: () => void;
}

function BidRow({ bid, isLowest, accepting, onAccept }: BidRowProps) {
  const pending = bid.sync === "pending";

  return (
    // Flat white rows: these are the numbers being compared, so they get
    // contrast rather than material.
    <li
      className={`flex items-center gap-3 rounded-lg p-3 ${
        pending ? "bg-warn/10 ring-1 ring-warn/30 ring-inset" : "bg-card"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink">{bid.transporterName}</p>
          {pending && (
            <span className="shrink-0 rounded-lg bg-warn/20 px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00]">
              Pending
            </span>
          )}
          {!pending && isLowest && (
            <span className="shrink-0 rounded-lg bg-ok/14 px-2 py-0.5 text-[11px] font-semibold text-[#0f7a4d]">
              Lowest
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink/50">
          {pending ? "Awaiting server confirmation" : formatDateTime(bid.submittedAt)}
        </p>
      </div>

      <span
        data-num
        className={`shrink-0 text-base font-semibold ${pending ? "text-warn" : "text-ink"}`}
      >
        {formatRate(bid.rate)}
      </span>

      <button
        type="button"
        onClick={onAccept}
        // A pending bid has no server id yet, so it cannot be accepted.
        disabled={pending || accepting}
        className="neu-raised-sm neu-toggle shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-ink/75 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {accepting ? "Accepting…" : "Accept bid"}
      </button>
    </li>
  );
}
