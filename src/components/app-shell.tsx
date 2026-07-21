"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Beaker,
  BookOpenCheck,
  CalendarDays,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  FileCheck2,
  GraduationCap,
  LockKeyhole,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { AccessPreviewControls, type AccessPreviewSite } from "@/components/access-preview-controls";
import { LiveReportingStatus } from "@/components/live-reporting-status";
import type { Capabilities } from "@/lib/auth/capabilities";
import type { AppRole } from "@/lib/types";
import { classNames } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof BarChart3; roles?: AppRole[] };
type NavSection = { heading?: string; items: NavItem[] };

const groupNavigation: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", icon: BarChart3 },
      { href: "/reports", label: "Weekly reports", icon: ClipboardList },
      { href: "/approvals", label: "Approvals", icon: ShieldCheck, roles: ["admin", "group_manager"] },
      { href: "/workspace", label: "Kitchen workspace", icon: ChefHat, roles: ["admin", "group_manager"] },
      { href: "/people", label: "People & performance", icon: UsersRound, roles: ["admin", "group_manager"] },
      { href: "/summary", label: "Management summary", icon: FileCheck2, roles: ["admin", "group_manager", "finance", "viewer"] },
      { href: "/costs", label: "Cost control", icon: LockKeyhole, roles: ["admin", "group_manager", "finance"] },
      { href: "/admin", label: "Administration", icon: Settings2, roles: ["admin", "group_manager"] },
    ],
  },
];

const kitchenManagerNavigation: NavSection[] = [
  {
    heading: "Today",
    items: [
      { href: "/dashboard", label: "Overview & actions", icon: BarChart3 },
      { href: "/reports", label: "Weekly reports", icon: ClipboardList },
    ],
  },
  {
    heading: "Run the kitchen",
    items: [
      { href: "/checks", label: "Kitchen checks", icon: ClipboardCheck },
      { href: "/waste", label: "Daily waste log", icon: Trash2 },
      { href: "/sops", label: "SOPs & systems", icon: BookOpenCheck },
      { href: "/calendar", label: "Kitchen calendar", icon: CalendarDays },
      { href: "/one-to-ones", label: "My 1-1s", icon: UsersRound },
      { href: "/training", label: "Team training", icon: GraduationCap },
      { href: "/product-development", label: "Product development", icon: Beaker },
    ],
  },
];

const roleLabel = (role: AppRole) => role === "viewer" ? "reporting viewer" : role.replaceAll("_", " ");

export function AppShell({ children, isDemo, isPreview, previewSites, user }: {
  children: React.ReactNode;
  isDemo: boolean;
  isPreview: boolean;
  previewSites: AccessPreviewSite[];
  user: {
    fullName: string;
    role: AppRole;
    actualRole: AppRole;
    navigationRole: AppRole;
    capabilities: Capabilities;
    isAccessPreview: boolean;
    previewSiteId: string | null;
    previewSiteName: string | null;
    previewManagerName: string | null;
  };
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const sections = user.navigationRole === "kitchen_manager" ? kitchenManagerNavigation : groupNavigation;

  return (
    <div className={classNames("app-shell", user.isAccessPreview && "app-shell--access-preview")}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className={classNames("app-shell__sidebar", navOpen && "app-shell__sidebar--open")}>
        <div className="app-shell__brand"><div className="app-shell__brand-mark"><ChefHat aria-hidden="true" size={25} /></div><div className="app-shell__brand-copy"><strong>HOS Kitchen Reports</strong><span>Weekly operations</span></div></div>
        <nav aria-label="Main navigation" className="app-shell__nav">
          {sections.map((section, index) => {
            const visibleItems = section.items.filter((item) => !item.roles || item.roles.includes(user.navigationRole));
            if (!visibleItems.length) return null;
            return <div className="app-shell__nav-section" key={section.heading ?? index}>{section.heading ? <div className="app-shell__nav-heading">{section.heading}</div> : null}{visibleItems.map(({ href, icon: Icon, label }) => { const active = pathname === href || pathname.startsWith(`${href}/`); return <Link className={classNames("app-shell__nav-link", active && "app-shell__nav-link--active")} href={href} key={href} onClick={() => setNavOpen(false)}><Icon aria-hidden="true" size={18} />{label}</Link>; })}</div>;
          })}
        </nav>
        <div className="app-shell__profile"><div className="app-shell__profile-copy"><div><div className="app-shell__profile-name">{user.fullName}</div><div className="app-shell__profile-role">{user.isAccessPreview ? `Viewing ${user.previewSiteName ?? "kitchen"} as Kitchen Manager` : `${roleLabel(user.actualRole)} · scoped access`}</div></div><form action={signOut}><button aria-label="Sign out" className="app-shell__signout" title="Sign out" type="submit"><LogOut aria-hidden="true" size={16} /></button></form></div></div>
      </aside>
      <div className="app-shell__main">
        <header className="app-shell__topbar">
          <button aria-label={navOpen ? "Close navigation" : "Open navigation"} className="app-shell__mobile-button" onClick={() => setNavOpen((value) => !value)} type="button">{navOpen ? <X size={22} /> : <Menu size={22} />}</button>
          <div className="app-shell__context">{user.isAccessPreview ? `${user.previewSiteName} · Kitchen Manager workspace` : "Group reporting · Europe/London"}</div>
          <div className="app-shell__topbar-status">
            {user.capabilities.admin ? <AccessPreviewControls previewManagerName={user.previewManagerName} previewSiteId={user.previewSiteId} previewSiteName={user.previewSiteName} sites={previewSites} /> : null}
            <LiveReportingStatus isDemo={isDemo} />
            {isPreview && !isDemo ? <div className="demo-banner demo-banner--preview"><CircleDashedIcon /><strong>UAT preview</strong><span>Staging data</span></div> : null}
            {isDemo ? <div className="demo-banner"><CircleDashedIcon /><strong>Test workspace</strong><span>Safe sample data</span></div> : null}
          </div>
        </header>
        <main className="app-shell__content" id="main-content">{children}</main>
      </div>
    </div>
  );
}

function CircleDashedIcon() { return <span aria-hidden="true">●</span>; }
