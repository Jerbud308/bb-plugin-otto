// The race: one lane per contestant on a shared time axis, with a photo-finish line (BUILD_SPEC 14.5).
import type { Lane } from "../src/shared/contract";
import { buildRace, pct } from "./lanesModel";
import { formatDuration, formatTime } from "./verdict";

export interface LanesProps {
  startedAt: number;
  lanes: Lane[];
  nameOf: (providerId: string) => string;
  now: number;
}

const LANE_H = 28;
const MID = LANE_H / 2;

const clock = (ms: number): string => formatDuration(ms);

export function Lanes({ startedAt, lanes, nameOf, now }: LanesProps) {
  const race = buildRace(startedAt, lanes, now);
  const summary = race.lanes
    .map((l) => {
      const done = l.running ? "still running" : l.failed ? "failed" : `finished at ${clock(l.endMs)}`;
      return `${nameOf(l.providerId)} ${done}, ${l.ticks.length} commands`;
    })
    .join("; ");
  const first = race.firstFinishMs;
  return (
    <div className="otto-lanes">
      <div className="otto-lanes__plot" role="img" aria-label={`Race of ${race.lanes.length} agents. ${summary}`}>
        <div className="otto-lanes__rows">
          {race.lanes.map((l) => (
            <div key={l.contestantId} className="otto-lane" data-status={l.status}>
              <span className="otto-lane__label">{nameOf(l.providerId)}</span>
              <svg className="otto-lane__svg" height={LANE_H} aria-hidden="true">
                <line
                  className={l.running ? "otto-lane__line otto-lane__line--live" : "otto-lane__line"}
                  x1="0%"
                  y1={MID}
                  x2={`${pct(l.endMs, race.spanMs)}%`}
                  y2={MID}
                />
                {l.ticks.map((t, i) => (
                  <svg key={i} x={`${pct(t.ms, race.spanMs)}%`} y="0" width="1" height={LANE_H} overflow="visible">
                    {t.kind === "cmd" ? (
                      <line className="otto-tick otto-tick--cmd" x1="0" y1={MID - 3} x2="0" y2={MID + 3} />
                    ) : t.kind === "check" ? (
                      <line className="otto-tick otto-tick--check" x1="0" y1={MID - 5} x2="0" y2={MID + 5} />
                    ) : (
                      <line className="otto-tick otto-tick--failed" x1="-3" y1={MID + 5} x2="3" y2={MID - 5} />
                    )}
                  </svg>
                ))}
                {l.failed ? (
                  <text className="otto-lane__failtext" x="6" y={MID + 4}>
                    failed
                  </text>
                ) : null}
                {first !== null && l.atFirstFinish !== null ? (
                  <svg x={`${pct(first, race.spanMs)}%`} y="0" width="1" height={LANE_H} overflow="visible">
                    <circle className="otto-lane__where" cx="0" cy={MID} r="3" />
                  </svg>
                ) : null}
              </svg>
            </div>
          ))}
        </div>
        {first === null ? null : (
          <div className="otto-photo" style={{ left: `calc(var(--otto-lane-label) + (100% - var(--otto-lane-label)) * ${pct(first, race.spanMs) / 100})` }}>
            <span className="otto-photo__label otto-mono">first finish {clock(first)}</span>
          </div>
        )}
      </div>
      <div className="otto-axis" aria-hidden="true">
        {race.axis.map((ms) => (
          <span key={ms} className="otto-axis__tick otto-mono" style={{ left: `${pct(ms, race.spanMs)}%` }}>
            {clock(ms)}
          </span>
        ))}
      </div>
      <details className="otto-twin">
        <summary className="otto-textbtn">Race as a table</summary>
        <table className="otto-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Commands</th>
              <th>Checks</th>
              <th>Failed checks</th>
            </tr>
          </thead>
          <tbody>
            {race.lanes.map((l) => (
              <tr key={l.contestantId}>
                <td>{nameOf(l.providerId)}</td>
                <td className="otto-mono">{formatTime(startedAt)}</td>
                <td className="otto-mono">{l.running ? "running" : l.failed ? "failed" : clock(l.endMs)}</td>
                <td className="otto-mono">{l.ticks.length}</td>
                <td className="otto-mono">{l.ticks.filter((t) => t.kind === "check").length}</td>
                <td className="otto-mono">{l.ticks.filter((t) => t.kind === "failedCheck").length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
