# Freight Lifecycle — Frontend

Vite + React 19 + TypeScript + Tailwind v4, with one Zustand store shared by
every module.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm run typecheck
```

Expects the backend on `http://localhost:4000` (`VITE_API_URL` to override —
the WebSocket URL is derived from it). Start `../server` first.

## Store

`src/store/useFreightStore.ts` is the single source of truth:

```ts
loads:    Map<string, Load>
bids:     Map<string, Bid[]>   // keyed by loadId, always sorted lowest-rate-first
invoices: Map<string, Invoice> // keyed by loadId; a load has at most one
```

Socket frames are applied straight to this state — `bid_update` reconciles the
bid list, `load_assigned` flips a load's status. **No component holds bid
state.** The only local state in the tree is `BidForm`'s uncommitted draft;
the moment it's submitted it becomes a store bid.

Components read through selectors (`useBiddingLoads`, `useBidsForLoad`,
`useLowestBid`) which use `useShallow`, so a bid landing on one lane re-renders
that row rather than the board.

## Optimistic bidding

1. `submitBid` puts the bid in the store immediately with `sync: "pending"` and
   a `clientRef`, rendered dashed/amber. It is never accept-able — a pending bid
   has no server id yet.
2. The frame goes out carrying that `clientRef` as `ref`.
3. **Confirm:** the server's `bid_update` is authoritative. A pending bid is
   dropped once the incoming list contains an equivalent bid (same transporter
   name, same rate) — that echo *is* the confirmation. Unmatched pending bids
   stay on screen.
4. **Reject:** the server echoes `ref` on the `error` frame, so rollback removes
   exactly that bid and shows the server's reason in the panel.

Accepting a bid sends `accept_bid` and marks it in-flight; the load only leaves
the board once `load_assigned` arrives and sets its status to `assigned`. The
board renders `status === "bidding"`, so removal is a consequence of the state
change rather than a separate deletion.

## Layout

| Path | Role |
| ---- | ---- |
| `src/store/useFreightStore.ts` | The shared store — state, socket frame handling, selectors. |
| `src/lib/socket.ts` | Transport only: reconnect w/ backoff, send queue. Interprets nothing. |
| `src/components/AppShell.tsx` | Persistent nav layout; owns the store lifecycle across routes. |
| `src/features/procure/` | Procurement board, bid panel, bid form. |
| `src/features/execute/` | Active shipments — assigned + in-transit loads. |
| `src/features/track/` | Tracking — map + virtualized table, both reused. |
| `src/features/settle/` | Settlement — invoices, mismatches, approve/flag. |
| `src/features/analytics/` | Analytics view + chart palette. |
| `src/store/analytics.ts` | Aggregations over the settled book. |
| `src/shared-components/` | Ported from the Fleet Control Tower project — see its `index.ts` for the full provenance table. |
| `src/components/StatusBadge.tsx`, `LoadSummaryCard.tsx` | Cross-module reusable pieces. |

## Routing

```
AppShell                     persistent nav + socket lifecycle
├── /procure                 Procurement board
├── /active                  Active Shipments
├── /track                   Tracking
├── /settle                  Settlement
├── /analytics               Analytics (Recharts, derived client-side)
└── /loads/:id               Load detail — lifecycle timeline + stage actions
```

Everything nests under `AppShell`, so the socket connects once and survives
navigation between modules.

`/loads/:id` is what makes the four modules one workspace: every list links into
it, and it renders the load's whole lifecycle plus whatever action is legal at
its current stage (bid board while bidding, mark-delivered while in transit,
approve/flag once delivered). It reads entirely from the shared store — the only
side effect is subscribing to that load's bid stream.

Lifecycle history is **authored by the server** (`load.history`), not
accumulated by the client from events it happened to witness: a browser opened
halfway through a load's life has seen none of those events and would otherwise
show a blank past. Live transitions append using the server's timestamp, and the
append is idempotent per status so a replayed frame after a reconnect cannot
duplicate a stage.

