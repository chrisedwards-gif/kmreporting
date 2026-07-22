const Line = ({ width = "100%" }: { width?: string }) => <span className="skeleton skeleton--line" style={{ width }} />;
const Card = ({ className = "" }: { className?: string }) => <div className={`skeleton skeleton--card ${className}`} />;

export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard" className="page-skeleton">
      <div className="page-skeleton__header"><div><Line width="180px" /><Line width="430px" /><Line width="320px" /></div><Card className="page-skeleton__button" /></div>
      <div className="page-skeleton__actions"><Card /><Card /><Card /></div>
      <div className="page-skeleton__metrics">{Array.from({ length: 6 }, (_, index) => <Card key={index} />)}</div>
      <div className="page-skeleton__dashboard"><div><Card className="page-skeleton__table" /><Card className="page-skeleton__chart" /></div><Card className="page-skeleton__review" /></div>
    </div>
  );
}

export function HubSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading workspace" className="page-skeleton">
      <div className="page-skeleton__header"><div><Line width="130px" /><Line width="360px" /><Line width="520px" /></div></div>
      <div className="page-skeleton__rows">{Array.from({ length: rows }, (_, index) => <Card key={index} />)}</div>
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading management summary" className="page-skeleton">
      <div className="page-skeleton__header"><div><Line width="180px" /><Line width="440px" /><Line width="520px" /></div><Card className="page-skeleton__button" /></div>
      <Card className="page-skeleton__summary-status" />
      <div className="page-skeleton__metrics">{Array.from({ length: 4 }, (_, index) => <Card key={index} />)}</div>
      <Card className="page-skeleton__report" />
    </div>
  );
}

export function WorkbenchSkeleton() {
  return <div aria-busy="true" aria-label="Loading actions" className="page-skeleton__actions"><Card /><Card /><Card /></div>;
}

export function MessageSkeleton() {
  return <Card className="page-skeleton__message" />;
}
