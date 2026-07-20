import Link from "next/link";
import { ArrowRight, ListChecks, Scale, UsersRound } from "lucide-react";
import { requireRole } from "@/lib/auth/dal";

export const metadata = { title: "People & performance" };

export default async function PeoplePerformancePage() {
  await requireRole(["admin", "group_manager"]);
  const tools = [
    { href: "/one-to-ones", title: "Manager 1-1s", description: "Open drafts, review history, KPI evidence and agreed actions.", icon: UsersRound },
    { href: "/performance/actions", title: "Master action log", description: "Track every open, overdue and completed management action.", icon: ListChecks },
    { href: "/performance/probation", title: "Probation", description: "Manage structured reviews, scores and development evidence.", icon: Scale },
  ];

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Perform</p><h1 className="page-header__title">People & performance.</h1><p className="page-header__copy">One route into manager development, accountability and follow-up.</p></div></header>
      <div className="report-list">
        {tools.map(({ href, title, description, icon: Icon }) => <Link className="report-row report-row--slim" href={href} key={href}><div className="site-cell"><div className="site-cell__mark"><Icon aria-hidden="true" size={17} /></div><div><div className="site-cell__name">{title}</div><div className="site-cell__manager">{description}</div></div></div><ArrowRight aria-hidden="true" size={18} /></Link>)}
      </div>
    </>
  );
}
