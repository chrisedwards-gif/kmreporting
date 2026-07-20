import "server-only";

export type ReminderDeliveryResult = {
  ok: boolean;
  status: number;
  providerReference: string;
  error: string;
};

export async function deliverReminderWebhook(url: string, payload: unknown): Promise<ReminderDeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });

    const providerReference = response.headers.get("x-request-id")
      ?? response.headers.get("x-ms-request-id")
      ?? response.headers.get("trace-id")
      ?? "";

    return {
      ok: response.ok,
      status: response.status,
      providerReference: providerReference.slice(0, 250),
      error: response.ok ? "" : `Webhook returned HTTP ${response.status}.`,
    };
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "Webhook timed out after 10 seconds."
      : "Webhook delivery failed before a response was received.";

    return { ok: false, status: 0, providerReference: "", error: message };
  } finally {
    clearTimeout(timeout);
  }
}
