import Link from "next/link";
import { ArrowRight, Beaker, BookOpenCheck, CalendarDays, ClipboardCheck, GraduationCap } from "lucide-react";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";

export const metadata = { title: "Kitchen workspace" };

const tools = [
  { href: "/checks", title: "Kitchen checks", description: "Run daily close-downs, weekly audits and management reviews.", icon: ClipboardCheck },
  { href: "/sops", title: "SOPs & systems", description: "Open live standards, add revisions and manage review dates.", icon: BookOpenCheck },
  { href: "/calendar", title: "Kitchen calendar", description: "View the shared Teamup calendar and configure kitchen links.", icon: CalendarDays },
  { href: "/training", title: "Team training", description: "Record sessions, sign-off and outstanding follow-up.", icon: GraduationCap },
  { href: "/product-development", title: "Product development", description: "Move ideas through trials, costing, training and launch.", icon: Beaker },
];

export default async function KitchenWorkspacePage() {
  await requireGroupWorkspaceRole(["admin", "group_manager"]);
  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Operate</p><h1 className="page-header__title">Kitchen workspace.</h1><p className="page-header__copy">Standards, checks, training, planning and product work in one place.</p></div></header>
      <div className="report-list">
        {tools.map(({ href, title, description, icon: Icon }) => <Link className="report-row report-row--slim" href={href} key={href}><div className="site-cell"><div className="site-cell__mark"><Icon aria-hidden="true" size={17} /></div><div><div className="site-cell__name">{title}</div><div className="site-cell__manager">{description}</div></div></div><ArrowRight aria-hidden="true" size={18} /></Link>)}
      </div>
    </>
  );
}
