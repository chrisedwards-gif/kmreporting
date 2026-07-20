"use client";

import { useEffect } from "react";

export function AuthFragmentGuard() {
  useEffect(() => {
    if (!window.location.hash.startsWith("#")) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    if (!params.get("error") && !params.get("error_code")) return;

    const message = params.get("error_description")?.replaceAll("+", " ")
      ?? "That email link is invalid or has expired. Request a new one.";
    window.location.replace(`/login?error=${encodeURIComponent(message)}`);
  }, []);

  return null;
}
