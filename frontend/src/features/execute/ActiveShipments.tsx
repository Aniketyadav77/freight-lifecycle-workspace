import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, LoadingState, ViewHeader } from "../../components/ViewState";
import { formatDate, formatRate, formatWeight } from "../../lib/format";
import { useActiveShipments, useFreightStore } from "../../store/useFreightStore";
import type { Load } from "../../types";

export function ActiveShipments() {
  const shipments = useActiveShipments();
  const loading = useFreightStore((state) => state.loading);
  const inTransit = shipments.filter((load) => load.status === "in_transit").length;

  return (
    <section>
      <ViewHeader
        title="Active shipments"
        description="Awarded loads, from assignment through to delivery."
        meta={`${shipments.length} active · ${inTransit} moving`}
      />

      {loading && shipments.length === 0 ? (
        <LoadingState label="Loading shipments…" />
      ) : shipments.length === 0 ? (
        <EmptyState
          title="Nothing is on the road"
          body="Loads land here the moment a bid is accepted. Award one on the procurement board and it'll show up as assigned, then depart on its own five seconds later."
          action={{ to: "/procure", label: "Go award a load" }}
        />
      ) : (
        <div className="neu-raised overflow-hidden rounded-xl p-4">
          {/* Rows sit on flat white — their status and rate change under the
              reader, and soft edges make live text harder to read, not softer. */}
          <div className="overflow-x-auto rounded-lg bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/8 text-left text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  <th className="px-5 py-3">Lane</th>
                  <th className="px-5 py-3">Transporter</th>
                  <th className="px-5 py-3 text-right">Contracted rate</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {shipments.map((load) => (
                  <ShipmentRow key={load.id} load={load} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ShipmentRow({ load }: { load: Load }) {
  const justChanged = useStatusFlash(load.status);

  return (
    <tr
      className={`border-b border-ink/6 transition-colors duration-700 last:border-0 ${
        justChanged ? "bg-accent/8" : "bg-card"
      }`}
    >
      <td className="px-5 py-4">
        <Link to={`/loads/${load.id}`} className="group">
          <p className="font-medium text-ink group-hover:underline">
            {load.origin} <span className="text-ink/35">→</span> {load.destination}
          </p>
          <p className="mt-0.5 text-xs text-ink/50">
            {formatWeight(load.weight)} · pickup {formatDate(load.pickupDate)} ·{" "}
            <span className="font-mono">{load.id}</span>
          </p>
        </Link>
      </td>

      <td className="px-5 py-4">
        <p className="text-ink/80">{load.assignedTransporterName ?? "—"}</p>
        {load.assignedTransporterId && (
          <p className="mt-0.5 font-mono text-xs text-ink/40">{load.assignedTransporterId}</p>
        )}
      </td>

      <td data-num className="px-5 py-4 text-right font-semibold text-ink">
        {load.contractedRate === null ? "—" : formatRate(load.contractedRate)}
      </td>

      <td className="px-5 py-4">
        <span className="flex items-center gap-2">
          <StatusBadge status={load.status} />
          {justChanged && (
            <span className="text-xs font-medium text-accent">just updated</span>
          )}
        </span>
      </td>
    </tr>
  );
}

/**
 * Briefly flags a row whose status changed under it. Purely presentational
 * timing, so it lives in the component — the status itself comes from the
 * store, and this never writes back to it.
 */
function useStatusFlash(status: string, ms = 4_000) {
  const [flash, setFlash] = useState(false);
  const previous = useRef(status);

  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), ms);
    return () => clearTimeout(timer);
  }, [status, ms]);

  return flash;
}
