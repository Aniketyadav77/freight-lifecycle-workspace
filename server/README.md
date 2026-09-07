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

The same file also streams positions: a one-second interval nudges each
in-transit load along a straight line toward its destination and broadcasts a
batched `position_update`. One real second is played as fifteen simulated
minutes (`TIME_COMPRESSION`), because a truck's real 14 m/s is invisible on a
map of India. Coordinates come from `src/places.js`, a small gazetteer of the
seeded lanes; unknown place names get a deterministic fallback position derived
from the name, so ad-hoc loads still track sensibly.

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
| `src/places.js`   | Lat/lng for the seeded lanes, with a deterministic fallback. |
| `src/simulation.js` | Simulated driver departure and position ticks. |
| `src/transit.js`  | Expected transit time per lane → `deliveryDueDate`. |
| `src/seed.js`     | Boot data, created by driving the real store API. |

The store emits on an `EventEmitter` that `realtime.js` subscribes to, rather
than calling sockets directly. That keeps the dependency one-way and means a
REST write (`PATCH /loads/:id/status`) pushes to watching sockets for free.
