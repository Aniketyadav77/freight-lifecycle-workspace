import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { fetchInvoices, fetchLoads } from "../lib/api";
import { FreightSocket } from "../lib/socket";
import type {
  Bid,
  ConnectionStatus,
  Invoice,
  Load,
  LoadHistoryEntry,
  LoadStatus,
  ServerBid,
  ServerFrame,
} from "../types";
import { hasMismatch, rateGap } from "../types";

/**
 * The one store every module reads from. A load's status lives here exactly
 * once — Procure, Track and Settle all render off the same record, so there is
 * no per-module copy to drift.
 *
 * Socket frames are applied directly to this state. Components never hold bid
 * state of their own; they submit an action and re-render off the store.
 */

const WATCH_ALL = "*";

export interface FreightState {
  loads: Map<string, Load>;
  bids: Map<string, Bid[]>;
  /** Keyed by loadId — a load has at most one invoice. */
  invoices: Map<string, Invoice>;

  connection: ConnectionStatus;
  loading: boolean;
  loadError: string | null;

  /** The load whose detail route is open — i.e. whose bid stream we subscribe to. */
  selectedLoadId: string | null;
  /** Rejection reason for the last failed bid on a load, keyed by loadId. */
  bidErrors: Record<string, string>;
  /** Bid ids awaiting an accept confirmation from the server. */
  acceptingBidIds: string[];
  notice: string | null;

  init: () => Promise<void>;
  teardown: () => void;
  selectLoad: (loadId: string | null) => void;
  submitBid: (loadId: string, transporterName: string, rate: number) => void;
  acceptBid: (loadId: string, bidId: string) => void;
  markDelivered: (loadId: string) => void;
  resolveInvoice: (loadId: string, decision: "approve" | "flag") => void;
  dismissBidError: (loadId: string) => void;
  dismissNotice: () => void;
}

/** Lowest rate wins; equal rates break by who bid first — same rule as the server. */
const sortBids = (bids: Bid[]) =>
  [...bids].sort(
    (a, b) => a.rate - b.rate || Date.parse(a.submittedAt) - Date.parse(b.submittedAt),
  );

const toMap = (loads: Load[]) => new Map(loads.map((load) => [load.id, load]));

// Transport and subscription bookkeeping are module-scoped: they are machinery,
// not renderable state, so they have no business triggering re-renders.
let socket: FreightSocket | null = null;
const watched = new Set<string>();

