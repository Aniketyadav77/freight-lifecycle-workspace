import * as store from "./store.js";

/**
 * Seed data is created by driving the real store API — create, bid, accept,
 * advance — rather than by injecting rows. Every seeded load is therefore a
 * state the app can legitimately reach, and the seed doubles as a smoke test
 * of the state machine on every boot.
 */

const CHAIN = ["assigned", "in_transit", "delivered", "settled"];

const daysFromNow = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

const SEED_LOADS = [
  {
    origin: "Bhiwandi, MH",
    destination: "Bengaluru, KA",
    weight: 18000,
    pickupInDays: 2,
    bids: [
      ["Sharma Roadlines", 84500],
      ["Konkan Carriers", 81200],
      ["Deccan Freight Movers", 87000],
    ],
  },
  {
    origin: "Gurugram, HR",
    destination: "Jaipur, RJ",
    weight: 9500,
    pickupInDays: 1,
    bids: [
      ["Aravalli Transport Co", 32000],
      ["North Star Logistics", 30400],
    ],
  },
  {
    origin: "Chennai, TN",
    destination: "Hyderabad, TS",
    weight: 24000,
    pickupInDays: 4,
    bids: [],
  },
  {
    origin: "Pune, MH",
    destination: "Ahmedabad, GJ",
    weight: 12000,
    pickupInDays: 3,
    bids: [
      ["Sahyadri Cargo", 48900],
      ["Gujarat Line Haul", 46500],
      ["Sharma Roadlines", 47250],
      ["Western Corridor Freight", 51000],
    ],
  },
  {
    origin: "Kolkata, WB",
    destination: "Guwahati, AS",
    weight: 16500,
    pickupInDays: 2,
    bids: [
      ["Brahmaputra Movers", 62800],
      ["Eastern Reach Logistics", 59900],
    ],
    advanceTo: "assigned",
  },
  {
    origin: "Ludhiana, PB",
    destination: "Delhi NCR",
    weight: 7800,
    pickupInDays: 0,
    bids: [
      ["Punjab Haulers", 21500],
      ["North Star Logistics", 22800],
    ],
    advanceTo: "in_transit",
  },
  // A few long lanes already rolling, so the tracking map has spread-out
  // traffic to cluster from the moment the server boots.
  {
    origin: "Bengaluru, KA",
    destination: "Visakhapatnam, AP",
    weight: 19400,
    pickupInDays: -1,
    bids: [
      ["Coromandel Freight", 71500],
      ["Deccan Freight Movers", 74800],
    ],
    advanceTo: "in_transit",
  },
  {
    origin: "Ahmedabad, GJ",
    destination: "Lucknow, UP",
    weight: 11300,
    pickupInDays: -1,
    bids: [
      ["North Star Logistics", 66400],
      ["Gujarat Line Haul", 64900],
    ],
    advanceTo: "in_transit",
  },
  {
    origin: "Kolkata, WB",
    destination: "Bhopal, MP",
    weight: 15800,
    pickupInDays: -2,
    bids: [
      ["Eastern Reach Logistics", 79200],
      ["Central India Transport", 76800],
    ],
    advanceTo: "in_transit",
  },
  {
    origin: "Surat, GJ",
    destination: "Nagpur, MH",
    weight: 21000,
    pickupInDays: -3,
    bids: [
      ["Western Corridor Freight", 54200],
      ["Sahyadri Cargo", 53100],
    ],
    advanceTo: "delivered",
  },
  // Delivered but not yet settled — these are what the settlement queue works
  // through on first load.
  {
    origin: "Jaipur, RJ",
    destination: "Surat, GJ",
    weight: 13600,
    pickupInDays: -5,
    bids: [
      ["Aravalli Transport Co", 44300],
      ["Gujarat Line Haul", 45900],
    ],
    advanceTo: "delivered",
  },
  {
    origin: "Hyderabad, TS",
    destination: "Pune, MH",
    weight: 17900,
    pickupInDays: -4,
    bids: [
      ["Deccan Freight Movers", 51200],
      ["Sahyadri Cargo", 49700],
    ],
    advanceTo: "delivered",
  },
  {
    origin: "Indore, MP",
    destination: "Raipur, CG",
    weight: 14200,
    pickupInDays: -6,
    bids: [
      ["Central India Transport", 38700],
      ["Deccan Freight Movers", 41000],
    ],
    advanceTo: "settled",
  },
];

