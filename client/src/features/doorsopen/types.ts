export type Severity = "critical" | "warning" | "info";
export type EntityKind = "event" | "session" | "venue" | "volunteer" | "equipment" | "task";
export type IssueKind = "room" | "capacity" | "volunteer" | "equipment" | "task" | "data" | "stale";

export interface LinkedEntity {
  id: string;
  kind: EntityKind;
  label: string;
}

export interface Venue {
  id: string;
  name: string;
  type: "stage" | "room" | "food" | "registration" | "first-aid" | "exit" | "route";
  capacity: number;
  zone: string;
  accessible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  csvRow?: number;
}

export interface Volunteer {
  id: string;
  name: string;
  role: string;
  availableFrom: string;
  availableTo: string;
  csvRow?: number;
}

export interface Equipment {
  id: string;
  name: string;
  type: string;
  status: "ready" | "needs-check";
  csvRow?: number;
}

export interface Session {
  id: string;
  title: string;
  kind: string;
  venueId: string;
  start: string;
  end: string;
  expectedAttendance: number;
  volunteerIds: string[];
  equipmentIds: string[];
  dayOffset: number;
  csvRow?: number;
}

export interface ReadinessTask {
  id: string;
  title: string;
  area: string;
  dueAt: string;
  completed: boolean;
  priority: "high" | "normal";
  venueId?: string;
  csvRow?: number;
}

export interface EventRecord {
  id: string;
  name: string;
  subtitle: string;
  date: string;
  venueName: string;
  isSample: boolean;
  confirmedAt?: string;
  csvRow?: number;
}

export interface EventPlan {
  event: EventRecord;
  venues: Venue[];
  sessions: Session[];
  volunteers: Volunteer[];
  equipment: Equipment[];
  tasks: ReadinessTask[];
}

export interface ReadinessIssue {
  id: string;
  kind: IssueKind;
  severity: Severity;
  title: string;
  explanation: string;
  recommendation: string;
  links: LinkedEntity[];
}

export type WorkspaceId = "overview" | "map" | "schedule" | "graph" | "simulator" | "resources" | "tasks" | "reports";

export interface SimulationResult {
  proposed: EventPlan;
  before: ReadinessIssue[];
  after: ReadinessIssue[];
  resolved: ReadinessIssue[];
  remaining: ReadinessIssue[];
  introduced: ReadinessIssue[];
}

export function timeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return Number.NaN;
  return hours * 60 + minutes;
}

export function formatTime(value: string): string {
  const minutes = timeToMinutes(value);
  if (!Number.isFinite(minutes)) return value;
  const hours = Math.floor(minutes / 60);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}
