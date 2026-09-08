import { useState, type ReactNode } from "react";

/**
 * A chart and its table twin.
 *
 * Every chart here ships with the same numbers as a table, reachable in one
 * click. A tooltip is an enhancement — it should never be the only way to read
 * a value, and a colour-encoded chart alone is not accessible to everyone.
 */
export function ChartCard({
  title,
  subtitle,
  chart,
  table,
  height = 300,
}: {
  title: string;
  subtitle: string;
  chart: ReactNode;
  table: ReactNode;
  /** Must include the x-axis band, not just the plot. */
  height?: number;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="neu-raised rounded-xl p-5">
      {/* No flex-wrap: a long subtitle must not push the toggle onto its own
          line, where it floats in the middle of the card. */}
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-xs text-ink/55">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((shown) => !shown)}
          aria-pressed={showTable}
          className={`neu-toggle shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${
            showTable ? "neu-inset text-accent" : "neu-raised-sm text-ink/65"
          }`}
        >
          {showTable ? "Chart" : "Table"}
        </button>
      </header>

      {/* The plot sits on flat white: the chart palette was validated against a
          white surface, and the neumorphic grey would change every contrast
          result it passed. */}
      {showTable ? (
        <div className="overflow-x-auto rounded-lg bg-card p-1">{table}</div>
      ) : (
        <div className="rounded-lg bg-card p-3" style={{ height }}>
          {chart}
        </div>
      )}
    </section>
  );
}

export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/45">
          {headers.map((header, index) => (
            <th
              key={header}
              className={`px-3 py-2 font-medium ${index === 0 ? "" : "text-right"}`}
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row[0])} className="border-b border-ink/6 last:border-0">
            {row.map((cell, index) => (
              <td
                key={index}
                className={`px-3 py-2 ${
                  index === 0 ? "text-ink/75" : "text-right tabular-nums text-ink"
                }`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
