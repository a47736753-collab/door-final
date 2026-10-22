import type { Equipment, EventPlan, ReadinessTask, Session, Venue, Volunteer } from "./types";
import { timeToMinutes } from "./types";

type Row = Record<string, unknown>;

export interface ImportOutcome {
  plan?: EventPlan;
  errors: string[];
  added: number;
}

const text = (row: Row, key: string) => String(row[key] ?? "").trim();
const normalized = (value: string) => value.trim().toLocaleLowerCase();
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export async function parseEventFile(file: File, current: EventPlan): Promise<ImportOutcome> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const XLSX = await import("xlsx");
  const book = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return { errors: ["The file has no readable worksheet."], added: 0 };
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: false });
  if (rows.length === 0) return { errors: ["The worksheet is empty."], added: 0 };

  const errors: string[] = [];
  const next: EventPlan = {
    ...current,
    event: { ...current.event },
    venues: [...current.venues],
    sessions: [...current.sessions],
    volunteers: [...current.volunteers],
    equipment: [...current.equipment],
    tasks: [...current.tasks],
  };
  const seen = new Set<string>();
  const stagedSessions: { row: Row; rowNumber: number }[] = [];
  let added = 0;

  const remember = (type: string, name: string, rowNumber: number) => {
    const key = `${type}:${normalized(name)}`;
    if (seen.has(key)) errors.push(`Row ${rowNumber}: duplicate ${type} record “${name}”.`);
    seen.add(key);
  };
  const venueByName = () => new Map(next.venues.map((item) => [normalized(item.name), item]));
  const volunteerByName = () => new Map(next.volunteers.map((item) => [normalized(item.name), item]));
  const equipmentByName = () => new Map(next.equipment.map((item) => [normalized(item.name), item]));

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const type = normalized(text(row, "type"));
    if (!type) {
      errors.push(`Row ${rowNumber}: add a type (venue, volunteer, equipment, session, or task).`);
      return;
    }
    if (type === "session") {
      stagedSessions.push({ row, rowNumber });
      return;
    }
    if (type === "venue") {
      const name = text(row, "name");
      const capacity = Number(text(row, "capacity"));
      const accessibleValue = normalized(text(row, "accessible"));
      if (!name || !Number.isFinite(capacity) || capacity < 0 || !["true", "false"].includes(accessibleValue)) {
        errors.push(`Row ${rowNumber}: venue rows need a name, a non-negative capacity, and accessible set to true or false.`);
        return;
      }
      remember(type, name, rowNumber);
      if (venueByName().has(normalized(name))) {
        errors.push(`Row ${rowNumber}: venue “${name}” already exists in this event.`);
        return;
      }
      const venueType = normalized(text(row, "venueType"));
      const allowed = ["stage", "room", "food", "registration", "first-aid", "exit", "route"] as const;
      if (venueType && !allowed.includes(venueType as (typeof allowed)[number])) {
        errors.push(`Row ${rowNumber}: venueType “${venueType}” is not supported.`);
        return;
      }
      const validType = allowed.find((item) => item === venueType) ?? "room";
      const position = next.venues.length;
      next.venues.push({
        id: uid("venue"), name, capacity, zone: text(row, "zone") || "New area",
        type: validType, accessible: accessibleValue === "true",
        x: 35 + (position % 3) * 205, y: 30 + Math.floor(position / 3) * 108, width: 150, height: 94,
      });
      added += 1;
      return;
    }
    if (type === "volunteer") {
      const name = text(row, "name");
      const from = text(row, "availableFrom");
      const to = text(row, "availableTo");
      if (!name || !/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to) || !Number.isFinite(timeToMinutes(from)) || !Number.isFinite(timeToMinutes(to)) || timeToMinutes(from) >= timeToMinutes(to)) {
        errors.push(`Row ${rowNumber}: volunteer rows need a name and a valid availableFrom–availableTo time range.`);
        return;
      }
      remember(type, name, rowNumber);
      if (volunteerByName().has(normalized(name))) {
        errors.push(`Row ${rowNumber}: volunteer “${name}” already exists in this event.`);
        return;
      }
      const volunteer: Volunteer = { id: uid("volunteer"), name, role: text(row, "role") || "Event volunteer", availableFrom: from, availableTo: to };
      next.volunteers.push(volunteer);
      added += 1;
      return;
    }
    if (type === "equipment") {
      const name = text(row, "name");
      if (!name) { errors.push(`Row ${rowNumber}: equipment rows need a name.`); return; }
      remember(type, name, rowNumber);
      if (equipmentByName().has(normalized(name))) {
        errors.push(`Row ${rowNumber}: equipment “${name}” already exists in this event.`);
        return;
      }
      const equipment: Equipment = { id: uid("equipment"), name, type: text(row, "category") || "General", status: "ready" };
      next.equipment.push(equipment);
      added += 1;
      return;
    }
    if (type === "task") {
      const title = text(row, "name");
      const due = text(row, "dueAt");
      const dueAt = new Date(due);
      if (!title || !due || Number.isNaN(dueAt.getTime())) {
        errors.push(`Row ${rowNumber}: task rows need a name and a valid dueAt date.`);
        return;
      }
      remember(type, title, rowNumber);
      if (next.tasks.some((item) => normalized(item.title) === normalized(title))) {
        errors.push(`Row ${rowNumber}: task “${title}” already exists in this event.`);
        return;
      }
      const task: ReadinessTask = {
        id: uid("task"), title, area: text(row, "area") || "Event preparation", dueAt: dueAt.toISOString(),
        completed: normalized(text(row, "status")) === "complete", priority: normalized(text(row, "priority")) === "high" ? "high" : "normal",
      };
      next.tasks.push(task);
      added += 1;
      return;
    }
    errors.push(`Row ${rowNumber}: unsupported type “${type}”. Use venue, volunteer, equipment, session, or task.`);
  });

  for (const { row, rowNumber } of stagedSessions) {
    const title = text(row, "name");
    const room = text(row, "room");
    const start = text(row, "start");
    const end = text(row, "end");
    const attendanceRaw = text(row, "attendance");
    const attendance = Number(attendanceRaw);
    const venue = venueByName().get(normalized(room));
    const startMins = timeToMinutes(start);
    const endMins = timeToMinutes(end);
    if (!title || !room || !start || !end || !attendanceRaw || !Number.isFinite(attendance) || attendance < 0) {
      errors.push(`Row ${rowNumber}: session rows need name, room, start, end, and a non-negative attendance value.`);
      continue;
    }
    if (!Number.isFinite(startMins) || !Number.isFinite(endMins) || startMins >= endMins) {
      errors.push(`Row ${rowNumber}: “${title}” needs valid times with end after start.`);
      continue;
    }
    if (!venue) {
      errors.push(`Row ${rowNumber}: venue “${room}” is not in this event or another venue row in the file.`);
      continue;
    }
    if (next.sessions.some((session) => normalized(session.title) === normalized(title))) {
      errors.push(`Row ${rowNumber}: session “${title}” already exists in this event.`);
      continue;
    }
    remember("session", title, rowNumber);
    const volunteerNames = text(row, "volunteers").split(/[;,]/).map((item) => item.trim()).filter(Boolean);
    const equipmentNames = text(row, "equipment").split(/[;,]/).map((item) => item.trim()).filter(Boolean);
    const volunteers = volunteerByName();
    const equipment = equipmentByName();
    const missingVolunteers = volunteerNames.filter((name) => !volunteers.has(normalized(name)));
    const missingEquipment = equipmentNames.filter((name) => !equipment.has(normalized(name)));
    if (missingVolunteers.length) errors.push(`Row ${rowNumber}: unknown volunteer(s): ${missingVolunteers.join(", ")}. Import them as volunteer rows first.`);
    if (missingEquipment.length) errors.push(`Row ${rowNumber}: unknown equipment: ${missingEquipment.join(", ")}. Import it as an equipment row first.`);
    if (missingVolunteers.length || missingEquipment.length) continue;
    const dayOffsetRaw = text(row, "dayOffset");
    const dayOffset = dayOffsetRaw ? Number(dayOffsetRaw) : 0;
    if (!Number.isInteger(dayOffset) || dayOffset < 0) {
      errors.push(`Row ${rowNumber}: dayOffset must be a non-negative whole number.`);
      continue;
    }
    const session: Session = {
      id: uid("session"), title, kind: text(row, "category") || "Session", venueId: venue.id,
      start, end, expectedAttendance: attendance,
      volunteerIds: volunteerNames.map((name) => volunteers.get(normalized(name))!.id),
      equipmentIds: equipmentNames.map((name) => equipment.get(normalized(name))!.id),
      dayOffset,
    };
    next.sessions.push(session);
    added += 1;
  }

  if (errors.length > 0) return { errors, added: 0 };
  if (added === 0) return { errors: ["No supported event records were found in the first worksheet."], added: 0 };
  return { plan: next, errors: [], added };
}

const importHeaders = ["type", "name", "venueType", "capacity", "zone", "accessible", "role", "availableFrom", "availableTo", "category", "room", "start", "end", "attendance", "volunteers", "equipment", "dayOffset", "dueAt", "area", "status", "priority"];
const importRows = [
  { type: "venue", name: "Room D", venueType: "room", capacity: "42", zone: "East Wing", accessible: "true" },
  { type: "volunteer", name: "Jordan Lee", role: "AV coordinator", availableFrom: "09:00", availableTo: "17:00" },
  { type: "equipment", name: "Projector P2", category: "Projection" },
  { type: "session", name: "Interactive Data Lab", category: "Workshop", room: "Room D", start: "10:00", end: "11:30", attendance: "28", volunteers: "Jordan Lee", equipment: "Projector P2", dayOffset: "0" },
  { type: "task", name: "Place wayfinding signs", dueAt: "2026-11-01", area: "Safety & access", status: "open", priority: "high" },
];
export const importTemplate = [importHeaders, ...importRows.map((row) => importHeaders.map((header) => (row as Row)[header] ?? ""))].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
