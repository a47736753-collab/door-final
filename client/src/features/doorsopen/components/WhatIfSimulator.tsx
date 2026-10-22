import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, Check, CheckCircle2, ChevronDown, CircleAlert, Clock3, FlaskConical, GitCompareArrows, RotateCcw, Wrench } from "lucide-react";
import type { EventPlan, ReadinessIssue } from "../types";
import { formatTime } from "../types";
import { simulatePlan } from "../checks";
import { IssueCard } from "./IssueCard";

export function WhatIfSimulator({ plan, issues, selectedSessionId, onCommit }: {
  plan: EventPlan; issues: ReadinessIssue[]; selectedSessionId?: string | null; onCommit: (plan: EventPlan) => void;
}) {
  const firstSession = plan.sessions.find((session) => session.id === selectedSessionId) ?? plan.sessions.find((session) => session.id === "session-robotics") ?? plan.sessions[0];
  const [sessionId, setSessionId] = useState(firstSession?.id ?? "");
  const initialDestination = selectedSessionId ? firstSession?.venueId : plan.venues.find((venue) => venue.name === "Room C")?.id;
  const [roomId, setRoomId] = useState(initialDestination ?? "");
  const [start, setStart] = useState(firstSession?.start ?? "10:00");
  const [end, setEnd] = useState(firstSession?.end ?? "11:00");
  const [swapFrom, setSwapFrom] = useState("");
  const [swapTo, setSwapTo] = useState("");
  const [preview, setPreview] = useState<EventPlan | null>(null);
  const [applied, setApplied] = useState(false);
  const baselinePlan = useRef(plan);
  const session = plan.sessions.find((item) => item.id === sessionId) ?? null;
  const room = plan.venues.find((item) => item.id === roomId) ?? null;
  const baseline = useMemo(() => issues, [issues]);
  const comparison = preview ? simulatePlan(baselinePlan.current, preview) : null;
  const originalSession = baselinePlan.current.sessions.find((item) => item.id === sessionId) ?? session;
  const originalRoom = originalSession ? baselinePlan.current.venues.find((venue) => venue.id === originalSession.venueId) : null;
  const relevantRemaining = comparison?.after.filter((issue) => issue.links.some((link) => link.id === originalSession?.id) || (issue.kind === "equipment" && issue.links.some((link) => originalSession?.equipmentIds.includes(link.id)))) ?? [];
  const canRun = Boolean(session && room && start && end);
  const invalidatePreview = () => { if (applied) baselinePlan.current = plan; setPreview(null); setApplied(false); };

  const chooseSession = (id: string) => {
    const selected = plan.sessions.find((item) => item.id === id);
    baselinePlan.current = plan;
    setSessionId(id); setStart(selected?.start ?? "10:00"); setEnd(selected?.end ?? "11:00");
    setRoomId(selected?.venueId ?? ""); setPreview(null); setApplied(false); setSwapFrom(""); setSwapTo("");
  };
  const runSimulation = () => {
    if (!session || !room) return;
    baselinePlan.current = plan;
    const proposed: EventPlan = { ...plan, sessions: plan.sessions.map((item) => {
      if (item.id !== session.id) return item;
      let equipmentIds = [...item.equipmentIds];
      if (swapFrom && swapTo) equipmentIds = equipmentIds.map((id) => id === swapFrom ? swapTo : id);
      if (swapFrom && !swapTo) equipmentIds = equipmentIds.filter((id) => id !== swapFrom);
      return { ...item, venueId: room.id, start, end, equipmentIds };
    }) };
    setPreview(proposed); setApplied(false);
  };
  const apply = () => { if (!preview) return; onCommit(preview); setApplied(true); };
  const reset = () => { if (!session) return; baselinePlan.current = plan; setRoomId(session.venueId); setStart(session.start); setEnd(session.end); setSwapFrom(""); setSwapTo(""); setPreview(null); setApplied(false); };

  return <div className="workspace-content">
    <div className="page-title-row"><div><div className="eyebrow-line"><span className="live-dot"/>SCENARIO WORKSPACE <span className="eyebrow-separator">/</span> WHAT-IF SIMULATOR</div><h1>Try the fix before the fix.</h1><p className="welcome-copy">Test a change against the whole dependency chain. Nothing changes until you apply it.</p></div><span className="simulation-mode-pill"><FlaskConical size={14}/>isolated simulation</span></div>
    {plan.sessions.length === 0 ? <section className="panel empty-state simulator-empty"><div className="empty-icon"><FlaskConical size={22}/></div><h2>Add a schedule to start a scenario</h2><p>Import event sessions and resources; the simulator will test changes against their connected checks.</p></section> : <>
      <section className="simulator-builder panel"><div className="simulator-step"><div className="step-marker">01</div><div className="step-content"><span className="eyebrow">CHOOSE AN ACTIVITY</span><label className="select-field"><span>Session to adjust</span><div><select value={sessionId} onChange={(event) => chooseSession(event.target.value)}>{plan.sessions.map((item) => <option value={item.id} key={item.id}>{item.title} · {formatTime(item.start)}</option>)}</select><ChevronDown size={15}/></div></label>{session && <p className="current-plan-line">Currently <strong>{plan.venues.find((venue) => venue.id === session.venueId)?.name ?? "No venue"}</strong><span>·</span>{formatTime(session.start)}–{formatTime(session.end)}<span>·</span>{session.expectedAttendance} expected</p>}</div></div>
        <div className="simulator-connector"><i/></div>
        <div className="simulator-step"><div className="step-marker">02</div><div className="step-content"><span className="eyebrow">PROPOSE A CHANGE</span><div className="simulator-controls"><label className="select-field"><span>Move to venue</span><div><select value={roomId} onChange={(event) => { invalidatePreview(); setRoomId(event.target.value); }}><option value="">Choose venue</option>{plan.venues.filter((venue) => venue.capacity > 0).map((venue) => <option value={venue.id} key={venue.id}>{venue.name} · {venue.capacity} capacity{session && session.expectedAttendance > venue.capacity ? " · too small" : ""}</option>)}</select><ChevronDown size={15}/></div></label><label className="time-input"><span>Start time</span><input type="time" value={start} onChange={(event) => { invalidatePreview(); setStart(event.target.value); }}/></label><label className="time-input"><span>End time</span><input type="time" value={end} onChange={(event) => { invalidatePreview(); setEnd(event.target.value); }}/></label></div>
          {session && session.equipmentIds.length > 0 && <div className="resource-swap-row"><div className="swap-label"><Wrench size={14}/><span>Change one equipment assignment <small>Room changes never clear equipment bookings automatically.</small></span></div><label className="select-field swap-select"><span>Replace item</span><div><select value={swapFrom} onChange={(event) => { invalidatePreview(); setSwapFrom(event.target.value); setSwapTo(""); }}><option value="">No equipment change</option>{session.equipmentIds.map((id) => <option key={id} value={id}>{plan.equipment.find((item) => item.id === id)?.name ?? id}</option>)}</select><ChevronDown size={14}/></div></label>{swapFrom && <><ArrowRight size={14}/><label className="select-field swap-select"><span>With available item</span><div><select value={swapTo} onChange={(event) => { invalidatePreview(); setSwapTo(event.target.value); }}><option value="">Remove / unassign</option>{plan.equipment.filter((item) => item.id !== swapFrom).map((item) => <option key={item.id} value={item.id}>{item.name}{item.status === "needs-check" ? " · needs check" : ""}</option>)}</select><ChevronDown size={14}/></div></label></>}</div>}
        </div></div>
        <div className="simulator-action-row"><div className="simulation-explainer"><GitCompareArrows size={16}/><span>We’ll rerun every room, capacity, volunteer and equipment check touched by this session.</span></div><button className="button button-primary" disabled={!canRun} onClick={runSimulation}><FlaskConical size={15}/>Run simulation</button></div>
      </section>

      {preview && comparison && <section className="simulation-results" aria-live="polite"><div className="simulation-results-head"><div><span className="eyebrow">IMPACT ANALYSIS</span><h2>Proposed plan vs. current</h2></div><button className="button button-quiet" onClick={reset}><RotateCcw size={14}/>Reset proposal</button></div><div className="simulation-diff-bar"><div className="diff-column"><span>CURRENT PLAN</span><strong>{originalRoom?.name ?? "No venue"}</strong><small>{session?.title} · {session && formatTime(session.start)}–{session && formatTime(session.end)}</small></div><ArrowRight size={18}/><div className="diff-column diff-column-proposed"><span>PROPOSED</span><strong>{room?.name}</strong><small>{session?.title} · {formatTime(start)}–{formatTime(end)}</small></div><div className="diff-summary"><span className="diff-resolved"><CheckCircle2 size={15}/>{comparison.resolved.length} resolved</span><span className="diff-remaining"><CircleAlert size={15}/>{comparison.remaining.length + comparison.introduced.length} remain / new</span></div></div>
        {comparison.resolved.length === 0 && comparison.introduced.length === 0 && <div className="simulation-nochange"><CircleAlert size={15}/>No issue changed in this proposal. Try another time, room, or resource.</div>}
        <div className="simulation-outcomes"><div className="outcome-column"><div className="outcome-heading outcome-heading-good"><CheckCircle2 size={16}/><strong>Resolved by this change</strong><span>{comparison.resolved.length}</span></div>{comparison.resolved.length ? comparison.resolved.map((issue) => <div className="outcome-item outcome-item-good" key={issue.id}><span className="outcome-check"><Check size={13}/></span><div><strong>{issue.title}</strong><small>Checks pass for this connection in the proposed plan.</small></div></div>) : <p className="outcome-none">No current issue cleared by the proposal.</p>}</div><div className="outcome-column"><div className="outcome-heading outcome-heading-warn"><CircleAlert size={16}/><strong>Still needs attention</strong><span>{comparison.remaining.length + comparison.introduced.length}</span></div>{[...comparison.remaining, ...comparison.introduced].slice(0, 6).map((issue) => <div className="outcome-item outcome-item-warning" key={issue.id}><span className="outcome-alert">!</span><div><strong>{issue.title}</strong><small>{issue.explanation}</small></div></div>)}{comparison.remaining.length + comparison.introduced.length === 0 && <div className="outcome-item outcome-item-good"><span className="outcome-check"><Check size={13}/></span><div><strong>All relevant conflicts are clear</strong><small>Review the full readiness report before confirming the event plan.</small></div></div>}</div></div>
        {session?.id === "session-robotics" && plan.event.isSample && <div className="simulator-proof"><div className="proof-icon"><CircleAlert size={16}/></div><p><strong>Dependency check, not a label change.</strong> Moving Robotics Workshop to Room C removes its Room A booking conflict only if Room C has capacity and is available. Projector P1 remains double-booked with Build for Tomorrow until the equipment booking is independently changed or confirmed available.</p></div>}
        <div className="simulation-commit-row"><div><Clock3 size={14}/>{applied ? "Proposal applied to this browser session; blockers remain visible on the dashboard." : "The original plan is unchanged until you apply this proposal."}</div><button className={`button ${comparison.remaining.some((issue) => issue.severity === "critical") || comparison.introduced.some((issue) => issue.severity === "critical") ? "button-quiet" : "button-primary"}`} onClick={apply} disabled={applied || comparison.resolved.length === 0}><Check size={15}/>{applied ? "Applied" : "Apply proposed changes"}</button></div>
        {comparison.after.length > 0 && relevantRemaining.some((issue) => issue.kind === "equipment" && issue.title.includes("Projector P1")) && <p className="remaining-callout"><CircleAlert size={14}/>Room changes do not reassign equipment. Projector P1 is still unresolved; this proposal does not pass all event checks.</p>}
      </section>}
      {!preview && <section className="simulator-guidance"><span className="guidance-icon"><GitCompareArrows size={18}/></span><div><strong>Start with the collision that matters.</strong><p>Robotics Workshop and Build for Tomorrow overlap in Room A from 10:00–11:00 AM and both request Projector P1. Move Robotics to Room C, then inspect what still needs a human decision.</p></div><div className="guidance-arrow"><ArrowDown size={18}/></div></section>}
      {baseline.length === 0 && plan.sessions.length > 0 && <div className="clear-state-line"><CheckCircle2 size={14}/>The current event plan has no unresolved checks to simulate.</div>}
    </>}
  </div>;
}
