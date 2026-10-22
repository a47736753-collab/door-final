import { useEffect, useMemo, useState } from "react";
import { Accessibility, AlertTriangle, ArrowUpRight, DoorOpen, MapPin, RotateCcw, Users, Wrench, ZoomIn, ZoomOut } from "lucide-react";
import type { EventPlan, ReadinessIssue, Venue } from "../types";
import { formatTime } from "../types";

const venueGlyph: Record<Venue["type"], string> = { room: "R", stage: "ST", food: "F", registration: "IN", "first-aid": "+", exit: "EX", route: "↗" };

export function VenueMap({ plan, issues, highlightVenueId, onSelectVenue, onNavigate, onOpenIssue }: {
  plan: EventPlan;
  issues: ReadinessIssue[];
  highlightVenueId?: string | null;
  onSelectVenue?: (venue: Venue) => void;
  onNavigate: (workspace: "schedule" | "resources") => void;
  onOpenIssue: (issue: ReadinessIssue) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(highlightVenueId ?? null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => { if (highlightVenueId) setSelectedId(highlightVenueId); }, [highlightVenueId]);
  const selected = plan.venues.find((venue) => venue.id === selectedId) ?? null;
  const affectedIds = useMemo(() => new Set(issues.flatMap((issue) => issue.links.flatMap((link) => {
    if (link.kind === "venue") return [link.id];
    if (link.kind === "session") {
      const session = plan.sessions.find((item) => item.id === link.id);
      return session ? [session.venueId] : [];
    }
    return [];
  }))), [issues, plan.sessions]);
  const bookings = selected ? plan.sessions.filter((session) => session.venueId === selected.id).sort((a, b) => a.dayOffset - b.dayOffset || a.start.localeCompare(b.start)) : [];
  const bookingIds = new Set(bookings.map((booking) => booking.id));
  const selectedIssues = selected ? issues.filter((issue) => issue.links.some((link) => (link.kind === "venue" && link.id === selected.id) || (link.kind === "session" && bookingIds.has(link.id)))) : [];
  const assignedVolunteers = selected ? [...new Set(bookings.flatMap((booking) => booking.volunteerIds))].map((id) => plan.volunteers.find((volunteer) => volunteer.id === id)).filter((item) => item !== undefined) : [];
  const assignedEquipment = selected ? [...new Set(bookings.flatMap((booking) => booking.equipmentIds))].map((id) => plan.equipment.find((item) => item.id === id)).filter((item) => item !== undefined) : [];
  const peakAttendance = Math.max(...bookings.map((booking) => booking.expectedAttendance), 0);
  const select = (venue: Venue) => { setSelectedId(venue.id); onSelectVenue?.(venue); };

  return <div className="workspace-content">
    <div className="page-title-row"><div><div className="eyebrow-line"><span className="live-dot"/>SPACE & CAPACITY <span className="eyebrow-separator">/</span> VENUE MAP</div><h1>Read the room.</h1><p className="welcome-copy">Places, paths and pressure points — all on one floor plan.</p></div><div className="map-summary"><span>{plan.venues.length}<small>locations</small></span><span className="summary-divider"/><span>{affectedIds.size}<small>flagged</small></span></div></div>
    <section className="panel map-panel"><div className="map-toolbar"><div className="map-legend"><span><i className="legend-square legend-clear"/>Available</span><span><i className="legend-square legend-flag"/>Needs attention</span><span><i className="legend-square legend-selected"/>Selected</span><span><Accessibility size={14}/>Accessible</span></div><div className="zoom-controls"><span>{Math.round(zoom * 100)}%</span><button className="icon-button" onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))} aria-label="Zoom in"><ZoomIn size={16}/></button><button className="icon-button" onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))} aria-label="Zoom out"><ZoomOut size={16}/></button><button className="icon-button" onClick={() => { setZoom(1); setSelectedId(null); }} aria-label="Reset venue map"><RotateCcw size={15}/></button></div></div>
      <div className="map-layout"><div className="floorplan-scroll"><svg className="floorplan-svg" viewBox="0 0 690 420" role="img" aria-label="Interactive venue floor plan" style={{ transform: `scale(${zoom})` }}>
        <defs><pattern id="map-grid" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M18 0H0V18" fill="none" stroke="rgba(123,145,170,.06)" strokeWidth="1"/></pattern></defs>
        <rect x="0" y="0" width="690" height="420" rx="18" fill="url(#map-grid)"/>
        <path d="M160 330 L160 342 L510 342 L510 330" className="accessible-path"/><path d="M237 90 H246 M422 90 H450 M160 325 V355" className="hall-path"/>
        {plan.venues.map((venue) => {
          const flag = affectedIds.has(venue.id);
          const active = selected?.id === venue.id;
          return <g key={venue.id} className={`venue-node ${active ? "venue-node-active" : ""} ${flag ? "venue-node-flagged" : ""} venue-type-${venue.type}`} role="button" tabIndex={0} aria-label={`${venue.name}, ${venue.type}, capacity ${venue.capacity || "not applicable"}${flag ? ", needs attention" : ""}`} onClick={() => select(venue)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(venue); } }}>
            <rect x={venue.x} y={venue.y} width={venue.width} height={venue.height} rx={venue.type === "route" || venue.type === "exit" ? 15 : 12} className="venue-shape"/><circle cx={venue.x + 19} cy={venue.y + 19} r="10" className="venue-glyph-disc"/><text x={venue.x + 19} y={venue.y + 22} className="venue-glyph">{venueGlyph[venue.type]}</text><text x={venue.x + 15} y={venue.y + 47} className="venue-title">{venue.name}</text><text x={venue.x + 15} y={venue.y + 66} className="venue-subtitle">{venue.type === "route" ? "Step-free route" : venue.type === "exit" ? "Emergency exit" : `${venue.capacity} capacity · ${venue.zone}`}</text>{venue.accessible && <g><Accessibility x={venue.x + venue.width - 25} y={venue.y + 12} size={14} className="venue-access-icon"/></g>}{flag && <g><circle cx={venue.x + venue.width - 17} cy={venue.y + 17} r="9" className="venue-flag-disc"/><text x={venue.x + venue.width - 17} y={venue.y + 21} className="venue-flag-text">!</text></g>}
          </g>;
        })}
        {plan.venues.length === 0 && <text x="345" y="190" textAnchor="middle" className="map-svg-empty">No venue records yet — import your event spaces to map them.</text>}
      </svg><div className="map-pan-hint"><MapPin size={13}/>Select a location to inspect its bookings</div></div>
        <aside className="venue-detail-panel" aria-live="polite">{selected ? <>
          <div className="detail-topline"><span className={`venue-type-tag venue-type-tag-${selected.type}`}>{selected.type.replace("-", " ")}</span><span className={`venue-state-tag ${selectedIssues.length ? "venue-state-flagged" : ""}`}><i/>{selectedIssues.length ? `${selectedIssues.length} linked issue${selectedIssues.length === 1 ? "" : "s"}` : "No linked issues"}</span></div>
          <h2>{selected.name}</h2><p className="detail-location"><MapPin size={13}/>{selected.zone}<span>·</span>{selected.accessible ? "Step-free access" : "Access unconfirmed"}</p>
          {selected.capacity > 0 && <div className="capacity-meter"><div><span>Capacity</span><strong>{selected.capacity} <small>people</small></strong></div><div className="capacity-track"><i style={{ width: `${Math.min(100, peakAttendance / selected.capacity * 100)}%` }}/></div><small>Peak scheduled attendance: {peakAttendance} / {selected.capacity}</small></div>}
          <div className="detail-section-head"><strong>Bookings</strong><button className="inline-link" onClick={() => onNavigate("schedule")}>Schedule <ArrowUpRight size={12}/></button></div>
          {bookings.length ? <div className="venue-bookings">{bookings.map((booking) => { const linked = issues.some((issue) => issue.links.some((link) => link.id === booking.id)); return <div key={booking.id} className="venue-booking"><span className="booking-time">{formatTime(booking.start)}<small>–{formatTime(booking.end)}</small></span><div><strong>{booking.title}</strong><small>{booking.expectedAttendance} expected · day {booking.dayOffset + 1}</small></div><span className={linked ? "booking-warning" : "booking-clear"}>{linked ? "!" : "✓"}</span></div>; })}</div> : <div className="detail-empty">No sessions booked here.</div>}
          {selectedIssues.length > 0 && <div className="venue-alert-list">{selectedIssues.slice(0, 3).map((issue) => <button key={issue.id} className="venue-alert" onClick={() => onOpenIssue(issue)}><AlertTriangle size={14}/><span><strong>{issue.title}</strong>{issue.explanation}</span><ArrowUpRight size={12}/></button>)}</div>}
          <div className="detail-resources"><div className="detail-resource"><Users size={13}/><span><strong>Assigned crew</strong><small>{assignedVolunteers.length ? assignedVolunteers.map((item) => item.name).join(", ") : "No volunteer assigned"}</small></span></div><div className="detail-resource"><Wrench size={13}/><span><strong>Equipment status</strong><small>{assignedEquipment.length ? assignedEquipment.map((item) => `${item.name} · ${item.status === "ready" ? "ready" : "needs check"}`).join(", ") : "No equipment assigned"}</small></span></div></div>
          <button className="button button-quiet button-full" onClick={() => onNavigate("resources")}>View linked resources <ArrowUpRight size={14}/></button>
        </> : <div className="venue-selection-empty"><div className="empty-icon"><DoorOpen size={20}/></div><h3>Select a place</h3><p>Choose any room or location on the plan to see capacity, schedule and assigned resources.</p><span><MapPin size={13}/>Locations with an alert need attention.</span></div>}</aside>
      </div>
      <div className="map-footer-note"><span>FLOOR PLAN · {plan.event.venueName.toUpperCase()}</span><span><i className="accessible-route-line"/>step-free route shown</span></div>
    </section>
  </div>;
}
