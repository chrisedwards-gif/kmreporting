"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main style={{ alignItems: "center", display: "flex", minHeight: "100vh", justifyContent: "center", padding: "1rem" }}><section className="panel empty-state"><TriangleAlert aria-hidden="true" size={36} /><h2>Something needs attention.</h2><p>No report was shared. Try the request again, or pass the reference to an administrator if it repeats.</p><button className="button button--primary" onClick={reset} type="button">Try again</button></section></main>;
}
