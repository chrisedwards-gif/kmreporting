import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RotaSiteSettingsForm } from "@/components/rotas/rota-site-settings-form";
import { requireActualRole } from "@/lib/auth/dal";
import { getRotaPlanningWorkspace } from "@/lib/data/rotas";

export const metadata = { title: "Rota calibration" };

export default async function RotaSettingsPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const [profile, params] = await Promise.all([requireActualRole(["admin", "group_manager"]), searchParams]);
  const workspace = await getRotaPlanningWorkspace({ profile, requestedSiteId: params.site });
  const site = workspace.selectedSite;
  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Controls before optimisation</p><h1 className="page-header__title">Rota calibration.</h1><p className="page-header__copy">Define what “safe and useful” means for each kitchen before the system tries to optimise cost.</p></div><Link className="button button--secondary" href={site ? `/rotas?site=${site.id}` : "/rotas"}><ArrowLeft aria-hidden="true" size={16} /> Rota planner</Link></header>
      <form className="comparison-filters panel" method="get"><label className="field"><span className="field__label">Kitchen</span><select className="field__input" defaultValue={site?.id} name="site">{workspace.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="button button--secondary" type="submit">Load settings</button></form>
      {workspace.error ? <div className="form-message form-message--error" role="alert">{workspace.error}</div> : null}
      {site ? <RotaSiteSettingsForm demand={workspace.demand} rules={workspace.dayRules} settings={{ forecastWeeks: workspace.forecastWeeks, minimumHistoryWeeks: workspace.minimumHistoryWeeks, intervalMinutes: workspace.intervalMinutes, minimumRestHours: workspace.minimumRestHours, salesPerLabourHourTarget: workspace.salesPerLabourHourTarget }} site={site} /> : null}
    </>
  );
}
