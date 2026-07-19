import { Beaker, Rocket, Sparkles } from "lucide-react";
import { ProductDevelopmentBoard } from "@/components/product-development/product-development-board";
import { requireRole } from "@/lib/auth/dal";
import { getProductDevelopmentItems, getProductDevelopmentOptions } from "@/lib/data/product-development";

export const metadata = { title: "Product development" };

export default async function ProductDevelopmentPage() {
  await requireRole(["admin", "group_manager", "finance", "viewer", "kitchen_manager"]);
  const [items, options] = await Promise.all([
    getProductDevelopmentItems(),
    getProductDevelopmentOptions(),
  ]);
  const liveCount = items.filter((item) => item.status === "live").length;
  const trialCount = items.filter((item) => ["trial_planned", "trial_complete", "amendments_required"].includes(item.status)).length;
  const launchCount = items.filter((item) => item.targetLaunchDate).length;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="page-header__eyebrow">Phase 3</p>
          <h1 className="page-header__title">Product development.</h1>
          <p className="page-header__copy">One route from idea to live product: trials, owner, costs, specs, training and approval history.</p>
        </div>
      </header>

      <section className="metric-grid metric-grid--three" aria-label="Product development summary">
        <article className="metric-card"><Sparkles aria-hidden="true" size={21} /><div className="metric-card__value">{items.length}</div><div className="metric-card__note">Active development records</div></article>
        <article className="metric-card"><Beaker aria-hidden="true" size={21} /><div className="metric-card__value">{trialCount}</div><div className="metric-card__note">In trial or amendment</div></article>
        <article className="metric-card"><Rocket aria-hidden="true" size={21} /><div className="metric-card__value">{liveCount}</div><div className="metric-card__note">Live · {launchCount} with launch dates</div></article>
      </section>

      <ProductDevelopmentBoard items={items} owners={options.owners} sites={options.sites} />
    </>
  );
}
