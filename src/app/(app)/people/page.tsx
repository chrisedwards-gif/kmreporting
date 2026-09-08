import Link from "next/link";
import { ArrowRight, ListChecks, UsersRound } from "lucide-react";
import { CreateManagerForm } from "@/components/performance/manager-admin";
import { requireGroupWorkspaceRole } from "@/lib/auth/dal";
import { getManagerAdminRecords } from "@/lib/data/performance";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "People" };

export default async function PeoplePage() {
  const profile = await requireGroupWorkspaceRole(["admin", "group_manager"]);
  const people = await getManagerAdminRecords();
  const activePeople = people.filter((person) => person.active);
  let sites: Array<{ id: string; name: string }> = [];

  if (profile.actualRole === "admin") {
    const admin = createAdminClient();
    const { data } = await admin
      .from("sites")
      .select("id, name")
      .eq("organisation_id", profile.organisationId)
      .eq("active", true)
      .order("name");
    sites = data ?? [];
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">People</p>
          <h1 className="page-header__title">Managers & assistants.</h1>
          <p className="page-header__copy">One simple directory for the people who submit weekly reports and receive weekly 1-1s.</p>
        </div>
        <div className="page-header__actions">
          <Link className="button button--secondary" href="/one-to-ones"><UsersRound aria-hidden="true" size={16} /> Weekly 1-1s</Link>
          <Link className="button button--secondary" href="/performance/actions"><ListChecks aria-hidden="true" size={16} /> Action log</Link>
        </div>
      </header>

      {profile.actualRole === "admin" ? <CreateManagerForm sites={sites} /> : null}

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Current people</h2>
            <p className="panel__subtitle">{activePeople.length} active manager{activePeople.length === 1 ? "" : "s"} / assistant{activePeople.length === 1 ? "" : "s"}</p>
          </div>
          {profile.actualRole === "admin" ? <Link className="button button--secondary button--compact" href="/performance/managers">Employment details</Link> : null}
        </div>
        <div className="report-list">
          {people.map((person) => (
            <Link className="report-row report-row--slim" href={`/one-to-ones?manager=${person.id}`} key={person.id}>
              <div className="site-cell">
                <div className="site-cell__mark">{person.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</div>
                <div>
                  <div className="site-cell__name">{person.fullName}</div>
                  <div className="site-cell__manager">{person.roleTitle} · {person.currentSite ?? "No kitchen assigned"}</div>
                </div>
              </div>
              <div>
                <span className="report-row__metric-label">Account</span>
                <span className={`status-badge status-badge--${person.active ? "approved" : "draft"}`}>{person.active ? "Active" : "Inactive"}</span>
              </div>
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          ))}
          {!people.length ? <div className="empty-inline">No managers or assistants have been added yet.</div> : null}
        </div>
      </section>
    </>
  );
}
