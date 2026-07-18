import { TrendingDown, TrendingUp } from "lucide-react";

type MetricCardProps = {
  label: string;
  value: string;
  note: string;
  trend?: "up" | "down" | "neutral";
  accent?: string;
};

export function MetricCard({ label, value, note, trend = "neutral", accent }: MetricCardProps) {
  return (
    <article className="metric-card" style={{ "--accent": accent } as React.CSSProperties}>
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      <div className="metric-card__note">
        {trend === "up" && <TrendingUp aria-hidden="true" size={13} />}
        {trend === "down" && <TrendingDown aria-hidden="true" size={13} />}
        {note}
      </div>
    </article>
  );
}
