import Link from "next/link";
import { ArrowRight, CircleCheckBig } from "lucide-react";
import type { WorkbenchItem } from "@/lib/data/workbench";

export function Workbench({
  allClear,
  clearMessage,
  items,
}: {
  allClear: boolean;
  clearMessage: string;
  items: WorkbenchItem[];
}) {
  if (allClear) {
    return (
      <section aria-label="This week" className="workbench workbench--clear">
        <CircleCheckBig aria-hidden="true" size={18} />
        <div>
          <strong>All clear.</strong> {clearMessage}
          {items.map((item) => (
            <Link className="workbench__quiet-link" href={item.href} key={item.key}>{item.cta}</Link>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="This week" className="workbench">
      {items.map((item) => (
        <Link className={`workbench__item workbench__item--${item.tone}`} href={item.href} key={item.key}>
          {item.count !== null && <span className="workbench__count">{item.count}</span>}
          <span className="workbench__copy">
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </span>
          <span className="workbench__cta">{item.cta} <ArrowRight aria-hidden="true" size={14} /></span>
        </Link>
      ))}
    </section>
  );
}
