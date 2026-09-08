import { randomBetween, round } from "./geo.js";
import { measurePath, pointAtDistance } from "./path.js";
import { coordsFor } from "./places.js";
import { getRoute } from "./routing.js";
import * as store from "./store.js";

/**
 * ============================ SIMULATED BEHAVIOUR ============================
 *
 * NONE OF THIS IS REAL DOMAIN LOGIC. It exists so the demo has movement without
 * a human in the loop.
 *
 * In a real TMS, `assigned -> in_transit` is a *driver action*: the driver taps
 * "started trip" in a mobile app, or a GPS geofence fires when the vehicle
 * leaves the pickup yard, and that inbound signal moves the load. The server
 * would never advance a load on a timer — it has no way of knowing the truck
 * actually left.
 *
 * Here we fake that inbound signal: five seconds after a load is assigned, we
 * pretend the driver hit "start trip". Everything downstream is real — the
 * transition still goes through the store's state machine and broadcasts the
 * same `status_update` a genuine driver event would, so the frontend cannot
 * tell the difference. Deleting this file removes the simulation and nothing
 * else.
 *
 * The same applies to positions. Real telemetry comes from a vehicle's GPS unit
 * reporting on its own schedule; here a one-second interval advances each
 * in-transit load along its route. The *route* is real — an actual driving path
 * from OSRM (see routing.js) — so a load follows the highways it would really
 * take. What is simulated is the vehicle walking that path on a timer instead
 * of a truck reporting where it is.
 *
 * This stays deliberately simpler than the Fleet Control Tower's simulation
 * server (no zones, no SLA breaches, no traffic or speed variance) because this
 * module exists to prove component reuse and lifecycle integration, not to
 * rebuild that project's real-time engineering.
 *
 * ============================================================================
 */

const DEPARTURE_DELAY_MS = 5_000;

/** How often positions are recomputed and broadcast. */
const POSITION_TICK_MS = 1_000;

/**
 * Wall-clock compression. A truck at 50 km/h covers 14 metres per real second,
 * which is invisible on a map of India — a Bhiwandi–Bengaluru run would take
 * seventeen real hours. So one real second is played as fifteen simulated
 * minutes, which crosses a long lane in about a minute. This is the only reason
 * the number exists; nothing about the movement itself is unusual.
 */
const TIME_COMPRESSION = 900;

const SPEED_RANGE_KMPH = [42, 62];

