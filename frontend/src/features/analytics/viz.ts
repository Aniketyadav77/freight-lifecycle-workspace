/**
 * Chart palette and chrome.
 *
 * Two categorical slots are in use (blue, orange). Validated against this app's
 * white card surface — lightness band, chroma floor, colour-vision separation
 * (worst adjacent ΔE 24.7 protan), normal-vision separation (ΔE 33.6) and 3:1
 * contrast all pass. Do not substitute a hue here without re-validating: the
 * pair being distinguishable under colour-vision deficiency is a measured
 * property, not a matter of taste.
 *
 * Chrome values are one shade off the surface on purpose — grid and axes are
 * meant to recede behind the data, not compete with it.
 */
export const VIZ = {
  surface: "#ffffff",
  /** Slot 1 — the primary measure in every chart here. */
  series1: "#2a78d6",
  /** Slot 2 — only ever the secondary series on the variance chart. */
  series2: "#eb6834",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  muted: "#898781",
  ink: "#52514e",
} as const;

/** Recharts axis defaults, so every chart's chrome matches without repetition. */
export const AXIS_TICK = { fill: VIZ.muted, fontSize: 11 } as const;
