import { distanceKm } from "./geo.js";
import { coordsFor } from "./places.js";

/**
 * Expected transit time for a lane.
 *
 * On-time performance needs something to be on time *against*. A load carries a
 * pickup date but no promised delivery date, so without this every on-time
 * calculation would be comparing delivery to pickup — which a load is always
 * "late" for, and which measures nothing.
 *
 * A real TMS gets this from the contract or a lane SLA table. Here it is
 * estimated from straight-line distance at a realistic Indian trucking pace:
 * roughly 450 km covered per day once rest, loading and checkposts are counted,
 * plus a day of slack. Crude, but it is a genuine yardstick rather than an
 * arbitrary constant.
 */
const KM_PER_DAY = 450;
const SLACK_DAYS = 1;

export function estimateTransitDays(origin, destination) {
  const km = distanceKm(coordsFor(origin), coordsFor(destination));
  return Math.max(1, Math.ceil(km / KM_PER_DAY)) + SLACK_DAYS;
}

/** The date a load is expected to be delivered by, given when it is picked up. */
export function deliveryDueDate(pickupDate, origin, destination) {
  const due = new Date(pickupDate);
  due.setDate(due.getDate() + estimateTransitDays(origin, destination));
  return due.toISOString();
}
