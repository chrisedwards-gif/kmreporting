import "server-only";

import { timingSafeEqual } from "node:crypto";

export function hasValidBearerSecret(authorization: string | null, expectedSecret?: string) {
  if (!authorization?.startsWith("Bearer ") || !expectedSecret) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedSecret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
