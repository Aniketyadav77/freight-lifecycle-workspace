/**
 * PORTED FROM: fleet-control-tower / src/components/table/tableLayout.ts
 * Changed: the column template (4 vehicle columns -> 5 load columns).
 *
 * Shared row geometry. The virtualizer needs the row height as a number, and
 * the header needs the same column template as the rows, so both live here
 * rather than being written twice and drifting apart.
 */

export const ROW_HEIGHT = 40;

/**
 * A literal class string, not an interpolated one: Tailwind scans source for
 * complete class names, so a template built at runtime would never make it into
 * the generated stylesheet.
 */
export const GRID_COLUMNS = "grid grid-cols-[6rem_1fr_8rem_6rem_5rem] gap-3";

/** Same layout with a trailing action column, used when `Action` is supplied. */
export const GRID_COLUMNS_WITH_ACTION =
  "grid grid-cols-[6rem_1fr_8rem_6rem_5rem_7rem] gap-3";
