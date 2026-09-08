/**
 * PORTED FROM: fleet-control-tower / src/map/FleetMap.tsx
 *
 * Changed: reads positioned loads through the trackedLoads adapter instead of
 * the fleet store, and the fallback viewport widened from Maharashtra to India
 * because these lanes are inter-state. The fit-once behaviour and the canvas
 * rendering choice are unchanged.
 */

import "leaflet/dist/leaflet.css";

import { latLngBounds } from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";

import { ClusterLayer } from "./ClusterLayer";
import { getTrackedLoads, subscribeTracked } from "../trackedLoads";

/** Roughly central India. Only used for the first paint, before any data lands. */
const FALLBACK_CENTER: [number, number] = [21.5, 79.0];
const FALLBACK_ZOOM = 5;

/** Keeps the outermost loads off the edge of the viewport. */
const FIT_PADDING_PX: [number, number] = [40, 40];

/**
 * Fits the map to the tracked loads' bounding box, once, as soon as the first
 * positions arrive.
 *
 * "Once" is the whole design here. The bounding box shifts slightly every tick
 * as loads move, and re-fitting on each change would leave the operator unable
 * to pan or zoom anywhere -- the map would yank itself back every second. So
 * this fits on the first non-empty set and then unsubscribes, handing control
 * to the user permanently.
 */
function FitToLoadsOnce() {
  const map = useMap();
  const hasFitRef = useRef(false);

  useEffect(() => {
    const fit = () => {
      const loads = getTrackedLoads();
      if (hasFitRef.current || loads.size === 0) return false;

      const bounds = latLngBounds(
        [...loads.values()].map((load) => [load.position.lat, load.position.lng]),
      );

      if (!bounds.isValid()) return false;

      map.fitBounds(bounds, { padding: FIT_PADDING_PX });
      hasFitRef.current = true;
      return true;
    };

    // The store is filled from the socket outside React, so by the time this
    // effect runs the data may already be there -- or may be a tick away.
    if (fit()) return;

    const unsubscribe = subscribeTracked(() => {
      if (fit()) unsubscribe();
    });

    return unsubscribe;
  }, [map]);

  return null;
}

export function ShipmentMap({
  height = 520,
  children,
}: {
  height?: number | string;
  /**
   * Extra Leaflet layers, rendered beneath the markers. An opt-in slot so this
   * component stays the general-purpose map it was in the source project —
   * the freight route overlay lives in the tracking feature, not in here.
   */
  children?: React.ReactNode;
}) {
  return (
    <MapContainer
      center={FALLBACK_CENTER}
      zoom={FALLBACK_ZOOM}
      style={{ height, width: "100%" }}
      // Loads are dots, not photos: the raster tiles are the only thing that
      // needs to look right, and preferring canvas keeps hundreds of
      // CircleMarkers out of the DOM entirely.
      preferCanvas
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToLoadsOnce />
      {/* Overlays first so the markers draw on top of them. */}
      {children}
      <ClusterLayer />
    </MapContainer>
  );
}
