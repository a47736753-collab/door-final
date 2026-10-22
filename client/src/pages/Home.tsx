import { lazy, Suspense, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, Bell, Boxes, CalendarClock, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, Command, FileBarChart2, Gauge, ListChecks, Map, MapPin, Menu, Plus, Radio, Search, ShieldAlert, Sparkles, Users, WandSparkles, Waypoints, X } from "lucide-react";
import { toast } from "sonner";
import { ImportDialog } from "@/features/doorsopen/components/ImportDialog";
const ConflictGraph = lazy(() => import("@/features/doorsopen/components/ConflictGraph").then((module) => ({ default: module.ConflictGraph })));
const Overview = lazy(() => import("@/features/doorsopen/components/Overview").then((module) => ({ default: module.Overview })));
const Reports = lazy(() => import("@/features/doorsopen/components/Reports").then((module) => ({ default: module.Reports })));
const ResourcesTasks = lazy(() => import("@/features/doorsopen/components/ResourcesTasks").then((module) => ({ default: module.ResourcesTasks })));
const Schedule = lazy(() => import("@/features/doorsopen/components/Schedule").then((module) => ({ default: module.Schedule })));
const VenueMap = lazy(() => import("@/features/doorsopen/components/VenueMap").then((module) => ({ default: module.VenueMap })));
const WhatIfSimulator = lazy(() => import("@/features/doorsopen/components/WhatIfSimulator").then((module) => ({ default: module.WhatIfSimulator })));
import { runChecks, readinessScore } from "@/features/doorsopen/checks";
import { createEmptyPlan, demoPlan } from "@/features/doorsopen/demo-data";
import type { EventPlan, ReadinessIssue, WorkspaceId } from "@/features/doorsopen/types";

const navGroups: { label: string; items: { id: WorkspaceId; title: string; icon: typeof Gauge; caption?: string }[] }[] = [
  { label: "COMMAND", items: [{ id: "overview", title: "Overview", icon: Gauge }] },
  { label: "VENUE & TIME", items: [{ id: "map", title: "Venue map", icon: Map }, { id: "schedule", title: "Schedule", icon: CalendarDays }] },
  { label: "IMPACT", items: [{ id: "graph", title: "Conflict graph", icon: Waypoints }, { id: "simulator", title: "What-if simulator", icon: WandSparkles }] },
  { label: "OPERATIONS", items: [{ id: "resources", title: "Resources", icon: Boxes }, { id: "tasks", title: "Readiness tasks", icon: ListChecks }] },
  { label: "DECISIONS", items: [{ id: "reports", title: "Reports", icon: FileBarChart2 }] },
];
const workspaceTitle: Record<WorkspaceId, string> = { overview: "Overview", map: "Venue map", schedule: "Schedule", graph: "Conflict graph", simulator: "What-if simulator", resources: "Resources", tasks: "Readiness tasks", reports: "Reports" };
const workspaceForIssue = (issue: ReadinessIssue): WorkspaceId => issue.kind === "room" || issue.kind === "capacity" ? "schedule" : issue.kind === "equipment" || issue.kind === "volunteer" ? "resources" : issue.kind === "task" ? "tasks" : "graph";

