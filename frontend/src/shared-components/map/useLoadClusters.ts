/**
 * PORTED FROM: fleet-control-tower / src/map/useVehicleClusters.ts
 *
 * Changed: the feature properties (vehicle id/speed/status -> load id/lane/
 * progress) and the source of positions (fleet store -> trackedLoads adapter).
 * The clustering scheme below — index/query split, dirty-flag subscription,
 * throttled rebuild — is unchanged, and the original rationale is preserved
 * verbatim because it is the reason this hook is shaped the way it is.
 *
 * ---------------------------------------------------------------------------
 * Why supercluster rather than leaflet.markercluster
 * ---------------------------------------------------------------------------
 * Both cluster markers; they differ in what they consider the unit of work, and
 * that difference decides the whole design for a fleet that never stops moving.
 *
 * leaflet.markercluster owns a live layer of real Leaflet Marker objects. It is
 * the more turnkey option -- spiderfying, cluster animations, and hover
 * outlines come for free. But its cost model is tied to mutating that layer:
 * moving 500 markers each tick means either removing and re-adding them (a full
 * re-cluster plus 500 DOM operations) or calling refreshClusters(), which still
 * walks the layer. The library is built for marker sets that are added once and
 * then panned around, not for a set whose every member changes position every
 * second.
 *
 * supercluster is not a Leaflet plugin at all. It is a pure spatial index: you
 * hand it plain GeoJSON points, it builds a KD-tree per zoom level, and you
 * query it for a bounding box and zoom. It touches no DOM and knows nothing
 * about Leaflet. That buys the two things this app needs:
 *
 *  1. Clustering becomes a cheap pure function of (positions, bbox, zoom), so
 *     we can decide exactly when to recompute rather than having a layer
 *     recompute itself whenever we touch it.
 *  2. We only ever render the clusters and points the viewport actually
 *     contains. At country zoom, 500 vehicles become a handful of Markers
 *     instead of 500 hidden ones.
 *
 * The cost is that we render the markers ourselves and lose the free
 * spiderfying. For this dashboard that is the right trade; if the product
 * later needs to expand overlapping markers at max zoom, that is a feature to
 * add rather than a reason to change engines.
 *
 * ---------------------------------------------------------------------------
 * How recomputation is avoided on every position tick
 * ---------------------------------------------------------------------------
 * There are two distinct operations here and they are throttled differently,
 * which is the point of the whole hook:
 *
 *   index.load(points)  -- rebuilds the KD-tree. Depends on load positions.
 *   index.getClusters() -- queries it. Depends on the viewport.
 *
 * Positions change on every server tick and would otherwise drive a rebuild
 * each time. Three things prevent that:
 *
 *   a. This hook does NOT subscribe to the store reactively. It uses a vanilla
 *      subscription to set a dirty flag, which triggers no React render at all.
 *      If it selected the loads map instead, the map would re-render on every
 *      frame before any throttling could help.
 *   b. A single interval at REBUILD_INTERVAL_MS is the only thing that rebuilds
 *      the index, and it rebuilds only when the dirty flag is set. Position
 *      updates arriving between ticks are coalesced for free; a fleet that
 *      stopped moving costs nothing.
 *   c. Panning and zooming re-run only the query, never the rebuild. The index
 *      is still valid -- the loads did not move because the user dragged the
 *      map -- so moveend/zoomend cost one bbox query, not a re-index.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import Supercluster, {
  type AnyProps,
  type ClusterFeature,
  type PointFeature,
} from "supercluster";

import { getTrackedLoads, subscribeTracked, type TrackedLoad } from "../trackedLoads";

/**
 * How often the index may be rebuilt. The server ticks once per second, so
 * rebuilding faster than this would re-index positions that have not changed.
 */
const REBUILD_INTERVAL_MS = 1000;

/** Cluster radius in pixels. 60 is supercluster's default and reads well here. */
const CLUSTER_RADIUS_PX = 60;

/** Past this zoom, show individual loads rather than clusters. */
const CLUSTER_MAX_ZOOM = 16;

export interface LoadProperties {
  loadId: string;
  lane: string;
  /** 0-1 along the lane. */
  progress: number;
  transporterName: string | null;
}

/**
 * A query result is either one load or one cluster. supercluster types the
 * cluster half as AnyProps because a cluster carries aggregate properties
 * (point_count and friends), not the properties of the points inside it.
 */
export type LoadFeature = PointFeature<LoadProperties> | ClusterFeature<AnyProps>;

export function isCluster(feature: LoadFeature): feature is ClusterFeature<AnyProps> {
  return "cluster" in feature.properties && feature.properties.cluster === true;
}

function toFeature(load: TrackedLoad): PointFeature<LoadProperties> {
  return {
    type: "Feature",
    properties: {
      loadId: load.id,
      lane: `${load.origin} → ${load.destination}`,
      progress: load.progress,
      transporterName: load.assignedTransporterName,
    },
    geometry: {
      type: "Point",
      // GeoJSON is [lng, lat]. Leaflet is [lat, lng]. Getting this backwards
      // silently drops every load into the Indian Ocean.
      coordinates: [load.position.lng, load.position.lat],
    },
  };
}

export interface LoadClusters {
  features: LoadFeature[];
  /** The zoom at which a given cluster breaks apart, for click-to-expand. */
  getExpansionZoom(clusterId: number): number;
}

export function useLoadClusters(): LoadClusters {
  const map = useMap();

  const indexRef = useRef<Supercluster<LoadProperties> | null>(null);
  const [features, setFeatures] = useState<LoadFeature[]>([]);

  // Set by the store subscription, cleared by the rebuild interval. A ref, not
  // state, because flipping it must never cause a render.
  const isDirtyRef = useRef(true);

  /**
   * Query only. Cheap enough to run on every pan and zoom: it walks the
   * existing tree for the current bbox and returns what is visible.
   */
  const query = useCallback(() => {
    const index = indexRef.current;
    if (!index) return;

    const bounds = map.getBounds();
    setFeatures(
      index.getClusters(
        [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        Math.round(map.getZoom()),
      ),
    );
  }, [map]);

  /** Rebuild the index from the store's current positions, then re-query. */
  const rebuild = useCallback(() => {
    const loads = getTrackedLoads();

    const index =
      indexRef.current ??
      new Supercluster<LoadProperties>({
        radius: CLUSTER_RADIUS_PX,
        maxZoom: CLUSTER_MAX_ZOOM,
      });

    index.load([...loads.values()].map(toFeature));
    indexRef.current = index;

    query();
  }, [query]);

  // Non-reactive store subscription: marks work as pending without rendering.
  useEffect(
    () =>
      subscribeTracked(() => {
        isDirtyRef.current = true;
      }),
    [],
  );

  useEffect(() => {
    rebuild();

    const timer = setInterval(() => {
      if (!isDirtyRef.current) return;
      isDirtyRef.current = false;
      rebuild();
    }, REBUILD_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [rebuild]);

  // Viewport changes re-query the existing index; they never rebuild it.
  useMapEvents({ moveend: query, zoomend: query });

  const getExpansionZoom = useCallback(
    (clusterId: number) => indexRef.current?.getClusterExpansionZoom(clusterId) ?? 0,
    [],
  );

  return { features, getExpansionZoom };
}
