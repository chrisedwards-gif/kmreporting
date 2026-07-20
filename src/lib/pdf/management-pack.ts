import { buildPdfDocument } from "@/lib/pdf/simple-pdf";
import { toSiteView, type ManagementPackInput } from "@/lib/pdf/management-pack-data";
import { drawGroupPage } from "@/lib/pdf/management-pack-group-page";
import { drawSitePages } from "@/lib/pdf/management-pack-site-pages";
import { drawFooter } from "@/lib/pdf/management-pack-theme";

export type { ManagementPackInput } from "@/lib/pdf/management-pack-data";

export const buildManagementPackPdf = (input: ManagementPackInput) => {
  const approvedReports = input.reports
    .filter((report) => ["approved", "shared"].includes(report.status))
    .map(toSiteView)
    .sort((left, right) => left.siteName.localeCompare(right.siteName));
  if (!approvedReports.length) throw new Error("At least one approved kitchen report is required to export the management pack.");

  const pageEntries = [
    { page: drawGroupPage(input, approvedReports), label: "Group management pack" },
    ...approvedReports.flatMap((report) => drawSitePages(input, report).map((page) => ({ page, label: report.siteName }))),
  ];
  pageEntries.forEach(({ page, label }, index) => drawFooter(page, index + 1, pageEntries.length, label));
  return buildPdfDocument(pageEntries.map(({ page }) => page));
};