export const useFreightStore = create<FreightState>((set, get) => {
  /** Subscribe to a load's bid stream; the server replies with a snapshot. */
  function watch(loadId: string) {
    if (watched.has(loadId)) return;
    watched.add(loadId);
    socket?.send({ type: "watch", loadId });
  }

  /** The lobby subscription plus a bid snapshot for every biddable load. */
  function subscribeAll() {
    watch(WATCH_ALL);
    for (const load of get().loads.values()) {
      if (load.status === "bidding") watch(load.id);
    }
  }

  /**
   * Extends a load's history with a transition that arrived live, using the
   * server's timestamp rather than this browser's clock. Idempotent on the
   * status, so a replayed frame after a reconnect cannot duplicate a stage.
   */
  function appendHistory(loadId: string, status: LoadStatus, at: string): LoadHistoryEntry[] {
    const history = get().loads.get(loadId)?.history ?? [];
    if (history.some((entry) => entry.status === status)) return history;
    return [...history, { status, at }];
  }

  function upsertInvoice(invoice: Invoice) {
    set((state) => {
      const invoices = new Map(state.invoices);
      invoices.set(invoice.loadId, invoice);
      return { invoices };
    });
  }

  function upsertLoad(loadId: string, patch: Partial<Load>) {
    set((state) => {
      const current = state.loads.get(loadId);
      if (!current) return state;
      const loads = new Map(state.loads);
      loads.set(loadId, { ...current, ...patch });
      return { loads };
    });
  }

  /**
   * Reconcile optimistic bids against the authoritative list. A pending bid is
   * dropped once the server echoes an equivalent one (same transporter, same
   * rate) — that echo *is* the confirmation. Anything still unmatched is a bid
   * the server hasn't processed yet, so it stays on screen as pending.
   */
  function applyBidUpdate(loadId: string, serverBids: ServerBid[]) {
    set((state) => {
      const confirmed: Bid[] = serverBids.map((bid) => ({ ...bid, sync: "confirmed" }));
      const stillPending = (state.bids.get(loadId) ?? []).filter(
        (bid) =>
          bid.sync === "pending" &&
          !confirmed.some(
            (s) => s.transporterName === bid.transporterName && s.rate === bid.rate,
          ),
      );

      const bids = new Map(state.bids);
      bids.set(loadId, sortBids([...confirmed, ...stillPending]));
      return { bids };
    });
  }

  /**
   * Applies a batch of positions.
   *
   * Only the loads that actually moved get new objects; every other entry in
   * the map keeps its identity. That is what lets a row subscribed to one load
   * ignore the other loads' movement, and what keeps the procurement board from
   * re-rendering on a tick that has nothing to do with bidding.
   */
  function applyPositions(positions: { loadId: string; lat: number; lng: number; progress: number }[]) {
    set((state) => {
      const loads = new Map(state.loads);
      const at = Date.now();
      let changed = false;

      for (const { loadId, lat, lng, progress } of positions) {
        const load = loads.get(loadId);
        if (!load) continue;
        loads.set(loadId, { ...load, position: { lat, lng }, progress, positionUpdatedAt: at });
        changed = true;
      }

      return changed ? { loads } : state;
    });
  }

  /** Roll back the optimistic bid the server refused, and say why. */
  function rejectBid(loadId: string, ref: string | undefined, message: string) {
    set((state) => {
      const current = state.bids.get(loadId) ?? [];
      const doomed = ref
        ? current.find((bid) => bid.clientRef === ref)
        : // No ref (older server): fall back to the newest pending bid.
          [...current].reverse().find((bid) => bid.sync === "pending");

      const bids = new Map(state.bids);
      bids.set(
        loadId,
        doomed ? current.filter((bid) => bid !== doomed) : current,
      );
      return { bids, bidErrors: { ...state.bidErrors, [loadId]: message } };
    });
  }

  function handleFrame(frame: ServerFrame) {
    switch (frame.type) {
      case "loads_snapshot": {
        set((state) => ({ loads: new Map([...state.loads, ...toMap(frame.loads)]) }));
        subscribeAll();
        return;
      }

      case "load_created": {
        set((state) => {
          const loads = new Map(state.loads);
          loads.set(frame.load.id, frame.load);
          return { loads };
        });
        if (frame.load.status === "bidding") watch(frame.load.id);
        return;
      }

      case "bid_update":
        return applyBidUpdate(frame.loadId, frame.bids);

      case "position_update":
        return applyPositions(frame.positions);

      case "invoice_generated": {
        upsertInvoice(frame.invoice);
        const gap = rateGap(frame.invoice);
        set({
          notice: hasMismatch(frame.invoice)
            ? `Invoice raised for ${frame.invoice.loadId} — ₹${Math.abs(gap).toLocaleString("en-IN")} ${gap > 0 ? "over" : "under"} contract.`
            : `Invoice raised for ${frame.invoice.loadId} — matches contract.`,
        });
        return;
      }

      case "invoice_updated":
        return upsertInvoice(frame.invoice);

      case "load_assigned": {
        upsertLoad(frame.loadId, {
          status: "assigned",
          contractedRate: frame.contractedRate,
          assignedTransporterId: frame.transporterId,
          assignedTransporterName: frame.transporterName,
          history: appendHistory(frame.loadId, "assigned", frame.at),
        });
        set({
          acceptingBidIds: [],
          notice: `${frame.transporterName} won ${frame.loadId} at ₹${frame.contractedRate.toLocaleString("en-IN")}.`,
        });
        return;
      }

      // Drives the live assigned -> in_transit move. Nothing here is aware that
      // the server is simulating the driver; it is an ordinary status change.
      case "status_update": {
        upsertLoad(frame.loadId, {
          status: frame.status,
          history: appendHistory(frame.loadId, frame.status, frame.at),
        });
        if (frame.status === "in_transit") {
          const load = get().loads.get(frame.loadId);
          set({
            notice: `${load?.assignedTransporterName ?? frame.loadId} departed — now in transit.`,
          });
        }
        return;
      }

      case "error": {
        if (frame.for === "submit_bid" && frame.loadId) {
          return rejectBid(frame.loadId, frame.ref, frame.message);
        }
        if (frame.for === "accept_bid" && frame.loadId) {
          set((state) => ({
            acceptingBidIds: [],
            bidErrors: { ...state.bidErrors, [frame.loadId!]: frame.message },
          }));
          return;
        }
        console.warn("[ws] server error", frame.code, frame.message);
        return;
      }

      default:
        return;
    }
  }

  return {
    loads: new Map(),
    bids: new Map(),
    invoices: new Map(),
    connection: "idle",
    loading: false,
    loadError: null,
    selectedLoadId: null,
    bidErrors: {},
    acceptingBidIds: [],
    notice: null,

    async init() {
      if (socket) return;

      socket = new FreightSocket({
        onFrame: handleFrame,
        onStatus: (connection) => {
          set({ connection });
          // A fresh socket has no subscriptions, so re-arm them on every open.
          if (connection === "open") {
            watched.clear();
            subscribeAll();
          }
        },
      });

      set({ loading: true, loadError: null });
      try {
        // REST gives the board something to render immediately; the socket then
        // keeps it live. Both paths land in the same maps.
        const [loads, invoices] = await Promise.all([fetchLoads(), fetchInvoices()]);
        set({
          loads: toMap(loads),
          invoices: new Map(invoices.map((invoice) => [invoice.loadId, invoice])),
          loading: false,
        });
      } catch (error) {
        set({
          loading: false,
          loadError: error instanceof Error ? error.message : "Could not reach the server.",
        });
      }

      socket.connect();
    },

    teardown() {
      socket?.close();
      socket = null;
      watched.clear();
      set({ connection: "idle" });
    },

    selectLoad(loadId) {
      set({ selectedLoadId: loadId });
      if (loadId) watch(loadId);
    },

    submitBid(loadId, transporterName, rate) {
      const name = transporterName.trim();
      const clientRef = crypto.randomUUID();

      // Optimistic: the bid is on the board before the socket has even flushed.
      const optimistic: Bid = {
        id: `tmp_${clientRef}`,
        loadId,
        transporterId: null,
        transporterName: name,
        rate,
        submittedAt: new Date().toISOString(),
        sync: "pending",
        clientRef,
      };

      set((state) => {
        const bids = new Map(state.bids);
        bids.set(loadId, sortBids([...(state.bids.get(loadId) ?? []), optimistic]));
        const { [loadId]: _cleared, ...bidErrors } = state.bidErrors;
        return { bids, bidErrors };
      });

      socket?.send({ type: "submit_bid", loadId, transporterName: name, rate, ref: clientRef });
    },

    acceptBid(loadId, bidId) {
      set((state) => ({ acceptingBidIds: [...state.acceptingBidIds, bidId] }));
      socket?.send({ type: "accept_bid", loadId, bidId, ref: crypto.randomUUID() });
    },

    markDelivered(loadId) {
      socket?.send({ type: "mark_delivered", loadId, ref: crypto.randomUUID() });
    },

    resolveInvoice(loadId, decision) {
      socket?.send({ type: "resolve_invoice", loadId, decision, ref: crypto.randomUUID() });
    },

    dismissBidError(loadId) {
      set((state) => {
        const { [loadId]: _cleared, ...bidErrors } = state.bidErrors;
        return { bidErrors };
      });
    },

    dismissNotice: () => set({ notice: null }),
  };
});

