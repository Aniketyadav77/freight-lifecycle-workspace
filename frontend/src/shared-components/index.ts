/**
 * =============================================================================
 * SHARED COMPONENTS — PORTED FROM THE FLEET CONTROL TOWER PROJECT
 * =============================================================================
 *
 * Everything in this directory originated in a separate project,
 * `fleet-control-tower` (a real-time fleet dashboard tracking 500+ vehicles).
 * It was copied here rather than rebuilt, and the adaptation was kept
 * deliberately narrow: the clustering and virtualization engines are unchanged,
 * and only the data shape and the displayed fields differ.
 *
 * -----------------------------------------------------------------------------
 * Provenance, file by file
 * -----------------------------------------------------------------------------
 *
 *   THIS PROJECT                       CAME FROM                      CHANGED
 *   ---------------------------------  -----------------------------  ---------
 *   map/useLoadClusters.ts             map/useVehicleClusters.ts      data only
 *   map/ClusterLayer.tsx               map/ClusterLayer.tsx           data only
 *   map/ShipmentMap.tsx                map/FleetMap.tsx               data only
 *   table/ShipmentTable.tsx            components/table/ShipmentTable  columns
 *   table/ShipmentRow.tsx              components/table/ShipmentRow    columns
 *   table/StatusCell.tsx               components/table/StatusCell     statuses
 *   table/tableLayout.ts               components/table/tableLayout    columns
 *   theme.ts                           theme.ts                       verbatim
 *   control-tower.css                  index.css (excerpt)            excerpt
 *   trackedLoads.ts                    store/selectors.ts (in part)   NEW SEAM
 *
 * `server/src/geo.js` in this project is likewise a near-verbatim copy of the
 * Control Tower server's `geo.js`.
 *
 * -----------------------------------------------------------------------------
 * What was NOT changed, and why that is the point
 * -----------------------------------------------------------------------------
 * The two pieces of engineering worth reusing both survived intact:
 *
 *  - **Clustering** (`useLoadClusters`). supercluster as a pure spatial index,
 *    a non-reactive store subscription that flips a dirty flag without
 *    rendering, a throttled rebuild interval, and pan/zoom re-querying the
 *    existing index instead of rebuilding it. Every line of that scheme is as
 *    it was; the original's long rationale comment is preserved verbatim.
 *
 *  - **Virtualization** (`ShipmentTable` / `ShipmentRow` / `StatusCell`). The
 *    two-mechanism design — virtualization bounding how many rows exist,
 *    id-only selectors bounding how often each row updates, and a memo'd status
 *    cell that ignores position ticks entirely — is unchanged.
 *
 * -----------------------------------------------------------------------------
 * How the adaptation was done: one seam, not a hundred edits
 * -----------------------------------------------------------------------------
 * In the source project these components read `useFleetStore` and a `Vehicle`
 * shape directly. Rewriting each of them to read this project's `Load` shape
 * would have meant touching the clustering and virtualization logic, which is
 * exactly what we wanted to avoid.
 *
 * Instead `trackedLoads.ts` is a thin adapter presenting this project's store
 * through the same *shape* of API the originals expected — a map of positioned
 * entities keyed by id, an id-list selector, a per-entity selector, and a
 * non-reactive subscribe. The copied components changed their imports and their
 * field names, and nothing else.
 *
 * That seam is also the honest answer to "how would you reuse this?": the
 * components were reusable because they depended on a *shape*, and the shape
 * was cheap to provide.
 *
 * -----------------------------------------------------------------------------
 * The one later addition
 * -----------------------------------------------------------------------------
 * `ShipmentTable` and `ShipmentRow` gained an optional `action` prop so the
 * tracking view could put a "Mark as Delivered" control on each row. It is an
 * extension point, not a freight-specific feature: with no `action` passed the
 * table renders exactly as it did in the source project.
 *
 * It is typed as a component (`ComponentType<{loadId}>`) rather than a render
 * callback for a specific reason — the row is memo'd, so an inline arrow
 * function would change identity on every render and silently defeat the
 * memoization the whole table depends on. Callers must pass a module-level
 * component.
 *
 * -----------------------------------------------------------------------------
 * Where this project is a weaker fit than the original
 * -----------------------------------------------------------------------------
 * Worth saying out loud rather than overselling the reuse:
 *
 *  - Clustering earns its keep at 500 vehicles. This project has a handful of
 *    in-transit loads, so the map would work fine with plain markers. The
 *    component is here because it is the one that already exists and it scales
 *    the right way, not because a demo of six loads needs a KD-tree.
 *  - Virtualization likewise only starts paying at hundreds of rows.
 *  - The source's SLA-breach badge has no equivalent here; that subscription
 *    was dropped rather than faked.
 *
 * =============================================================================
 */

export { ShipmentMap } from "./map/ShipmentMap";
export { ShipmentTable } from "./table/ShipmentTable";
export { STATUS_COLOR, CLUSTER_COLOR, ACCENT } from "./theme";
export type { TrackedLoad } from "./trackedLoads";
