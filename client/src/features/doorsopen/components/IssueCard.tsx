import { ArrowUpRight, Check, Clock3, TriangleAlert } from "lucide-react";
import type { ReadinessIssue } from "../types";

const severityIcon = {
  critical: TriangleAlert,
  warning: Clock3,
  info: Check,
};

export function SeverityTag({ severity }: { severity: ReadinessIssue["severity"] }) {
  const Icon = severityIcon[severity];
  return <span className={`severity-tag severity-${severity}`}><Icon size={12} strokeWidth={2.1} />{severity}</span>;
}

export function IssueCard({
  issue,
  onOpen,
  compact = false,
}: {
  issue: ReadinessIssue;
  onOpen?: (issue: ReadinessIssue) => void;
  compact?: boolean;
}) {
  return (
    <article className={`issue-card ${compact ? "issue-card-compact" : ""}`}>
      <span className={`issue-mark issue-mark-${issue.severity}`} />
      <div className="issue-card-copy">
        <div className="issue-card-top"><SeverityTag severity={issue.severity} /><span className="issue-kind">{issue.kind}</span></div>
        <h3>{issue.title}</h3>
        {!compact && <p>{issue.explanation}</p>}
        <div className="issue-links" aria-label="Affected records">
          {issue.links.slice(0, compact ? 1 : 3).map((link) => <span key={`${link.kind}-${link.id}`} className={`entity-chip entity-${link.kind}`}>{link.label}</span>)}
          {issue.links.length > (compact ? 1 : 3) && <span className="entity-chip">+{issue.links.length - (compact ? 1 : 3)} linked</span>}
        </div>
        {!compact && <div className="issue-recommendation"><span>Next step</span>{issue.recommendation}</div>}
      </div>
      {onOpen && <button className="icon-button issue-open" onClick={() => onOpen(issue)} aria-label={`Open ${issue.title}`} title="Open affected records"><ArrowUpRight size={16} /></button>}
    </article>
  );
}
