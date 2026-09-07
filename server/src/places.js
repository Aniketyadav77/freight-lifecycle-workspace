/**
 * A tiny gazetteer for the lanes this demo ships on.
 *
 * A load carries its origin and destination as free text ("Bhiwandi, MH"), so
 * anything that wants to draw one on a map has to turn that text into a
 * coordinate. A real system would geocode against an address service and store
 * the result on the load; here a lookup table covers the seeded lanes, which is
 * all the tracking module needs.
 */

const PLACES = {
  "bhiwandi, mh": { lat: 19.2967, lng: 73.0631 },
  "bengaluru, ka": { lat: 12.9716, lng: 77.5946 },
  "gurugram, hr": { lat: 28.4595, lng: 77.0266 },
  "jaipur, rj": { lat: 26.9124, lng: 75.7873 },
  "chennai, tn": { lat: 13.0827, lng: 80.2707 },
  "hyderabad, ts": { lat: 17.385, lng: 78.4867 },
  "pune, mh": { lat: 18.5204, lng: 73.8567 },
  "ahmedabad, gj": { lat: 23.0225, lng: 72.5714 },
  "kolkata, wb": { lat: 22.5726, lng: 88.3639 },
  "guwahati, as": { lat: 26.1445, lng: 91.7362 },
  "ludhiana, pb": { lat: 30.901, lng: 75.8573 },
  "delhi ncr": { lat: 28.6139, lng: 77.209 },
  "surat, gj": { lat: 21.1702, lng: 72.8311 },
  "nagpur, mh": { lat: 21.1458, lng: 79.0882 },
  "indore, mp": { lat: 22.7196, lng: 75.8577 },
  "raipur, cg": { lat: 21.2514, lng: 81.6296 },
  "kochi, kl": { lat: 9.9312, lng: 76.2673 },
  "coimbatore, tn": { lat: 11.0168, lng: 76.9558 },
  "visakhapatnam, ap": { lat: 17.6868, lng: 83.2185 },
  "bhopal, mp": { lat: 23.2599, lng: 77.4126 },
  "patna, br": { lat: 25.5941, lng: 85.1376 },
  "lucknow, up": { lat: 26.8467, lng: 80.9462 },
};

/** Rough mainland-India box, used only for the unknown-place fallback. */
const INDIA_BOUNDS = { minLat: 12, maxLat: 30, minLng: 72, maxLng: 88 };

/** Cheap string hash, so an unknown place always lands in the same spot. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/**
 * Coordinate for a place name. Unknown names (anything created through
 * `POST /loads` with a lane we have no entry for) get a *deterministic*
 * pseudo-position derived from the name itself, so an ad-hoc load still tracks
 * sensibly instead of vanishing from the map or jumping around between ticks.
 */
export function coordsFor(placeName) {
  const known = PLACES[placeName.trim().toLowerCase()];
  if (known) return { ...known };

  const a = hash(placeName);
  const b = hash(`${placeName}#salt`);
  return {
    lat: INDIA_BOUNDS.minLat + a * (INDIA_BOUNDS.maxLat - INDIA_BOUNDS.minLat),
    lng: INDIA_BOUNDS.minLng + b * (INDIA_BOUNDS.maxLng - INDIA_BOUNDS.minLng),
  };
}
