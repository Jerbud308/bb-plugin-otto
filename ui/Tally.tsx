// Tally marks: groups of five (four verticals and a diagonal), always beside the real number (BUILD_SPEC 12.3).
const GROUP_W = 18;
const MAX_MARKS = 50; // the number next to the marks carries the true count

export function Tally({ count, noun = ["win", "wins"] }: { count: number; noun?: [string, string] }) {
  const shown = Math.min(Math.max(0, Math.floor(count)), MAX_MARKS);
  const groups = Math.floor(shown / 5);
  const rest = shown % 5;
  const label = `${count} ${count === 1 ? noun[0] : noun[1]}`;
  const width = groups * GROUP_W + (rest > 0 ? rest * 4 + 2 : 0);
  return (
    <span className="otto-tally" title={label} role="img" aria-label={label}>
      {width === 0 ? null : (
        <svg className="otto-tally__marks" width={width} height="14" viewBox={`0 0 ${width} 14`} fill="none" aria-hidden="true">
          {Array.from({ length: groups }, (_, g) => {
            const x = g * GROUP_W;
            return (
              <g key={g} stroke="currentColor" strokeWidth="1.5">
                {[2, 6, 10, 14].map((dx) => (
                  <line key={dx} x1={x + dx} y1="1" x2={x + dx} y2="13" />
                ))}
                <line x1={x} y1="12" x2={x + 16} y2="2" />
              </g>
            );
          })}
          {Array.from({ length: rest }, (_, i) => {
            const x = groups * GROUP_W + 2 + i * 4;
            return <line key={`r${i}`} x1={x} y1="1" x2={x} y2="13" stroke="currentColor" strokeWidth="1.5" />;
          })}
        </svg>
      )}
      <span className="otto-mono otto-count">{count}</span>
    </span>
  );
}
