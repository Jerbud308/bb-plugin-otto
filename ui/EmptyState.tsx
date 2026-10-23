// A blank ruled page: three hairline rules, one serif italic line, at most one action (BUILD_SPEC 12.4).
export interface EmptyStateProps {
  line: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ line, action }: EmptyStateProps) {
  return (
    <div className="otto-empty" role="status">
      <div className="otto-empty__rule" />
      <p className="otto-marginalia otto-empty__line">{line}</p>
      <div className="otto-empty__rule" />
      {action === undefined ? null : (
        <button type="button" className="otto-textbtn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      <div className="otto-empty__rule" />
    </div>
  );
}
