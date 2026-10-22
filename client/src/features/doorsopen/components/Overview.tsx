import { ArrowRight, CalendarDays, CheckCircle2, Clock3, MapPin, Radio, ShieldAlert, Sparkles, Users, Wrench } from "lucide-react";
import { priorityScore, readinessScore } from "../checks";
import type { EventPlan, ReadinessIssue, WorkspaceId } from "../types";
import { formatTime } from "../types";
import { IssueCard } from "./IssueCard";

const formatDate = (date: string) => new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date(date));
const daysAway = (date: string) => Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86400000));

export function Overview({
  plan, issues, onNavigate, onOpenIssue, onOpenImport, onConfirmPlan,
}: {
  plan: EventPlan;
  issues: ReadinessIssue[];
  onNavigate: (workspace: WorkspaceId) => void;
  onOpenIssue: (issue: ReadinessIssue) => void;
  onOpenImport: () => void;
  onConfirmPlan: () => void;
}) {
  const score = readinessScore(issues);
  const critical = issues.filter((issue) => issue.severity === "critical").length;
  const openTasks = plan.tasks.filter((task) => !task.completed).length;
  const highPriority = [...issues].sort((a, b) => priorityScore(issues, b, daysAway(plan.event.date)) - priorityScore(issues, a, daysAway(plan.event.date))).slice(0, 4);
  const schedule = [...plan.sessions].sort((a, b) => a.start.localeCompare(b.start));
  const circumference = 2 * Math.PI * 48;
  const progress = circumference * (1 - score / 100);
  const targetForIssue = (issue: ReadinessIssue): WorkspaceId => issue.kind === "room" || issue.kind === "capacity" ? "schedule" : issue.kind === "equipment" || issue.kind === "volunteer" ? "resources" : issue.kind === "task" ? "tasks" : "graph";

  return (
    <div className="workspace-content">
      <div className="welcome-row"><div><div className="eyebrow-line"><span className="live-dot" />EVENT OPERATIONS <span className="eyebrow-separator">/</span> OVERVIEW</div><h1>Find the friction<br className="desktop-only" /> before <span>doors open.</span></h1><p className="welcome-copy">One clear view of what’s ready, what’s blocked, and what to do next.</p></div><div className="overview-header-actions"><button className={`button ${issues.length === 0 && plan.sessions.length > 0 ? "button-primary" : "button-quiet"}`} onClick={onConfirmPlan} disabled={issues.length > 0 || plan.sessions.length === 0 || Boolean(plan.event.confirmedAt)} title={plan.event.confirmedAt ? "The current plan is confirmed; any change requires a fresh confirmation." : issues.length ? "Resolve every open check before confirming the plan." : plan.sessions.length === 0 ? "Add at least one session before confirming the plan." : undefined}><CheckCircle2 size={15} />{plan.event.confirmedAt ? "Plan confirmed" : "Confirm final plan"}</button><button className="button button-quiet" onClick={onOpenImport}><Radio size={15} />Import event data</button></div></div>

      {plan.event.isSample && <div className="sample-banner"><Sparkles size={15} /><span><strong>Live demo environment.</strong> Sample event data is shown; scores and checks are computed from this dataset.</span><button onClick={onOpenImport}>Replace with your data <ArrowRight size={13} /></button></div>}

      <div className="overview-top-grid">
        <section className="panel readiness-panel">
          <div className="panel-heading"><div><span className="eyebrow">READINESS STATUS</span><h2>Event readiness</h2></div><span className={`status-pill ${!plan.sessions.length || issues.length ? "status-attention" : "status-clear"}`}><span className="status-pip" />{!plan.sessions.length ? "Add event data" : critical ? "Action needed" : issues.length ? "Review warnings" : plan.event.confirmedAt ? "Plan confirmed" : "Clear to confirm"}</span></div>
          {plan.sessions.length === 0 && plan.tasks.length === 0 ? <div className="empty-state small-empty"><div className="empty-icon"><CalendarDays size={20} /></div><h3>Your event plan starts here</h3><p>Add your schedule and resources to see checks, capacity, conflicts and readiness here.</p><button className="button button-primary" onClick={onOpenImport}>Import your first records</button></div> : <div className="readiness-body"><div className="score-dial" aria-label={`Computed readiness score ${score} out of 100`}><svg viewBox="0 0 116 116" role="img" aria-hidden="true"><circle className="dial-track" cx="58" cy="58" r="48" /><circle className="dial-value" cx="58" cy="58" r="48" strokeDasharray={circumference} strokeDashoffset={progress} /></svg><div className="dial-copy"><strong>{score}</strong><span>/ 100</span></div><i className="dial-spark" /></div><div className="score-explainer"><span className="score-caption">BASED ON CURRENT CHECKS</span><p>{critical > 0 ? `${critical} critical issue${critical === 1 ? "" : "s"} need attention before this plan is ready to confirm.` : issues.length ? `${issues.length} open item${issues.length === 1 ? " is" : "s are"} worth reviewing before the event.` : "All current checks pass. An organiser can review and confirm the plan."}</p><button className="inline-link" onClick={() => onNavigate("graph")}>See what’s affecting the score <ArrowRight size={14} /></button></div></div>}
          <div className="readiness-footer"><span><CheckCircle2 size={14} />{plan.sessions.length} sessions checked</span><span><ShieldAlert size={14} />{issues.length} open items</span><span><Clock3 size={14} />{openTasks} tasks left</span></div>
        </section>

        <section className="panel event-card"><div className="event-card-top"><span className="eyebrow">UP NEXT</span><span className="event-date-tag"><CalendarDays size={13} />{formatDate(plan.event.date)}</span></div><div className="event-card-main"><div className="event-countdown"><strong>{daysAway(plan.event.date)}</strong><span>days</span></div><div className="event-card-copy"><h2>{plan.event.name || "Untitled event"}</h2><p>{plan.event.subtitle}</p></div></div><div className="event-location"><MapPin size={14} />{plan.event.venueName}</div><div className="event-countdown-track" aria-hidden="true"><span /></div><div className="event-card-footer"><span>Countdown to event day</span><button onClick={() => onNavigate("schedule")}>View schedule <ArrowRight size={14} /></button></div></section>
      </div>

      <div className="overview-lower-grid">
        <section className="panel priority-panel"><div className="panel-heading"><div><span className="eyebrow">DO THESE NEXT</span><h2>Priority queue <span className="count-bubble">{issues.length}</span></h2></div><button className="text-button" onClick={() => onNavigate("graph")}>All issues <ArrowRight size={14} /></button></div>
          {highPriority.length ? <div className="priority-list">{highPriority.map((issue, index) => <div className="priority-row" key={issue.id}><span className="priority-number">0{index + 1}</span><button className="priority-item-button" onClick={() => { onNavigate(targetForIssue(issue)); onOpenIssue(issue); }}><IssueCard issue={issue} compact /></button><span className="priority-score" title={`Priority score: 28 per severity level (${issue.severity}), up to 30 for event proximity, 3 per linked record, and up to 12 for related issues.`}>{priorityScore(issues, issue, daysAway(plan.event.date))}<small>priority*</small></span></div>)}</div> : <div className="empty-state compact-empty">{plan.sessions.length ? <CheckCircle2 size={19} /> : <CalendarDays size={18} />}<strong>{plan.sessions.length ? "No open issues in this plan" : "No check results yet"}</strong><span>{plan.sessions.length ? "Current checks are clear. Review the report and confirm when ready." : "Add schedules and resources before treating this plan as clear."}</span></div>}
        </section>
        <section className="panel timeline-panel"><div className="panel-heading"><div><span className="eyebrow">EVENT PROGRAM</span><h2>Event schedule <span className="count-bubble">{schedule.length}</span></h2></div><button className="text-button" onClick={() => onNavigate("schedule")}>Full timeline <ArrowRight size={14} /></button></div>
          {schedule.length ? <div className="timeline-list">{schedule.slice(0, 5).map((session) => { const room = plan.venues.find((venue) => venue.id === session.venueId); const related = issues.some((issue) => issue.links.some((link) => link.id === session.id)); return <button className={`timeline-item ${related ? "timeline-item-flagged" : ""}`} key={session.id} onClick={() => onNavigate("schedule")}><span className="timeline-time">{formatTime(session.start)}</span><span className="timeline-line"><i /></span><span className="timeline-copy"><strong>{session.title}</strong><span><MapPin size={12} />{room?.name ?? "Venue needed"}<span className="timeline-divider">·</span>{session.expectedAttendance} expected</span></span><span className={`timeline-state ${related ? "timeline-state-alert" : ""}`}>{related ? "Review" : "On plan"}</span></button>; })}</div> : <div className="empty-state compact-empty"><CalendarDays size={18} /><strong>No sessions added yet</strong><span>Import or add a schedule to see it here.</span></div>}
          <div className="timeline-note"><Users size={14} /><span>{plan.volunteers.length} volunteers</span><span className="timeline-divider">·</span><Wrench size={14} /><span>{plan.equipment.length} equipment items</span></div>
        </section>
      </div>
    </div>
  );
}
