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
            <th>Food cost / spend</th>
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
                {formatPercentage(site.foodCostPct)}{site.foodCostBasis === "spend" ? <span className="basis-label">Spend</span> : null}
              </td>
              <td className={classNames(site.labourPct > site.labourTarget && "cost-value--warning")}>
                {formatPercentage(site.labourPct)}
              </td>
              <td className={classNames(site.wastePct > site.wasteTarget && "cost-value--warning")}>
                {formatPercentage(site.wastePct)}
              </td>
              <td><StatusBadge status={site.status} /></td>
              <td>
                {site.reportId ? (
                  <Link aria-label={`Open ${site.name} report`} href={`/reports/${site.reportId}`}>
                    <ChevronRight aria-hidden="true" size={18} />
                  </Link>
                ) : (
                  <span aria-label={`No report yet for ${site.name}`} className="data-table__no-report">—</span>
                )}
              </td>
            </tr>
          ))}
          {!sites.length ? <tr><td colSpan={7}><div className="empty-inline">No weekly cost snapshot is available for this reporting period.</div></td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
