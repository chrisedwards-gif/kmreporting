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

// Uses request headers first, then Vercel's deployment host variables. Server
// Actions do not consistently expose a Host header in every proxy/runtime, so
// relying on that header alone can generate a null auth-email redirect.
export async function getRequestOrigin() {
  const requestHeaders = await headers();
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedOrigin = forwardedHost
    ? asOrigin(`${forwardedProtocol === "http" ? "http" : "https"}://${forwardedHost}`)
    : null;

  return forwardedOrigin
    ?? asOrigin(requestHeaders.get("host"))
    ?? asOrigin(process.env.NEXT_PUBLIC_APP_URL)
    ?? asOrigin(process.env.VERCEL_BRANCH_URL)
    ?? asOrigin(process.env.VERCEL_URL);
}
