import {
  normaliseSiteName,
  parseCreditsOverview,
  parseGoodsDelivered,
  parseRotaCloudLabour,
  parseStockLinkEndOfWeek,
  type SourcePeriod,
} from "@/lib/reporting/imports";
import { parseStockLinkSalesInsights } from "@/lib/reporting/sales-imports";
import type { SalesInsightsInput } from "@/lib/types";

export type PackClassification =
  | "sales_eow"
  | "procure_goods"
  | "procure_credits"
  | "rotacloud_labour"
  | "stocktake_support"
  | "waste_support"
  | "supporting";

export type ParsedPackFile = {
  classification: PackClassification;
  parseStatus: "parsed" | "unrecognised" | "error";
  siteHint: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  summary: Record<string, unknown>;
  error: string;
  salesInsights?: SalesInsightsInput;
};

const hasAll = (content: string, tokens: string[]) => tokens.every((token) => content.toLowerCase().includes(token.toLowerCase()));

export function classifyWeeklyPackFile(fileName: string, content: string, expected: SourcePeriod): ParsedPackFile {
  const lowerName = fileName.toLowerCase();

  if (/End Of Week Report/i.test(content)) {
    try {
      const result = parseStockLinkEndOfWeek(content, expected);
      let salesInsights: SalesInsightsInput | undefined;
      try {
        const detail = parseStockLinkSalesInsights(content, expected, result.netSales);
        salesInsights = {
          days: detail.days.slice(0, 7),
          items: detail.items.slice(0, 100),
          categories: detail.categories.slice(0, 40),
        };
      } catch {
        salesInsights = undefined;
      }
      return {
        classification: "sales_eow",
        parseStatus: "parsed",
        siteHint: result.siteName,
        periodStart: result.period.start,
        periodEnd: result.period.end,
        summary: {
          grossSales: result.grossAfterAdjustments,
          vat: result.vat,
          serviceCharge: result.serviceCharge,
          netSales: result.netSales,
          dailyRows: salesInsights?.days.length ?? 0,
          itemRows: salesInsights?.items.length ?? 0,
          categoryRows: salesInsights?.categories.length ?? 0,
        },
        error: "",
        salesInsights,
      };
    } catch (error) {
      return recognisedError("sales_eow", error);
    }
  }

  if (hasAll(content, ["Purchaser Unit Name", "Date Delivered", "Total Price Net"])) {
    try {
      const result = parseGoodsDelivered(content, expected);
      return {
        classification: "procure_goods",
        parseStatus: "parsed",
        siteHint: result.siteName,
        periodStart: result.period.start,
        periodEnd: result.period.end,
        summary: { purchases: result.purchases, awaitingInvoice: result.awaitingInvoice, rowCount: result.rowCount },
        error: "",
      };
    } catch (error) {
      return recognisedError("procure_goods", error);
    }
  }

  if (hasAll(content, ["Credit Request Date", "Order Status", "Purchaser Unit"])) {
    try {
      const result = parseCreditsOverview(content, expected);
      return {
        classification: "procure_credits",
        parseStatus: "parsed",
        siteHint: result.siteName || null,
        periodStart: expected.start,
        periodEnd: expected.end,
        summary: {
          confirmedCredits: result.confirmedCredits,
          pendingCredits: result.pendingCredits,
          confirmedCount: result.confirmedCount,
          pendingCount: result.pendingCount,
        },
        error: "",
      };
    } catch (error) {
      return recognisedError("procure_credits", error);
    }
  }

  const looksLikeRotaCloud = /rotacloud|rota cloud/i.test(lowerName)
    || /total wage cost|estimated wage cost|paid hours|labour cost|labor cost/i.test(content.slice(0, 8000));
  if (looksLikeRotaCloud) {
    try {
      const result = parseRotaCloudLabour(content, expected);
      return {
        classification: "rotacloud_labour",
        parseStatus: "parsed",
        siteHint: result.siteName ?? null,
        periodStart: result.period?.start ?? expected.start,
        periodEnd: result.period?.end ?? expected.end,
        summary: { staffCost: result.staffCost, paidHours: result.paidHours },
        error: "",
      };
    } catch (error) {
      return recognisedError("rotacloud_labour", error);
    }
  }

  if (/stock|stocktake|stock take/i.test(lowerName)) {
    return support("stocktake_support");
  }
  if (/waste/i.test(lowerName)) {
    return support("waste_support");
  }
  return support("supporting");
}

export function packSiteMatches(siteHint: string | null, selectedSiteName: string) {
  if (!siteHint) return true;
  return normaliseSiteName(siteHint) === normaliseSiteName(selectedSiteName);
}

function recognisedError(classification: PackClassification, error: unknown): ParsedPackFile {
  return {
    classification,
    parseStatus: "error",
    siteHint: null,
    periodStart: null,
    periodEnd: null,
    summary: {},
    error: error instanceof Error ? error.message : "This recognised report could not be parsed.",
  };
}

function support(classification: PackClassification): ParsedPackFile {
  return {
    classification,
    parseStatus: "unrecognised",
    siteHint: null,
    periodStart: null,
    periodEnd: null,
    summary: {},
    error: "",
  };
}
