"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SitePerformance } from "@/lib/types";

export function CostChart({ sites }: { sites: SitePerformance[] }) {
  const data = sites.map((site) => ({
    name: site.name,
    "Food cost": Number(site.foodCostPct.toFixed(1)),
    Labour: Number(site.labourPct.toFixed(1)),
  }));

  return (
    <div className="chart-wrap" aria-label="Food and labour cost percentages by site">
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={data} margin={{ left: -16, right: 6, top: 8 }}>
          <CartesianGrid stroke="#e7e1d7" strokeDasharray="3 3" vertical={false} />
          <XAxis axisLine={false} dataKey="name" fontSize={11} tickLine={false} />
          <YAxis axisLine={false} domain={[0, 40]} fontSize={11} tickFormatter={(value) => `${value}%`} tickLine={false} />
          <Tooltip
            contentStyle={{ border: "1px solid #ddd8ce", borderRadius: "10px", fontSize: "12px" }}
            formatter={(value) => [`${Number(value).toFixed(1)}%`]}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "12px" }} />
          <Bar dataKey="Food cost" fill="#eb6b4f" radius={[5, 5, 0, 0]} />
          <Bar dataKey="Labour" fill="#2d7a62" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
