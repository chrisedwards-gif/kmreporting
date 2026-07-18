const required = ["STAGING_APP_URL", "IMPORT_SECRET", "STAGING_ORGANISATION_ID", "STAGING_SITE_ID"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error(`Missing staging environment values: ${missing.join(", ")}`);
}

const previousMonday = () => {
  const today = new Date();
  const weekday = today.getUTCDay() || 7;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - weekday - 6);
  monday.setUTCHours(12, 0, 0, 0);
  return monday;
};

const start = previousMonday();
const metrics = Array.from({ length: 7 }, (_, index) => {
  const day = new Date(start);
  day.setUTCDate(start.getUTCDate() + index);
  return {
    businessDate: day.toISOString().slice(0, 10),
    grossSales: 6_300 + index * 180,
    netSales: 5_250 + index * 150,
    covers: 185 + index * 8,
    foodPurchases: index === 1 || index === 4 ? 3_850 : 0,
    credits: index === 4 ? 125 : 0,
    wasteCost: 42 + index * 3,
    sourceReference: `staging-pulse-${day.toISOString().slice(0, 10)}`,
  };
});

const response = await fetch(`${process.env.STAGING_APP_URL}/api/imports/operations`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.IMPORT_SECRET}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    organisationId: process.env.STAGING_ORGANISATION_ID,
    siteId: process.env.STAGING_SITE_ID,
    sourceSystem: "staging-simulator",
    domains: ["sales", "purchasing", "waste"],
    metrics,
  }),
});

if (!response.ok) throw new Error(`Staging import failed with HTTP ${response.status}.`);
const result = await response.json();
process.stdout.write(`Imported ${result.imported} safe operational rows into staging.\n`);
