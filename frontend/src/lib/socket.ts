import { socketUrl } from "./config";
import type { ClientFrame, ConnectionStatus, ServerFrame } from "../types";

interface SocketHandlers {
  onFrame: (frame: ServerFrame) => void;
  onStatus: (status: ConnectionStatus) => void;
}

const RECONNECT_MS = [500, 1_000, 2_000, 5_000, 10_000];

/**
 * Dumb transport: it owns the socket, buffers sends made before the connection
 * is up, and reconnects with backoff. It knows nothing about loads or bids —
 * every frame is handed straight to the store, which is the only place that
 * interprets them.
 */
export class FreightSocket {
  #ws: WebSocket | null = null;
  #queue: ClientFrame[] = [];
  #attempt = 0;
  #closedByUs = false;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #handlers: SocketHandlers;

  constructor(handlers: SocketHandlers) {
    this.#handlers = handlers;
  }

  connect() {
    this.#closedByUs = false;
    if (this.#ws && this.#ws.readyState <= WebSocket.OPEN) return;

    this.#handlers.onStatus("connecting");
    const ws = new WebSocket(socketUrl());
    this.#ws = ws;

    ws.onopen = () => {
      this.#attempt = 0;
      this.#handlers.onStatus("open");
      // Flush anything queued while we were down; the store re-subscribes on
      // "open", so these are only user actions taken mid-reconnect.
      const queued = this.#queue;
      this.#queue = [];
      for (const frame of queued) this.send(frame);
    };

    ws.onmessage = (event) => {
      try {
        this.#handlers.onFrame(JSON.parse(event.data as string) as ServerFrame);
      } catch {
        console.warn("[ws] dropped unparseable frame", event.data);
      }
    };

    ws.onclose = () => {
      this.#ws = null;
      this.#handlers.onStatus("closed");
      if (!this.#closedByUs) this.#scheduleReconnect();
    };

    // `onclose` always follows `onerror`, so reconnect is handled there.
    ws.onerror = () => ws.close();
  }

  send(frame: ClientFrame) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(frame));
      return;
    }
    this.#queue.push(frame);
    this.connect();
  }

  close() {
    this.#closedByUs = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#queue = [];
    this.#ws?.close();
    this.#ws = null;
  }

  #scheduleReconnect() {
    const delay = RECONNECT_MS[Math.min(this.#attempt, RECONNECT_MS.length - 1)] ?? 10_000;
    this.#attempt += 1;
    this.#retryTimer = setTimeout(() => this.connect(), delay);
  }
}
