# Freight Lifecycle — Server

Express (REST) + `ws` (real-time bidding) on a single HTTP server, port `4000`
by default (`PORT` env var to change). State is in memory and reseeds on every
boot — restart to get a clean board.

```bash
npm install
npm start     # or: npm run dev  (node --watch)
```

Boot seeds loads spanning every lifecycle state, several with bids already on
the board, plus twelve completed shipments so the analytics module has a past
worth charting.

Those historical loads walk the real state machine and are then **backdated**
(`store.backdateHistory`, seed-only). Without that, every seeded stage would be
stamped within the same millisecond at boot, and every duration-based metric —
on-time performance, spend over time — would be zero. Lanes deliberately repeat
so cost-per-lane has several runs to average.

## Lifecycle

```
posted -> bidding -> assigned -> in_transit -> delivered -> settled
```

Strictly linear, enforced in `src/lifecycle.js` and applied in `src/store.js`,
so both transports are held to the same rules. `assigned` is only reachable by
accepting a bid — it carries a contracted rate and a transporter, so no
endpoint can set it directly.

## REST

| Method | Path                 | Notes |
| ------ | -------------------- | ----- |
| `POST` | `/loads`             | Body: `origin`, `destination`, `weight`, `pickupDate`. Created as `posted`, returned as `bidding`. → `201` |
| `GET`  | `/loads`             | All loads. `?status=bidding` filters. |
| `GET`  | `/loads/:id`         | The load plus its `bids` array (sorted lowest-first). |
| `PATCH`| `/loads/:id/status`  | Body: `{ "status": "in_transit" }`. Advances one legal step. |
| `GET`  | `/invoices`          | Every invoice raised so far. |
| `GET`  | `/health`            | Liveness + seeded load count. |

Errors are `{ "error": { "code", "message" } }` — `400` invalid input, `404`
unknown load, `409` illegal for the load's current state.

### Load

```jsonc
{
  "id": "ld_1001",
  "origin": "Bhiwandi, MH",
  "destination": "Bengaluru, KA",
  "weight": 18000,
  "pickupDate": "2026-09-10T03:30:00.000Z",
  "status": "bidding",
  "assignedTransporterId": null,     // set on assignment
  "assignedTransporterName": null,   // set on assignment
  "contractedRate": null,            // set on assignment
  "position": null,                  // live lat/lng while in transit
  "progress": 0,                     // 0-1 along the lane
  "history": [                       // every status held, in order
    { "status": "posted",  "at": "2026-09-08T…" },
    { "status": "bidding", "at": "2026-09-08T…" }
  ],
  "createdAt": "2026-09-08T…"
}
```

`history` is server-authored rather than accumulated by clients from the events
they happen to witness — a client that connects halfway through a load's life
has seen none of those events, and a detail view should not show a blank past
just because the browser was opened late. `status_update` and `load_assigned`
both carry an `at` so a live client appends using the server's clock.

### Invoice

```jsonc
{
  "id": "inv_9001",
  "loadId": "ld_1013",
  "invoicedRate": 39500,      // what the transporter billed
  "contractedRate": 38700,    // what was agreed at award
  "generatedAt": "2026-09-08T…",
  "reviewState": "pending"    // | "flagged" | "approved"
}
```

Storing both rates is the whole point of settlement — a single `amount` field
would make the discrepancy unrepresentable. `reviewState` is an addition to the
original four-field spec: an invoice awaiting a human decision needs somewhere
to record it, and "flagged" has no other home ("approved" is otherwise implied
by the load reaching `settled`).

## Invoicing (`src/billing.js`)

Delivery raises an invoice. That part is real domain behaviour. What is mocked
is where the *number* comes from: a real system reconciles the transporter's
actual bill (detention, fuel surcharge, re-weighed freight, tolls), and we have
no transporter to bill us.

The variance is a pure function of the load id rather than `Math.random()`. With
random rolls, roughly one boot in ten would seed a demo where every invoice
happens to match and the mismatch feature looks like dead UI. Deterministic
variance behaves identically from the outside — some invoices differ, by amounts
you cannot predict from the lane — but the same load always bills the same,
which keeps the seeded demo stable and the behaviour testable. Swap `variance()`
for `Math.random()` if genuine per-boot randomness matters more.

