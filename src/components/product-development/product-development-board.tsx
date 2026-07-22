"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Beaker,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  GripVertical,
  Image as ImageIcon,
  Pencil,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  saveProductDevelopmentItem,
  updateProductDevelopmentStatus,
  type ProductDevelopmentActionState,
} from "@/app/actions/product-development";
import { EvidencePanel } from "@/components/evidence/evidence-panel";
import { useToast } from "@/components/ui/toast-provider";
import type { ProductDevelopmentItem, ProductDevelopmentOption } from "@/lib/data/product-development";
import {
  grossProfitPercentage,
  PRODUCT_STATUSES,
  productStatusLabel,
  type ProductStatus,
} from "@/lib/product-development/calculations";
import { formatCurrency, formatDate } from "@/lib/utils";

const initialState: ProductDevelopmentActionState = { status: "idle", message: "" };

type ProductEditorProps = {
  item: ProductDevelopmentItem | null;
  owners: ProductDevelopmentOption[];
  sites: ProductDevelopmentOption[];
  onClose: () => void;
};

const liveControls = (item: ProductDevelopmentItem) => [
  { label: "Recipe / specification", complete: item.recipeSummary.trim().length >= 5 },
  { label: "Method", complete: item.methodText.trim().length >= 5 },
  { label: "Portion", complete: item.portionText.trim().length >= 2 },
  { label: "Cost and selling price", complete: item.foodCost !== null && item.sellPrice !== null },
  { label: "Allergen declaration", complete: item.allergens.length > 0 },
  { label: "Shelf life / storage", complete: item.shelfLifeText.trim().length >= 2 },
  { label: "Operational / training plan", complete: item.operationalPlan.trim().length >= 5 },
  { label: "Finished-product photo", complete: item.evidence.some((file) => file.evidenceType === "finished_photo" && file.mimeType.startsWith("image/")) },
];

