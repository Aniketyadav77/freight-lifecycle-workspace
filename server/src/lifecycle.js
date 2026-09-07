import { conflict } from "./errors.js";

/** The only statuses a load may ever hold. */
export const LOAD_STATUSES = [
  "posted",
  "bidding",
  "assigned",
  "in_transit",
  "delivered",
  "settled",
];

/**
 * The lifecycle is strictly linear — no skipping, no going back. Every status
 * mutation in the app funnels through `assertTransition`, so an invalid state
 * is unreachable rather than merely discouraged.
 */
const TRANSITIONS = {
  posted: ["bidding"],
  bidding: ["assigned"],
  assigned: ["in_transit"],
  in_transit: ["delivered"],
  delivered: ["settled"],
  settled: [],
};

export const isStatus = (value) => LOAD_STATUSES.includes(value);

export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

export function assertTransition(from, to) {
  if (canTransition(from, to)) return;

  const allowed = TRANSITIONS[from] ?? [];
  throw conflict(
    "invalid_transition",
    allowed.length
      ? `Cannot move a load from "${from}" to "${to}" (only "${allowed.join('", "')}" is reachable from "${from}").`
      : `A load in "${from}" is terminal and cannot change status.`,
  );
}
