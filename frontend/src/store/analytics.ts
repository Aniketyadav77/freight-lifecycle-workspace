import { useMemo } from "react";

import { useFreightStore, type FreightState } from "./useFreightStore";
import type { Invoice, Load } from "../types";

/**
 * Analytics over the settled book.
 *
 * ---------------------------------------------------------------------------
 * Shape of this module, and why
 * ---------------------------------------------------------------------------
 * Two layers, deliberately separated:
 *
 *  1. **Pure functions** (`computeLaneCosts`, `computeOnTime`,
 *     `computeRateVariance`) that take loads and invoices and return figures.
 *     They know nothing about React or the store, so a future role-scoped view
 *     — a Regional Manager who only sees their own lanes, the way the Control
 *     Tower project scoped KPIs by zone — reuses them by passing a filtered
 *     collection instead of the whole book. That is the entire reason they take
 *     an iterable rather than reading the store themselves.
 *
 *  2. **Hooks** that feed the store's settled loads into those functions.
 *
 * Nothing here is stored. These figures are recomputed from the loads and
 * invoices the store already holds, which is the same argument the Control
 * Tower's KPI selector makes: running counters in the store are how a dashboard
 * ends up claiming 101% on-time, because two sources of truth drift and the bug
 * only shows after a reconnect. A fold over a few hundred records costs
 * microseconds and cannot disagree with the book it is folded from.
 *
 * ---------------------------------------------------------------------------
 * Why these hooks memoize on a signature instead of using useShallow
 * ---------------------------------------------------------------------------
 * These aggregations return arrays of objects. A selector building fresh
 * objects fails Object.is on every store update, and `useShallow` compares
 * elements by reference — so it would also fail, every time. The analytics view
 * would then re-render on every position tick from the tracking module.
 *
 * So the hooks select a cheap *string* signature of the settled book (ids, and
 * the invoice figures that feed the numbers). A string compares stably, and the
 * real work runs in a useMemo keyed on it. Settled is a terminal state, so in
 * practice the signature only changes when a load newly settles.
 */

// ---------------------------------------------------------------- pure layer

export interface LaneCost {
  lane: string;
  origin: string;
  destination: string;
  shipments: number;
  totalSpend: number;
  avgCost: number;
  /** Average cost per tonne, so lanes of different weights are comparable. */
  avgCostPerTonne: number;
}