function localDate(daysAhead = 14) {
  const date = new Date(); date.setDate(date.getDate() + daysAhead);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export default function Home() {
  const [plans, setPlans] = useState<EventPlan[]>([demoPlan]);
  const [activeEventId, setActiveEventId] = useState(demoPlan.event.id);
  const [workspace, setWorkspace] = useState<WorkspaceId>("overview");
  const [importOpen, setImportOpen] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState(localDate());
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [focusedIssue, setFocusedIssue] = useState<ReadinessIssue | null>(null);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const plan = plans.find((item) => item.event.id === activeEventId) ?? plans[0];
  const issues = useMemo(() => runChecks(plan), [plan]);
  const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
  const score = readinessScore(issues);
  const allTasks = plan.tasks.filter((task) => !task.completed).length;

  const updatePlan = (next: EventPlan) => setPlans((current) => current.map((item) => item.event.id === activeEventId ? { ...next, event: { ...next.event, confirmedAt: undefined } } : item));
  const confirmPlan = () => {
    if (issues.length > 0 || plan.sessions.length === 0) return;
    setPlans((current) => current.map((item) => item.event.id === activeEventId ? { ...item, event: { ...item.event, confirmedAt: new Date().toISOString() } } : item));
    toast.success("Final event plan confirmed", { description: "All current checks passed. Any later plan change will require a fresh review." });
  };
  const navigate = (next: WorkspaceId) => { setWorkspace(next); setMobileNavOpen(false); };
  const openIssue = (issue: ReadinessIssue) => {
    setFocusedIssue(issue);
    const firstVenue = issue.links.find((link) => link.kind === "venue");
    if (firstVenue) setSelectedVenueId(firstVenue.id);
    const firstSession = issue.links.find((link) => link.kind === "session");
    if (firstSession) setSelectedSessionId(firstSession.id);
    navigate(workspaceForIssue(issue));
  };
  const startSimulation = (sessionId: string) => { if (sessionId) setSelectedSessionId(sessionId); setWorkspace("simulator"); };

  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return [];
    return [
      ...issues.filter((issue) => `${issue.title} ${issue.explanation} ${issue.links.map((link) => link.label).join(" ")}`.toLocaleLowerCase().includes(query)).slice(0, 4).map((issue) => ({ type: "Issue", label: issue.title, detail: issue.kind, action: () => openIssue(issue) })),
      ...plan.sessions.filter((item) => `${item.title} ${item.start}`.toLocaleLowerCase().includes(query)).slice(0, 3).map((item) => ({ type: "Session", label: item.title, detail: item.start, action: () => { setSelectedSessionId(item.id); navigate("schedule"); } })),
      ...plan.venues.filter((item) => `${item.name} ${item.zone}`.toLocaleLowerCase().includes(query)).slice(0, 2).map((item) => ({ type: "Venue", label: item.name, detail: item.zone, action: () => { setSelectedVenueId(item.id); navigate("map"); } })),
    ].slice(0, 8);
  }, [search, issues, plan]);

  const createEvent = (event: React.FormEvent) => {
    event.preventDefault();
    const name = eventName.trim();
    if (!name || !eventDate) return;
    const next = createEmptyPlan(name, `${eventDate}T09:00:00`);
    setPlans((current) => [...current, next]); setActiveEventId(next.event.id); setWorkspace("overview");
    setEventDialogOpen(false); setEventName(""); setEventDate(localDate()); setFocusedIssue(null); setSelectedVenueId(null); setSelectedSessionId(null);
    toast.success("Event workspace created", { description: "It is empty until you add schedules, places and resources." });
  };

  const openNotices = () => { setNoticeOpen((value) => !value); setSearchOpen(false); };
  return <div className="app-shell">
    {mobileNavOpen && <button className="mobile-nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    <aside className={`command-sidebar ${mobileNavOpen ? "command-sidebar-open" : ""}`}>
      <button className="brand-lockup" onClick={() => navigate("overview")} aria-label="DoorsOpen overview"><img src="/doorsopen-mark.svg" alt=""/><span className="brand-name">Doors<span>Open</span></span><span className="brand-edition">OPS</span></button>
      <button className="event-switcher" onClick={() => document.getElementById("event-picker")?.focus()}><span className="event-avatar">{plan.event.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "EV"}</span><span className="event-switcher-copy"><small>ACTIVE EVENT</small><strong>{plan.event.name}</strong></span><ChevronDown size={15}/><select id="event-picker" aria-label="Select event" value={activeEventId} onChange={(event) => { setActiveEventId(event.target.value); setWorkspace("overview"); setFocusedIssue(null); setSelectedVenueId(null); setSelectedSessionId(null); }}><option value={demoPlan.event.id}>{demoPlan.event.name}</option>{plans.filter((item) => item.event.id !== demoPlan.event.id).map((item) => <option key={item.event.id} value={item.event.id}>{item.event.name}</option>)}</select></button>
      <button className="sidebar-add-event" onClick={() => setEventDialogOpen(true)}><Plus size={14}/>New event workspace</button>
      <div className="sidebar-nav" aria-label="Main navigation">{navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${workspace === item.id ? "nav-item-active" : ""}`} onClick={() => navigate(item.id)} aria-current={workspace === item.id ? "page" : undefined}><Icon size={17}/><span>{item.title}</span>{item.id === "graph" && issues.length > 0 && <span className="nav-badge">{issues.length}</span>}{item.id === "tasks" && allTasks > 0 && <span className="nav-badge nav-badge-muted">{allTasks}</span>}{workspace === item.id && <i className="nav-indicator"/>}</button>; })}</div>)}</div>
      <a className="nav-item" href="/acoustic" style={{ textDecoration: "none", marginTop: 14 }}><Radio size={17}/><span>Sound check-in</span></a>
      <div className="sidebar-spacer"/>
      <div className="sidebar-health"><div className="health-ring"><Activity size={15}/></div><div><small>READINESS SIGNAL</small><strong>{!plan.sessions.length ? "Add event data" : criticalCount ? `${criticalCount} blocker${criticalCount === 1 ? "" : "s"} to clear` : issues.length ? `${issues.length} items to review` : plan.event.confirmedAt ? "Plan confirmed" : "Checks are clear"}</strong></div><span className={criticalCount ? "health-indicator health-warning" : "health-indicator"}/></div>
      <div className="sidebar-footer"><div className="sidebar-footer-mark"><CircleHelp size={15}/></div><span><strong>Built for event crews</strong><small>Find it before doors open.</small></span><span className="version-label">v1.0</span></div>
    </aside>

      <div className="app-main"><header className="topbar"><div className="topbar-leading"><button className="icon-button mobile-menu-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={18}/></button><span className="topbar-context"><span>Event operations</span><span className="crumb-slash">/</span><strong>{workspaceTitle[workspace]}</strong></span><span className={`topbar-event-state ${criticalCount || !plan.sessions.length ? "topbar-state-attention" : ""}`}><i/>{!plan.sessions.length ? "No event data" : criticalCount ? "Needs attention" : issues.length ? "Review warnings" : plan.event.confirmedAt ? "Plan confirmed" : "Checks clear"}</span></div><div className="topbar-actions"><div className={`global-search ${searchOpen ? "global-search-open" : ""}`}><button className="icon-button" onClick={() => { setSearchOpen((value) => !value); setNoticeOpen(false); setSearch(""); }} aria-label="Search the event"><Search size={17}/></button>{searchOpen && <><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); setSearch(""); } if (event.key === "Enter" && searchResults[0]) searchResults[0].action(); }} placeholder="Search the event…" aria-label="Search event records"/><kbd>ESC</kbd>{search && <div className="search-popover">{searchResults.length ? searchResults.map((result, index) => <button className="search-result" key={`${result.type}-${result.label}-${index}`} onClick={() => { result.action(); setSearchOpen(false); setSearch(""); }}><span className="search-result-type">{result.type}</span><span><strong>{result.label}</strong><small>{result.detail}</small></span><ArrowRight size={14}/></button>) : <div className="search-empty">No matching issues or records.</div>}</div>}</>}</div><button className={`icon-button notification-button ${noticeOpen ? "icon-button-active" : ""}`} onClick={openNotices} aria-label="Readiness alerts"><Bell size={17}/>{issues.length > 0 && <i/>}</button><span className="topbar-divider"/><div className="operator-avatar" title="Event operations">EO</div><span className="operator-label">Event crew</span></div>
        {noticeOpen && <div className="notification-popover"><div className="notification-head"><span className="eyebrow">READINESS SIGNALS</span><button className="icon-button" onClick={() => setNoticeOpen(false)} aria-label="Close alerts"><X size={15}/></button></div>{issues.slice(0, 4).map((issue) => <button className="notification-item" key={issue.id} onClick={() => { setNoticeOpen(false); openIssue(issue); }}><span className={`notification-mark notification-${issue.severity}`}/><span><strong>{issue.title}</strong><small>{issue.kind} · {issue.severity}</small></span><ArrowRight size={13}/></button>)}{!issues.length && <div className="notification-clear"><Check size={14}/>No unresolved checks.</div>}<button className="notification-footer" onClick={() => { setNoticeOpen(false); navigate("graph"); }}>Open all issues <ArrowRight size={13}/></button></div>}
      </header>
      <main id="main-content" className="workspace-main" key={`${activeEventId}-${workspace}`}>
        <Suspense fallback={<div className="panel workspace-loading" role="status" aria-live="polite"><span className="live-dot"/>Opening {workspaceTitle[workspace]} workspace…</div>}>
        {workspace === "overview" && <Overview plan={plan} issues={issues} onNavigate={navigate} onOpenIssue={openIssue} onOpenImport={() => setImportOpen(true)} onConfirmPlan={confirmPlan}/>}
        {workspace === "map" && <VenueMap plan={plan} issues={issues} highlightVenueId={selectedVenueId} onSelectVenue={(venue) => setSelectedVenueId(venue.id)} onNavigate={(target) => navigate(target)} onOpenIssue={openIssue}/>}
        {workspace === "schedule" && <Schedule plan={plan} issues={issues} onSimulate={startSimulation} onOpenIssue={openIssue} focusSessionId={selectedSessionId}/>}
        {workspace === "graph" && <ConflictGraph key={focusedIssue?.id ?? "all-issues"} issues={issues} onOpenIssue={openIssue} focusIssueId={focusedIssue?.id}/>}
        {workspace === "simulator" && <WhatIfSimulator plan={plan} issues={issues} selectedSessionId={selectedSessionId} onCommit={(next) => { updatePlan(next); setFocusedIssue(null); toast.success("Proposed changes applied", { description: "Readiness checks were recalculated. Any remaining issues are still visible." }); }}/>}
        {(workspace === "resources" || workspace === "tasks") && <ResourcesTasks plan={plan} issues={issues} view={workspace} onPlanChange={updatePlan}/>}
        {workspace === "reports" && <Reports plan={plan} issues={issues} onConfirmPlan={confirmPlan}/>}
        </Suspense>
      </main>
      <footer className="global-footer"><span><i className="footer-pulse"/>DoorsOpen checks are rule-based and update when this event data changes.</span><span>SESSION-ONLY · NOT SAVED BETWEEN SESSIONS</span></footer>
    </div>

    <ImportDialog open={importOpen} plan={plan} onClose={() => setImportOpen(false)} onImported={updatePlan}/>
    {eventDialogOpen && <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventDialogOpen(false); }}><section className="dialog-panel event-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-event-title"><div className="dialog-heading"><div className="dialog-icon"><CalendarClock size={19}/></div><div><span className="eyebrow">NEW EVENT</span><h2 id="create-event-title">Open a fresh workspace</h2><p>Start with a clean plan, then import your event records.</p></div><button className="icon-button" onClick={() => setEventDialogOpen(false)} aria-label="Close create event dialog"><X size={18}/></button></div><form onSubmit={createEvent} className="event-create-form"><label className="form-field"><span>Event name</span><input autoFocus value={eventName} onChange={(event) => setEventName(event.target.value)} placeholder="e.g. Spring Innovation Fest" maxLength={72} required/></label><label className="form-field"><span>Event date</span><input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} required/></label><div className="event-empty-note"><Sparkles size={15}/><span>This workspace starts empty. Readiness metrics appear after you add real schedule and resource data.</span></div><div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setEventDialogOpen(false)}>Cancel</button><button type="submit" className="button button-primary" disabled={!eventName.trim()}><Plus size={15}/>Create workspace</button></div></form></section></div>}
  </div>;
}
