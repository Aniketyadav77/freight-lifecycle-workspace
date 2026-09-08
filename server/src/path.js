import { distanceKm } from "./geo.js";

/**
 * Polyline traversal — moving a point along a real road path.
 *
 * The straight-line simulation this replaced only ever needed two points, so
 * "how far along are we" was a single interpolation. A road route is a few
 * thousand segments, so position becomes "the point N kilometres into this
 * path", which needs the cumulative distance table below.
 *
 * Distances are measured once when a route arrives, not per tick: the path does
 * not change while a load drives it, and re-measuring 12,000 segments every
 * second for every load would be the most expensive thing the server does.
 */

const toPoint = ([lng, lat]) => ({ lat, lng });

/** Cumulative distance to each vertex, so position is a lookup plus a lerp. */
export function measurePath(coordinates) {
  const cumulative = new Array(coordinates.length).fill(0);

  for (let i = 1; i < coordinates.length; i += 1) {
    cumulative[i] =
      cumulative[i - 1] + distanceKm(toPoint(coordinates[i - 1]), toPoint(coordinates[i]));
  }

  return { cumulative, totalKm: cumulative[cumulative.length - 1] ?? 0 };
}

/**
 * The point `targetKm` along the path.
 *
 * Callers advance monotonically, so `fromIndex` lets a tick resume the scan
 * where the last one stopped instead of walking the whole table each time —
 * the difference between O(n) and O(1) per tick on a 12,000-point route.
 */
export function pointAtDistance(coordinates, cumulative, targetKm, fromIndex = 0) {
  if (coordinates.length === 0) return null;

  const total = cumulative[cumulative.length - 1] ?? 0;
  if (targetKm >= total) {
    const last = coordinates[coordinates.length - 1];
    return { ...toPoint(last), index: coordinates.length - 1, arrived: true };
  }

  let i = Math.max(0, Math.min(fromIndex, coordinates.length - 2));
  while (i < coordinates.length - 2 && cumulative[i + 1] < targetKm) i += 1;

  const segmentStart = cumulative[i];
  const segmentLength = cumulative[i + 1] - segmentStart;
  const t = segmentLength === 0 ? 0 : (targetKm - segmentStart) / segmentLength;

  const a = toPoint(coordinates[i]);
  const b = toPoint(coordinates[i + 1]);

  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
    index: i,
    arrived: false,
  };
}

/**
 * Ramer–Douglas–Peucker simplification.
 *
 * OSRM's `overview=full` returns ~12,000 points for a 1,000 km route — a
 * quarter of a megabyte of JSON, for a line that is a few hundred pixels long
 * on screen. The server keeps the full path (it drives the movement, where the
 * detail is real), and sends a simplified one to browsers for drawing.
 *
 * RDP rather than "keep every Nth point" because it is shape-aware: it spends
 * points where the road actually bends and almost none on a straight highway,
 * so the drawn line stays faithful at a fraction of the size.
 */
export function simplifyPath(coordinates, epsilonDeg = 0.0004) {
  if (coordinates.length <= 2) return coordinates;

  const keep = new Uint8Array(coordinates.length);
  keep[0] = 1;
  keep[coordinates.length - 1] = 1;

  // Iterative rather than recursive: a 12,000-point path can nest deep enough
  // to blow the call stack.
  const stack = [[0, coordinates.length - 1]];

  while (stack.length > 0) {
    const [start, end] = stack.pop();
    if (end - start < 2) continue;

    let farthest = -1;
    let maxDistance = 0;

    for (let i = start + 1; i < end; i += 1) {
      const distance = perpendicularDistance(coordinates[i], coordinates[start], coordinates[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }

    if (maxDistance > epsilonDeg && farthest !== -1) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return coordinates.filter((_, index) => keep[index] === 1);
}

/** Distance from `point` to the line through `a`-`b`, in degrees. */
function perpendicularDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);

  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));

  return Math.hypot(px - (ax + clamped * dx), py - (ay + clamped * dy));
}
