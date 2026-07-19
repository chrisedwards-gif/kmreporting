"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  BellRing,
  Beaker,
  BookOpenCheck,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  GraduationCap,
  ListChecks,
  LockKeyhole,
  LogOut,
  Menu,
  Scale,
  Settings2,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react";
import { classNames } from "@/lib/utils";
import type { AppRole } from "@/lib/types";
import { LiveReportingStatus } from "@/components/live-reporting-status";
import { signOut } from "@/app/actions/auth";

type NavItem = { href: string; label: string; icon: typeof BarChart3; roles?: AppRole[] };
const operationalRoles: AppRole[] = ["admin", "group_manager", "finance", "viewer", "kitchen_manager"];

const navSections: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "Operate",
    items: [
      { href: "/dashboard", label: "Overview", icon: BarChart3 },
      { href: "/reports", label: "Weekly reports", icon: ClipboardList },
      { href: "/approvals", label: "Approvals", icon: ShieldCheck, roles: ["admin", "group_manager"] },
      { href: "/checks", label: "Kitchen checks", icon: ClipboardCheck, roles: operationalRoles },
      { href: "/sops", label: "SOPs & systems", icon: BookOpenCheck, roles: operationalRoles },
    ],
  },
  {
    heading: "Perform",
    items: [
      { href: "/one-to-ones", label: "Manager 1-1s", icon: UsersRound, roles: operationalRoles },
      { href: "/performance/actions", label: "Action log", icon: ListChecks, roles: operationalRoles },
      { href: "/training", label: "Team training", icon: GraduationCap, roles: operationalRoles },
      { href: "/performance/probation", label: "Probation", icon: Scale, roles: ["admin", "group_manager", "finance", "viewer"] },
      { href: "/product-development", label: "Product development", icon: Beaker, roles: operationalRoles },
    ],
  },
  {
    heading: "Insight",
    items: [
      { href: "/summary", label: "Management summary", icon: FileCheck2, roles: ["admin", "group_manager", "finance", "viewer"] },
      { href: "/costs", label: "Cost control", icon: LockKeyhole, roles: ["admin", "group_manager", "finance"] },
    ],
  },
  {
    heading: "Admin",
    items: [
      { href: "/performance/managers", label: "Manager admin", icon: UserRoundCog, roles: ["admin"] },
      { href: "/settings/sites", label: "Sites & access", icon: Settings2, roles: ["admin"] },
      { href: "/notifications", label: "Notifications", icon: BellRing, roles: ["admin", "group_manager"] },
    ],
  },
];

export function AppShell({ children, isDemo, isPreview, user }: { children: React.ReactNode; isDemo: boolean; isPreview: boolean; user: { fullName: string; role: AppRole } }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className={classNames("app-shell__sidebar", navOpen && "app-shell__sidebar--open")}>
        <div className="app-shell__brand"><div className="app-shell__brand-mark"><ChefHat aria-hidden="true" size={25} /></div><div className="app-shell__brand-copy"><strong>HOS Kitchen Reports</strong><span>Weekly operations</span></div></div>
        <nav aria-label="Main navigation" className="app-shell__nav">
          {navSections.map((section) => {
            const visibleItems = section.items.filter((item) => !item.roles || item.roles.includes(user.role));
            if (!visibleItems.length) return null;
            return <div className="app-shell__nav-section" key={section.heading}><div className="app-shell__nav-heading">{section.heading}</div>{visibleItems.map(({ href, icon: Icon, label }) => { const active = pathname === href || pathname.startsWith(`${href}/`); return <Link className={classNames("app-shell__nav-link", active && "app-shell__nav-link--active")} href={href} key={href} onClick={() => setNavOpen(false)}><Icon aria-hidden="true" size={18} />{label}</Link>; })}</div>;
          })}
        </nav>
        <div className="app-shell__profile"><div className="app-shell__profile-copy"><div><div className="app-shell__profile-name">{user.fullName}</div><div className="app-shell__profile-role">{user.role.replaceAll("_", " ")} · Scoped access</div></div><form action={signOut}><button aria-label="Sign out" className="app-shell__signout" title="Sign out" type="submit"><LogOut aria-hidden="true" size={16} /></button></form></div></div>
      </aside>
      <div className="app-shell__main">
        <header className="app-shell__topbar"><button aria-label={navOpen ? "Close navigation" : "Open navigation"} className="app-shell__mobile-button" onClick={() => setNavOpen((value) => !value)} type="button">{navOpen ? <X size={22} /> : <Menu size={22} />}</button><div className="app-shell__context">Group reporting · Europe/London</div><div className="app-shell__topbar-status"><LiveReportingStatus isDemo={isDemo} />{isPreview && !isDemo ? <div className="demo-banner demo-banner--preview"><CircleDashedIcon /><strong>UAT preview</strong><span>Staging data</span></div> : null}{isDemo ? <div className="demo-banner"><CircleDashedIcon /><strong>Test workspace</strong><span>Safe sample data</span></div> : null}</div></header>
        <main className="app-shell__content" id="main-content">{children}</main>
      </div>
    </div>
  );
}

function CircleDashedIcon() { return <span aria-hidden="true">●</span>; }
