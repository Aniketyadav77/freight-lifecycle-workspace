import { Router } from "express";

import * as store from "./store.js";
import { AppError } from "./errors.js";

export function createRouter() {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true, loads: store.listLoads().length });
  });

  router.post("/loads", (req, res) => {
    const load = store.createLoad(req.body ?? {});
    res.status(201).json(load);
  });

  router.get("/loads", (req, res) => {
    const { status } = req.query;
    const loads = store.listLoads();
    res.json(status ? loads.filter((load) => load.status === status) : loads);
  });

  // Detail carries the bid board so a load page can render before its socket
  // subscription delivers the first bid_update.
  router.get("/loads/:id", (req, res) => {
    const load = store.getLoad(req.params.id);
    res.json({ ...load, bids: store.getBids(load.id) });
  });

  router.get("/invoices", (_req, res) => {
    res.json(store.listInvoices());
  });

  // Moves a load along the lifecycle after assignment (in_transit -> delivered
  // -> settled). Reaching "assigned" is not possible here; that needs a bid.
  router.patch("/loads/:id/status", (req, res) => {
    const load = store.setStatus(req.params.id, req.body?.status);
    res.json(load);
  });

  return router;
}

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: { code: "route_not_found", message: "No such endpoint." } });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err?.type === "entity.parse.failed") {
    return res
      .status(400)
      .json({ error: { code: "bad_json", message: "Request body is not valid JSON." } });
  }

  console.error("[error] unhandled:", err);
  return res
    .status(500)
    .json({ error: { code: "internal_error", message: "Something went wrong." } });
}
