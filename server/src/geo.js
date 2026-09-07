/**
 * ============================================================================
 * REUSED FROM: fleet-control-tower / server/src/geo.js
 * Copied verbatim except for trimming helpers this project does not use
 * (randomPointInBounds, randomIntBetween). The math is unchanged.
 * ============================================================================
 *
 * Minimal geo helpers. We use an equirectangular approximation rather than a
 * full haversine/geodesic solve: over the few-hundred-metre steps a vehicle
 * takes each tick, the error is far below what the map can render, and the
 * math stays cheap enough to run 500+ times per second.
 */

const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;

/** Kilometres per degree of latitude is constant; longitude shrinks with lat. */
const KM_PER_DEG_LAT = EARTH_RADIUS_KM * DEG_TO_RAD;

function kmPerDegLng(lat) {
  return KM_PER_DEG_LAT * Math.cos(lat * DEG_TO_RAD);
}

/** Approximate distance in km between two lat/lng points. */
export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * KM_PER_DEG_LAT;
  const dLng = (b.lng - a.lng) * kmPerDegLng((a.lat + b.lat) / 2);
  return Math.hypot(dLat, dLng);
}

/**
 * Move `from` toward `to` by at most `stepKm`.
 * Returns the new position plus whether the target was reached, so the caller
 * can decide to advance to the next waypoint.
 */
export function moveToward(from, to, stepKm) {
  const remainingKm = distanceKm(from, to);
  if (remainingKm <= stepKm || remainingKm === 0) {
    return { lat: to.lat, lng: to.lng, arrived: true };
  }

  const fraction = stepKm / remainingKm;
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lng: from.lng + (to.lng - from.lng) * fraction,
    arrived: false,
  };
}

export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/** Trim coordinate noise -- ~1m precision is plenty and shrinks the payload. */
export function round(value, decimals = 5) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
