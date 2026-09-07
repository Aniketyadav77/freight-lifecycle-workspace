import { useState, type FormEvent } from "react";

import { useFreightStore } from "../../store/useFreightStore";

/**
 * Local state here is only the uncommitted draft — the moment it is submitted
 * it becomes a bid in the store. No bid ever lives in component state.
 */
export function BidForm({ loadId }: { loadId: string }) {
  const submitBid = useFreightStore((state) => state.submitBid);
  const [transporterName, setTransporterName] = useState("");
  const [rate, setRate] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = transporterName.trim();
    const amount = Number(rate);

    if (!name) return setInvalid("Enter a transporter name.");
    if (!Number.isFinite(amount) || amount <= 0) return setInvalid("Enter a rate above zero.");

    setInvalid(null);
    submitBid(loadId, name, amount);
    setRate("");
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="text-sm font-semibold text-ink">Submit a bid</p>

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="min-w-0 flex-1 basis-40">
          <span className="text-xs text-ink/55">Transporter</span>
          <input
            value={transporterName}
            onChange={(event) => setTransporterName(event.target.value)}
            placeholder="Sharma Roadlines"
            // Inputs are inset: a field you type into is pressed into the
            // surface rather than raised off it.
            className="neu-inset mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/35"
          />
        </label>

        <label className="min-w-0 flex-1 basis-32">
          <span className="text-xs text-ink/55">Rate (₹)</span>
          <input
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            inputMode="numeric"
            data-num
            placeholder="82000"
            className="neu-inset mt-1 w-full rounded-lg px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/35"
          />
        </label>

        <button
          type="submit"
          className="neu-raised-sm neu-toggle mt-auto rounded-lg px-4 py-2 text-sm font-medium text-accent"
        >
          Place bid
        </button>
      </div>

      {invalid && <p className="mt-2 text-xs text-bad">{invalid}</p>}

      <p className="mt-2 text-xs text-ink/45">
        Re-bidding under the same transporter name replaces that transporter&rsquo;s
        previous bid.
      </p>
    </form>
  );
}
