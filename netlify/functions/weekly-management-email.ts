export default async function weeklyManagementEmail() {
  const origin = (process.env.APP_ORIGIN ?? process.env.URL ?? "").replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!origin || !secret) throw new Error("APP_ORIGIN/URL and CRON_SECRET are required for scheduled management email delivery.");

  const response = await fetch(`${origin}/api/cron/management-email`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "User-Agent": "hos-kitchen-reports-netlify-scheduler/1.0",
    },
    body: "{}",
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Management email schedule returned ${response.status}: ${body}`);
  console.log("weekly management email check completed", body);
  return new Response(null, { status: 204 });
}

export const config = {
  schedule: "0 * * * *",
};
