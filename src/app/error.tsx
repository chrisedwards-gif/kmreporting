"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <main style={{ alignItems: "center", display: "flex", minHeight: "100vh", justifyContent: "center", padding: "1rem" }}>
      <section className="panel empty-state">
        <TriangleAlert aria-hidden="true" size={36} />
        <h2>Something needs attention.</h2>
        <p>The page could not be loaded or the action could not be completed. Try again once; if it repeats, give the reference below to an administrator.</p>
        {error.digest ? <code style={{ background: "#f3efe7", borderRadius: ".45rem", padding: ".45rem .65rem" }}>Reference: {error.digest}</code> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".6rem", justifyContent: "center" }}>
          <button className="button button--primary" onClick={reset} type="button">Try again</button>
          <a className="button button--secondary" href="/dashboard">Return to dashboard</a>
        </div>
      </section>
    </main>
  );
}
