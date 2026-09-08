# Freight Lifecycle Workspace

A single-page workspace that follows a freight load through its entire
commercial life — from being posted for bids, to a transporter winning it, to
tracking it on the road, to reconciling the invoice against what was agreed.

Four modules, one shared store, one WebSocket connection. The point of the
project is that they are **not four separate pages that happen to share a nav
bar**: a load's status is a single source of truth, and every list is a way into
the same load record.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Procurement  │  Active Shipments  │  Tracking  │  Settlement │ Analytics │
└───────┬───────────────┬──────────────────┬────────────┬───────────┬──────┘
        │               │                  │            │           │
        └───────────────┴────────┬─────────┴────────────┴───────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   ONE Zustand store      │
                    │   loads / bids /         │
                    │   invoices               │
                    └────────────┬─────────────┘
                                 │  one WebSocket + REST
                    ┌────────────▼─────────────┐
                    │  Express + ws (in-memory)│
                    │  state machine enforced  │
                    └──────────────────────────┘
```

---

## The load lifecycle

Six states, strictly linear. No skipping, no going back.

```
      POST /loads                accept_bid              (simulated
      (auto-advances)          [lowest bid wins]       driver start-trip)
            │                        │                        │
            ▼                        ▼                        ▼
      ┌──────────┐            ┌────────────┐           ┌────────────┐
      │  posted  │───────────▶│  bidding   │──────────▶│  assigned  │
      └──────────┘            └────────────┘           └─────┬──────┘
                                    ▲                        │
                                    │                        │ +5s
                              submit_bid                     ▼
                            (optimistic UI,           ┌──────────────┐
                             server confirms)         │  in_transit  │
                                                      └──────┬───────┘
                                                             │
                                        mark_delivered       │
                                      (proof of delivery)    ▼
                                                      ┌──────────────┐
                                                      │  delivered   │──┐
                                                      └──────┬───────┘  │
                                                             │          │ flag
                                        resolve_invoice      │          │ for
                                          (approve)          │          │ review
                                                             ▼          │
                                                      ┌──────────────┐  │
                                                      │   settled    │  │
                                                      └──────────────┘  │
                                                       (terminal)       │
                                                             ▲──────────┘
                                                        stays "delivered"
                                                        until approved

  ├─ Procurement ─┤├── Active Shipments ──┤├ Tracking ┤├─── Settlement ───┤
                              (assigned + in_transit)
