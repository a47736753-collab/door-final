import { useMemo } from "react";
import { ArrowDownToLine, Check, CheckCircle2, CircleAlert, FileText, Printer, ShieldCheck, TriangleAlert } from "lucide-react";
import { readinessScore } from "../checks";
import type { EventPlan, ReadinessIssue } from "../types";
import { IssueCard } from "./IssueCard";

const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function Reports({ plan, issues, onConfirmPlan }: { plan: EventPlan; issues: ReadinessIssue[]; onConfirmPlan: () => void }) {
  const score = plan.sessions.length ? readinessScore(issues) : null;
  const critical = issues.filter((issue) => issue.severity === "critical");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const complete = plan.tasks.filter((task) => task.completed);
  const open = plan.tasks.filter((task) => !task.completed);
  const breakdown = useMemo(() => [
    { label: "Schedule & rooms", count: issues.filter((item) => item.kind === "room" || item.kind === "capacity").length, color: "violet" },
    { label: "People & assignments", count: issues.filter((item) => item.kind === "volunteer").length, color: "cyan" },
    { label: "Equipment", count: issues.filter((item) => item.kind === "equipment").length, color: "amber" },
    { label: "Preparation tasks", count: issues.filter((item) => item.kind === "task").length, color: "coral" },
  ], [issues]);
  const exportCsv = () => {
    const rows = [
      ["DoorsOpen readiness report", plan.event.name],
      ["Generated", new Date().toISOString()],
      ["Readiness score", `${score}/100`],
      ["Critical issues", String(critical.length)],
      ["Warnings", String(warnings.length)],
      [],
      ["Severity", "Category", "Issue", "Explanation", "Recommended action", "Affected records"],
      ...issues.map((issue) => [issue.severity, issue.kind, issue.title, issue.explanation, issue.recommendation, issue.links.map((link) => link.label).join("; ")]),
      [],
      ["Task", "Area", "Status", "Due"],
      ...plan.tasks.map((task) => [task.title, task.area, task.completed ? "Complete" : "Open", task.dueAt]),
    ];
    const blob = new Blob([rows.map((row) => row.map((cell) => escapeCsv(String(cell ?? ""))).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `doorsopen-readiness-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className="workspace-content report-workspace">
    <div className="page-title-row"><div><div className="eyebrow-line"><span className="live-dot"/>DECISION SUPPORT <span className="eyebrow-separator">/</span> READINESS REPORT</div><h1>The plan, in plain sight.</h1><p className="welcome-copy">A live summary of checks, blockers and the actions still on the board.</p></div><div className="report-actions"><button className="button button-quiet" onClick={() => window.print()}><Printer size={15}/>Print view</button><button className="button button-quiet" disabled={issues.length > 0 || plan.sessions.length === 0 || Boolean(plan.event.confirmedAt)} onClick={onConfirmPlan} title={plan.event.confirmedAt ? "The current plan is confirmed." : issues.length ? "Resolve every open check before confirming the plan." : ""}><ShieldCheck size={15}/>{plan.event.confirmedAt ? "Confirmed" : "Confirm plan"}</button><button className="button button-primary" onClick={exportCsv}><ArrowDownToLine size={15}/>Export report</button></div></div>
    {plan.event.isSample && <div className="sample-banner"><FileText size={15}/><span><strong>Sample event report.</strong> All findings below are calculated from the current demo event data.</span></div>}
    <section className="panel report-cover"><div className="report-cover-top"><div><span className="eyebrow">EVENT READINESS SUMMARY</span><h2>{plan.event.name || "Untitled event"}</h2><p>{plan.event.venueName} · {new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(new Date(plan.event.date))}</p></div><div className={`report-verdict ${!plan.sessions.length ? "verdict-review" : critical.length ? "verdict-blocked" : issues.length ? "verdict-review" : "verdict-ready"}`}>{!plan.sessions.length ? <><FileText size={17}/><span>NO EVENT DATA TO CHECK</span></> : critical.length ? <><TriangleAlert size={17}/><span>NOT READY TO CONFIRM</span></> : issues.length ? <><CircleAlert size={17}/><span>REVIEW WARNINGS</span></> : plan.event.confirmedAt ? <><CheckCircle2 size={17}/><span>ORGANISER CONFIRMED</span></> : <><ShieldCheck size={17}/><span>CHECKS CLEAR · REVIEW TO CONFIRM</span></>}</div></div><div className="report-score-row"><div className="report-score"><strong>{score ?? "—"}</strong><span>{score === null ? "" : "/ 100"}</span><small>{score === null ? "waiting for sessions" : "computed readiness"}</small></div><div className="report-summary-stat"><span>Critical conflicts</span><strong className={critical.length ? "text-critical" : ""}>{critical.length}</strong><small>{plan.sessions.length ? "blocks a confident plan" : "no sessions to check"}</small></div><div className="report-summary-stat"><span>Remaining warnings</span><strong>{warnings.length}</strong><small>{plan.sessions.length ? "follow-up recommended" : "no sessions to check"}</small></div><div className="report-summary-stat"><span>Tasks complete</span><strong>{complete.length}<small> / {plan.tasks.length}</small></strong><small>{open.length} still open</small></div></div><p className="report-method-note"><CheckCircle2 size={14}/>{score === null ? "No readiness score is shown until at least one session is checked. After that, the score starts at 100 and deducts 14 per critical issue, 7 per warning, and 3 per informational item (minimum 0)." : "Score starts at 100 and deducts 14 per critical issue, 7 per warning, and 3 per informational item (minimum 0); every deduction comes from the current deterministic checks."}</p></section>
    <div className="report-grid"><section className="panel report-breakdown"><div className="panel-heading"><div><span className="eyebrow">OPEN ITEMS BY AREA</span><h2>Where attention goes</h2></div><span className="count-bubble">{issues.length}</span></div>{breakdown.map((item) => <div className="report-breakdown-row" key={item.label}><span className={`breakdown-bar breakdown-${item.color}`}><i style={{ width: `${issues.length ? Math.max(item.count ? 9 : 0, item.count / Math.max(1, issues.length) * 100) : 0}%` }}/></span><span>{item.label}</span><strong>{item.count}</strong></div>)}<div className="report-category-foot"><span>Critical issues require resolution before plan confirmation.</span></div></section><section className="panel report-next"><div className="panel-heading"><div><span className="eyebrow">RECOMMENDED ACTIONS</span><h2>What to do next</h2></div><span className="report-action-icon"><CircleAlert size={16}/></span></div>{issues.slice(0, 4).length ? issues.slice(0, 4).map((issue, index) => <div className="report-action-row" key={issue.id}><span className="report-action-index">0{index + 1}</span><span><strong>{issue.recommendation}</strong><small>For: {issue.title}</small></span><span className={`report-action-severity report-action-${issue.severity}`}>{issue.severity}</span></div>) : <div className="report-clear"><Check size={16}/>No current recommendations. Review and confirm the plan when ready.</div>}</section></div>
    <section className="panel report-findings"><div className="panel-heading"><div><span className="eyebrow">DETAILED FINDINGS</span><h2>Conflicts & warnings</h2></div><span className="report-findings-count">{issues.length} total</span></div>{issues.length ? <div className="report-issue-list">{issues.map((issue) => <IssueCard issue={issue} key={issue.id}/>)}</div> : <div className="empty-state report-empty">{plan.sessions.length ? <CheckCircle2 size={20}/> : <FileText size={20}/>}<h3>{plan.sessions.length ? "All current checks pass" : "No event data to check yet"}</h3><p>{plan.sessions.length ? "An organiser can review and confirm the final plan." : "Import at least one session to calculate conflicts and readiness."}</p></div>}</section>
    {plan.tasks.length > 0 && <section className="panel report-tasks"><div className="panel-heading"><div><span className="eyebrow">PREPARATION PROGRESS</span><h2>Readiness tasks</h2></div><span className="count-bubble">{complete.length}/{plan.tasks.length}</span></div><div className="report-task-grid">{plan.tasks.map((task) => <div className={`report-task-chip ${task.completed ? "report-task-done" : ""}`} key={task.id}>{task.completed ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}<span><strong>{task.title}</strong><small>{task.area} · {task.completed ? "Complete" : "Open"}</small></span></div>)}</div></section>}
  </div>;
}
