"use client";

import { useActionState, useState } from "react";
import { Beaker, CalendarDays, CircleDollarSign, Pencil, Plus, X } from "lucide-react";
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

type ProductEditorProps = {
  item: ProductDevelopmentItem | null;
  owners: ProductDevelopmentOption[];
  sites: ProductDevelopmentOption[];
  onClose: () => void;
};

function ProductEditor({ item, owners, sites, onClose }: ProductEditorProps) {
  const [state, action, pending] = useActionState(saveProductDevelopmentItem, initialState);
  const editing = Boolean(item);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-modal="true" className="modal modal--wide" role="dialog">
        <header className="modal__header">
          <div>
            <p className="page-header__eyebrow">Product development</p>
            <h2 className="modal__title">{editing ? `Edit ${item?.title}.` : "Start a new product."}</h2>
            <p className="modal__copy">{editing ? "Update the product record without losing its status and version history." : "Capture the trial, costs, ownership and route to launch in one place."}</p>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <form action={action} className="modal__body report-form">
          <input name="id" type="hidden" value={item?.id ?? ""} />
          <div className="form-grid form-grid--three">
            <label className="field"><span className="field__label">Product name</span><input className="field__input" defaultValue={item?.title ?? ""} name="title" required /></label>
            <label className="field"><span className="field__label">Category</span><input className="field__input" defaultValue={item?.category ?? "Dish"} name="category" /></label>
            <label className="field"><span className="field__label">Status</span><select className="field__input" defaultValue={item?.status ?? "idea"} name="status">{PRODUCT_STATUSES.map((status) => <option key={status} value={status}>{productStatusLabel(status)}</option>)}</select></label>
          </div>
          <div className="form-grid form-grid--two">
            <label className="field"><span className="field__label">Kitchen / concept</span><select className="field__input" defaultValue={item?.siteId ?? ""} name="siteId"><option value="">Group-wide</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <label className="field"><span className="field__label">Owner</span><select className="field__input" defaultValue={item?.ownerProfileId ?? ""} name="ownerProfileId"><option value="">Unassigned</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
          </div>
          <div className="form-grid form-grid--two">
            <label className="field"><span className="field__label">Target launch date</span><input className="field__input" defaultValue={item?.targetLaunchDate ?? ""} name="targetLaunchDate" type="date" /></label>
            <label className="field"><span className="field__label">Next trial date</span><input className="field__input" defaultValue={item?.nextTrialDate ?? ""} name="nextTrialDate" type="date" /></label>
          </div>
          <label className="field"><span className="field__label">Recipe / concept summary</span><textarea className="field__input" defaultValue={item?.recipeSummary ?? ""} name="recipeSummary" rows={3} /></label>
          <div className="form-grid form-grid--two">
            <label className="field"><span className="field__label">Yield</span><input className="field__input" defaultValue={item?.yieldText ?? ""} name="yieldText" placeholder="e.g. 10 portions" /></label>
            <label className="field"><span className="field__label">Portion</span><input className="field__input" defaultValue={item?.portionText ?? ""} name="portionText" placeholder="e.g. 220g" /></label>
          </div>
          <div className="form-grid form-grid--two">
            <label className="field"><span className="field__label">Food cost</span><input className="field__input" defaultValue={item?.foodCost ?? ""} inputMode="decimal" min="0" name="foodCost" step="0.01" type="number" /></label>
            <label className="field"><span className="field__label">Selling price</span><input className="field__input" defaultValue={item?.sellPrice ?? ""} inputMode="decimal" min="0" name="sellPrice" step="0.01" type="number" /></label>
          </div>
          <label className="field"><span className="field__label">Allergens</span><input className="field__input" defaultValue={item?.allergens.join(", ") ?? ""} name="allergens" placeholder="Comma separated, e.g. gluten, milk, egg" /></label>
          <label className="field"><span className="field__label">Trial notes</span><textarea className="field__input" defaultValue={item?.trialNotes ?? ""} name="trialNotes" rows={3} /></label>
          <label className="field"><span className="field__label">Approval notes</span><textarea className="field__input" defaultValue={item?.approvalNotes ?? ""} name="approvalNotes" rows={2} /></label>
          {state.status !== "idle" ? <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.message}</div> : null}
          <div className="form-actions">
            <button className="button button--secondary" onClick={onClose} type="button">Close</button>
            <button className="button button--primary" disabled={pending} type="submit">{pending ? "Saving…" : editing ? "Save changes" : "Create product"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ProductDevelopmentBoard({
  items,
  owners,
  sites,
}: {
  items: ProductDevelopmentItem[];
  owners: ProductDevelopmentOption[];
  sites: ProductDevelopmentOption[];
}) {
  const [editorItem, setEditorItem] = useState<ProductDevelopmentItem | null | undefined>(undefined);
  const activeStatuses = PRODUCT_STATUSES.filter((status) => !["archived"].includes(status));

  return (
    <>
      <div className="page-header__actions">
        <button className="button button--primary" onClick={() => setEditorItem(null)} type="button"><Plus aria-hidden="true" size={16} /> New product</button>
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
                      <button className="button button--secondary button--compact" onClick={() => setEditorItem(item)} type="button"><Pencil aria-hidden="true" size={14} /> Edit details</button>
                    </article>
                  );
                })}
                {!statusItems.length ? <div className="product-column__empty">Nothing here yet.</div> : null}
              </div>
            </section>
          );
        })}
      </div>

      {editorItem !== undefined ? (
        <ProductEditor
          item={editorItem}
          key={editorItem?.id ?? "new"}
          onClose={() => setEditorItem(undefined)}
          owners={owners}
          sites={sites}
        />
      ) : null}
    </>
  );
}
