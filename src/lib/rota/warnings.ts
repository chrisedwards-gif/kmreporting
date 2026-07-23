export type RotaWarningVisibility = "all" | "management";

export type ParsedRotaWarning = {
  message: string;
  visibility: RotaWarningVisibility;
};

const visibilityPrefix = /^\[\[visibility:(all|management)\]\]\s*/;

export function createRotaWarning(
  message: string,
  visibility: RotaWarningVisibility = "all",
): string {
  return `[[visibility:${visibility}]] ${message.trim()}`;
}

export function parseRotaWarning(raw: string): ParsedRotaWarning {
  const match = raw.match(visibilityPrefix);
  if (!match) {
    return {
      message: raw,
      // Existing warnings pre-date explicit visibility. Defaulting them to the
      // restricted audience is the safe migration behaviour.
      visibility: "management",
    };
  }

  return {
    message: raw.replace(visibilityPrefix, ""),
    visibility: match[1] as RotaWarningVisibility,
  };
}

export function prefixRotaWarning(prefix: string, raw: string): string {
  const parsed = parseRotaWarning(raw);
  return createRotaWarning(`${prefix}${parsed.message}`, parsed.visibility);
}

export function visibleRotaWarnings(
  warnings: string[],
  audience: "all" | "management",
): string[] {
  return warnings.flatMap((raw) => {
    const parsed = parseRotaWarning(raw);
    return audience === "management" || parsed.visibility === "all"
      ? [parsed.message]
      : [];
  });
}