The seeded set currently yields one mismatch out of four invoices; loads
delivered live get their own roll.

Billing attaches **before** seeding (seeded delivered/settled loads need
invoices like any other), which is the opposite of the driver simulation below.

## Simulated driver departure

`src/simulation.js` moves a load `assigned -> in_transit` five seconds after it
is assigned. **This is a demo fake.** In a real TMS that transition is a driver
action (a "start trip" tap or a geofence crossing) arriving from outside; a
server would never advance a load on a timer. The simulation still goes through
the state machine and emits the same `status_update` a real driver event would,
so nothing downstream can tell the difference. Delete the file to remove it.

It is attached *after* seeding, so seeded loads parked in `assigned` stay put —
only assignments made while the server is running trigger a departure.

The same file also streams positions: a one-second interval advances each
in-transit load **along a real driving route** and broadcasts a batched
`position_update`. One real second is played as fifteen simulated minutes
(`TIME_COMPRESSION`), because a truck's real 14 m/s is invisible on a map of
India. Endpoint coordinates come from `src/places.js`, a small gazetteer of the
seeded lanes; unknown place names get a deterministic fallback position derived
from the name, so ad-hoc loads still track sensibly.

## Road routing (`src/routing.js`)

When a load departs, the server fetches a driving route from the **OSRM public
demo API** (`overview=full&geometries=geojson`) and the load then follows that
road path instead of a straight line.

> **Demo only.** `router.project-osrm.org` is a free, unauthenticated instance
> run as a courtesy by the OSRM project — rate-limited, no uptime guarantee, and
> its usage policy asks that it not be used for production. A real product would
> self-host OSRM (open source; a country extract runs on a small VM) or pay for
> Mapbox / Google Routes / HERE. Swapping providers means changing
> `requestRoute` and nothing else.

Being a guest on a free service shapes two decisions:

- **Requests are serialised and spaced** (~350 ms apart) rather than fired in
  parallel at boot.
- **Routes are cached by lane, not by load** — every load on Bhiwandi →
  Bengaluru is the same road, so the seeded book's repeated lanes cost one
  request each.

**Geometry is split in two.** OSRM returns ~12,000 points for a 1,000 km route,
a quarter-megabyte of JSON for a line a few hundred pixels long. The server
keeps the full path (it drives the movement, where the detail is real) and sends
browsers a Ramer–Douglas–Peucker simplification — shape-aware, so it spends
points where the road bends and almost none on a straight highway. In practice
16,959 points become 1,483, and all four seeded routes together weigh 73 KB
instead of ~1 MB.

**Failure degrades, it does not break.** A trip starts on the straight line
between its endpoints and swaps to the road route when OSRM answers, so a
freshly departed load is never frozen waiting on the network. If the request
fails or times out (8 s), a warning is logged and the straight line simply
stays — the fallback is not a special case in the movement code, it is a
two-point path through the same traversal routine. Clients are told which they
are looking at via `route.source` (`"osrm"` | `"straight-line"`), so a straight
line is never drawn as though it were a road.

`src/geo.js` is copied near-verbatim from the Fleet Control Tower server.

Arrived loads park at their destination rather than auto-delivering — marking a
load delivered is a real business event (proof of delivery), not something a
position tick should decide.

## WebSocket — `ws://localhost:4000/ws`

Subscriptions are per load, so a busy lane doesn't wake every open tab. On
connect the server sends `{ "type": "connected", "watchAllToken": "*" }`.

### Client → server

```jsonc
{ "type": "watch",           "loadId": "ld_1001" }   // "*" = every load (list views)
{ "type": "unwatch",         "loadId": "ld_1001" }
{ "type": "submit_bid",      "loadId": "ld_1001", "transporterName": "Sharma Roadlines", "rate": 84500 }
{ "type": "accept_bid",      "loadId": "ld_1001", "bidId": "bid_5001" }
{ "type": "mark_delivered",  "loadId": "ld_1001" }
{ "type": "resolve_invoice", "loadId": "ld_1001", "decision": "approve" }  // or "flag"
{ "type": "ping" }
```

