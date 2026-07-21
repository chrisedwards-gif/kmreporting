import "server-only";

import { environment } from "@/lib/env";

export type EmailAttachment = {
  filename: string;
  content: Uint8Array | string;
  contentType?: string;
};

type EmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  idempotencyKey: string;
  category?: string;
};

export type EmailDeliveryResult = {
  configured: boolean;
  ok: boolean;
  providerReference: string;
  error: string;
};

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const textToHtml = (value: string) => escapeHtml(value)
  .split(/\n{2,}/)
  .map((paragraph) => `<p style="margin:0 0 16px;line-height:1.6">${paragraph.replaceAll("\n", "<br>")}</p>`)
  .join("");

const encodeAttachment = (attachment: EmailAttachment) => ({
  filename: attachment.filename,
  content: typeof attachment.content === "string"
    ? Buffer.from(attachment.content, "utf8").toString("base64")
    : Buffer.from(attachment.content).toString("base64"),
  ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
});

export async function sendTransactionalEmail(input: EmailInput): Promise<EmailDeliveryResult> {
  if (!environment.resendApiKey || !environment.resendFromEmail) {
    return { configured: false, ok: false, providerReference: "", error: "Resend is not configured." };
  }

  const recipient = environment.reminderRecipientOverride ?? input.to;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${environment.resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
        "User-Agent": "hos-kitchen-reports/1.0",
      },
      body: JSON.stringify({
        from: environment.resendFromEmail,
        to: [recipient],
        subject: input.subject,
        text: input.text,
        html: input.html ?? `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#17352d"><h1 style="font-size:24px">${escapeHtml(input.subject)}</h1>${textToHtml(input.text)}</div>`,
        ...(input.attachments?.length ? { attachments: input.attachments.map(encodeAttachment) } : {}),
        ...(environment.resendReplyTo ? { reply_to: environment.resendReplyTo } : {}),
        tags: [
          { name: "category", value: input.category ?? "transactional" },
          { name: "environment", value: environment.isProduction ? "production" : "uat" },
        ],
      }),
      cache: "no-store",
    });

    const body = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: { message?: string } };
    if (!response.ok || !body.id) {
      return {
        configured: true,
        ok: false,
        providerReference: "",
        error: body.error?.message ?? body.message ?? `Resend returned ${response.status}.`,
      };
    }

    return { configured: true, ok: true, providerReference: body.id, error: "" };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      providerReference: "",
      error: error instanceof Error ? error.message : "Resend request failed.",
    };
  }
}
