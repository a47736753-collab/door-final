import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, Clock3, List, MapPin, Users, Wrench } from "lucide-react";
import type { EventPlan, ReadinessIssue } from "../types";
import { formatTime, timeToMinutes } from "../types";

const leftOffset = 106;
const hourWidth = 88;

export function Schedule({ plan, issues, onSimulate, onOpenIssue, focusSessionId }: {
  plan: EventPlan;
  issues: ReadinessIssue[];
  onSimulate: (sessionId: string) => void;
  onOpenIssue: (issue: ReadinessIssue) => void;
  focusSessionId?: string | null;
}) {
  const dayOffsets = useMemo(() => [...new Set(plan.sessions.map((session) => session.dayOffset))].sort((a, b) => a - b), [plan.sessions]);
  const [selectedDay, setSelectedDay] = useState(dayOffsets[0] ?? 0);
  const [selected, setSelected] = useState<string | null>(focusSessionId ?? null);
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"timeline" | "agenda" | "calendar">("timeline");

  useEffect(() => {
    if (!focusSessionId) return;
    const focused = plan.sessions.find((session) => session.id === focusSessionId);
    if (focused) { setSelected(focused.id); setSelectedDay(focused.dayOffset); }
  }, [focusSessionId, plan.sessions]);
  useEffect(() => {
    if (dayOffsets.length > 0 && !dayOffsets.includes(selectedDay)) setSelectedDay(dayOffsets[0]);
  }, [dayOffsets, selectedDay]);

  const visible = useMemo(() => plan.sessions
    .filter((session) => session.dayOffset === selectedDay && (filter === "all" || session.venueId === filter))
    .sort((a, b) => a.start.localeCompare(b.start)), [plan.sessions, filter, selectedDay]);
  const calendarSessions = useMemo(() => plan.sessions
    .filter((session) => filter === "all" || session.venueId === filter)
    .sort((a, b) => a.dayOffset - b.dayOffset || a.start.localeCompare(b.start)), [plan.sessions, filter]);
  const picked = visible.find((session) => session.id === selected) ?? null;
  const sessionDays = visible.map((session) => ({ start: timeToMinutes(session.start), end: timeToMinutes(session.end) })).filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end));
  const firstHour = Math.min(8, ...sessionDays.map((range) => Math.floor(range.start / 60)));
  const lastHour = Math.max(19, ...sessionDays.map((range) => Math.ceil(range.end / 60)));
  const hours = Array.from({ length: Math.max(1, lastHour - firstHour) }, (_, index) => firstHour + index);
  const timelineWidth = leftOffset + hours.length * hourWidth;
  const toPosition = (value: string) => (timeToMinutes(value) - firstHour * 60) / 60 * hourWidth;
  const conflictingSessions = new Set(issues.flatMap((issue) => issue.links.filter((link) => link.kind === "session").map((link) => link.id)));
  const dayDate = (offset: number) => { const date = new Date(plan.event.date); date.setDate(date.getDate() + offset); return date; };
  const dateLabel = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(dayDate(selectedDay));
  const timeLabel = (hour: number) => hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
  const scheduleEmpty = (day = selectedDay) => plan.sessions.length === 0
    ? <div className="empty-state schedule-empty"><CalendarDays size={20}/><h3>No schedule yet</h3><p>Import sessions with a room, time and expected attendance to populate the schedule.</p></div>
    : <div className="empty-state schedule-empty"><CalendarDays size={20}/><h3>No sessions on Day {day + 1}</h3><p>Choose another event day or remove the venue filter.</p></div>;

  return <div className="workspace-content">
    <div className="page-title-row"><div><div className="eyebrow-line"><span className="live-dot"/>TIME & CONFLICTS <span className="eyebrow-separator">/</span> SCHEDULE</div><h1>Make the day flow.</h1><p className="welcome-copy">One time axis. Every room and assignment checked against it.</p></div><label className="filter-select"><span>Show</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All venues</option>{plan.venues.filter((venue) => venue.capacity > 0).map((venue) => <option value={venue.id} key={venue.id}>{venue.name}</option>)}</select><ChevronDown size={14}/></label></div>
    <section className="panel schedule-panel">
      <div className="schedule-panel-head"><div><span className="eyebrow">{view === "calendar" ? "EVENT CALENDAR" : view === "agenda" ? "EVENT AGENDA" : "DAY VIEW"}</span><h2>{view === "calendar" ? plan.event.name : dateLabel}</h2></div><div className="schedule-head-tools"><div className="schedule-days" role="tablist" aria-label="Event day">{dayOffsets.map((offset) => <button key={offset} role="tab" aria-selected={selectedDay === offset} className={selectedDay === offset ? "schedule-day-active" : ""} onClick={() => setSelectedDay(offset)}>Day {offset + 1}</button>)}</div><div className="schedule-view-toggle" role="group" aria-label="Schedule view"><button className={view === "timeline" ? "schedule-view-active" : ""} onClick={() => setView("timeline")} aria-pressed={view === "timeline"}><Clock3 size={13}/>Timeline</button><button className={view === "calendar" ? "schedule-view-active" : ""} onClick={() => setView("calendar")} aria-pressed={view === "calendar"}><CalendarDays size={13}/>Calendar</button><button className={view === "agenda" ? "schedule-view-active" : ""} onClick={() => setView("agenda")} aria-pressed={view === "agenda"}><List size={13}/>Agenda</button></div></div></div>
      {view === "timeline" ? <>
        <div className="schedule-legend"><span><i className="legend-dot legend-session"/>Session</span><span><i className="legend-dot legend-session-alert"/>Conflict-linked</span><span><Clock3 size={14}/>local event time</span></div>
        <div className="timeline-scroll"><div className="timeline-board" style={{ minWidth: `${timelineWidth}px` }}>
          <div className="timeline-axis"><div className="axis-label">VENUE / TIME</div><div className="axis-hours">{hours.map((hour) => <div className="axis-hour" key={hour}>{timeLabel(hour)}</div>)}</div></div>
          {plan.venues.filter((venue) => venue.capacity > 0 && (filter === "all" || venue.id === filter)).map((venue) => {
            const sessions = visible.filter((session) => session.venueId === venue.id);
            return <div className="schedule-track-row" key={venue.id}><div className="track-venue"><strong>{venue.name}</strong><span>{venue.capacity} seats · {venue.zone}</span></div><div className="track-lane">{hours.map((hour) => <i className="track-gridline" key={hour} style={{ left: `${(hour - firstHour) * hourWidth}px` }} />)}{sessions.map((session) => { const rawLeft = toPosition(session.start); const rawRight = toPosition(session.end); const valid = Number.isFinite(rawLeft) && Number.isFinite(rawRight); const left = valid ? Math.max(0, rawLeft) : 0; const width = valid ? Math.max(54, rawRight - rawLeft) : 116; const flagged = conflictingSessions.has(session.id); return <button key={session.id} className={`session-block ${flagged ? "session-block-alert" : ""} ${selected === session.id ? "session-block-selected" : ""}`} style={{ left: `${left}px`, width: `${width}px` }} onClick={() => setSelected(session.id)} title={`${session.title} · ${formatTime(session.start)}–${formatTime(session.end)}`}><span className="session-block-time">{formatTime(session.start)}–{formatTime(session.end)}</span><strong>{session.title}</strong><span className="session-block-meta">{session.expectedAttendance} expected</span></button>; })}</div></div>;
          })}
          {visible.length === 0 && scheduleEmpty()}
        </div></div>
      </> : view === "agenda" ? <div className="agenda-list">{visible.length === 0 ? scheduleEmpty() : visible.map((session) => { const venue = plan.venues.find((item) => item.id === session.venueId); const flagged = conflictingSessions.has(session.id); return <button key={session.id} className={`agenda-row ${flagged ? "agenda-row-alert" : ""} ${selected === session.id ? "agenda-row-selected" : ""}`} onClick={() => setSelected(session.id)}><span className="agenda-time">{formatTime(session.start)}<small>{formatTime(session.end)}</small></span><span className="agenda-kind">{session.kind.slice(0, 2).toUpperCase()}</span><span className="agenda-copy"><strong>{session.title}</strong><small><MapPin size={12}/>{venue?.name ?? "Venue needed"}<span>·</span>{session.expectedAttendance} expected</small></span><span className={`agenda-status ${flagged ? "agenda-status-alert" : ""}`}>{flagged ? "Review" : "Scheduled"}</span><ArrowRight size={14}/></button>; })}</div> : <div className="calendar-grid-scroll">{calendarSessions.length === 0 ? scheduleEmpty() : <div className="calendar-view-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, dayOffsets.length)}, minmax(205px, 1fr))` }}>{dayOffsets.map((offset) => { const date = dayDate(offset); const dateText = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date); const sessions = calendarSessions.filter((session) => session.dayOffset === offset); return <section className="calendar-day-column" key={offset}><button className={`calendar-day-heading ${selectedDay === offset ? "calendar-day-heading-active" : ""}`} onClick={() => setSelectedDay(offset)}><strong>Day {offset + 1}</strong><span>{dateText}</span></button>{sessions.length ? sessions.map((session) => { const venue = plan.venues.find((item) => item.id === session.venueId); const flagged = conflictingSessions.has(session.id); return <button key={session.id} className={`calendar-session ${flagged ? "calendar-session-alert" : ""} ${selected === session.id ? "calendar-session-selected" : ""}`} onClick={() => { setSelectedDay(offset); setSelected(session.id); }}><span className="calendar-session-time">{formatTime(session.start)}–{formatTime(session.end)}</span><strong>{session.title}</strong><small><MapPin size={12}/>{venue?.name ?? "Venue needed"}</small><span className={flagged ? "calendar-session-state calendar-session-state-alert" : "calendar-session-state"}>{flagged ? "Review conflict" : "Scheduled"}</span></button>; }) : <p className="calendar-day-empty">No sessions on this day.</p>}</section>; })}</div>}</div>}
      <div className="schedule-footer"><span><i className="status-pip status-pip-cyan"/>{view === "calendar" ? calendarSessions.length : visible.length} visible sessions</span><span><i className="status-pip status-pip-amber"/>{(view === "calendar" ? calendarSessions : visible).filter((session) => conflictingSessions.has(session.id)).length} session-linked issues</span>{visible.length > 0 && <button className="text-button" onClick={() => onSimulate(picked?.id ?? visible[0]?.id ?? "")}>Open what-if simulator <ArrowRight size={14}/></button>}</div>
    </section>
    <div className="schedule-detail-row">{picked ? <section className="panel selected-session-card"><div className="selected-session-main"><div className="session-kind-mark">{picked.kind.slice(0, 2).toUpperCase()}</div><div><span className="eyebrow">{picked.kind} · DAY {picked.dayOffset + 1}</span><h2>{picked.title}</h2><p><Clock3 size={13}/>{formatTime(picked.start)}–{formatTime(picked.end)} <span>·</span><MapPin size={13}/>{plan.venues.find((venue) => venue.id === picked.venueId)?.name ?? "Venue needed"}</p></div></div><div className="session-detail-stats"><span><Users size={14}/>{picked.expectedAttendance} expected</span><span><Users size={14}/>{picked.volunteerIds.map((id) => plan.volunteers.find((item) => item.id === id)?.name).filter(Boolean).join(", ") || "No volunteer assigned"}</span><span><Wrench size={14}/>{picked.equipmentIds.map((id) => plan.equipment.find((item) => item.id === id)?.name).filter(Boolean).join(", ") || "No equipment"}</span></div><div className="session-detail-issues">{issues.filter((issue) => issue.links.some((link) => link.id === picked.id)).map((issue) => <button key={issue.id} className="linked-issue-link" onClick={() => onOpenIssue(issue)}><span className={`status-pip status-pip-${issue.severity}`}/>{issue.title}<ArrowRight size={12}/></button>)}</div><button className="button button-quiet" onClick={() => onSimulate(picked.id)}>Test a change <ArrowRight size={14}/></button></section> : <section className="panel schedule-hint"><div className="empty-icon"><CalendarDays size={19}/></div><div><strong>Select a scheduled session</strong><span>Inspect its assignments, connected issues, or test a proposed move in the simulator.</span></div></section>}</div>
  </div>;
}