```

**Side effects on entry**

| Transition | What fires |
| --- | --- |
| `posted → bidding` | Immediate; a posted load is biddable the moment it exists |
| `bidding → assigned` | Records `contractedRate` + winning transporter |
| `assigned → in_transit` | 5s later, simulated driver departure; positions start ticking |
| `in_transit → delivered` | **Invoice raised** — this is where billing enters |
| `delivered → settled` | Only by approving that invoice |

The transition table lives in `server/src/lifecycle.js` and every status change
in the app funnels through `assertTransition`, so an invalid state is
*unreachable* rather than merely discouraged. Both transports — REST and
WebSocket — call the same store functions, so a bad transition is rejected
identically no matter which door it comes through.

---

## The four modules

| Module | Shows | Acts on |
| --- | --- | --- |
| **Procurement** | Loads open for bidding, live lowest bid | Submit a bid (optimistic), accept one |
| **Active Shipments** | Awarded loads, assigned + in transit | — |
| **Tracking** | Live map + virtualized table of moving loads | Mark delivered |
| **Settlement** | Invoices vs contracted rates, mismatches flagged | Approve / flag for review |
| **Analytics** | Cost per lane, on-time %, bid-vs-actual variance | — |

Plus **Load Detail** (`/loads/:id`) — the whole lifecycle as a timeline, with
whatever action is legal at the load's current stage. Every module's list links
into it. This is the route that makes the workspace feel unified rather than
tabbed.

### Architecture rules the code actually holds to

- **One store, no module-private copies.** A load's status is stored once and
  read by Procurement, Tracking and Settlement alike.
- **Optimistic bidding.** A submitted bid appears immediately as `pending`, then
  reconciles — confirmed when the server echoes it back, rolled back with the
  server's reason if refused. The client sends an opaque `ref` that the server
  echoes on errors, so a rollback targets the exact bid that failed.
- **The state machine is server-side.** The UI never offers an action the server
  would refuse, because the load's status decides what renders.
- **Selectors return ids, not objects.** Freshly-built objects fail identity
  comparison on every store update, which would re-render whole views on every
  position tick. Lists select ids; each row reads its own record.

---

## How this complements the Fleet Control Tower

**Fleet Control Tower** is a real-time operations dashboard: 500+ vehicles
streaming positions several times a second, clustered on a map, in a virtualized
table, with SLA breach alerting. It is a *depth* project — the interesting work
is throughput and render economy under a firehose.

**This project is the breadth counterpart.** The interesting work is the
commercial lifecycle: a state machine that cannot be violated, optimistic UI
that reconciles against a server, and one store that four modules genuinely
share. It moves a handful of loads, not five hundred vehicles.

They are meant to be read together, so the Tracking module **reuses the Control
Tower's components rather than reimplementing them**:

| Reused here | From | Adapted |
| --- | --- | --- |
| Clustered Leaflet map (supercluster) | `map/FleetMap`, `ClusterLayer`, `useVehicleClusters` | data shape only |
| Virtualized shipment table | `components/table/*` | columns only |
| Neumorphic design tokens | `index.css`, `theme.ts` | verbatim |
| Geo helpers | `server/src/geo.js` | near-verbatim |

The clustering and virtualization engines are **unchanged**. The adaptation runs
through a single seam — `frontend/src/shared-components/trackedLoads.ts` — which
presents this project's `Load` store in the shape those components already
expected. That is the honest answer to "how would you reuse this?": they were
reusable because they depended on a *shape*, and the shape was cheap to provide.

Full provenance, file by file, is in the comment block at the top of
`frontend/src/shared-components/index.ts`. Both projects wear the same
neumorphic system, so they look like siblings when shown together.

Where the reuse is a weaker fit is documented rather than oversold: clustering
earns its keep at 500 vehicles, and this project has a handful of loads. The
component is here because it already exists and scales the right way.

---

## Running it locally

Two processes. Node 20+.

```bash
# terminal 1 — API + WebSocket on :4000
cd server
npm install
npm start

# terminal 2 — app on :5173
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Set `VITE_API_URL` if the server isn't on
`localhost:4000`; the WebSocket URL is derived from it.

State is **in memory** — restarting the server reseeds the whole book from
scratch. That is deliberate for a demo: every boot gives the same starting
position.

### What's there on boot

Loads across every lifecycle state, several with bids already on the board, a
few already rolling, and twelve completed shipments so Analytics has a past
worth charting. Lanes deliberately repeat so cost-per-lane has runs to average.

### A two-minute tour

1. **Procurement** — open a load, place a bid (watch it appear instantly as
   pending, then confirm), accept the lowest.
2. **Active Shipments** — the load is there as `assigned`. Wait five seconds and
   watch it flip to `in transit` on its own.
3. **Tracking** — it's on the map, position updating every second. Hit
   *Delivered*.
4. **Settlement** — its invoice is waiting, flagged if the transporter billed
   something other than the contracted rate. Approve it.
5. **Analytics** — the settled book, one load larger.

At any point, click a load to see its whole lifecycle as a timeline.

### Simulated vs real

Three things are faked, and each says so in its own source file:

- **Driver departure** (`server/src/simulation.js`) — a real TMS gets this from
  a driver's "start trip" tap or a geofence crossing. A server would never
  advance a load on a timer.
- **Positions** (same file) — the *route* is real: an actual driving path from
  the OSRM public demo API, so a load follows the highways it would really take
  and the map draws the road. What is faked is the vehicle walking that path on
  a timer instead of a truck reporting where it is, compressed 900× so a lane
  crosses in about a minute instead of seventeen hours. If routing is
  unavailable it falls back to a straight line and says so on the map.
- **The invoiced amount** (`server/src/billing.js`) — a real system reconciles
  the transporter's actual bill. Raising an invoice on delivery is real domain
  behaviour; only the number is derived.

Everything downstream of those is real: the transitions go through the state
machine and broadcast the same events a genuine signal would.

---

## Stack

**Server** — Node, Express (REST), `ws` (WebSocket), in-memory store.
**Frontend** — React 19, TypeScript, Vite, Zustand, React Router, Tailwind v4,
Leaflet + supercluster, TanStack Virtual, Recharts.

Per-project detail — the full REST/WebSocket contract, the store's
reconciliation rules, the analytics aggregation layer — is in
[`server/README.md`](server/README.md) and
[`frontend/README.md`](frontend/README.md).

## Project status

Built as a portfolio piece. There are no automated tests: behaviour was verified
during development with throwaway harnesses that drove the real store against
the real server, and those were removed rather than left as pretend test suites.
Wiring up Vitest against the pure layers (`lifecycle.js`, `store/analytics.ts`)
would be the natural first addition.
