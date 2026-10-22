import { useMemo, useRef, useState } from "react";
import { ArrowRight, CircleHelp, Hand, Minus, Plus, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import type { ReadinessIssue, Severity } from "../types";
import { IssueCard } from "./IssueCard";

const severityRank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const shortKind = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);

export function ConflictGraph({ issues, onOpenIssue, focusIssueId }: { issues: ReadinessIssue[]; onOpenIssue: (issue: ReadinessIssue) => void; focusIssueId?: string | null }) {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("all");
  const [selectedIssue, setSelectedIssue] = useState<string | null>(focusIssueId ?? null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const canvas = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => issues.filter((issue) => (severity === "all" || issue.severity === severity) && `${issue.title} ${issue.explanation} ${issue.links.map((link) => link.label).join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.title.localeCompare(b.title)), [issues, search, severity]);
  const focused = filtered.find((issue) => issue.id === selectedIssue) ?? filtered[0] ?? null;
  const entityMap = new Map<string, { id: string; kind: string; label: string; issues: string[] }>();
  for (const issue of filtered) for (const link of issue.links) {
    const key = `${link.kind}:${link.id}`;
    const item = entityMap.get(key) ?? { id: link.id, kind: link.kind, label: link.label, issues: [] };
    item.issues.push(issue.id); entityMap.set(key, item);
  }
  const entities = [...entityMap.values()];
  const graphHeight = Math.max(440, filtered.length * 82 + 40, entities.length * 66 + 40);
  const issueY = new Map(filtered.map((issue, index) => [issue.id, 48 + index * 82]));
  const entityY = new Map(entities.map((entity, index) => [entity.id + entity.kind, 52 + index * 66]));
  const reset = () => { setZoom(1); if (canvas.current) { canvas.current.scrollTo({ top: 0, left: 0, behavior: "smooth" }); } setSelectedIssue(null); };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pan || (event.target as HTMLElement).closest("[data-graph-node]")) return;
    if (!canvas.current) return;
    setDragging(true); canvas.current.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY, left: canvas.current.scrollLeft, top: canvas.current.scrollTop };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !canvas.current) return;
    canvas.current.scrollLeft = dragStart.current.left - (event.clientX - dragStart.current.x);
    canvas.current.scrollTop = dragStart.current.top - (event.clientY - dragStart.current.y);
  };

  return <div className="workspace-content">
    <div className="page-title-row"><div><div className="eyebrow-line"><span className="live-dot"/>IMPACT & DEPENDENCIES <span className="eyebrow-separator">/</span> CONFLICT GRAPH</div><h1>See what’s connected.</h1><p className="welcome-copy">Trace each issue back to the bookings, people and resources it touches.</p></div><div className="graph-stat"><strong>{filtered.length}</strong><span>visible issues</span></div></div>
    <section className="panel graph-panel"><div className="graph-toolbar"><label className="graph-search"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search issues, people, rooms…" aria-label="Search graph"/>{search && <button onClick={() => setSearch("")}>Clear</button>}</label><label className="graph-filter"><SlidersHorizontal size={14}/><select value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Filter issue severity"><option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></label><div className="graph-zoom"><button className={`icon-button ${pan ? "icon-button-active" : ""}`} onClick={() => setPan((value) => !value)} aria-pressed={pan} aria-label="Toggle pan mode"><Hand size={15}/></button><button className="icon-button" onClick={() => setZoom((value) => Math.max(0.72, value - 0.1))} aria-label="Zoom out"><Minus size={15}/></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" onClick={() => setZoom((value) => Math.min(1.45, value + 0.1))} aria-label="Zoom in"><Plus size={15}/></button><button className="icon-button" onClick={reset} aria-label="Reset graph"><RotateCcw size={14}/></button></div></div>
      <div className="graph-legend"><span><i className="graph-legend-issue"/>Issue</span><span><i className="graph-legend-session"/>Session</span><span><i className="graph-legend-resource"/>Place / person / resource</span><span className="graph-legend-hint"><CircleHelp size={13}/>Select a node to trace its connections</span></div>
      <div className={`graph-canvas ${pan ? "graph-pan-mode" : ""} ${dragging ? "graph-dragging" : ""}`} ref={canvas} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}>
        {filtered.length ? <svg className="dependency-svg" viewBox={`0 0 960 ${graphHeight}`} style={{ height: `${graphHeight}px`, minWidth: `${Math.max(960, 960 * zoom)}px` }} role="img" aria-label="Interactive graph connecting readiness issues to affected activities and resources">
          <g transform={`translate(0 0) scale(${zoom})`}>
            <text x="54" y="24" className="graph-column-label">OPEN ISSUE</text><text x="586" y="24" className="graph-column-label">AFFECTED RECORDS</text>
            {filtered.flatMap((issue) => issue.links.map((link) => <path key={`${issue.id}-${link.kind}-${link.id}`} d={`M 310 ${issueY.get(issue.id)! + 23} C 390 ${issueY.get(issue.id)! + 23}, 480 ${entityY.get(link.id + link.kind)! + 20}, 554 ${entityY.get(link.id + link.kind)! + 20}`} className={`graph-link ${focused?.id === issue.id ? "graph-link-focused" : ""} graph-link-${issue.severity}`}/>))}
            {filtered.map((issue) => { const y = issueY.get(issue.id)!; const active = focused?.id === issue.id; return <g key={issue.id} className={`graph-node graph-issue-node ${active ? "graph-node-selected" : ""} graph-node-${issue.severity}`} data-graph-node role="button" tabIndex={0} aria-label={`${issue.severity} issue: ${issue.title}`} onClick={() => setSelectedIssue(issue.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedIssue(issue.id); }}><rect x="48" y={y} width="266" height="48" rx="11"/><circle cx="64" cy={y + 17} r="4"/><text x="78" y={y + 19} className="graph-issue-kind">{issue.severity.toUpperCase()} · {issue.kind.toUpperCase()}</text><text x="62" y={y + 37} className="graph-node-label">{issue.title.length > 34 ? `${issue.title.slice(0, 33)}…` : issue.title}</text></g>; })}
            {entities.map((item) => { const y = entityY.get(item.id + item.kind)!; const linked = focused?.links.some((link) => link.id === item.id && link.kind === item.kind); return <g key={`${item.kind}-${item.id}`} className={`graph-node graph-entity-node graph-entity-${item.kind} ${linked ? "graph-node-linked" : ""}`} data-graph-node role="button" tabIndex={0} aria-label={`${shortKind(item.kind)}: ${item.label}`} onClick={() => { const issue = filtered.find((candidate) => candidate.links.some((link) => link.id === item.id && link.kind === item.kind)); if (issue) setSelectedIssue(issue.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { const issue = filtered.find((candidate) => candidate.links.some((link) => link.id === item.id && link.kind === item.kind)); if (issue) setSelectedIssue(issue.id); } }}><rect x="554" y={y} width="336" height="42" rx="10"/><circle cx="572" cy={y + 21} r="4"/><text x="587" y={y + 17} className="graph-entity-kind">{shortKind(item.kind).toUpperCase()} · {item.issues.length} LINK{item.issues.length === 1 ? "" : "S"}</text><text x="587" y={y + 32} className="graph-node-label">{item.label.length > 36 ? `${item.label.slice(0, 35)}…` : item.label}</text></g>; })}
          </g>
        </svg> : <div className="empty-state graph-empty"><div className="empty-icon"><Search size={19}/></div><h3>{issues.length ? "No issues match those filters" : "No open conflicts"}</h3><p>{issues.length ? "Try a different search or severity filter." : "The graph will connect any new issue to its affected records."}</p><button className="button button-quiet" onClick={() => { setSearch(""); setSeverity("all"); }}>Reset filters</button></div>}
      </div>
      <div className="graph-footer"><span>Dependency links are built from the current event plan and checks.</span><span>Pan: {pan ? "on — drag the canvas" : "off"}</span></div>
    </section>
    {focused && <section className="graph-inspector panel"><div className="inspector-heading"><div><span className="eyebrow">SELECTED CONFLICT</span><h2>Issue details</h2></div><button className="text-button" onClick={() => onOpenIssue(focused)}>Open in workspace <ArrowRight size={14}/></button></div><IssueCard issue={focused}/></section>}
  </div>;
}
