"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ComparisonDailyPoint } from "@/lib/data/comparisons";

const shortDate = (value?: string) => value
  ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
  : "";

export function ComparisonChart({
  current,
  previous,
  priorYear,
}: {
  current: ComparisonDailyPoint[];
  previous: ComparisonDailyPoint[];
  priorYear: ComparisonDailyPoint[];
}) {
  const length = Math.max(current.length, previous.length, priorYear.length);
  if (!length) return <div className="empty-inline">Daily sales will appear here after a report includes dated EPOS totals.</div>;

  const data = Array.from({ length }, (_, index) => ({
    label: current[index]?.businessDate ? shortDate(current[index].businessDate) : `Day ${index + 1}`,
    current: current[index]?.netSales ?? null,
    previous: previous[index]?.netSales ?? null,
    priorYear: priorYear[index]?.netSales ?? null,
  }));

  return (
    <div className="comparison-chart" aria-label="Daily net sales compared with the previous equivalent period and prior year">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart data={data} margin={{ left: 4, right: 16, top: 12, bottom: 2 }}>
          <CartesianGrid stroke="#e7e1d7" strokeDasharray="3 3" vertical={false} />
          <XAxis axisLine={false} dataKey="label" fontSize={11} tickLine={false} />
          <YAxis axisLine={false} fontSize={11} tickFormatter={(value) => `£${Math.round(Number(value) / 100) * 100}`} tickLine={false} width={54} />
          <Tooltip
            contentStyle={{ border: "1px solid #ddd8ce", borderRadius: "10px", fontSize: "12px" }}
            formatter={(value, name) => [value == null ? "No data" : `£${Number(value).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`, name]}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }} />
          <Line connectNulls={false} dataKey="current" dot={{ r: 3 }} name="Selected period" stroke="#0e2b21" strokeWidth={3} type="monotone" />
          <Line connectNulls={false} dataKey="previous" dot={false} name="Previous equivalent" stroke="#eb6b4f" strokeDasharray="5 4" strokeWidth={2} type="monotone" />
          <Line connectNulls={false} dataKey="priorYear" dot={false} name="Same period last year" stroke="#8a6b23" strokeDasharray="2 4" strokeWidth={2} type="monotone" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