## Live status transitions

The server simulates a driver departure five seconds after assignment (see
`../server/src/simulation.js`) and broadcasts `status_update`. The store applies
it to `loads` like any other frame, so **Active Shipments** re-renders with no
refetch and no polling — accept a bid on the board, switch to Active shipments,
and watch the row flip `Assigned → In transit` on its own.

Rows briefly flag themselves when their status changes under them. That flash is
component-local `useState` — presentational timing only, never written back to
the store.

## Reused components (Tracking)

`src/shared-components/` holds the clustered Leaflet map and the virtualized
shipment table lifted from the **Fleet Control Tower** project. The clustering
and virtualization engines are unchanged; only the data shape and displayed
fields differ. `src/shared-components/index.ts` carries the file-by-file
provenance table and the full reuse story.

The adaptation runs through one seam — `shared-components/trackedLoads.ts` —
which presents this project's `Load` store in the shape those components already
expected (keyed map of positioned entities, id-list selector, per-entity
selector, non-reactive subscribe). That is why the copied files needed only
import and field-name changes.

Positions come from the server's simulation on a one-second tick and are applied
per load, so untouched loads keep object identity and the procurement board does
not re-render when a truck moves.

### Route polylines

Each in-transit load carries a `route` (real OSRM road geometry, or a
straight-line fallback — `route.source` says which). It arrives once via
`route_ready` and lives on the load in the store, so `features/track/RouteLayer`
never fetches and a client that connects mid-journey gets the route from the
initial `GET /loads`.

The layer follows the same id-list pattern as everything else: the list selector
returns **load ids** (unchanged by movement) and each polyline reads its own
route object (stable from arrival). Routes are therefore drawn once and ignored
by the position stream entirely — important, since they run to a couple of
thousand points.

`ShipmentMap` takes an optional `children` slot for extra Leaflet layers, so the
freight-specific route overlay lives in the tracking feature rather than inside
the ported Control Tower component.

The table takes an optional `action` prop (used for "Mark as Delivered"). It
must be a **module-level component**, not an inline arrow — the row is memo'd
and compares it by reference.

## Settlement

Marking a load delivered raises an invoice server-side; the settlement view
lists them with the contracted rate beside the invoiced one and flags any gap as
a rate mismatch. **Approve** settles the load, **Flag for review** records the
dispute and deliberately leaves it at `delivered`.

`useSettlementLoadIds` returns ids, never `{load, invoice}` pairs — building
pair objects in the selector would mint fresh ones on every store update and
re-render the whole settlement view on every position tick from Tracking.

## Analytics

`src/store/analytics.ts` is two layers on purpose:

- **Pure functions** — `computeLaneCosts`, `computeOnTime`, `computeRateVariance`
  — take an iterable of loads plus the invoice map and return figures. They know
  nothing about React or the store, so a role-scoped view (a Regional Manager
  seeing only their lanes, the way the Control Tower scoped KPIs by zone) reuses
  them by passing a filtered collection. That is why they take an iterable rather
  than reading the store themselves.
- **`useFreightAnalytics`** feeds the store's settled loads into them.

Nothing is stored. Running counters in the store are how a dashboard ends up
claiming 101% on-time — two sources of truth drift, and the bug only shows after
a reconnect.

These aggregations return arrays of objects, so `useShallow` cannot help: it
compares elements by reference and would fail on every update, re-rendering the
charts on every position tick. Instead the hook selects a cheap **string
signature** of the settled book and does the work in a `useMemo` keyed on it.

On-time is measured against `load.deliveryDueDate` (server-derived from lane
distance), not against pickup — a load is always delivered after it is picked
up, so pickup-vs-delivery measures nothing.

Chart colours live in `features/analytics/viz.ts` and were validated for
colour-vision separation and contrast against the white card surface. Don't swap
a hue without re-validating. Each chart ships a table view of the same numbers.