/** Spend per origin-destination pair, dearest lane first. */
export function computeLaneCosts(
  loads: Iterable<Load>,
  invoices: ReadonlyMap<string, Invoice>,
): LaneCost[] {
  const byLane = new Map<string, LaneCost & { totalTonnes: number }>();

  for (const load of loads) {
    const invoice = invoices.get(load.id);
    // Settled loads are invoiced by definition, but fall back to the contract
    // rather than dropping a shipment out of the totals.
    const cost = invoice?.invoicedRate ?? load.contractedRate;
    if (cost === null) continue;

    const lane = `${load.origin} → ${load.destination}`;
    const entry = byLane.get(lane) ?? {
      lane,
      origin: load.origin,
      destination: load.destination,
      shipments: 0,
      totalSpend: 0,
      avgCost: 0,
      avgCostPerTonne: 0,
      totalTonnes: 0,
    };

    entry.shipments += 1;
    entry.totalSpend += cost;
    entry.totalTonnes += load.weight / 1000;
    byLane.set(lane, entry);
  }

  return [...byLane.values()]
    .map(({ totalTonnes, ...entry }) => ({
      ...entry,
      avgCost: Math.round(entry.totalSpend / entry.shipments),
      avgCostPerTonne: totalTonnes === 0 ? 0 : Math.round(entry.totalSpend / totalTonnes),
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend);
}

export interface OnTimeStats {
  delivered: number;
  onTime: number;
  late: number;
  onTimePct: number;
  /** Mean days late across the late ones only. 0 when nothing ran late. */
  avgDaysLate: number;
  byLane: { lane: string; shipments: number; onTime: number; onTimePct: number }[];
}

const DAY_MS = 86_400_000;

const deliveredAt = (load: Load) =>
  load.history.find((entry) => entry.status === "delivered")?.at ?? null;

/**
 * On-time performance: delivered on or before the lane's due date.
 *
 * `deliveryDueDate` is the yardstick. Comparing delivery to *pickup* — the
 * obvious thing to reach for, since both are on the load — measures nothing: a
 * load is always delivered after it is picked up.
 */
export function computeOnTime(loads: Iterable<Load>): OnTimeStats {
  const lanes = new Map<string, { lane: string; shipments: number; onTime: number }>();

  let delivered = 0;
  let onTime = 0;
  let lateDaysTotal = 0;
  let lateCount = 0;

  for (const load of loads) {
    const at = deliveredAt(load);
    if (!at) continue;

    delivered += 1;
    const daysLate = (Date.parse(at) - Date.parse(load.deliveryDueDate)) / DAY_MS;
    const wasOnTime = daysLate <= 0;

    if (wasOnTime) {
      onTime += 1;
    } else {
      lateCount += 1;
      lateDaysTotal += daysLate;
    }

    const lane = `${load.origin} → ${load.destination}`;
    const entry = lanes.get(lane) ?? { lane, shipments: 0, onTime: 0 };
    entry.shipments += 1;
    if (wasOnTime) entry.onTime += 1;
    lanes.set(lane, entry);
  }

  return {
    delivered,
    onTime,
    late: delivered - onTime,
    onTimePct: delivered === 0 ? 0 : Math.round((onTime / delivered) * 1000) / 10,
    avgDaysLate: lateCount === 0 ? 0 : Math.round((lateDaysTotal / lateCount) * 10) / 10,
    byLane: [...lanes.values()]
      .map((entry) => ({
        ...entry,
        onTimePct: Math.round((entry.onTime / entry.shipments) * 1000) / 10,
      }))
      .sort((a, b) => a.onTimePct - b.onTimePct),
  };
}

export interface VariancePoint {
  loadId: string;
  lane: string;
  /** Settlement date, as an ISO day. */
  date: string;
  label: string;
  contractedRate: number;
  invoicedRate: number;
  /** Invoiced minus contracted for this load. Positive = billed over contract. */
  variance: number;
  /** Mean variance across every load settled up to and including this one. */
  runningAvgVariance: number;
}

/**
 * Bid-vs-actual variance over time.
 *
 * The per-load variance is noisy by nature, so the series that matters is the
 * running average: it answers "are we drifting away from our contracted rates?"
 * rather than "was this one invoice odd?".
 */
export function computeRateVariance(
  loads: Iterable<Load>,
  invoices: ReadonlyMap<string, Invoice>,
): VariancePoint[] {
  const points: Omit<VariancePoint, "runningAvgVariance">[] = [];

  for (const load of loads) {
    const invoice = invoices.get(load.id);
    if (!invoice) continue;

    const settledAt =
      load.history.find((entry) => entry.status === "settled")?.at ??
      load.history.at(-1)?.at ??
      invoice.generatedAt;

    points.push({
      loadId: load.id,
      lane: `${load.origin} → ${load.destination}`,
      date: settledAt,
      label: new Date(settledAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      contractedRate: invoice.contractedRate,
      invoicedRate: invoice.invoicedRate,
      variance: invoice.invoicedRate - invoice.contractedRate,
    });
  }

  points.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  let total = 0;
  return points.map((point, index) => {
    total += point.variance;
    return { ...point, runningAvgVariance: Math.round(total / (index + 1)) };
  });
}

// --------------------------------------------------------------- hook layer

export const selectSettledLoads = (state: FreightState): Load[] =>
  [...state.loads.values()].filter((load) => load.status === "settled");

/**
 * A cheap string standing in for "the settled book as it currently is". Changes
 * only when a load settles or its invoice figures change — never on a position
 * tick — so the memo below holds across the app's noisiest updates.
 */
function settledSignature(state: FreightState): string {
  const parts: string[] = [];
  for (const load of state.loads.values()) {
    if (load.status !== "settled") continue;
    const invoice = state.invoices.get(load.id);
    parts.push(`${load.id}:${invoice?.invoicedRate ?? ""}:${invoice?.contractedRate ?? ""}`);
  }
  return parts.sort().join("|");
}

export interface FreightAnalytics {
  settledCount: number;
  totalSpend: number;
  laneCosts: LaneCost[];
  onTime: OnTimeStats;
  variance: VariancePoint[];
  /** Mean variance across the whole settled book. */
  avgVariance: number;
}

export function useFreightAnalytics(): FreightAnalytics {
  const signature = useFreightStore(settledSignature);

  return useMemo(() => {
    const state = useFreightStore.getState();
    const settled = selectSettledLoads(state);

    const laneCosts = computeLaneCosts(settled, state.invoices);
    const variance = computeRateVariance(settled, state.invoices);

    return {
      settledCount: settled.length,
      totalSpend: laneCosts.reduce((sum, lane) => sum + lane.totalSpend, 0),
      laneCosts,
      onTime: computeOnTime(settled),
      variance,
      avgVariance: variance.length === 0 ? 0 : (variance.at(-1)?.runningAvgVariance ?? 0),
    };
    // `signature` is the real dependency; the store is read imperatively so the
    // heavy work does not run on every unrelated store update.
  }, [signature]);
}
