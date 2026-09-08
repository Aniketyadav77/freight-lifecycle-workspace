import { useMemo } from "react";
import { Polyline, Tooltip } from "react-leaflet";
import { useShallow } from "zustand/react/shallow";

import { ACCENT, STATUS_COLOR } from "../../shared-components";
import { useFreightStore } from "../../store/useFreightStore";

/**
 * Draws the road each in-transit load is driving.
 *
 * The performance shape here matters more than it looks. A route is a few
 * hundred to a couple of thousand points, positions tick every second, and a
 * naive implementation would rebuild and re-render every polyline on every
 * tick. So:
 *
 *  - The list selector returns **load ids** (strings), which do not change when
 *    a load moves — only when one starts or stops having a route.
 *  - Each polyline reads its own route object, whose identity is stable from
 *    the moment it arrives until the load is gone.
 *
 * Net effect: the routes are drawn once and then ignored by the position
 * stream entirely.
 */
export function RouteLayer() {
  const loadIds = useFreightStore(
    useShallow((state) => {
      const ids: string[] = [];
      for (const load of state.loads.values()) {
        if (load.status === "in_transit" && load.route) ids.push(load.id);
      }
      return ids.sort();
    }),
  );

  return (
    <>
      {loadIds.map((loadId) => (
        <RoutePolyline key={loadId} loadId={loadId} />
      ))}
    </>
  );
}

function RoutePolyline({ loadId }: { loadId: string }) {
  // The route object, not the load: this must not change when the load moves.
  const route = useFreightStore((state) => state.loads.get(loadId)?.route);
  const lane = useFreightStore((state) => {
    const load = state.loads.get(loadId);
    return load ? `${load.origin} → ${load.destination}` : "";
  });

  // GeoJSON is [lng, lat]; Leaflet wants [lat, lng]. Flip once per route, not
  // once per render — this is up to a couple of thousand points.
  const positions = useMemo(
    () => (route ? route.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]) : []),
    [route],
  );

  if (!route || positions.length < 2) return null;

  const isRealRoad = route.source === "osrm";

  return (
    <>
      {/* A casing under the line: a bare stroke disappears against road tiles
          of a similar colour, and this is how map routes are conventionally
          drawn — a wide light halo with a thin coloured line on top. */}
      <Polyline
        positions={positions}
        pathOptions={{
          color: "#ffffff",
          weight: 6,
          opacity: 0.85,
          interactive: false,
        }}
      />
      <Polyline
        positions={positions}
        pathOptions={{
          color: isRealRoad ? ACCENT : STATUS_COLOR.warn,
          weight: 2.5,
          opacity: 0.9,
          // Dashed is semantic here, not decoration: it marks a path we could
          // not route, so a straight line is never passed off as a real road.
          dashArray: isRealRoad ? undefined : "6 6",
        }}
      >
        <Tooltip sticky>
          <span className="font-medium">{lane}</span>
          <br />
          {isRealRoad
            ? `${Math.round(route.distanceKm)} km by road`
            : "Routing unavailable — straight-line estimate"}
        </Tooltip>
      </Polyline>
    </>
  );
}
