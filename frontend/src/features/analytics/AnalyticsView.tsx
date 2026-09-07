import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard, DataTable } from "./ChartCard";
import { AXIS_TICK, VIZ } from "./viz";
import { EmptyState, ViewHeader } from "../../components/ViewState";
import { cityOf, formatRate, formatRateCompact } from "../../lib/format";
import { useFreightAnalytics } from "../../store/analytics";

const shortLane = (origin: string, destination: string) =>
  `${cityOf(origin)} → ${cityOf(destination)}`;

// Recharts hands formatters a loose value type, so these take `unknown` and
// coerce rather than asserting a shape the library does not promise.
const money = (value: unknown) => formatRate(Number(value));
const moneyCompact = (value: unknown) => formatRateCompact(Number(value));
const percent = (value: unknown) => `${Number(value)}%`;

export function AnalyticsView() {
  const { settledCount, totalSpend, laneCosts, onTime, variance, avgVariance } =
    useFreightAnalytics();

  if (settledCount === 0) {
    return (
      <section>
        <Header settledCount={0} />
        <EmptyState
          title="No settled loads to analyse yet"
          body="These charts are built from the settled book — lane costs, on-time rate and rate variance all need closed shipments. Approve an invoice in Settlement and the first data point lands here immediately."
          action={{ to: "/settle", label: "Go review an invoice" }}
        />
      </section>
    );
  }

  const laneData = laneCosts.map((lane) => ({
    ...lane,
    short: shortLane(lane.origin, lane.destination),
  }));

  const onTimeData = onTime.byLane.map((lane) => {
    const [origin = "", destination = ""] = lane.lane.split(" → ");
    return { ...lane, short: shortLane(origin, destination) };
  });

  return (
    <section className="space-y-5">
      <Header settledCount={settledCount} />

      {/* The headline figures are numbers, not charts — a single value does not
          need a plot to be read. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Settled loads" value={String(settledCount)} />
        <StatTile label="Total spend" value={formatRate(totalSpend)} />
        <StatTile
          label="On-time delivery"
          value={`${onTime.onTimePct}%`}
          note={`${onTime.onTime} of ${onTime.delivered} by due date`}
        />
        <StatTile
          label="Avg rate variance"
          value={`${avgVariance > 0 ? "+" : ""}${formatRate(avgVariance)}`}
          note={avgVariance > 0 ? "billed over contract" : "at or under contract"}
          tone={avgVariance > 0 ? "warn" : "good"}
        />
      </div>

      <ChartCard
        title="Cost per lane"
        subtitle="Total settled spend by origin–destination pair, dearest first."
        height={Math.max(220, laneData.length * 38 + 40)}
        chart={
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={laneData}
              layout="vertical"
              margin={{ top: 4, right: 72, bottom: 4, left: 4 }}
              barCategoryGap={2}
            >
              <CartesianGrid horizontal={false} stroke={VIZ.grid} />
              <XAxis
                type="number"
                tickFormatter={formatRateCompact}
                tick={AXIS_TICK}
                axisLine={{ stroke: VIZ.axis }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="short"
                width={165}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(11,11,11,0.04)" }}
                formatter={(value: unknown) => [money(value), "Total spend"] as [string, string]}
                contentStyle={TOOLTIP_STYLE}
              />
              {/* One series, one colour for every bar. Colouring bars by their
                  own value would double-encode length as hue. */}
              <Bar
                dataKey="totalSpend"
                fill={VIZ.series1}
                radius={[0, 4, 4, 0]}
                barSize={18}
                label={{
                  position: "right",
                  formatter: moneyCompact,
                  fill: VIZ.ink,
                  fontSize: 11,
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        }
        table={
          <DataTable
            headers={["Lane", "Shipments", "Total spend", "Avg / load", "Avg / tonne"]}
            rows={laneData.map((lane) => [
              lane.short,
              lane.shipments,
              formatRate(lane.totalSpend),
              formatRate(lane.avgCost),
              formatRate(lane.avgCostPerTonne),
            ])}
          />
        }
      />

      <ChartCard
        title="On-time delivery by lane"
        subtitle="Share of shipments delivered on or before the lane's due date. Worst lanes first."
        height={Math.max(220, onTimeData.length * 38 + 40)}
        chart={
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={onTimeData}
              layout="vertical"
              margin={{ top: 4, right: 56, bottom: 4, left: 4 }}
              barCategoryGap={2}
            >
              <CartesianGrid horizontal={false} stroke={VIZ.grid} />
              <XAxis
                type="number"
                domain={[0, 100]}
                unit="%"
                tick={AXIS_TICK}
                axisLine={{ stroke: VIZ.axis }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="short"
                width={165}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(11,11,11,0.04)" }}
                formatter={(value: unknown) => [percent(value), "On time"] as [string, string]}
                contentStyle={TOOLTIP_STYLE}
              />
              <Bar
                dataKey="onTimePct"
                fill={VIZ.series1}
                radius={[0, 4, 4, 0]}
                barSize={18}
                label={{
                  position: "right",
                  formatter: percent,
                  fill: VIZ.ink,
                  fontSize: 11,
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        }
        table={
          <DataTable
            headers={["Lane", "Shipments", "On time", "On-time %"]}
            rows={onTimeData.map((lane) => [
              lane.short,
              lane.shipments,
              lane.onTime,
              `${lane.onTimePct}%`,
            ])}
          />
        }
      />

      <ChartCard
        title="Bid vs actual variance"
        subtitle="Invoiced minus contracted, per settlement. The running average is the trend that matters — a single odd invoice is noise."
        height={320}
        chart={
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={variance} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid vertical={false} stroke={VIZ.grid} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                axisLine={{ stroke: VIZ.axis }}
                tickLine={false}
              />
              {/* One axis: both series are rupees, so they share a scale. */}
              <YAxis
                tickFormatter={formatRateCompact}
                tick={AXIS_TICK}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value: unknown, name: unknown) =>
                  [money(value), String(name)] as [string, string]
                }
                labelFormatter={(label: unknown) => `Settled ${String(label)}`}
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend
                verticalAlign="top"
                align="left"
                height={28}
                iconType="plainline"
                wrapperStyle={{ fontSize: 12, color: VIZ.ink }}
              />
              <Line
                type="monotone"
                dataKey="variance"
                name="Per-load variance"
                stroke={VIZ.series2}
                strokeWidth={2}
                dot={{ r: 3, strokeWidth: 0, fill: VIZ.series2 }}
                activeDot={{ r: 5, stroke: VIZ.surface, strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="runningAvgVariance"
                name="Running average"
                stroke={VIZ.series1}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, stroke: VIZ.surface, strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        }
        table={
          <DataTable
            headers={["Load", "Lane", "Contracted", "Invoiced", "Variance", "Running avg"]}
            rows={variance.map((point) => [
              point.loadId,
              point.lane,
              formatRate(point.contractedRate),
              formatRate(point.invoicedRate),
              `${point.variance > 0 ? "+" : ""}${formatRate(point.variance)}`,
              formatRate(point.runningAvgVariance),
            ])}
          />
        }
      />
    </section>
  );
}

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid rgba(11,11,11,0.10)",
  fontSize: 12,
  boxShadow: "0 2px 8px rgba(11,11,11,0.08)",
} as const;

function Header({ settledCount }: { settledCount: number }) {
  return (
    <ViewHeader
      title="Analytics"
      description="Derived from the settled book in the shared store — no separate reporting query."
      meta={`${settledCount} settled`}
    />
  );
}

function StatTile({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "good" | "warn";
}) {
  return (
    <div className="neu-raised rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-ink/45">{label}</p>
      {/* Proportional figures, not tabular: equal-width digits make a large
          standalone number look loose. */}
      <p
        className={`mt-1 text-2xl font-semibold ${
          tone === "warn" ? "text-warn" : tone === "good" ? "text-ok" : "text-ink"
        }`}
      >
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-ink/50">{note}</p>}
    </div>
  );
}
