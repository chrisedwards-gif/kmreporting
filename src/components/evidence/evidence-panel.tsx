"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, FileImage, FileText, LoaderCircle, Paperclip, Trash2, Upload } from "lucide-react";
import { useToast } from "@/components/ui/toast-provider";
import type { EvidenceEntityType, EvidenceFile, EvidenceType } from "@/lib/data/evidence";

const evidenceLabels: Record<EvidenceType, string> = {
  finished_photo: "Finished-product photo",
  trial_photo: "Trial photo",
  signed_document: "Signed document",
  training_evidence: "Training evidence",
  check_photo: "Check photo",
  supporting_document: "Supporting document",
  other: "Other evidence",
};

const entityEvidenceOptions: Record<EvidenceEntityType, EvidenceType[]> = {
  product_development: ["finished_photo", "trial_photo", "supporting_document", "other"],
  sop: ["signed_document", "supporting_document", "other"],
  training_record: ["training_evidence", "signed_document", "supporting_document", "other"],
  kitchen_check_run: ["check_photo", "supporting_document", "other"],
  probation_review: ["signed_document", "supporting_document", "other"],
};

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

export function EvidencePanel({
  canEdit,
  description = "Files are private and opened through a short-lived secure link.",
  entityId,
  entityType,
  files,
  recommendedType,
  title = "Evidence",
}: {
  canEdit: boolean;
  description?: string;
  entityId: string;
  entityType: EvidenceEntityType;
  files: EvidenceFile[];
  recommendedType?: EvidenceType;
  title?: string;
}) {
  const router = useRouter();
  const { pushToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const options = entityEvidenceOptions[entityType];
  const [evidenceType, setEvidenceType] = useState<EvidenceType>(recommendedType && options.includes(recommendedType) ? recommendedType : options[0]);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const uploadEvidence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      pushToast({ title: "Choose a file", description: "Select the photo or document you want to attach.", variant: "warning" });
      return;
    }
    setUploading(true);
    const formData = new FormData();
    formData.set("entityType", entityType);
    formData.set("entityId", entityId);
    formData.set("evidenceType", evidenceType);
    formData.set("caption", caption);
    formData.set("file", file);
    try {
      const response = await fetch("/api/evidence", { method: "POST", body: formData });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The evidence file could not be uploaded.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setCaption("");
      pushToast({ title: "Evidence uploaded", description: `${file.name} is now attached to this record.`, variant: "success" });
      router.refresh();
    } catch (error) {
      pushToast({
        title: "Evidence upload failed",
        description: error instanceof Error ? error.message : "The evidence file could not be uploaded.",
        variant: "error",
        persistent: true,
      });
    } finally {
      setUploading(false);
    }
  };

  const deleteEvidence = async (file: EvidenceFile) => {
    if (!window.confirm(`Remove ${file.fileName}? The file and evidence record will be deleted.`)) return;
    setDeletingId(file.id);
    try {
      const response = await fetch(`/api/evidence/${file.id}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The evidence file could not be removed.");
      pushToast({ title: "Evidence removed", description: file.fileName, variant: "success" });
      router.refresh();
    } catch (error) {
      pushToast({
        title: "Evidence could not be removed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "error",
        persistent: true,
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="evidence-panel">
      <header className="evidence-panel__header">
        <div>
          <p className="page-header__eyebrow">Private record</p>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="source-chip"><Paperclip aria-hidden="true" size={14} /> {files.length} attached</span>
      </header>

      {files.length ? (
        <div className="evidence-list">
          {files.map((file) => {
            const Icon = file.mimeType.startsWith("image/") ? FileImage : FileText;
            return (
              <article className="evidence-list__item" key={file.id}>
                <Icon aria-hidden="true" size={18} />
                <div className="evidence-list__copy">
                  <strong>{file.caption || file.fileName}</strong>
                  <span>{evidenceLabels[file.evidenceType]} · {formatBytes(file.sizeBytes)} · {file.uploadedByName}</span>
                </div>
                <a className="button button--secondary button--compact" href={`/api/evidence/${file.id}`}>
                  <Download aria-hidden="true" size={14} /> Open
                </a>
                {canEdit ? (
                  <button
                    aria-label={`Delete ${file.fileName}`}
                    className="icon-button icon-button--danger"
                    disabled={deletingId === file.id}
                    onClick={() => void deleteEvidence(file)}
                    type="button"
                  >
                    {deletingId === file.id ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : <Trash2 aria-hidden="true" size={15} />}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : <div className="empty-inline">No evidence has been attached yet.</div>}

      {canEdit ? (
        <form className="evidence-upload" onSubmit={uploadEvidence}>
          <label className="field field--compact">
            <span className="field__label">Evidence type</span>
            <select className="field__input" onChange={(event) => setEvidenceType(event.target.value as EvidenceType)} value={evidenceType}>
              {options.map((option) => <option key={option} value={option}>{evidenceLabels[option]}</option>)}
            </select>
          </label>
          <label className="field evidence-upload__file">
            <span className="field__label">File</span>
            <input
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf,.docx,.xlsx,.csv,.txt"
              className="field__input"
              ref={fileInputRef}
              type="file"
            />
          </label>
          <label className="field evidence-upload__caption">
            <span className="field__label">Caption</span>
            <input className="field__input" maxLength={500} onChange={(event) => setCaption(event.target.value)} placeholder="What does this prove?" value={caption} />
          </label>
          <button className="button button--primary" disabled={uploading} type="submit">
            {uploading ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : <Upload aria-hidden="true" size={15} />}
            {uploading ? "Uploading…" : "Attach evidence"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
