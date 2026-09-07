import { Link } from "react-router-dom";

import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, LoadingState, ViewHeader } from "../../components/ViewState";
import { formatDateTime, formatRate } from "../../lib/format";
import {
  useFreightStore,
  useInvoice,
  useLoad,
  useSettlementLoadIds,
  useSettlementSummary,
} from "../../store/useFreightStore";
import { hasMismatch, rateGap } from "../../types";

export function SettlementView() {
  const loadIds = useSettlementLoadIds();
  const { awaiting, mismatched, flagged, exposure } = useSettlementSummary();
  const loading = useFreightStore((state) => state.loading);

  return (
    <section className="space-y-5">
      <ViewHeader
        title="Settlement"
        description="Delivered loads, their invoices, and how those invoices compare to what was contracted."
        meta={`${awaiting} awaiting review${mismatched > 0 ? ` · ${mismatched} mismatched` : ""}${
          flagged > 0 ? ` · ${flagged} flagged` : ""
        }`}
      />

      {mismatched > 0 && (
        <div className="neu-raised flex flex-wrap items-baseline gap-x-2 rounded-xl px-4 py-3 text-sm">
          <span className="font-semibold text-ink">
            {mismatched} invoice{mismatched === 1 ? "" : "s"} differ
            {mismatched === 1 ? "s" : ""} from contract.
          </span>
          <span className="text-ink/65">
            Net exposure{" "}
            <span data-num className="font-semibold text-warn">
              {exposure > 0 ? "+" : ""}
              {formatRate(exposure)}
            </span>{" "}
            against contracted rates.
          </span>
        </div>
      )}

      {loading && loadIds.length === 0 ? (
        <LoadingState label="Loading invoices…" />
      ) : loadIds.length === 0 ? (
        <EmptyState
          title="No invoices to review"
          body="An invoice is raised the moment a load is delivered. Mark one delivered on the tracking board and it lands here within a second, with its contracted and invoiced rates side by side."
          action={{ to: "/track", label: "Go mark a load delivered" }}
        />
      ) : (
        <div className="space-y-4">
          {loadIds.map((loadId) => (
            <InvoiceCard key={loadId} loadId={loadId} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One invoice. Reads its own load and invoice from the store rather than taking
 * them as props, so a position tick elsewhere in the app cannot re-render it.
 */
function InvoiceCard({ loadId }: { loadId: string }) {
  const load = useLoad(loadId);
  const invoice = useInvoice(loadId);
  const resolveInvoice = useFreightStore((state) => state.resolveInvoice);

  if (!load || !invoice) return null;

  const gap = rateGap(invoice);
  const mismatch = hasMismatch(invoice);
  const settled = load.status === "settled";
  const isFlagged = invoice.reviewState === "flagged";

  return (
    <article className={`neu-raised rounded-xl p-5 ${settled ? "opacity-75" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/loads/${loadId}`} className="font-medium text-ink hover:underline">
            {load.origin} <span className="text-ink/35">→</span> {load.destination}
          </Link>
          <p className="mt-0.5 text-xs text-ink/50">
            <span className="font-mono">{invoice.id}</span> · {load.assignedTransporterName} ·
            raised {formatDateTime(invoice.generatedAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isFlagged && (
            <span className="rounded-lg bg-bad/12 px-2 py-0.5 text-xs font-semibold text-bad">
              Flagged for review
            </span>
          )}
          <StatusBadge status={load.status} />
        </div>
      </div>

      {/* The three figures being compared sit on flat white together. */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-lg bg-card p-4">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Figure label="Contracted" value={formatRate(invoice.contractedRate)} />
          <Figure
            label="Invoiced"
            value={formatRate(invoice.invoicedRate)}
            tone={mismatch ? "warn" : "plain"}
          />
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink/45">Difference</dt>
            <dd className="mt-0.5">
              {mismatch ? (
                <span className="inline-flex items-center gap-2">
                  <span className="rounded-lg bg-warn/20 px-2 py-0.5 text-xs font-semibold text-[#8a5a00]">
                    Rate mismatch
                  </span>
                  <span data-num className={`font-semibold ${gap > 0 ? "text-bad" : "text-ok"}`}>
                    {gap > 0 ? "+" : "−"}
                    {formatRate(Math.abs(gap))}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-ok">Matches contract</span>
              )}
            </dd>
          </div>
        </dl>

        {settled ? (
          <p className="text-sm text-ink/50">Settled — approved and closed.</p>
        ) : (
          <div className="flex gap-2">
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
              // Flagging deliberately does not move the load's status: an
              // invoice under dispute is not settled, and the lifecycle says so.
              disabled={isFlagged}
              className="neu-raised-sm neu-toggle rounded-lg px-3.5 py-1.5 text-sm font-medium text-ink/75 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isFlagged ? "Flagged" : "Flag for review"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function Figure({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "warn";
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink/45">{label}</dt>
      <dd
        data-num
        className={`mt-0.5 font-semibold ${tone === "warn" ? "text-warn" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
