"use client";

import { Eye, RotateCcw } from "lucide-react";
import { clearAccessPreview, startAccessPreview } from "@/app/actions/access-preview";

export type AccessPreviewSite = { id: string; name: string; active: boolean };

export function AccessPreviewControls({
  sites,
  previewSiteId,
  previewSiteName,
  previewManagerName,
}: {
  sites: AccessPreviewSite[];
  previewSiteId: string | null;
  previewSiteName: string | null;
  previewManagerName: string | null;
}) {
  if (!sites.length) return null;

  if (previewSiteId) {
    return (
      <div className="access-preview access-preview--active" role="status">
        <div className="access-preview__copy">
          <Eye aria-hidden="true" size={15} />
          <span>
            <strong>Kitchen Manager preview</strong>
            {previewSiteName ? ` · ${previewSiteName}` : ""}
            {previewManagerName ? ` · ${previewManagerName}` : " · no primary manager assigned"}
          </span>
          <small>Read-only reporting view. Your real account remains Admin.</small>
        </div>
        <form action={startAccessPreview} className="access-preview__switcher">
          <label className="sr-only" htmlFor="preview-site-switch">Preview another kitchen</label>
          <select defaultValue={previewSiteId} id="preview-site-switch" name="siteId">
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}{site.active ? "" : " · inactive"}</option>)}
          </select>
          <button className="access-preview__button" type="submit">Switch</button>
        </form>
        <form action={clearAccessPreview}>
          <button className="access-preview__button access-preview__button--return" type="submit"><RotateCcw aria-hidden="true" size={14} /> Return to Admin</button>
        </form>
      </div>
    );
  }

  return (
    <form action={startAccessPreview} className="access-preview access-preview--idle">
      <Eye aria-hidden="true" size={15} />
      <label className="sr-only" htmlFor="preview-site">Preview Kitchen Manager dashboard</label>
      <select defaultValue="" id="preview-site" name="siteId" required>
        <option disabled value="">Preview Kitchen Manager…</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}{site.active ? "" : " · inactive"}</option>)}
      </select>
      <button className="access-preview__button" type="submit">View</button>
    </form>
  );
}