`mark_delivered` stands in for a proof-of-delivery signal and raises the load's
invoice. `resolve_invoice` with `approve` settles the load; with `flag` it marks
the invoice flagged and deliberately leaves the load at `delivered` — an invoice
under dispute is not settled, and the lifecycle should say so.

`watch` replies with a snapshot — `bid_update` for a load, `loads_snapshot` for
`"*"` — so a view can render without a second fetch. Submitting or accepting a
bid auto-subscribes you to that load.

### Server → client

```jsonc
{ "type": "bid_update",    "loadId": "ld_1001", "bids": [ /* lowest rate first */ ] }
{ "type": "load_assigned", "loadId": "ld_1001", "contractedRate": 81200, "transporterId": "tr_konkan-carriers", "transporterName": "Konkan Carriers" }
{ "type": "status_update", "loadId": "ld_1001", "status": "in_transit", "previousStatus": "assigned" }
{ "type": "position_update",  "positions": [ { "loadId": "ld_1001", "lat": 19.1, "lng": 74.3, "progress": 0.42 } ] }
{ "type": "route_ready",      "loadId": "ld_1001", "route": { "coordinates": [[73.06,19.29], …], "source": "osrm", "distanceKm": 994 } }
{ "type": "invoice_generated", "invoice": { /* see below */ } }
{ "type": "invoice_updated",   "invoice": { /* review state changed */ } }
{ "type": "load_created",  "load": { /* … */ } }        // "*" watchers only
{ "type": "error",         "code": "…", "message": "…", "for": "submit_bid", "ref": "…" }
```

Any client frame may carry a `ref` (an opaque correlation id). It is echoed
verbatim on the resulting `error`, which is what lets an optimistic client roll
back the exact action that failed instead of guessing which one.

`bid_update` and `load_assigned` go to every client watching that load,
including the one that acted. Errors go only to the sender.

### Bid

```jsonc
{
  "id": "bid_5001",
  "loadId": "ld_1001",
  "transporterId": "tr_sharma-roadlines",   // derived from the name
  "transporterName": "Sharma Roadlines",
  "rate": 84500,
  "submittedAt": "2026-09-08T…"
}
```

Two behaviours worth knowing, both in `src/store.js`:

- **One live bid per transporter.** Transporters have no accounts here, so
  identity is slugged from `transporterName`. Re-bidding replaces that
  transporter's previous bid rather than stacking a duplicate, keeping the
  board a running low.
- **Ties break by time.** Equal rates sort earliest-first.

## Layout

| File              | Role |
| ----------------- | ---- |
| `src/index.js`    | Wires Express + `ws` onto one HTTP server, seeds, listens. |
| `src/lifecycle.js`| Status list and the transition table. |
| `src/store.js`    | In-memory state, validation, all rule enforcement. Emits change events. |
| `src/realtime.js` | Socket subscriptions; fans store events out to watchers. |
| `src/routes.js`   | REST handlers and error translation. |
| `src/billing.js`  | Raises an invoice on delivery; mocks the billed amount. |
| `src/geo.js`      | Distance/move-toward math, copied from Fleet Control Tower. |
| `src/routing.js`  | OSRM road routes: fetch, queue, lane cache, fallback. |
| `src/path.js`     | Polyline traversal + RDP simplification. |
| `src/places.js`   | Lat/lng for the seeded lanes, with a deterministic fallback. |
| `src/simulation.js` | Simulated driver departure and position ticks. |
| `src/transit.js`  | Expected transit time per lane → `deliveryDueDate`. |
| `src/seed.js`     | Boot data, created by driving the real store API. |

The store emits on an `EventEmitter` that `realtime.js` subscribes to, rather
than calling sockets directly. That keeps the dependency one-way and means a
REST write (`PATCH /loads/:id/status`) pushes to watching sockets for free.