export function attachSimulation({
  delayMs = DEPARTURE_DELAY_MS,
  tickMs = POSITION_TICK_MS,
} = {}) {
  const timers = new Map();
  /**
   * loadId -> { coordinates, cumulative, totalKm, traveledKm, cursor, speedKmph }
   * for loads currently rolling. `cursor` is where the last tick's lookup ended,
   * so each tick resumes the scan instead of re-walking the path.
   */
  const trips = new Map();

  /**
   * Puts a load on the road.
   *
   * A trip starts immediately on the straight line between its endpoints, then
   * upgrades to the real road route when OSRM answers. Waiting for the network
   * before moving would leave a freshly departed load frozen on the map for a
   * second or two; starting straight and swapping under it means the only thing
   * a viewer sees is the path snapping onto real roads.
   *
   * Also called for loads already in transit at boot (the seeded ones), which
   * otherwise would have no position to move from.
   */
  function beginTrip(load) {
    if (trips.has(load.id)) return;

    const origin = coordsFor(load.origin);
    const destination = coordsFor(load.destination);
    const speedKmph = randomBetween(SPEED_RANGE_KMPH[0], SPEED_RANGE_KMPH[1]);

    // The fallback is not a special case in the movement code — it is simply a
    // two-point path. One traversal routine serves both.
    setPath(load.id, [
      [origin.lng, origin.lat],
      [destination.lng, destination.lat],
    ]);
    const trip = trips.get(load.id);
    trip.speedKmph = speedKmph;

    store.applyPositions([
      {
        loadId: load.id,
        lat: round(load.position?.lat ?? origin.lat),
        lng: round(load.position?.lng ?? origin.lng),
        progress: load.progress ?? 0,
      },
    ]);

    // Fire-and-forget: a routing failure resolves to null and leaves the
    // straight-line path in place, so the tracking view never depends on it.
    void adoptRoute(load, origin, destination);
  }

  /** Installs a path on a trip, preserving how far along the load already is. */
  function setPath(loadId, coordinates) {
    const existing = trips.get(loadId);
    const { cumulative, totalKm } = measurePath(coordinates);
    const fraction = existing && existing.totalKm > 0 ? existing.traveledKm / existing.totalKm : 0;

    trips.set(loadId, {
      ...existing,
      coordinates,
      cumulative,
      totalKm,
      // Carry progress across the swap as a *fraction*: the road route is
      // longer than the straight line, so kilometres travelled do not transfer.
      traveledKm: fraction * totalKm,
      cursor: 0,
    });
  }

  async function adoptRoute(load, origin, destination) {
    const route = await getRoute(load.origin, load.destination);

    // The load may have been delivered while we were waiting.
    if (!trips.has(load.id)) return;

    if (!route) {
      // Straight-line fallback stays. Tell clients so the map can say so.
      store.setRoute(load.id, {
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
        source: "straight-line",
        distanceKm: trips.get(load.id)?.totalKm ?? 0,
      });
      return;
    }

    setPath(load.id, route.coordinates);
    store.setRoute(load.id, {
      coordinates: route.wire,
      source: "osrm",
      distanceKm: route.distanceKm,
    });
  }

  /** One tick: advance every rolling load along its path. */
  function tick() {
    const updates = [];

    for (const [loadId, trip] of trips) {
      const load = store.listLoads().find((candidate) => candidate.id === loadId);

      // Delivered, settled, or otherwise no longer moving — stop tracking it.
      if (!load || load.status !== "in_transit" || !load.position) {
        trips.delete(loadId);
        continue;
      }

      const stepKm = (trip.speedKmph * (tickMs / 1000) * TIME_COMPRESSION) / 3600;
      trip.traveledKm = Math.min(trip.traveledKm + stepKm, trip.totalKm);

      const next = pointAtDistance(
        trip.coordinates,
        trip.cumulative,
        trip.traveledKm,
        trip.cursor,
      );
      if (!next) {
        trips.delete(loadId);
        continue;
      }
      trip.cursor = next.index;

      // Progress is distance along the path, so it is monotonic by construction
      // and means the same thing whether the path is a road or a straight line.
      const progress = trip.totalKm === 0 ? 1 : Math.min(1, trip.traveledKm / trip.totalKm);

      updates.push({
        loadId,
        lat: round(next.lat),
        lng: round(next.lng),
        progress: Math.round(progress * 1000) / 1000,
      });

      // Arrived. It stays parked at the destination rather than auto-delivering:
      // marking a load delivered is a real business event (proof of delivery),
      // not something a position tick should decide.
      if (next.arrived) trips.delete(loadId);
    }

    if (updates.length > 0) store.applyPositions(updates);
  }

  store.events.on("load_assigned", ({ loadId }) => {
    if (timers.has(loadId)) return;

    const timer = setTimeout(() => {
      timers.delete(loadId);
      try {
        store.setStatus(loadId, "in_transit");
        console.log(`[sim] load ${loadId} departed (simulated driver start-trip)`);
      } catch (err) {
        // The load moved on by other means (a manual PATCH, say). The state
        // machine refused us, which is exactly right — drop the simulation.
        console.warn(`[sim] skipped departure for ${loadId}: ${err.message}`);
      }
    }, delayMs);

    timer.unref?.();
    timers.set(loadId, timer);
  });

  // A load that has just departed starts rolling on the next tick.
  store.events.on("status_update", ({ loadId, status }) => {
    if (status !== "in_transit") return;
    const load = store.listLoads().find((candidate) => candidate.id === loadId);
    if (load) beginTrip(load);
  });

  // Seeded loads are already in transit by the time we attach, so put them on
  // the road too — otherwise they would sit on the tracking map with no
  // position at all.
  for (const load of store.listLoads()) {
    if (load.status === "in_transit") beginTrip(load);
  }

  const positionTimer = setInterval(tick, tickMs);
  positionTimer.unref?.();

  return function stopSimulation() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    clearInterval(positionTimer);
    trips.clear();
  };
}
