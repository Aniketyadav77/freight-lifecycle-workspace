# Freight Lifecycle Workspace — Project Context

## What this is
A unified SPA modeling a freight lifecycle: Procure (bidding) → Execute
(assignment) → Track (live shipment tracking) → Settle (invoice
reconciliation + analytics). Portfolio project targeting a logistics/TMS
company (FreightFox). Companion project to a separate real-time tracking
project (Fleet Control Tower) — the tracking module here should reuse that
project's map/table components, not reimplement them.

## Stack
- Backend: Node.js + `ws` (WebSocket) + Express (for REST endpoints where a
  request/response fits better than a stream, e.g. invoice generation)
- Frontend: React + TypeScript, Zustand (shared cross-module store), React
  Router (nested routes/layouts), Recharts (analytics), Tailwind CSS

## Architecture principles (don't violate these)
- ONE Zustand store shared across all four modules — no module keeps
  private duplicate state for data another module also needs (e.g. a load's
  status is one source of truth, read by Procure, Track, and Settle views)
- Routing uses nested layouts: a persistent shell (nav + load context) wraps
  module-specific routes, not four disconnected pages
- Bidding uses optimistic UI: a submitted bid appears in the list
  immediately, then reconciles (confirms or rolls back) when the server
  responds — never block the UI waiting for server confirmation
- A load's lifecycle state machine is explicit: posted -> bidding -> assigned
  -> in_transit -> delivered -> settled. No module should be able to put a
  load in an invalid state.
- Components built for one module should be reusable in another where the
  same UI concept recurs (e.g. a status badge, a load-summary card)

## Current build phase
(update this line as you progress)
Phase 1: not started