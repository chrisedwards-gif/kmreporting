import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SitePerformance } from "@/lib/types";
import { classNames, formatCurrency, formatPercentage } from "@/lib/utils";

export function SitePerformanceTable({ sites }: { sites: SitePerformance[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Kitchen</th>
            <th>Net sales</th>
            <th>Food</th>
            <th>Labour</th>
            <th>Waste</th>
            <th>Status</th>
            <th aria-label="Open report" />
          </tr>
        </thead>
        <tbody>
          {sites.map((site) => (
            <tr key={site.id}>
              <td>
                <div className="site-cell">
                  <div className="site-cell__mark">{site.code.slice(0, 2)}</div>
                  <div>
                    <div className="site-cell__name">{site.name}</div>
                    <div className="site-cell__manager">{site.manager}</div>
                  </div>
                </div>
              </td>
              <td>{formatCurrency(site.netSales)}</td>
              <td className={classNames(site.foodCostPct > site.foodCostTarget && "cost-value--warning")}>
                {formatPercentage(site.foodCostPct)}
              </td>
              <td className={classNames(site.labourPct > site.labourTarget && "cost-value--warning")}>
                {formatPercentage(site.labourPct)}
              </td>
              <td className={classNames(site.wastePct > site.wasteTarget && "cost-value--warning")}>
                {formatPercentage(site.wastePct)}
              </td>
              <td><StatusBadge status={site.status} /></td>
              <td>
                <Link aria-label={`Open ${site.name} report`} href={`/reports/${site.reportId ?? site.id}`}>
                  <ChevronRight aria-hidden="true" size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
