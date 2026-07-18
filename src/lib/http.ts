import "server-only";

import { headers } from "next/headers";

const validHost = /^(?:localhost(?::\d{1,5})?|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?)$/i;

// Derives the public origin from proxy-aware request headers so invitation and
// password-reset emails link back to the exact deployment that sent them.
export async function getRequestOrigin() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost ?? requestHeaders.get("host")?.trim();
  if (!host || !validHost.test(host)) return null;

  const forwardedProtocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : "https";
  if (protocol === "http" && !host.startsWith("localhost")) return null;

  return `${protocol}://${host}`;
}
