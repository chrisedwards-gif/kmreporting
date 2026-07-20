"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, BadgePoundSterling, CalendarRange, ReceiptText, ShoppingBasket, UsersRound } from "lucide-react";
import type { SalesInsights } from "@/lib/reporting/sales-insights";
import { formatCurrency } from "@/lib/utils";

const formatCount = (value: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value);
const trend = (value: number | null) => value === null ? null : value >= 0
  ? <span className="sales-trend sales-trend--up"><ArrowUpRight aria-hidden="true" size={13} /> {value.toFixed(1)}%</span>
  : <span className="sales-trend sales-trend--down"><ArrowDownRight aria-hidden="true" size={13} /> {Math.abs(value).toFixed(1)}%</span>;

export function SalesInsightsPanel({ insights }: { insights: SalesInsights }) {
  if (!insights.available) {
    return <section className="panel empty-state sales-insights-empty"><ReceiptText aria-hidden="true" size={24} /><h2>Detailed sales insight is not available yet.</h2><p>The weekly net-sales total is safe, but this report does not yet have a daily, transaction, cover or product breakdown.</p></section>;
  }

  const dayData = insights.days.map((day) => ({
    name: day.dayLabel.split(" ")[0],
    fullName: day.dayLabel,
    "Net sales": day.netSales,
    Transactions: day.transactions || null,
    Covers: day.covers || null,
  }));
  const categoryData = insights.categories.slice(0, 8).map((category) => ({ name: category.category, Sales: category.netSales, Mix: category.mixPct }));

  return (
    <div className="stack sales-insights">
      <section className="sales-kpi-grid" aria-label="Sales performance KPIs">
        <article className="sales-kpi"><BadgePoundSterling aria-hidden="true" size={18} /><span>ATV</span><strong>{insights.atv === null ? "Not supplied" : formatCurrency(insights.atv, 2)}</strong><small>{trend(insights.atvChangePct)}{insights.previousAtv !== null ? ` previous ${formatCurrency(insights.previousAtv, 2)}` : " sales ÷ transactions"}</small></article>
        <article className="sales-kpi"><ReceiptText aria-hidden="true" size={18} /><span>Transactions</span><strong>{insights.hasTransactions ? insights.totalTransactions.toLocaleString("en-GB") : "Not supplied"}</strong><small>{insights.hasTransactions ? `${formatCount(insights.totalTransactions / Math.max(insights.tradingDays, 1))} average per trading day` : "Upload a report with order count"}</small></article>
        <article className="sales-kpi"><UsersRound aria-hidden="true" size={18} /><span>Average covers</span><strong>{insights.averageDailyCovers === null ? "Not supplied" : formatCount(insights.averageDailyCovers)}</strong><small>{insights.hasCovers ? `${insights.totalCovers.toLocaleString("en-GB")} across ${insights.tradingDays} trading days` : "Cover count not present in source"}</small></article>
        <article className="sales-kpi"><ShoppingBasket aria-hidden="true" size={18} /><span>Sales per cover</span><strong>{insights.salesPerCover === null ? "Not supplied" : formatCurrency(insights.salesPerCover, 2)}</strong><small>{insights.bestSeller ? `Top seller: ${insights.bestSeller.itemName}` : "Net sales ÷ covers"}</small></article>
        <article className="sales-kpi"><CalendarRange aria-hidden="true" size={18} /><span>Average day</span><strong>{insights.averageDailySales === null ? "—" : formatCurrency(insights.averageDailySales)}</strong><small>{insights.bestDay ? `Best: ${insights.bestDay.dayLabel} · ${formatCurrency(insights.bestDay.netSales)}` : "No daily sales"}</small></article>
        <article className="sales-kpi"><ArrowUpRight aria-hidden="true" size={18} /><span>Week-on-week sales</span><strong>{insights.salesChangePct === null ? "No comparison" : `${insights.salesChangePct >= 0 ? "+" : ""}${insights.salesChangePct.toFixed(1)}%`}</strong><small>{insights.previousNetSales === null ? "Previous detailed week unavailable" : `${formatCurrency(insights.totalNetSales)} vs ${formatCurrency(insights.previousNetSales)}`}</small></article>
      </section>

      {insights.hasDailySales ? <section className="panel"><div className="panel__header"><div><h2 className="panel__title">Day-by-day sales</h2><p className="panel__subtitle">Net sales with transactions and covers where the EPOS export supplies them</p></div></div><div className="panel__body"><div className="sales-chart sales-chart--daily" aria-label="Daily net sales, transactions and covers chart"><ResponsiveContainer height="100%" width="100%"><ComposedChart data={dayData} margin={{ left: -12, right: 4, top: 12 }}><CartesianGrid stroke="#e7e1d7" strokeDasharray="3 3" vertical={false} /><XAxis axisLine={false} dataKey="name" fontSize={11} tickLine={false} /><YAxis axisLine={false} fontSize={11} tickFormatter={(value) => `£${Number(value) / 1000}k`} tickLine={false} yAxisId="sales" /><YAxis axisLine={false} fontSize={11} orientation="right" tickLine={false} yAxisId="count" /><Tooltip contentStyle={{ border: "1px solid #ddd8ce", borderRadius: "10px", fontSize: "12px" }} formatter={(value, name) => [name === "Net sales" ? formatCurrency(Number(value)) : Number(value).toLocaleString("en-GB"), name]} labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullName ?? _label} /><Legend iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }} /><Bar dataKey="Net sales" fill="#eb6b4f" radius={[5, 5, 0, 0]} yAxisId="sales" /><Line connectNulls dataKey="Transactions" dot={{ r: 3 }} stroke="#2d7a62" strokeWidth={2} type="monotone" yAxisId="count" /><Line connectNulls dataKey="Covers" dot={{ r: 3 }} stroke="#c78324" strokeWidth={2} type="monotone" yAxisId="count" /></ComposedChart></ResponsiveContainer></div><div className="sales-day-table"><div className="sales-day-table__head"><span>Day</span><span>Sales</span><span>Vs avg</span><span>Orders</span><span>ATV</span><span>Covers</span><span>£ / cover</span></div>{insights.days.map((day) => <div className="sales-day-table__row" key={day.businessDate}><strong>{day.dayLabel}</strong><span>{formatCurrency(day.netSales)}</span><span className={day.salesVsDailyAveragePct !== null && day.salesVsDailyAveragePct < 0 ? "negative" : "positive"}>{day.salesVsDailyAveragePct === null ? "—" : `${day.salesVsDailyAveragePct >= 0 ? "+" : ""}${day.salesVsDailyAveragePct.toFixed(1)}%`}</span><span>{day.transactions || "—"}</span><span>{day.atv === null ? "—" : formatCurrency(day.atv, 2)}</span><span>{day.covers || "—"}</span><span>{day.salesPerCover === null ? "—" : formatCurrency(day.salesPerCover, 2)}</span></div>)}</div></div></section> : null}

      {insights.hasItemMix ? <div className="dashboard-grid dashboard-grid--balanced"><section className="panel"><div className="panel__header"><div><h2 className="panel__title">Category mix</h2><p className="panel__subtitle">Share of captured menu sales</p></div></div><div className="panel__body"><div className="sales-chart sales-chart--category" aria-label="Category sales chart"><ResponsiveContainer height="100%" width="100%"><BarChart data={categoryData} layout="vertical" margin={{ left: 8, right: 24, top: 4 }}><CartesianGrid stroke="#e7e1d7" strokeDasharray="3 3" horizontal={false} /><XAxis axisLine={false} fontSize={11} tickFormatter={(value) => `£${Math.round(Number(value) / 1000)}k`} tickLine={false} type="number" /><YAxis axisLine={false} dataKey="name" fontSize={11} tickLine={false} type="category" width={110} /><Tooltip contentStyle={{ border: "1px solid #ddd8ce", borderRadius: "10px", fontSize: "12px" }} formatter={(value, name, item) => [name === "Sales" ? `${formatCurrency(Number(value))} · ${item.payload.Mix}% mix` : value, name]} /><Bar dataKey="Sales" fill="#2d7a62" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></div></section><section className="panel"><div className="panel__header"><div><h2 className="panel__title">Best-selling items</h2><p className="panel__subtitle">Ranked by net sales; quantity is shown where available</p></div></div><div className="panel__body"><div className="best-seller-list">{insights.items.slice(0, 12).map((item, index) => <div className="best-seller-row" key={`${item.category}-${item.itemName}`}><span className="best-seller-row__rank">{index + 1}</span><div><strong>{item.itemName}</strong><small>{item.category}</small></div><span>{item.quantity ? `${formatCount(item.quantity)} sold` : "Qty n/a"}</span><strong>{formatCurrency(item.netSales)}</strong></div>)}{!insights.items.length ? <div className="empty-inline">The export contains category totals but no item-level sales.</div> : null}</div></div></section></div> : null}

      {insights.weakestDay ? <section className="sales-observation"><strong>Commercial read:</strong> {insights.bestDay ? `${insights.bestDay.dayLabel} was the strongest day at ${formatCurrency(insights.bestDay.netSales)}. ` : ""}{insights.weakestDay.dayLabel} was the weakest trading day at {formatCurrency(insights.weakestDay.netSales)}{insights.weakestDay.salesVsDailyAveragePct !== null ? ` (${Math.abs(insights.weakestDay.salesVsDailyAveragePct).toFixed(1)}% ${insights.weakestDay.salesVsDailyAveragePct < 0 ? "below" : "above"} the daily average)` : ""}.</section> : null}
    </div>
  );
}
