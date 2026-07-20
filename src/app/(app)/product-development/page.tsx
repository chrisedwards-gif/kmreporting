import { Beaker, Rocket, Sparkles } from "lucide-react";
import { ProductDevelopmentBoard } from "@/components/product-development/product-development-board";
import { requireRole } from "@/lib/auth/dal";
import { scopeContainsSite, siteIsInScope } from "@/lib/auth/site-scope";
import { getProductDevelopmentItems, getProductDevelopmentOptions } from "@/lib/data/product-development";

export const metadata = { title: "Product development" };

export default async function ProductDevelopmentPage() {
  const profile = await requireRole(["admin", "group_manager", "kitchen_manager"]);
  const [allItems, allOptions] = await Promise.all([getProductDevelopmentItems(), getProductDevelopmentOptions()]);
  const items = allItems.filter((item) => siteIsInScope(profile.siteScopeIds, item.siteId));
  const options = {
    sites: allOptions.sites.filter((item) => scopeContainsSite(profile.siteScopeIds, item.id)),
    owners: profile.scopeManagerId ? allOptions.owners.filter((item) => item.id === profile.scopeManagerId) : allOptions.owners,
  };
  const liveCount = items.filter((item) => item.status === "live").length;
  const trialCount = items.filter((item) => ["trial_planned", "trial_complete", "amendments_required"].includes(item.status)).length;
  const launchCount = items.filter((item) => Boolean(item.targetLaunchDate) && item.status !== "live").length;
  const canEdit = profile.capabilities.maintainTrackers;

  return (
    <>
      <header className="page-header"><div><p className="page-header__eyebrow">Develop</p><h1 className="page-header__title">Product development.</h1><p className="page-header__copy">One route from idea to live product: trials, owner, costs, specs, training and approval history.</p></div></header>
      {profile.isAccessPreview ? <div className="privacy-callout">Admin site mode for {profile.previewSiteName}. Product records, trials and owners are restricted to this manager workspace.</div> : null}
      <section className="metric-grid metric-grid--three" aria-label="Product development summary"><article className="metric-card"><Sparkles aria-hidden="true" size={21} /><div className="metric-card__value">{items.length}</div><div className="metric-card__note">Active development records</div></article><article className="metric-card"><Beaker aria-hidden="true" size={21} /><div className="metric-card__value">{trialCount}</div><div className="metric-card__note">In trial or amendment</div></article><article className="metric-card"><Rocket aria-hidden="true" size={21} /><div className="metric-card__value">{launchCount}</div><div className="metric-card__note">Upcoming launch dates · {liveCount} already live</div></article></section>
      <ProductDevelopmentBoard canEdit={canEdit} items={items} owners={options.owners} sites={options.sites} />
    </>
  );
}
