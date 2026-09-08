import { EventEmitter } from "node:events";

import { assertTransition, isStatus, LOAD_STATUSES } from "./lifecycle.js";
import { badRequest, conflict, notFound } from "./errors.js";
import { deliveryDueDate } from "./transit.js";

/**
 * In-memory store. Everything lives here so the REST and WebSocket layers stay
 * thin: they parse input, call a store function, and forward the result. All
 * state-machine enforcement happens in this file, which means a bad transition
 * is impossible regardless of which transport asked for it.
 *
 * Mutations announce themselves on `events`; the realtime layer subscribes and
 * fans them out to sockets. Keeping that one-way avoids a store <-> socket
 * import cycle and lets REST writes push updates without knowing sockets exist.
 */
export const events = new EventEmitter();

/** loadId -> load */
const loads = new Map();
/** loadId -> Bid[] (insertion order; callers get a sorted copy) */
const bidsByLoad = new Map();
/** loadId -> Invoice. One invoice per load; delivery generates it. */
const invoices = new Map();

let loadSeq = 1000;
let bidSeq = 5000;
let invoiceSeq = 9000;

// ---------------------------------------------------------------- validation

function requireText(value, field, { max = 120 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest("invalid_field", `"${field}" is required and must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw badRequest("invalid_field", `"${field}" must be ${max} characters or fewer.`);
  }
  return trimmed;
}

function requirePositiveNumber(value, field) {
  const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || num <= 0) {
    throw badRequest("invalid_field", `"${field}" is required and must be a positive number.`);
  }
  return num;
}

function requireDate(value, field) {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw badRequest("invalid_field", `"${field}" is required and must be an ISO date string.`);
  }
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (Number.isNaN(ms)) {
    throw badRequest("invalid_field", `"${field}" is not a valid date.`);
  }
  return new Date(ms).toISOString();
}

/**
 * Transporters have no accounts in this demo, so identity is derived from the
 * name. Same name -> same id, which is what lets a transporter revise their own
 * bid instead of stacking duplicates on the board.
 */
function transporterIdFor(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `tr_${slug || "unknown"}`;
}

/**
 * Stamps a lifecycle transition onto the load.
 *
 * The history is kept on the server rather than accumulated by clients from
 * the events they happen to witness: a client that connects halfway through a
 * load's life has seen none of those events, and a load detail view should not
 * show a blank past just because the browser was opened late.
 */
function record(load, status) {
  load.history.push({ status, at: new Date().toISOString() });
  return load.history.at(-1).at;
}

// --------------------------------------------------------------------- reads

export const listLoads = () => [...loads.values()];

export function getLoad(loadId) {
  const load = loads.get(loadId);
  if (!load) throw notFound("load_not_found", `No load with id "${loadId}".`);
  return load;
}

/** Lowest rate first; ties broken by who bid earlier. */
export function getBids(loadId) {
  const bids = bidsByLoad.get(loadId) ?? [];
  return [...bids].sort(
    (a, b) => a.rate - b.rate || Date.parse(a.submittedAt) - Date.parse(b.submittedAt),
  );
}

// -------------------------------------------------------------------- writes

export function createLoad(input = {}) {
  const origin = requireText(input.origin, "origin");
  const destination = requireText(input.destination, "destination");
  const pickupDate = requireDate(input.pickupDate, "pickupDate");

  const load = {
    id: `ld_${++loadSeq}`,
    origin,
    destination,
    weight: requirePositiveNumber(input.weight, "weight"),
    pickupDate,
    /** What on-time performance is measured against. See transit.js. */
    deliveryDueDate: deliveryDueDate(pickupDate, origin, destination),
    status: "posted",
    assignedTransporterId: null,
    // Denormalised alongside the id purely so downstream views can show a
    // readable transporter without re-deriving it from the winning bid.
    assignedTransporterName: null,
    contractedRate: null,
    // Tracking state. Null until the load starts moving; see simulation.js.
    position: null,
    progress: 0,
    /**
     * The road path this load drives, once routing has resolved. Carries the
     * *simplified* geometry — the full one stays server-side driving movement.
     */
    route: null,
    /** Every status this load has held, in order, with when it took it. */
    history: [],
    createdAt: new Date().toISOString(),
  };

  loads.set(load.id, load);
  bidsByLoad.set(load.id, []);
  record(load, "posted");

  // A posted load is open for bids the moment it exists, but it still walks the
  // transition rather than being born in "bidding".
  assertTransition(load.status, "bidding");
  load.status = "bidding";
  record(load, "bidding");

  events.emit("load_created", { load });
  return load;
}

/**
 * Generic status advance for the lifecycle steps after assignment. "assigned"
 * is deliberately excluded: it carries a contracted rate and a winning
 * transporter, so it can only be reached through `acceptBid`.
 */
export function setStatus(loadId, nextStatus) {
  if (!isStatus(nextStatus)) {
    throw badRequest(
      "invalid_field",
      `"status" must be one of: ${LOAD_STATUSES.join(", ")}.`,
    );
  }
  if (nextStatus === "assigned") {
    throw conflict(
      "assignment_requires_bid",
      'A load becomes "assigned" only by accepting a bid, not by setting status directly.',
    );
  }

  const load = getLoad(loadId);
  const previousStatus = load.status;
  assertTransition(previousStatus, nextStatus);
  load.status = nextStatus;
  const at = record(load, nextStatus);

  events.emit("status_update", { loadId: load.id, status: load.status, previousStatus, at });
  return load;
}

export function submitBid(loadId, transporterName, rate) {
  const load = getLoad(loadId);
  if (load.status !== "bidding") {
    throw conflict(
      "load_not_accepting_bids",
      `Load "${load.id}" is "${load.status}" and is no longer accepting bids.`,
    );
  }

  const name = requireText(transporterName, "transporterName", { max: 80 });
  const amount = requirePositiveNumber(rate, "rate");
  const transporterId = transporterIdFor(name);

  const bid = {
    id: `bid_${++bidSeq}`,
    loadId: load.id,
    transporterId,
    transporterName: name,
    rate: amount,
    submittedAt: new Date().toISOString(),
  };

  // One live bid per transporter: a re-bid replaces the previous one so the
  // board reads as a running low, not a history of every keystroke.
  const existing = bidsByLoad.get(load.id) ?? [];
  const next = existing.filter((b) => b.transporterId !== transporterId);
  next.push(bid);
  bidsByLoad.set(load.id, next);

  const bids = getBids(load.id);
  events.emit("bid_update", { loadId: load.id, bids });
  return { load, bid, bids };
}

export function acceptBid(loadId, bidId) {
  const load = getLoad(loadId);
  if (load.status !== "bidding") {
    throw conflict(
      "load_not_in_bidding",
      `Load "${load.id}" is "${load.status}"; only a load in "bidding" can have a bid accepted.`,
    );
  }

  const bid = (bidsByLoad.get(load.id) ?? []).find((b) => b.id === bidId);
  if (!bid) {
    throw notFound("bid_not_found", `No bid "${bidId}" on load "${load.id}".`);
  }

  assertTransition(load.status, "assigned");
  // Commercial terms first, status last, so every listener that wakes on the
  // status change already sees a fully assigned load.
  load.contractedRate = bid.rate;
  load.assignedTransporterId = bid.transporterId;
  load.assignedTransporterName = bid.transporterName;
  load.assignedAt = new Date().toISOString();
  load.status = "assigned";
  const at = record(load, "assigned");

  events.emit("load_assigned", {
    loadId: load.id,
    contractedRate: load.contractedRate,
    transporterId: load.assignedTransporterId,
    transporterName: load.assignedTransporterName,
    bidId: bid.id,
    at,
  });
  return { load, bid };
}

// ------------------------------------------------------------------ invoices

export const listInvoices = () => [...invoices.values()];

export const getInvoice = (loadId) => invoices.get(loadId) ?? null;

/**
 * Raises the invoice for a delivered load.
 *
 * `invoicedRate` is what the transporter billed; `contractedRate` is what was
 * agreed at award. Storing both is the entire point of the settlement module —
 * a single "amount" field would make the discrepancy unrepresentable.
 *
 * Idempotent: a load has exactly one invoice, so a repeat delivery event (a
 * reconnect replaying, say) returns the existing one rather than raising a
 * second bill.
 */
export function createInvoice(loadId, invoicedRate) {
  const existing = invoices.get(loadId);
  if (existing) return existing;

  const load = getLoad(loadId);
  if (load.contractedRate === null) {
    throw conflict(
      "load_never_contracted",
      `Load "${loadId}" has no contracted rate, so it cannot be invoiced.`,
    );
  }

  const invoice = {
    id: `inv_${++invoiceSeq}`,
    loadId,
    invoicedRate: requirePositiveNumber(invoicedRate, "invoicedRate"),
    contractedRate: load.contractedRate,
    generatedAt: new Date().toISOString(),
    // Not in the original spec, but an invoice awaiting a human decision needs
    // somewhere to record that decision. "approved" is implied by the load
    // reaching "settled"; "flagged" is the state that has no other home.
    reviewState: "pending",
  };

  invoices.set(loadId, invoice);
  events.emit("invoice_generated", { invoice });
  return invoice;
}

const REVIEW_STATES = ["pending", "flagged", "approved"];

export function setInvoiceReview(loadId, reviewState) {
  if (!REVIEW_STATES.includes(reviewState)) {
    throw badRequest(
      "invalid_field",
      `"reviewState" must be one of: ${REVIEW_STATES.join(", ")}.`,
    );
  }

  const invoice = invoices.get(loadId);
  if (!invoice) throw notFound("invoice_not_found", `No invoice for load "${loadId}".`);

  invoice.reviewState = reviewState;
  events.emit("invoice_updated", { invoice });
  return invoice;
}

/**
 * Records the path a load is driving, so the map can draw the road rather than
 * just the moving dot. `source` says whether this is a real OSRM route or the
 * straight-line fallback, which the UI shows rather than hides.
 */
export function setRoute(loadId, route) {
  const load = loads.get(loadId);
  if (!load) return null;

  load.route = route;
  events.emit("route_ready", { loadId, route });
  return load;
}

/**
 * Applies a batch of position updates and announces them as one event.
 *
 * Batched on purpose: positions move for every in-transit load on the same
 * tick, and emitting per load would put N frames on the wire where one will do.
 */
export function applyPositions(updates) {
  const applied = [];

  for (const { loadId, lat, lng, progress } of updates) {
    const load = loads.get(loadId);
    if (!load) continue;

    load.position = { lat, lng };
    load.progress = progress;
    applied.push({ loadId, lat, lng, progress });
  }

  if (applied.length > 0) events.emit("position_update", { positions: applied });
  return applied;
}

/**
 * SEED-ONLY. Rewrites a load's history timestamps.
 *
 * Seeded loads reach their lifecycle state by really walking the state machine,
 * which means every stage gets stamped within the same millisecond at boot. That
 * is fine for correctness and useless for analytics: on-time performance and
 * spend-over-time both measure durations, and every seeded duration would be
 * zero.
 *
 * So the seed drives the real transitions and then backdates the stamps to a
 * plausible history. Nothing outside seed.js may call this — a live load's
 * history is a record of what actually happened.
 */
export function backdateHistory(loadId, stamps) {
  const load = getLoad(loadId);

  for (const entry of load.history) {
    const at = stamps[entry.status];
    if (at) entry.at = new Date(at).toISOString();
  }
  load.history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const assigned = stamps.assigned;
  if (assigned) load.assignedAt = new Date(assigned).toISOString();
  return load;
}

/** Test/dev helper — drops everything so seeding can start from a clean slate. */
export function reset() {
  loads.clear();
  bidsByLoad.clear();
  invoices.clear();
  loadSeq = 1000;
  bidSeq = 5000;
  invoiceSeq = 9000;
}
