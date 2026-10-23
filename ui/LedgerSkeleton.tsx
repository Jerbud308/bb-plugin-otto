// Loading state everywhere: ruled lines with a muted bar that fills while waiting. No spinners.
export function LedgerSkeleton({ rows }: { rows: number }) {
  return (
    <div className="otto-skel" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="otto-skel__row">
          <span className="otto-skel__bar" style={{ width: `${55 + ((i * 17) % 40)}%` }} />
        </div>
      ))}
    </div>
  );
}
