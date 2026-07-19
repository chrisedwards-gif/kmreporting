import Link from "next/link";
import type { PerformanceTrendPoint } from "@/lib/data/performance";
import { formatDate } from "@/lib/utils";

const WIDTH = 720;
const HEIGHT = 210;
const PAD_X = 42;
const PAD_Y = 24;

const xAt = (index: number, count: number) =>
  count <= 1 ? WIDTH / 2 : PAD_X + (index / (count - 1)) * (WIDTH - PAD_X * 2);

const yAt = (score: number) => {
  const normalised = (Math.max(1, Math.min(5, score)) - 1) / 4;
  return HEIGHT - PAD_Y - normalised * (HEIGHT - PAD_Y * 2);
};

export function PerformanceTrendChart({ points }: { points: PerformanceTrendPoint[] }) {
  const recent = points.slice(-12);
  const line = recent.map((point, index) => `${xAt(index, recent.length)},${yAt(point.overall)}`).join(" ");

  if (!recent.length) {
    return <div className="empty-inline">Finalise the first 1-1 to start the performance trend.</div>;
  }

  return (
    <div className="performance-chart">
      <svg aria-label="Overall 1-1 score trend from 1 to 5" className="performance-chart__svg" role="img" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {[1, 2, 3, 4, 5].map((score) => (
          <g key={score}>
            <line className="performance-chart__grid" x1={PAD_X} x2={WIDTH - PAD_X} y1={yAt(score)} y2={yAt(score)} />
            <text className="performance-chart__axis" x={16} y={yAt(score) + 4}>{score}</text>
          </g>
        ))}
        {recent.length > 1 ? <polyline className="performance-chart__line" fill="none" points={line} /> : null}
        {recent.map((point, index) => (
          <g key={point.reviewId}>
            <circle className="performance-chart__point" cx={xAt(index, recent.length)} cy={yAt(point.overall)} r={5} />
            <title>{`${point.managerName} · ${formatDate(point.weekCommencing)} · ${point.overall.toFixed(1)}`}</title>
          </g>
        ))}
      </svg>
      <div className="performance-chart__labels">
        {recent.map((point) => (
          <Link className="performance-chart__label" href={`/one-to-ones/${point.reviewId}`} key={point.reviewId}>
            <span>{formatDate(point.weekCommencing)}</span>
            <strong>{point.overall.toFixed(1)}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
