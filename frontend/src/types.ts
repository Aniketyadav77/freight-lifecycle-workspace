/** Mirrors the server's lifecycle in `server/src/lifecycle.js`. */
export type LoadStatus =
  | "posted"
  | "bidding"
  | "assigned"
  | "in_transit"
  | "delivered"
  | "settled";

export interface LoadPosition {
  lat: number;
  lng: number;
}

/** One lifecycle transition, as recorded by the server. */
export interface LoadHistoryEntry {
  status: LoadStatus;
  at: string;
}

export interface Load {
  id: string;
  origin: string;
  destination: string;
  weight: number;
  pickupDate: string;
  /** What on-time performance is measured against; derived from lane distance. */
  deliveryDueDate: string;
  status: LoadStatus;
  assignedTransporterId: string | null;
  assignedTransporterName: string | null;
  contractedRate: number | null;
  /** Live position while in transit; null before the load starts moving. */
  position: LoadPosition | null;
  /** 0-1 along the lane from origin to destination. */
  progress: number;
  /**
   * When this client last heard a position for the load. Stamped on arrival
   * rather than sent on the wire — the same thing the Control Tower's stream
   * layer did, and it is what lets a row show "last update" without a server
   * field for it.
   */
  positionUpdatedAt?: number;
  /** Ordered lifecycle history, authored by the server. */
  history: LoadHistoryEntry[];
  createdAt?: string;
  assignedAt?: string;
}

/** A bid exactly as the server returns it. */
export interface ServerBid {
  id: string;
  loadId: string;
  transporterId: string;
  transporterName: string;
  rate: number;
  submittedAt: string;
}

/**
 * A bid as the store holds it. `pending` bids are optimistic — they exist only
 * on this client until a `bid_update` echoes them back, at which point they are
 * replaced by the confirmed server record. `transporterId` is null until then,
 * because the server is what assigns it.
 */
export interface Bid extends Omit<ServerBid, "transporterId"> {
  transporterId: string | null;
  sync: "pending" | "confirmed";
  /** Correlation id, present only while optimistic; echoed on server errors. */
  clientRef?: string;
}

/** What the transporter billed, against what was agreed at award. */
export interface Invoice {
  id: string;
  loadId: string;
  invoicedRate: number;
  contractedRate: number;
  generatedAt: string;
  reviewState: "pending" | "flagged" | "approved";
}

export const rateGap = (invoice: Invoice) => invoice.invoicedRate - invoice.contractedRate;
export const hasMismatch = (invoice: Invoice) => rateGap(invoice) !== 0;

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed";

// ------------------------------------------------------------ socket frames

export type ClientFrame =
  | { type: "watch"; loadId: string }
  | { type: "unwatch"; loadId: string }
  | { type: "submit_bid"; loadId: string; transporterName: string; rate: number; ref: string }
  | { type: "accept_bid"; loadId: string; bidId: string; ref: string }
  | { type: "mark_delivered"; loadId: string; ref: string }
  | { type: "resolve_invoice"; loadId: string; decision: "approve" | "flag"; ref: string };

export type ServerFrame =
  | { type: "connected"; watchAllToken: string }
  | { type: "loads_snapshot"; loads: Load[] }
  | { type: "load_created"; load: Load }
  | { type: "bid_update"; loadId: string; bids: ServerBid[] }
  | {
      type: "load_assigned";
      loadId: string;
      contractedRate: number;
      transporterId: string;
      transporterName: string;
      at: string;
    }
  | {
      type: "status_update";
      loadId: string;
      status: LoadStatus;
      previousStatus: LoadStatus;
      at: string;
    }
  | {
      type: "position_update";
      positions: { loadId: string; lat: number; lng: number; progress: number }[];
    }
  | { type: "invoice_generated"; invoice: Invoice }
  | { type: "invoice_updated"; invoice: Invoice }
  | { type: "unwatched"; loadId: string }
  | { type: "pong" }
  | {
      type: "error";
      code: string;
      message: string;
      for?: ClientFrame["type"];
      loadId?: string;
      ref?: string;
    };
