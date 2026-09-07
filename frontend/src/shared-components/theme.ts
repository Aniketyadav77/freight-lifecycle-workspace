/**
 * PORTED FROM: fleet-control-tower / src/theme.ts — copied verbatim.
 *
 * Status colours as literal values.
 *
 * Leaflet paints CircleMarkers and injected divIcon HTML outside React's tree
 * and needs real colour values, not Tailwind classes. Keeping them here means
 * the map and the rest of the dashboard share one source for the palette.
 *
 * These are the *flat* colours, deliberately. Map markers, status badges and
 * severity indicators all opt out of the neumorphic material: they are what an
 * operator scans for, and soft low-contrast edges are exactly wrong for that.
 * They must stay in step with the @theme block in control-tower.css.
 */

export const STATUS_COLOR = {
  /** on time, healthy */
  ok: "#1FAE6A",
  /** delayed, degraded */
  warn: "#F5A623",
  /** SLA breached, offline */
  bad: "#E5484D",
} as const;

/** The one non-status accent, from the design tokens. */
export const ACCENT = "#3D5AFE";

/**
 * Cluster bubbles use the accent at low density and shift toward the alert
 * colours as they get denser, so scale reads before the number does.
 */
export const CLUSTER_COLOR = {
  small: ACCENT,
  medium: "#F5A623",
  large: "#E5484D",
} as const;
