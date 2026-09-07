import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

import { LifecycleTimeline } from "./LifecycleTimeline";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, LoadingState } from "../../components/ViewState";
import { BidPanel } from "../procure/BidPanel";
import { formatDate, formatRate, formatWeight } from "../../lib/format";
import { useBidsForLoad, useFreightStore, useInvoice, useLoad } from "../../store/useFreightStore";
import { hasMismatch, rateGap, type LoadStatus } from "../../types";

/** Which module owns a load at each stage — the "you are here" of the workspace. */
const HOME_MODULE: Record<LoadStatus, { to: string; label: string }> = {
  posted: { to: "/procure", label: "Procurement" },
  bidding: { to: "/procure", label: "Procurement" },
  assigned: { to: "/active", label: "Active Shipments" },
  in_transit: { to: "/track", label: "Tracking" },
  delivered: { to: "/settle", label: "Settlement" },
  settled: { to: "/settle", label: "Settlement" },
};

export function LoadDetail() {
  const { id = "" } = useParams();
  const load = useLoad(id);
  const bids = useBidsForLoad(id);
  const invoice = useInvoice(id);
  const loading = useFreightStore((state) => state.loading);
  const selectLoad = useFreightStore((state) => state.selectLoad);

  // Subscribing to this load's bid stream is the only side effect here. All the
  // data below already lives in the shared store; nothing on this route fetches.
  useEffect(() => {
    if (id) selectLoad(id);
    return () => selectLoad(null);
  }, [id, selectLoad]);

  if (!load) {
    return loading ? (
      <LoadingState label="Loading this load…" />
    ) : (
      <EmptyState
        title={`No load with id “${id}”`}
        body="It may have been created before the last server restart — this demo keeps everything in memory, so restarting reseeds the book from scratch."
        action={{ to: "/procure", label: "Back to the procurement board" }}
      />
    );
  }

  const home = HOME_MODULE[load.status];

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-2 text-sm text-ink/50">
        <Link to={home.to} className="hover:text-ink hover:underline">
          {home.label}
        </Link>
        <span aria-hidden>/</span>
        <span className="font-mono text-xs text-ink/40">{load.id}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">
            {load.origin} <span className="text-ink/35">→</span> {load.destination}
          </h1>
          <p className="mt-1 text-sm text-ink/55">
            {formatWeight(load.weight)} · pickup {formatDate(load.pickupDate)}
            {load.assignedTransporterName && ` · ${load.assignedTransporterName}`}
          </p>
        </div>
        <StatusBadge status={load.status} />
      </header>

      <dl className="neu-raised grid grid-cols-2 gap-px overflow-hidden rounded-xl p-4 sm:grid-cols-4">
        <Fact
          label="Contracted"
          value={load.contractedRate === null ? "—" : formatRate(load.contractedRate)}
        />
        <Fact label="Invoiced" value={invoice ? formatRate(invoice.invoicedRate) : "—"} />
        <Fact
          label="Difference"
          value={
            invoice && hasMismatch(invoice)
              ? `${rateGap(invoice) > 0 ? "+" : "−"}${formatRate(Math.abs(rateGap(invoice)))}`
              : invoice
                ? "None"
                : "—"
          }
          tone={invoice && hasMismatch(invoice) ? "warn" : "plain"}
        />
        <Fact
          label="Progress"
          value={load.status === "in_transit" ? `${Math.round(load.progress * 100)}%` : "—"}
        />
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="neu-raised rounded-xl p-5">
          <h2 className="mb-5 text-sm font-semibold text-ink">Lifecycle</h2>
          <LifecycleTimeline load={load} bids={bids} invoice={invoice} />
        </section>

        <div className="space-y-4">
          <StageActions loadId={load.id} />
          {load.status === "bidding" && <BidPanel load={load} />}
        </div>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "warn";
}) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-ink/45">{label}</dt>
      <dd
        data-num
        className={`mt-1 font-semibold ${tone === "warn" ? "text-warn" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Whatever this load can have done to it right now. The state machine decides
 * what appears, so the detail route never offers an action the server would
 * refuse.
 */
function StageActions({ loadId }: { loadId: string }) {
  const load = useLoad(loadId);
  const invoice = useInvoice(loadId);
  const markDelivered = useFreightStore((state) => state.markDelivered);
  const resolveInvoice = useFreightStore((state) => state.resolveInvoice);

  if (!load) return null;

  if (load.status === "in_transit") {
    return (
      <ActionCard hint="Stands in for a proof-of-delivery signal from the driver.">
        <button
          type="button"
          onClick={() => markDelivered(loadId)}
          className="neu-raised-sm neu-toggle rounded-lg px-3.5 py-1.5 text-sm font-medium text-accent"
        >
          Mark as delivered
        </button>
      </ActionCard>
    );
  }

  if (load.status === "delivered" && invoice) {
    const flagged = invoice.reviewState === "flagged";
    return (
      <ActionCard
        hint={
          hasMismatch(invoice)
            ? "This invoice does not match the contracted rate."
            : "This invoice matches the contracted rate."
        }
      >
        <button
          type="button"
          onClick={() => resolveInvoice(loadId, "approve")}
          className="neu-raised-sm neu-toggle rounded-lg px-3.5 py-1.5 text-sm font-medium text-accent"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => resolveInvoice(loadId, "flag")}
          disabled={flagged}
          className="neu-raised-sm neu-toggle rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink/75 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {flagged ? "Flagged" : "Flag for review"}
        </button>
      </ActionCard>
    );
  }

  return null;
}

function ActionCard({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <div className="neu-raised rounded-xl p-4">
      <p className="text-xs text-ink/55">{hint}</p>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
