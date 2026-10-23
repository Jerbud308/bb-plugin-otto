// A verdict as a stamp: shape plus word, so it reads in grayscale (BUILD_SPEC 12.3).
import { useState } from "react";
import type { Verdict } from "../src/shared/contract";
import { GLYPH_CIRCLE, GLYPH_PATH, VERDICT_CLASS, VERDICT_GLYPH, VERDICT_WORD } from "./verdict";

// Card ids whose stamp has already landed this session, so it animates once.
const landed = new Set<string>();

export interface StampProps {
  verdict: Verdict;
  size?: "sm" | "md";
  cardId?: string;
  // Overrides the verdict word, for example "All claims verified".
  label?: string;
}

export function Stamp({ verdict, size = "sm", cardId, label }: StampProps) {
  const [land] = useState(() => {
    if (cardId === undefined) return false;
    const first = !landed.has(cardId);
    landed.add(cardId);
    return first;
  });
  const glyph = VERDICT_GLYPH[verdict];
  const word = label ?? VERDICT_WORD[verdict];
  return (
    <span
      className={`otto-stamp otto-stamp--${size} ${VERDICT_CLASS[verdict]}${land ? " otto-stamp--land" : ""}`}
      data-verdict={verdict}
      data-glyph={glyph ?? "none"}
    >
      {glyph === null ? null : (
        <svg className="otto-stamp__glyph" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          {glyph === "circle" ? (
            <circle cx={GLYPH_CIRCLE.cx} cy={GLYPH_CIRCLE.cy} r={GLYPH_CIRCLE.r} stroke="currentColor" strokeWidth="2" />
          ) : (
            <path d={GLYPH_PATH[glyph]} stroke="currentColor" strokeWidth="2" />
          )}
        </svg>
      )}
      <span className="otto-stamp__word">{word}</span>
    </span>
  );
}
