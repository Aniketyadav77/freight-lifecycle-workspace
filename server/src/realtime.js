import { WebSocket, WebSocketServer } from "ws";

import * as store from "./store.js";
import { AppError, badRequest } from "./errors.js";

/**
 * Clients subscribe per load, so a bid storm on one lane doesn't wake every
 * open tab. `WATCH_ALL` is the lobby subscription a list view uses to follow
 * every load at once.
 */
const WATCH_ALL = "*";
const HEARTBEAT_MS = 30_000;

const send = (socket, payload) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
};

const sendError = (socket, code, message, context = {}) =>
  send(socket, { type: "error", code, message, ...context });

export function attachRealtime(server, { path = "/ws" } = {}) {
  const wss = new WebSocketServer({ server, path });

  function broadcast(loadId, payload) {
    for (const client of wss.clients) {
      if (client.watching?.has(loadId) || client.watching?.has(WATCH_ALL)) {
        send(client, payload);
      }
    }
  }

  // The store is the single source of truth for what happened; this layer only
  // decides who hears about it. REST writes therefore reach sockets too.
  store.events.on("load_created", ({ load }) => {
    for (const client of wss.clients) {
      if (client.watching?.has(WATCH_ALL)) send(client, { type: "load_created", load });
    }
  });

  store.events.on("bid_update", ({ loadId, bids }) => {
    broadcast(loadId, { type: "bid_update", loadId, bids });
  });

  // `at` rides along so a client can append the transition to its copy of the
  // load's history using the server's clock rather than its own.
  store.events.on(
    "load_assigned",
    ({ loadId, contractedRate, transporterId, transporterName, at }) => {
      broadcast(loadId, {
        type: "load_assigned",
        loadId,
        contractedRate,
        transporterId,
        transporterName,
        at,
      });
    },
  );

  store.events.on("status_update", ({ loadId, status, previousStatus, at }) => {
    broadcast(loadId, { type: "status_update", loadId, status, previousStatus, at });
  });

  // Routes go to lobby watchers, like positions: they are for map views.
  store.events.on("route_ready", ({ loadId, route }) => {
    for (const client of wss.clients) {
      if (client.watching?.has(WATCH_ALL)) send(client, { type: "route_ready", loadId, route });
    }
  });

  store.events.on("invoice_generated", ({ invoice }) => {
    broadcast(invoice.loadId, { type: "invoice_generated", invoice });
  });

  store.events.on("invoice_updated", ({ invoice }) => {
    broadcast(invoice.loadId, { type: "invoice_updated", invoice });
  });

  // Positions go out as one batch per tick, and only to lobby ("*") watchers:
  // they are for map and tracking views that follow the whole fleet, not for a
  // client watching a single load's bid board.
  store.events.on("position_update", ({ positions }) => {
    for (const client of wss.clients) {
      if (client.watching?.has(WATCH_ALL)) send(client, { type: "position_update", positions });
    }
  });

  wss.on("connection", (socket) => {
    socket.watching = new Set();
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    send(socket, { type: "connected", watchAllToken: WATCH_ALL });

    socket.on("message", (raw) => handleMessage(socket, raw));
    socket.on("error", (err) => console.error("[ws] socket error:", err.message));
  });

  function handleMessage(socket, raw) {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return sendError(socket, "bad_json", "Message is not valid JSON.");
    }
    if (!msg || typeof msg.type !== "string") {
      return sendError(socket, "bad_message", 'Message must be an object with a "type" string.');
    }

    try {
      return route(socket, msg);
    } catch (err) {
      if (err instanceof AppError) {
        // `ref` is an opaque client correlation id echoed straight back, so an
        // optimistic client can roll back the exact action that failed.
        return sendError(socket, err.code, err.message, {
          for: msg.type,
          loadId: msg.loadId,
          ref: msg.ref,
        });
      }
      console.error("[ws] unhandled:", err);
      return sendError(socket, "internal_error", "Something went wrong.", { for: msg.type });
    }
  }

  function route(socket, msg) {
    switch (msg.type) {
      case "watch": {
        const loadId = requireLoadId(msg.loadId);
        // "*" is the lobby; anything else must name a load that exists.
        if (loadId !== WATCH_ALL) store.getLoad(loadId);
        socket.watching.add(loadId);

        // Hand back a snapshot so the client renders without a second fetch.
        if (loadId === WATCH_ALL) {
          return send(socket, { type: "loads_snapshot", loads: store.listLoads() });
        }
        return send(socket, { type: "bid_update", loadId, bids: store.getBids(loadId) });
      }

      case "unwatch": {
        socket.watching.delete(requireLoadId(msg.loadId));
        return send(socket, { type: "unwatched", loadId: msg.loadId });
      }

      case "submit_bid": {
        const { load } = store.submitBid(msg.loadId, msg.transporterName, msg.rate);
        // A bidder implicitly follows the load they just bid on.
        socket.watching.add(load.id);
        return; // store event drives the bid_update broadcast
      }

      case "accept_bid": {
        const { load } = store.acceptBid(msg.loadId, msg.bidId);
        socket.watching.add(load.id);
        return; // store event drives the load_assigned broadcast
      }

      // Stands in for a proof-of-delivery signal — a driver's POD scan, or a
      // consignee signature arriving from the field. Delivery raises an
      // invoice; see billing.js.
      case "mark_delivered": {
        const load = store.setStatus(requireLoadId(msg.loadId), "delivered");
        socket.watching.add(load.id);
        return; // store events drive the status_update and invoice broadcasts
      }

      case "resolve_invoice": {
        const loadId = requireLoadId(msg.loadId);

        if (msg.decision === "approve") {
          // Approval is what settles the load, so it goes through the state
          // machine like every other transition.
          store.setStatus(loadId, "settled");
          store.setInvoiceReview(loadId, "approved");
        } else if (msg.decision === "flag") {
          // Flagged invoices stay at "delivered" on purpose: an invoice under
          // dispute is not settled, and the lifecycle should say so.
          store.setInvoiceReview(loadId, "flagged");
        } else {
          throw badRequest("invalid_field", '"decision" must be "approve" or "flag".');
        }

        socket.watching.add(loadId);
        return;
      }

      case "ping":
        return send(socket, { type: "pong" });

      default:
        return sendError(socket, "unknown_type", `Unsupported message type "${msg.type}".`, {
          for: msg.type,
        });
    }
  }

  // Drop half-open sockets so watcher sets don't leak across reconnects.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}

function requireLoadId(loadId) {
  if (typeof loadId !== "string" || loadId.trim() === "") {
    throw badRequest("invalid_field", '"loadId" is required and must be a string.');
  }
  return loadId.trim();
}
