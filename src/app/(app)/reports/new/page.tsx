import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReportForm } from "@/components/reports/report-form";
import { getAccessibleSites } from "@/lib/data/reporting";
import { getSessionProfile } from "@/lib/auth/dal";
import { getLatestCompletedReportingWeek } from "@/lib/reporting/periods";

export const metadata = { title: "New weekly report" };

export default async function NewReportPage() {
  const sites = await getAccessibleSites();
  const profile = await getSessionProfile();
  const week = getLatestCompletedReportingWeek();
  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Kitchen submission</p>
          <h1 className="page-header__title">Build the week’s report.</h1>
          <p className="page-header__copy">The app validates the reporting period and required figures before the report enters management review.</p>
        </div>
        <Link className="button button--secondary" href="/reports"><ArrowLeft aria-hidden="true" size={16} /> All reports</Link>
      </header>
      {sites.length ? <ReportForm sites={sites} week={week} /> : (
        <section className="panel empty-state"><h2>No active kitchen is available.</h2><p>{profile?.role === "admin" ? "Create or activate a kitchen before starting its weekly report." : "Ask an administrator to assign you to an active kitchen."}</p>{profile?.role === "admin" ? <Link className="button button--primary" href="/settings/sites">Configure kitchens</Link> : null}</section>
      )}
    </>
  );
}
