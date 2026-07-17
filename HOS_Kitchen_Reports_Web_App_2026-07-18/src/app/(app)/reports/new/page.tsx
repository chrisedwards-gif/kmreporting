import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReportForm } from "@/components/reports/report-form";
import { getAccessibleSites } from "@/lib/data/reporting";

export const metadata = { title: "New weekly report" };

export default async function NewReportPage() {
  const sites = await getAccessibleSites();
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
      <ReportForm sites={sites} />
    </>
  );
}
