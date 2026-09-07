import http from "node:http";

import cors from "cors";
import express from "express";

import { attachBilling } from "./billing.js";
import { createRouter, errorHandler, notFoundHandler } from "./routes.js";
import { attachRealtime } from "./realtime.js";
import { attachSimulation } from "./simulation.js";
import { seed } from "./seed.js";
import { listInvoices } from "./store.js";

const PORT = Number(process.env.PORT ?? 4000);

// Attached *before* seeding: the seed delivers and settles loads on its way to
// those states, and those loads need invoices exactly like live ones do.
attachBilling();

const loads = seed();

// Attached *after* seeding on purpose: the seed assigns loads to reach its
// later lifecycle states, and we don't want those historical assignments to
// trigger simulated departures. Only assignments made while running count.
attachSimulation();

const app = express();
app.use(cors());
app.use(express.json());
app.use(createRouter());
app.use(notFoundHandler);
app.use(errorHandler);

// REST and WebSocket share one HTTP server, so the frontend needs one origin.
const server = http.createServer(app);
attachRealtime(server);

server.listen(PORT, () => {
  console.log(`freight-lifecycle server listening on http://localhost:${PORT}`);
  console.log(`  REST      http://localhost:${PORT}/loads`);
  console.log(`  WebSocket ws://localhost:${PORT}/ws`);
  console.log(`  seeded    ${loads.length} loads`);
  console.log(`  invoices  ${listInvoices().length} raised`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
