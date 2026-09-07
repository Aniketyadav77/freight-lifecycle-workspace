/**
 * PORTED FROM: fleet-control-tower / src/map/ClusterLayer.tsx
 *
 * Changed: the individual-marker colour is keyed off trip progress instead of
 * on-time/delayed, and the tooltip shows lane and progress instead of speed.
 * Cluster sizing, colouring, keying and click-to-expand are unchanged.
 */

import { divIcon } from "leaflet";
import { CircleMarker, Marker, Tooltip, useMap } from "react-leaflet";

import { isCluster, useLoadClusters } from "./useLoadClusters";
import { CLUSTER_COLOR, STATUS_COLOR } from "../theme";

/** Cluster bubbles grow with the count, but only up to a readable ceiling. */
function clusterDiameter(count: number): number {
  return Math.min(64, 28 + Math.log2(count + 1) * 6);
}

function clusterColor(count: number): string {
  if (count >= 200) return CLUSTER_COLOR.large;
  if (count >= 50) return CLUSTER_COLOR.medium;
  return CLUSTER_COLOR.small;
}

/**
 * The source project coloured a vehicle by on-time/delayed. A load in this
 * project has no delay signal, so the nearest useful equivalent is how far
 * along it is: amber when it has barely left, green as it closes on delivery.
 */
function progressColor(progress: number): string {
  if (progress >= 0.75) return STATUS_COLOR.ok;
  if (progress >= 0.25) return CLUSTER_COLOR.small;
  return STATUS_COLOR.warn;
}

/**
 * Renders whatever the cluster index says is currently visible.
 *
 * Everything here is driven by `features`, which only changes when the index is
 * rebuilt (once per second at most) or the viewport moves. Position ticks
 * arriving in between do not reach this component at all -- see the comment
 * block in useLoadClusters for how that is arranged.
 */
export function ClusterLayer() {
  const map = useMap();
  const { features, getExpansionZoom } = useLoadClusters();

  return (
    <>
      {features.map((feature) => {
        const [lng, lat] = feature.geometry.coordinates as [number, number];

        if (isCluster(feature)) {
          const count = feature.properties.point_count as number;
          const size = clusterDiameter(count);

          return (
            <Marker
              // Cluster ids are stable for a given cell and zoom, so React can
              // reuse the marker between rebuilds instead of tearing it down.
              key={`cluster-${feature.properties.cluster_id}`}
              position={[lat, lng]}
              icon={divIcon({
                html: `<div style="
                  width:${size}px;height:${size}px;border-radius:50%;
                  display:flex;align-items:center;justify-content:center;
                  background:${clusterColor(count)};color:#fff;
                  font:600 12px/1 system-ui,sans-serif;
                  border:2px solid rgba(255,255,255,.9);
                  box-shadow:0 1px 4px rgba(0,0,0,.4);
                ">${feature.properties.point_count_abbreviated}</div>`,
                className: "",
                iconSize: [size, size],
              })}
              eventHandlers={{
                click: () =>
                  map.flyTo([lat, lng], getExpansionZoom(feature.properties.cluster_id as number)),
              }}
            />
          );
        }

        // Individual loads are CircleMarkers rather than icon Markers: they
        // render into Leaflet's vector overlay instead of creating a DOM node
        // each, which matters once a zoomed-in viewport holds a few hundred.
        return (
          <CircleMarker
            key={feature.properties.loadId}
            center={[lat, lng]}
            radius={6}
            pathOptions={{
              color: "#fff",
              weight: 1,
              fillColor: progressColor(feature.properties.progress),
              fillOpacity: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <span className="font-medium">{feature.properties.lane}</span>
              <br />
              {feature.properties.transporterName ?? feature.properties.loadId} —{" "}
              {Math.round(feature.properties.progress * 100)}% of the way
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
