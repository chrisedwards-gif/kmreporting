import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return <main style={{ alignItems: "center", display: "flex", minHeight: "100vh", justifyContent: "center", padding: "1rem" }}><section className="panel empty-state"><FileQuestion aria-hidden="true" size={36} /><h2>Report not found.</h2><p>The report may be outside your assigned kitchens, or the link is no longer current.</p><Link className="button button--primary" href="/reports">Return to reports</Link></section></main>;
}
