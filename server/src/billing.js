import * as store from "./store.js";

/**
 * Invoice generation.
 *
 * Raising an invoice on delivery is real domain behaviour, not a simulation —
 * a TMS does exactly this. What *is* mocked here is where the number comes
 * from: a real system receives the transporter's actual bill (with detention
 * charges, fuel surcharge, weight re-measurement, tolls) and reconciles it
 * against the contract. We have no transporter to bill us, so the invoiced
 * amount is derived instead.
 *
 * ---------------------------------------------------------------------------
 * Why the variance is deterministic rather than Math.random()
 * ---------------------------------------------------------------------------
 * The brief asked for invoices that "sometimes" differ, randomly. Done with
 * Math.random(), roughly one boot in ten would seed a demo where every invoice
 * happens to match and the whole mismatch feature looks like dead UI.
 *
 * So the variance is a pure function of the load id instead. From the outside
 * it behaves identically — some invoices differ, by amounts you cannot predict
 * from looking at a lane — but the same load always produces the same invoice,
 * which makes the seeded demo stable and the behaviour testable. Swap
 * `variance()` for Math.random() if genuine per-boot randomness matters more.
 */

/** Share of invoices that come in at something other than the agreed rate. */
const MISMATCH_RATE = 0.45;

/**
 * How far off a mismatched invoice runs. Skewed positive because real billing
 * disputes are mostly the transporter charging *more* — detention and
 * surcharges add, they rarely subtract.
 */
const VARIANCE_RANGE = { min: -0.06, max: 0.14 };

/** Invoices are raised in whole hundreds of rupees, like real freight bills. */
const ROUNDING = 100;

/** Stable 0-1 value from a string. Same id, same result, every boot. */
function hashUnit(text, salt = "") {
  let h = 2166136261;
  const input = `${text}${salt}`;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * What the transporter billed for this load. Most of the time it matches the
 * contract exactly; sometimes it does not, and catching that is the point of
 * the settlement module.
 */
export function invoicedRateFor(load) {
  const contracted = load.contractedRate;

  if (hashUnit(load.id, ":mismatch") > MISMATCH_RATE) return contracted;

  const spread = VARIANCE_RANGE.max - VARIANCE_RANGE.min;
  const delta = VARIANCE_RANGE.min + hashUnit(load.id, ":delta") * spread;
  const invoiced = Math.round((contracted * (1 + delta)) / ROUNDING) * ROUNDING;

  // A rounded delta can land back on the contracted rate; nudge it off so a
  // "mismatch" is always visibly a mismatch.
  return invoiced === contracted ? invoiced + ROUNDING : invoiced;
}

/**
 * Attach *before* seeding: the seed delivers and settles loads to reach those
 * lifecycle states, and those loads need invoices like any other. This differs
 * from the driver simulation, which attaches after seeding precisely so it does
 * *not* act on historical transitions.
 */
export function attachBilling() {
  store.events.on("status_update", ({ loadId, status }) => {
    if (status !== "delivered") return;

    const load = store.listLoads().find((candidate) => candidate.id === loadId);
    if (!load) return;

    try {
      const invoice = store.createInvoice(loadId, invoicedRateFor(load));
      const gap = invoice.invoicedRate - invoice.contractedRate;
      console.log(
        `[billing] invoice ${invoice.id} for ${loadId}: ₹${invoice.invoicedRate}` +
          (gap === 0 ? " (matches contract)" : ` (₹${gap > 0 ? "+" : ""}${gap} vs contract)`),
      );
    } catch (err) {
      console.warn(`[billing] could not invoice ${loadId}: ${err.message}`);
    }
  });
}
