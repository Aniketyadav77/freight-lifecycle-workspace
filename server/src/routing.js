import { coordsFor } from "./places.js";
import { measurePath, simplifyPath } from "./path.js";

/**
 * Road routing via the OSRM public demo server.
 *
 * ---------------------------------------------------------------------------
 * PORTFOLIO DEMO ONLY — this instance is not for production
 * ---------------------------------------------------------------------------
 * `router.project-osrm.org` is a free, unauthenticated demo run as a courtesy
 * by the OSRM project. It is rate-limited, has no uptime guarantee, and its
 * usage policy asks that it not be used for production traffic. A real product
 * would either self-host OSRM (it is open source, and a country extract runs
 * comfortably on a small VM) or pay for a routing provider — Mapbox
 * Directions, Google Routes, HERE. Swapping this out means changing
 * `requestRoute` and nothing else.
 *
 * Two things here are deliberate concessions to being a guest on someone
 * else's free service:
 *
 *  - **Requests are serialised and spaced.** Four seeded loads departing at
 *    boot would otherwise fire four simultaneous requests. One at a time, a
 *    third of a second apart, is polite and still fast enough that a route
 *    lands before anyone looks at the map.
 *  - **Routes are cached by lane, not by load.** Every load on
 *    Bhiwandi → Bengaluru is the same road, so the seeded book's repeated lanes
 *    cost one request each instead of one per shipment. That also satisfies the
 *    "never re-fetch the same route" requirement more strongly than caching by
 *    load id would.
 * ---------------------------------------------------------------------------
 */

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const REQUEST_TIMEOUT_MS = 8_000;
const MIN_REQUEST_SPACING_MS = 350;

/** laneKey -> Promise<Route|null>. Also dedupes concurrent asks for one lane. */
const laneCache = new Map();

const laneKey = (origin, destination) => `${origin}→${destination}`;

/** Serialises outbound requests so we never hammer the demo server. */
let queue = Promise.resolve();
function enqueue(task) {
  const result = queue.then(task);
  queue = result.then(
    () => new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_SPACING_MS)),
    () => new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_SPACING_MS)),
  );
  return result;
}

async function requestRoute(from, to) {
  const url =
    `${OSRM_BASE}/${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`OSRM responded ${response.status}`);

    const body = await response.json();
    if (body.code !== "Ok" || !body.routes?.[0]) {
      throw new Error(`OSRM returned code "${body.code}"`);
    }

    const route = body.routes[0];
    const coordinates = route.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      throw new Error("OSRM returned a route with no usable geometry");
    }

    return { coordinates, distanceKm: route.distance / 1000, durationHours: route.duration / 3600 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A road route for a lane, or `null` if routing was unavailable.
 *
 * Returning null rather than throwing is the point: the caller's fallback is a
 * straight line, and a routing outage should degrade the demo, not break it.
 */
export function getRoute(origin, destination) {
  const key = laneKey(origin, destination);
  const cached = laneCache.get(key);
  if (cached) return cached;

  const pending = enqueue(async () => {
    try {
      const { coordinates, distanceKm, durationHours } = await requestRoute(
        coordsFor(origin),
        coordsFor(destination),
      );

      // The full path drives movement; the simplified one goes over the wire.
      const wire = simplifyPath(coordinates);
      const { totalKm } = measurePath(coordinates);

      console.log(
        `[routing] ${key}: ${distanceKm.toFixed(0)} km by road, ` +
          `${coordinates.length} pts → ${wire.length} sent (${durationHours.toFixed(1)} h drive)`,
      );

      return { coordinates, wire, distanceKm, totalKm, source: "osrm" };
    } catch (error) {
      const reason = error.name === "AbortError" ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : error.message;
      console.warn(`[routing] ${key}: ${reason} — falling back to a straight line`);
      // Cache the failure too, so a lane that cannot be routed is not retried
      // on every departure. Restart the server to try again.
      return null;
    }
  });

  laneCache.set(key, pending);
  return pending;
}

/** Test/dev helper. */
export function clearRouteCache() {
  laneCache.clear();
}