/**
 * Completed shipments, for the analytics module to have a past worth charting.
 *
 * Lanes repeat on purpose — cost-per-lane is only interesting when a lane has
 * several runs to average, and a chart of ten one-off lanes says nothing. Rates
 * vary within a lane the way real spot rates do.
 *
 * `daysAgo` is when the load was picked up; `lateDays` is how far past its due
 * date it actually landed (0 = on time). Both are fixed rather than random so
 * the analytics view looks the same on every boot and can be reasoned about.
 */
const SETTLED_HISTORY = [
  ["Bhiwandi, MH", "Bengaluru, KA", 18200, 34, 82400, 0],
  ["Bhiwandi, MH", "Bengaluru, KA", 17600, 27, 79800, 1],
  ["Bhiwandi, MH", "Bengaluru, KA", 19100, 19, 86200, 0],
  ["Pune, MH", "Ahmedabad, GJ", 12400, 31, 47100, 0],
  ["Pune, MH", "Ahmedabad, GJ", 11800, 22, 45600, 2],
  ["Gurugram, HR", "Jaipur, RJ", 9200, 29, 30800, 0],
  ["Gurugram, HR", "Jaipur, RJ", 9800, 16, 32600, 0],
  ["Chennai, TN", "Hyderabad, TS", 23400, 25, 58900, 3],
  ["Chennai, TN", "Hyderabad, TS", 22100, 12, 56200, 0],
  ["Kolkata, WB", "Guwahati, AS", 16200, 20, 61400, 1],
  ["Surat, GJ", "Nagpur, MH", 20800, 14, 52700, 0],
  ["Ludhiana, PB", "Delhi NCR", 7400, 9, 20900, 0],
];

const atDaysAgo = (days, hour = 9) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d;
};

const plusDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

/**
 * Drives one historical load all the way to settled, then backdates its stamps
 * so the durations are realistic. The transitions are genuine — only the clock
 * is rewritten.
 */
function seedSettledLoad([origin, destination, weight, daysAgo, rate, lateDays]) {
  const pickup = atDaysAgo(daysAgo);

  const load = store.createLoad({
    origin,
    destination,
    weight,
    pickupDate: pickup.toISOString(),
  });

  const bid = store.submitBid(load.id, "Sharma Roadlines", rate + 2600).bid;
  const winner = store.submitBid(load.id, "Konkan Carriers", rate).bid;
  void bid;
  store.acceptBid(load.id, winner.id);

  for (const status of ["in_transit", "delivered", "settled"]) {
    store.setStatus(load.id, status);
  }
  store.setInvoiceReview(load.id, "approved");

  // Delivery lands `lateDays` past the due date the lane implies.
  const delivered = plusDays(store.getLoad(load.id).deliveryDueDate, lateDays);

  store.backdateHistory(load.id, {
    posted: plusDays(pickup, -4),
    bidding: plusDays(pickup, -4),
    assigned: plusDays(pickup, -1),
    in_transit: pickup,
    delivered,
    settled: plusDays(delivered, 2),
  });

  return load;
}

export function seed() {
  store.reset();

  for (const spec of SETTLED_HISTORY) seedSettledLoad(spec);

  for (const spec of SEED_LOADS) {
    const load = store.createLoad({
      origin: spec.origin,
      destination: spec.destination,
      weight: spec.weight,
      pickupDate: daysFromNow(spec.pickupInDays),
    });

    const placed = spec.bids.map(([name, rate]) => store.submitBid(load.id, name, rate).bid);

    if (!spec.advanceTo) continue;

    // Award to the lowest bid, then walk the lifecycle up to the target status.
    const winner = [...placed].sort((a, b) => a.rate - b.rate)[0];
    store.acceptBid(load.id, winner.id);
    for (let i = 1; i <= CHAIN.indexOf(spec.advanceTo); i += 1) {
      store.setStatus(load.id, CHAIN[i]);
    }

    // A load only reaches "settled" by someone approving its invoice, so a
    // seeded settled load must carry an approved invoice to match.
    if (spec.advanceTo === "settled") store.setInvoiceReview(load.id, "approved");
  }

  return store.listLoads();
}
