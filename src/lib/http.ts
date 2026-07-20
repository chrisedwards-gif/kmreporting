import "server-only";

import { headers } from "next/headers";

const asOrigin = (value: string | null | undefined) => {
  const candidate = value?.split(",")[0]?.trim();
  if (!candidate) return null;

  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `${candidate.startsWith("localhost") ? "http" : "https"}://${candidate}`;

  try {
    const url = new URL(withProtocol);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    return url.origin;
  } catch {
    return null;
  }
};

/**
 * Auth emails must always use the configured canonical URL in deployed
 * environments. Request headers remain a local-development fallback only, so
 * legacy Netlify aliases cannot leak into invitations or password-reset links.
 */
export async function getRequestOrigin() {
  const configuredOrigin = asOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configuredOrigin) return configuredOrigin;

  const requestHeaders = await headers();
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedOrigin = forwardedHost
    ? asOrigin(`${forwardedProtocol === "http" ? "http" : "https"}://${forwardedHost}`)
    : null;

  return forwardedOrigin
    ?? asOrigin(requestHeaders.get("host"))
    ?? asOrigin(process.env.VERCEL_BRANCH_URL)
    ?? asOrigin(process.env.VERCEL_URL);
}