// ------------------------------------------------------------------ selectors

/** Loads currently open for bidding, soonest pickup first. */
export const useBiddingLoads = () =>
  useFreightStore(
    useShallow((state) =>
      [...state.loads.values()]
        .filter((load) => load.status === "bidding")
        .sort((a, b) => Date.parse(a.pickupDate) - Date.parse(b.pickupDate)),
    ),
  );

/**
 * Loads that have been awarded but not yet delivered. In transit first (those
 * are the ones actually moving), then by pickup date.
 */
const ACTIVE_ORDER = { in_transit: 0, assigned: 1 } as const;

export const useActiveShipments = () =>
  useFreightStore(
    useShallow((state) =>
      [...state.loads.values()]
        .filter((load) => load.status === "assigned" || load.status === "in_transit")
        .sort(
          (a, b) =>
            ACTIVE_ORDER[a.status as keyof typeof ACTIVE_ORDER] -
              ACTIVE_ORDER[b.status as keyof typeof ACTIVE_ORDER] ||
            Date.parse(a.pickupDate) - Date.parse(b.pickupDate),
        ),
    ),
  );

/**
 * The settlement queue, as ids — never as `{load, invoice}` pairs.
 *
 * Building pair objects here would mint fresh ones on every store update, fail
 * the shallow compare, and re-render the whole settlement view on every
 * position tick from the tracking module. Ids are strings, so this list only
 * changes when the queue actually changes; each row reads its own load and
 * invoice.
 *
 * Order is the work order: flagged first, then mismatches awaiting a decision,
 * then clean invoices, then settled ones kept as a record rather than vanishing.
 */
