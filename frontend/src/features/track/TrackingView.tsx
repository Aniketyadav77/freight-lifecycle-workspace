import { Link } from "react-router-dom";

import { RouteLayer } from "./RouteLayer";
import { EmptyState, LoadingState, ViewHeader } from "../../components/ViewState";
import { ShipmentMap, ShipmentTable } from "../../shared-components";
import { useTrackedCount } from "../../shared-components/trackedLoads";
import { useFreightStore } from "../../store/useFreightStore";

/**
 * Stands in for a proof-of-delivery signal — in a real system the driver or
 * consignee closes the trip, not an ops user clicking a button. Delivering the
 * load is what makes the server raise its invoice, so this is the handoff from
 * Tracking to Settlement.
 *
 * Defined at module scope on purpose: `ShipmentTable` passes it into a memo'd
 * row, so an inline component would change identity every render and break the
 * row's memoization.
 */
function RowActions({ loadId }: { loadId: string }) {
  const markDelivered = useFreightStore((state) => state.markDelivered);

  return (
    <span className="flex items-center gap-2">
      <Link
        to={`/loads/${loadId}`}
        className="text-xs font-medium text-accent hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        Detail
      </Link>
      <button
        type="button"
        onClick={() => markDelivered(loadId)}
        className="neu-raised-sm neu-toggle rounded-lg px-2.5 py-1 text-xs font-medium text-ink/75"
      >
        Delivered
      </button>
    </span>
  );
}

export function TrackingView() {
  const tracked = useTrackedCount();
  const loading = useFreightStore((state) => state.loading);
  const connection = useFreightStore((state) => state.connection);
  // Loads awarded but not yet departed, so an empty map can explain itself.
  const awaitingDeparture = useFreightStore(
    (state) => [...state.loads.values()].filter((load) => load.status === "assigned").length,
  );

  if (loading && tracked === 0) {
    return (
      <section>
        <TrackingHeader tracked={0} awaitingDeparture={0} />
        <LoadingState label="Connecting to the tracking stream…" />
      </section>
    );
  }

  if (tracked === 0) {
    return (
      <section>
        <TrackingHeader tracked={0} awaitingDeparture={awaitingDeparture} />
        <EmptyState
          title="Nothing is moving right now"
          body={
            awaitingDeparture > 0
              ? `${awaitingDeparture} load${awaitingDeparture === 1 ? " is" : "s are"} assigned and waiting to depart. They appear on the map about five seconds after assignment, when the driver starts the trip — positions then update every second.`
              : connection === "open"
                ? "Accept a bid on the procurement board and the load departs five seconds later, then shows up here with a live position that updates every second."
                : "Waiting for the tracking stream to connect. Positions will appear as soon as it does."
          }
          action={{
            to: awaitingDeparture > 0 ? "/active" : "/procure",
            label: awaitingDeparture > 0 ? "See what's waiting" : "Go award a load",
          }}
        />
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <TrackingHeader tracked={tracked} awaitingDeparture={awaitingDeparture} />

      <div className="neu-raised overflow-hidden rounded-xl p-4">
        <div className="overflow-hidden rounded-lg">
          <ShipmentMap height={460}>
            <RouteLayer />
          </ShipmentMap>
        </div>
      </div>

      <ShipmentTable action={RowActions} actionLabel="Actions" />
    </section>
  );
}

function TrackingHeader({
  tracked,
  awaitingDeparture,
}: {
  tracked: number;
  awaitingDeparture: number;
}) {
  return (
    <ViewHeader
      title="Tracking"
      description="Live positions for loads in transit, on the Control Tower map and table."
      meta={`${tracked} in transit${awaitingDeparture > 0 ? ` · ${awaitingDeparture} awaiting departure` : ""}`}
    />
  );
}
