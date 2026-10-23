// A hand-drawn ellipse around its children, used only for the Bake-off winner (BUILD_SPEC 12.3).
import type { ReactNode } from "react";

export function HandCircle({ children }: { children: ReactNode }) {
  return (
    <span className="otto-handcircle">
      {children}
      <svg className="otto-handcircle__svg" aria-hidden="true" data-handcircle="true">
        <ellipse className="otto-handcircle__ellipse" cx="50%" cy="50%" rx="49%" ry="46%" pathLength="100" />
      </svg>
    </span>
  );
}
