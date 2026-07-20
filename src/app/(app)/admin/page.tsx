import Link from "next/link";
import { ArrowRight, BellRing, MessageSquareText, Settings2, UserRoundCog } from "lucide-react";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";

export const metadata = { title: "Administration" };

export default async function AdministrationPage() {
  const profile = await requireGroupWorkspaceRole(["admin", "group_manager"]);
  const tools = [
    { href: "/messages", title: "Team messages", description: "Write immediate or scheduled messages for kitchens and named managers.", icon: MessageSquareText, visible: true },
    { href: "/notifications", title: "Email & notifications", description: "Test delivery, inspect failures and confirm the live email configuration.", icon: BellRing, visible: true },
    { href: "/performance/managers", title: "People & access", description: "Invite managers and reporting viewers, manage login status and ownership.", icon: UserRoundCog, visible: profile.capabilities.admin },
    { href: "/settings/sites", title: "Sites & access", description: "Create kitchens and assign managers across one or more sites.", icon: Settings2, visible: profile.capabilities.admin },
  ].filter((tool) => tool.visible);

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Admin</p><h1 className="page-header__title">Administration.</h1><p className="page-header__copy">Invites, kitchen access, communications and delivery settings without crowding the daily operating navigation.</p></div></header>
      <div className="report-list">
        {tools.map(({ href, title, description, icon: Icon }) => <Link className="report-row report-row--slim" href={href} key={href}><div className="site-cell"><div className="site-cell__mark"><Icon aria-hidden="true" size={17} /></div><div><div className="site-cell__name">{title}</div><div className="site-cell__manager">{description}</div></div></div><ArrowRight aria-hidden="true" size={18} /></Link>)}
      </div>
    </>
  );
}