function ProductEditor({ item, owners, sites, onClose }: ProductEditorProps) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveProductDevelopmentItem, initialState);
  const editing = Boolean(item);
  const controls = item ? liveControls(item) : [];

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-modal="true" className="modal modal--wide modal--scroll" role="dialog">
        <header className="modal__header">
          <div>
            <p className="page-header__eyebrow">Product development</p>
            <h2 className="modal__title">{editing ? `Edit ${item?.title}.` : "Start a new product."}</h2>
            <p className="modal__copy">{editing ? "Complete the operating specification and evidence trail before launch." : "Save the record first, then attach trial and finished-product evidence."}</p>
          </div>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
        </header>

        <div className="modal__body product-editor">
          {item ? (
            <section className="launch-gate">
              <header><div><p className="page-header__eyebrow">Live gate</p><h3>{controls.filter((control) => control.complete).length}/{controls.length} controls complete</h3></div><ShieldCheck aria-hidden="true" size={20} /></header>
              <div className="launch-gate__grid">
                {controls.map((control) => <span className={control.complete ? "launch-gate__item launch-gate__item--complete" : "launch-gate__item"} key={control.label}><CheckCircle2 aria-hidden="true" size={14} /> {control.label}</span>)}
              </div>
              <p>The database blocks Live status until every control is complete. The calculated gate cannot be bypassed in the browser.</p>
            </section>
          ) : null}

          <form action={action} className="report-form">
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
            <label className="field"><span className="field__label">Final recipe / specification</span><textarea className="field__input" defaultValue={item?.recipeSummary ?? ""} name="recipeSummary" rows={4} /></label>
            <label className="field"><span className="field__label">Method</span><textarea className="field__input" defaultValue={item?.methodText ?? ""} name="methodText" placeholder="Production method, critical controls and service finish" rows={4} /></label>
            <div className="form-grid form-grid--three">
              <label className="field"><span className="field__label">Yield</span><input className="field__input" defaultValue={item?.yieldText ?? ""} name="yieldText" /></label>
              <label className="field"><span className="field__label">Portion</span><input className="field__input" defaultValue={item?.portionText ?? ""} name="portionText" /></label>
              <label className="field"><span className="field__label">Shelf life / storage</span><input className="field__input" defaultValue={item?.shelfLifeText ?? ""} name="shelfLifeText" placeholder="48 hours chilled, ≤5°C" /></label>
            </div>
            <div className="form-grid form-grid--two">
              <label className="field"><span className="field__label">Food cost</span><input className="field__input" defaultValue={item?.foodCost ?? ""} min="0" name="foodCost" step="0.01" type="number" /></label>
              <label className="field"><span className="field__label">Selling price</span><input className="field__input" defaultValue={item?.sellPrice ?? ""} min="0" name="sellPrice" step="0.01" type="number" /></label>
            </div>
            <label className="field"><span className="field__label">Allergen declaration</span><input className="field__input" defaultValue={item?.allergens.join(", ") ?? ""} name="allergens" placeholder="Gluten, milk — or None" /></label>
            <label className="field"><span className="field__label">Operational and training plan</span><textarea className="field__input" defaultValue={item?.operationalPlan ?? ""} name="operationalPlan" placeholder="Prep flow, equipment, service impact, staff training and launch controls" rows={4} /></label>
            <label className="field"><span className="field__label">Trial notes</span><textarea className="field__input" defaultValue={item?.trialNotes ?? ""} name="trialNotes" rows={3} /></label>
            <label className="field"><span className="field__label">Approval notes</span><textarea className="field__input" defaultValue={item?.approvalNotes ?? ""} name="approvalNotes" rows={2} /></label>
            {state.status !== "idle" ? <div className={`form-message ${state.status === "error" ? "form-message--error" : "form-message--success"}`} role="status">{state.message}</div> : null}
            <div className="form-actions"><button className="button button--secondary" onClick={onClose} type="button">Close</button><button className="button button--primary" disabled={pending} type="submit">{pending ? "Saving…" : editing ? "Save changes" : "Create product"}</button></div>
          </form>

          {item ? (
            <EvidencePanel
              canEdit
              description="Attach trial images, final presentation and supporting specifications. A finished-product photo is mandatory for Live status."
              entityId={item.id}
              entityType="product_development"
              files={item.evidence}
              recommendedType="finished_photo"
              title="Product evidence"
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function ProductDevelopmentBoard({
  items,
  owners,
  sites,
  canEdit = true,
}: {
  items: ProductDevelopmentItem[];
  owners: ProductDevelopmentOption[];
  sites: ProductDevelopmentOption[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [editorItem, setEditorItem] = useState<ProductDevelopmentItem | null | undefined>(undefined);
  const [moving, startMoving] = useTransition();
  const activeStatuses = PRODUCT_STATUSES.filter((status) => status !== "archived");

  const currentEditorItem = editorItem === undefined
    ? undefined
    : editorItem === null
      ? null
      : items.find((item) => item.id === editorItem.id) ?? editorItem;

  const moveItem = (id: string, status: ProductStatus) => {
    if (!canEdit) return;
    const formData = new FormData();
    formData.set("id", id);
    formData.set("status", status);
    startMoving(async () => {
      try {
        await updateProductDevelopmentStatus(formData);
        pushToast({ title: "Product status updated", description: `Moved to ${productStatusLabel(status)}.`, variant: "success" });
        router.refresh();
      } catch (error) {
        pushToast({ title: "Product could not move", description: error instanceof Error ? error.message : "Check the Live gate and try again.", variant: "error", persistent: true });
      }
    });
  };

  return (
    <>
      {canEdit ? <div className="page-header__actions"><button className="button button--primary" onClick={() => setEditorItem(null)} type="button"><Plus aria-hidden="true" size={16} /> New product</button></div> : null}
      <div className={`product-board${moving ? " product-board--moving" : ""}`}>
        {activeStatuses.map((status) => {
          const statusItems = items.filter((item) => item.status === status);
          return (
            <section
              className="product-column"
              key={status}
              onDragOver={(event) => canEdit && event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                moveItem(event.dataTransfer.getData("text/product-id"), status);
              }}
            >
              <header className="product-column__header"><h2>{productStatusLabel(status)}</h2><span>{statusItems.length}</span></header>
              <div className="product-column__items">
                {statusItems.map((item) => {
                  const gp = grossProfitPercentage(item.foodCost, item.sellPrice);
                  const controls = liveControls(item);
                  const completed = controls.filter((control) => control.complete).length;
                  return (
                    <article className="product-card" draggable={canEdit} key={item.id} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/product-id", item.id); }}>
                      <div className="product-card__top"><span className="source-chip">{item.category}</span><span className="product-card__version">{canEdit ? <GripVertical aria-hidden="true" size={15} /> : null}<span className="code-pill">v{item.version}</span></span></div>
                      <h3>{item.title}</h3>
                      <p>{item.siteName} · {item.ownerName}</p>
                      <div className="product-card__metrics">
                        <span><CalendarDays aria-hidden="true" size={13} /> {item.targetLaunchDate ? formatDate(item.targetLaunchDate) : "No launch date"}</span>
                        <span><Beaker aria-hidden="true" size={13} /> {item.nextTrialDate ? formatDate(item.nextTrialDate) : "No trial booked"}</span>
                        <span><CircleDollarSign aria-hidden="true" size={13} /> {gp === null ? "Not costed" : `${gp}% GP · ${formatCurrency(item.foodCost ?? 0)} cost`}</span>
                        <span><ImageIcon aria-hidden="true" size={13} /> {item.evidence.length} evidence files</span>
                      </div>
                      <div className={`product-card__gate${completed === controls.length ? " product-card__gate--ready" : ""}`}><ShieldCheck aria-hidden="true" size={14} /><strong>{completed}/{controls.length}</strong> Live controls complete</div>
                      {item.trialNotes ? <p className="product-card__notes">{item.trialNotes}</p> : null}
                      {canEdit ? (
                        <>
                          <div className="product-card__status">
                            <select className="field__input field__input--compact" defaultValue={item.status} onChange={(event) => moveItem(item.id, event.target.value as ProductStatus)}>{PRODUCT_STATUSES.map((option) => <option key={option} value={option}>{productStatusLabel(option)}</option>)}</select>
                          </div>
                          <button className="button button--secondary button--compact" onClick={() => setEditorItem(item)} type="button"><Pencil aria-hidden="true" size={14} /> Edit details & evidence</button>
                        </>
                      ) : <span className="status-badge status-badge--draft">{productStatusLabel(item.status)}</span>}
                    </article>
                  );
                })}
                {!statusItems.length ? <div className="product-column__empty">{canEdit ? "Drop a product here or move it with the selector." : "Nothing here yet."}</div> : null}
              </div>
            </section>
          );
        })}
      </div>
      {currentEditorItem !== undefined ? <ProductEditor item={currentEditorItem} key={currentEditorItem?.id ?? "new"} onClose={() => setEditorItem(undefined)} owners={owners} sites={sites} /> : null}
    </>
  );
}
