"use client";

import { useActionState, useState } from "react";
import { Beaker, CalendarDays, CircleDollarSign, Plus, X } from "lucide-react";
import {
  saveProductDevelopmentItem,
  updateProductDevelopmentStatus,
  type ProductDevelopmentActionState,
} from "@/app/actions/product-development";
import type { ProductDevelopmentItem, ProductDevelopmentOption } from "@/lib/data/product-development";
import {
  grossProfitPercentage,
  PRODUCT_STATUSES,
  productStatusLabel,
} from "@/lib/product-development/calculations";
import { formatCurrency, formatDate } from "@/lib/utils";

const initialState: ProductDevelopmentActionState = { status: "idle", message: "" };

export function ProductDevelopmentBoard({
  items,
  owners,
  sites,
}: {
  items: ProductDevelopmentItem[];
  owners: ProductDevelopmentOption[];
  sites: ProductDevelopmentOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveProductDevelopmentItem, initialState);
  const activeStatuses = PRODUCT_STATUSES.filter((status) => !["archived"].includes(status));

  return (
    <>
      <div className="page-header__actions">
        <button className="button button--primary" onClick={() => setOpen(true)} type="button"><Plus aria-hidden="true" size={16} /> New product</button>
      </div>

      <div className="product-board">
        {activeStatuses.map((status) => {
          const statusItems = items.filter((item) => item.status === status);
          return (
            <section className="product-column" key={status}>
              <header className="product-column__header"><h2>{productStatusLabel(status)}</h2><span>{statusItems.length}</span></header>
              <div className="product-column__items">
                {statusItems.map((item) => {
                  const gp = grossProfitPercentage(item.foodCost, item.sellPrice);
                  return (
                    <article className="product-card" key={item.id}>
                      <div className="product-card__top"><span className="source-chip">{item.category}</span><span className="code-pill">v{item.version}</span></div>
                      <h3>{item.title}</h3>
                      <p>{item.siteName} · {item.ownerName}</p>
                      <div className="product-card__metrics">
                        <span><CalendarDays aria-hidden="true" size={13} /> {item.targetLaunchDate ? formatDate(item.targetLaunchDate) : "No launch date"}</span>
                        <span><Beaker aria-hidden="true" size={13} /> {item.nextTrialDate ? formatDate(item.nextTrialDate) : "No trial booked"}</span>
                        <span><CircleDollarSign aria-hidden="true" size={13} /> {gp === null ? "Not costed" : `${gp}% GP · ${formatCurrency(item.foodCost ?? 0)} cost`}</span>
                      </div>
                      {item.trialNotes ? <p className="product-card__notes">{item.trialNotes}</p> : null}
                      <form action={updateProductDevelopmentStatus} className="product-card__status">
                        <input name="id" type="hidden" value={item.id} />
                        <select aria-label={`Status for ${item.title}`} className="field__input field__input--compact" defaultValue={item.status} name="status">
                          {PRODUCT_STATUSES.map((option) => <option key={option} value={option}>{productStatusLabel(option)}</option>)}
                        </select>
                        <button className="button button--secondary button--compact" type="submit">Move</button>
                      </form>
                    </article>
                  );
                })}
                {!statusItems.length ? <div className="product-column__empty">Nothing here yet.</div> : null}
              </div>
            </section>
          );
        })}
      </div>

      {open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section aria-modal="true" className="modal modal--wide" role="dialog">
            <header className="modal__header"><div><p className="page-header__eyebrow">Product development</p><h2 className="modal__title">Start a new product.</h2><p className="modal__copy">Capture the trial, costs, ownership and route to launch in one place.</p></div><button aria-label="Close" className="icon-button" onClick={() => setOpen(false)} type="button"><X aria-hidden="true" size={18} /></button></header>
            <form action={action} className="modal__body report-form">
              <input name="id" type="hidden" value="" />
              <div className="form-grid form-grid--three">
                <label className="field"><span className="field__label">Product name</span><input className="field__input" name="title" required /></label>
                <label className="field"><span className="field__label">Category</span><input className="field__input" defaultValue="Dish" name="category" /></label>
                <label className="field"><span className="field__label">Status</span><select className="field__input" defaultValue="idea" name="status">{PRODUCT_STATUSES.map((status) => <option key={status} value={status}>{productStatusLabel(status)}</option>)}</select></label>
              </div>
              <div className="form-grid form-grid--two">
                <label className="field"><span className="field__label">Kitchen / concept</span><select className="field__input" defaultValue="" name="siteId"><option value="">Group-wide</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
                <label className="field"><span className="field__label">Owner</span><select className="field__input" defaultValue="" name="ownerProfileId"><option value="">Unassigned</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
              </div>
              <div className="form-grid form-grid--two">
                <label className="field"><span className="field__label">Target launch date</span><input className="field__input" name="targetLaunchDate" type="date" /></label>
                <label className="field"><span className="field__label">Next trial date</span><input className="field__input" name="nextTrialDate" type="date" /></label>
              </div>
              <label className="field"><span className="field__label">Recipe / concept summary</span><textarea className="field__input" name="recipeSummary" rows={3} /></label>
              <div className="form-grid form-grid--two">
                <label className="field"><span className="field__label">Yield</span><input className="field__input" name="yieldText" placeholder="e.g. 10 portions" /></label>
                <label className="field"><span className="field__label">Portion</span><input className="field__input" name="portionText" placeholder="e.g. 220g" /></label>
              </div>
              <div className="form-grid form-grid--two">
                <label className="field"><span className="field__label">Food cost</span><input className="field__input" inputMode="decimal" min="0" name="foodCost" step="0.01" type="number" /></label>
                <label className="field"><span className="field__label">Selling price</span><input className="field__input" inputMode="decimal" min="0" name="sellPrice" step="0.01" type="number" /></label>
              </div>
              <label className="field"><span className="field__label">Allergens</span><input className="field__input" name="allergens" placeholder="Comma separated, e.g. gluten, milk, egg" /></label>
              <label className="field"><span className="field__label">Trial notes</span><textarea className="field__input" name="trialNotes" rows={3} /></label>
              <label className="field"><span className="field__label">Approval notes</span><textarea className="field__input" name="approvalNotes" rows={2} /></label>
              {state.status !== "idle" ? <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`}>{state.message}</div> : null}
              <div className="form-actions"><button className="button button--secondary" onClick={() => setOpen(false)} type="button">Cancel</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "Saving…" : "Create product"}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
