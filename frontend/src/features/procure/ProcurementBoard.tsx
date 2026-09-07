import { LoadSummaryCard } from "../../components/LoadSummaryCard";
import { EmptyState, ErrorState, LoadingState, ViewHeader } from "../../components/ViewState";
import { useBiddingLoads, useFreightStore } from "../../store/useFreightStore";

/**
 * The board is a list, not a workspace. Bidding on a load happens on that
 * load's detail route, so there is one place a load is acted on rather than a
 * side panel here and a separate history page elsewhere.
 */
export function ProcurementBoard() {
  const loads = useBiddingLoads();
  const loading = useFreightStore((state) => state.loading);
  const loadError = useFreightStore((state) => state.loadError);

  return (
    <section>
      <ViewHeader
        title="Procurement board"
        description="Loads open for bidding. Rates update live as transporters bid."
        meta={`${loads.length} open`}
      />

      {loadError ? (
        <ErrorState
          title="Can't reach the freight server"
          body={`${loadError} The API should be running on port 4000 — start it with "npm start" in the server directory, and this board will fill itself in.`}
        />
      ) : loading && loads.length === 0 ? (
        <LoadingState label="Loading the board…" />
      ) : loads.length === 0 ? (
        <EmptyState
          title="Nothing is open for bidding"
          body="Every posted load has been awarded to a transporter. New loads appear here the moment they're posted, and bids stream in live — no refresh needed."
          action={{ to: "/active", label: "See what's already awarded" }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {loads.map((load) => (
            <LoadSummaryCard key={load.id} load={load} />
          ))}
        </div>
      )}
    </section>
  );
}
