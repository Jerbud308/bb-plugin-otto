// A thin bar split by verdict counts (BUILD_SPEC 12.3). NO_CLAIM is excluded.
import type { VerdictCounts } from "../src/shared/contract";

export interface RibbonProps {
  counts: VerdictCounts;
  // CSS width of the whole ribbon, for example 48 or "100%".
  width?: number | string;
  // Bar height in pixels.
  height?: number;
}

export function Ribbon({ counts, width = "100%", height = 6 }: RibbonProps) {
  const total = counts.VERIFIED + counts.UNVERIFIED + counts.CONTRADICTED;
  if (total === 0) return null;
  const segments = [
    { key: "verified", n: counts.VERIFIED },
    { key: "unverified", n: counts.UNVERIFIED },
    { key: "contradicted", n: counts.CONTRADICTED },
  ].filter((s) => s.n > 0);
  return (
    <span
      className="otto-ribbon"
      role="img"
      style={{ width, height }}
      aria-label={`${counts.VERIFIED} verified, ${counts.UNVERIFIED} unverified, ${counts.CONTRADICTED} contradicted`}
    >
      {segments.map((s) => (
        <span
          key={s.key}
          className={`otto-ribbon__seg otto-ribbon__seg--${s.key}`}
          data-segment={s.key}
          style={{ width: `${(s.n / total) * 100}%` }}
        />
      ))}
    </span>
  );
}