export const useSettlementLoadIds = () =>
  useFreightStore(
    useShallow((state) => {
      const rank = (loadId: string) => {
        const invoice = state.invoices.get(loadId)!;
        if (state.loads.get(loadId)?.status === "settled") return 3;
        if (invoice.reviewState === "flagged") return 0;
        return hasMismatch(invoice) ? 1 : 2;
      };

      return [...state.invoices.values()]
        .filter((invoice) => state.loads.has(invoice.loadId))
        .map((invoice) => invoice.loadId)
        .sort(
          (a, b) =>
            rank(a) - rank(b) ||
            Date.parse(state.invoices.get(b)!.generatedAt) -
              Date.parse(state.invoices.get(a)!.generatedAt),
        );
    }),
  );

export const useInvoice = (loadId: string): Invoice | undefined =>
  useFreightStore((state) => state.invoices.get(loadId));

export const useLoad = (loadId: string): Load | undefined =>
  useFreightStore((state) => state.loads.get(loadId));

/** Counts for the settlement header. Primitives, so ticks never touch them. */
export const useSettlementSummary = () =>
  useFreightStore(
    useShallow((state) => {
      let awaiting = 0;
      let mismatched = 0;
      let flagged = 0;
      let exposure = 0;

      for (const invoice of state.invoices.values()) {
        if (state.loads.get(invoice.loadId)?.status === "settled") continue;
        awaiting += 1;
        if (invoice.reviewState === "flagged") flagged += 1;
        if (hasMismatch(invoice)) {
          mismatched += 1;
          exposure += rateGap(invoice);
        }
      }

      return { awaiting, mismatched, flagged, exposure };
    }),
  );

export const useBidsForLoad = (loadId: string | null) =>
  useFreightStore(useShallow((state) => (loadId ? (state.bids.get(loadId) ?? []) : [])));

/** Cheapest bid on a load, pending ones included — bids are kept sorted. */
export const useLowestBid = (loadId: string) =>
  useFreightStore((state) => state.bids.get(loadId)?.[0] ?? null);

