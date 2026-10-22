import type { EventPlan } from "./types";

function futureDate(days: number, hour = 9): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

const twoWeeksAway = new Date();
twoWeeksAway.setDate(twoWeeksAway.getDate() + 14);
twoWeeksAway.setHours(0, 0, 0, 0);

export const demoPlan: EventPlan = {
  event: {
    id: "event-campus-futures",
    name: "Campus Futures Fest",
    subtitle: "A day for ideas in motion",
    date: twoWeeksAway.toISOString(),
    venueName: "North Campus · Innovation District",
    isSample: true,
  },
  venues: [
    { id: "venue-room-a", name: "Room A", type: "room", capacity: 48, zone: "North Wing", accessible: true, x: 28, y: 28, width: 190, height: 115 },
    { id: "venue-room-b", name: "Room B", type: "room", capacity: 36, zone: "North Wing", accessible: true, x: 254, y: 28, width: 168, height: 115 },
    { id: "venue-room-c", name: "Room C", type: "room", capacity: 40, zone: "East Wing", accessible: true, x: 458, y: 28, width: 188, height: 115 },
    { id: "venue-main-stage", name: "Main Stage", type: "stage", capacity: 180, zone: "Central Hall", accessible: true, x: 28, y: 184, width: 250, height: 142 },
    { id: "venue-registration", name: "Registration", type: "registration", capacity: 500, zone: "South Entry", accessible: true, x: 314, y: 184, width: 126, height: 62 },
    { id: "venue-food", name: "Food Court", type: "food", capacity: 120, zone: "South Entry", accessible: true, x: 468, y: 184, width: 178, height: 92 },
    { id: "venue-first-aid", name: "First Aid", type: "first-aid", capacity: 8, zone: "Central Hall", accessible: true, x: 314, y: 264, width: 126, height: 62 },
    { id: "venue-exit-west", name: "West Exit", type: "exit", capacity: 0, zone: "North Wing", accessible: true, x: 28, y: 354, width: 120, height: 46 },
    { id: "venue-accessible-route", name: "Accessible Route", type: "route", capacity: 0, zone: "Campus-wide", accessible: true, x: 462, y: 354, width: 184, height: 46 },
  ],
  volunteers: [
    { id: "volunteer-asha", name: "Asha Patel", role: "Workshop lead", availableFrom: "09:00", availableTo: "12:30" },
    { id: "volunteer-noah", name: "Noah Kim", role: "AV support", availableFrom: "09:00", availableTo: "16:00" },
    { id: "volunteer-maya", name: "Maya Chen", role: "Guest experience", availableFrom: "09:30", availableTo: "13:00" },
    { id: "volunteer-jules", name: "Jules Rivera", role: "Stage manager", availableFrom: "10:00", availableTo: "17:00" },
    { id: "volunteer-eli", name: "Eli Morgan", role: "Registration", availableFrom: "08:00", availableTo: "11:00" },
  ],
  equipment: [
    { id: "equipment-p1", name: "Projector P1", type: "Projection", status: "ready" },
    { id: "equipment-mic2", name: "Wireless Mic 02", type: "Audio", status: "needs-check" },
    { id: "equipment-kit3", name: "Robotics Kit 03", type: "Workshop kit", status: "ready" },
    { id: "equipment-pa1", name: "PA System 01", type: "Audio", status: "ready" },
    { id: "equipment-laptop7", name: "Laptop Set 07", type: "Computing", status: "ready" },
  ],
  sessions: [
    { id: "session-robotics", title: "Robotics Workshop", kind: "Workshop", venueId: "venue-room-a", start: "10:00", end: "11:00", expectedAttendance: 32, volunteerIds: ["volunteer-asha", "volunteer-noah"], equipmentIds: ["equipment-p1", "equipment-kit3"], dayOffset: 0 },
    { id: "session-coding", title: "Build for Tomorrow", kind: "Hackathon briefing", venueId: "venue-room-a", start: "10:00", end: "11:00", expectedAttendance: 42, volunteerIds: ["volunteer-maya"], equipmentIds: ["equipment-p1", "equipment-laptop7"], dayOffset: 0 },
    { id: "session-design", title: "Designing Better Futures", kind: "Workshop", venueId: "venue-room-b", start: "10:30", end: "12:00", expectedAttendance: 39, volunteerIds: ["volunteer-asha"], equipmentIds: ["equipment-mic2"], dayOffset: 0 },
    { id: "session-showcase", title: "Student Project Showcase", kind: "Showcase", venueId: "venue-main-stage", start: "11:30", end: "13:00", expectedAttendance: 116, volunteerIds: ["volunteer-jules", "volunteer-noah"], equipmentIds: ["equipment-pa1"], dayOffset: 0 },
    { id: "session-keynote", title: "The Next Good Idea", kind: "Keynote", venueId: "venue-room-c", start: "14:00", end: "15:00", expectedAttendance: 28, volunteerIds: ["volunteer-jules"], equipmentIds: ["equipment-mic2"], dayOffset: 0 },
  ],
  tasks: [
    { id: "task-access", title: "Confirm accessible route signage", area: "Safety & access", dueAt: futureDate(1, 17), completed: false, priority: "high", venueId: "venue-accessible-route" },
    { id: "task-projector", title: "Confirm projector P1 handoff", area: "AV & equipment", dueAt: futureDate(2, 15), completed: false, priority: "high", venueId: "venue-room-a" },
    { id: "task-firstaid", title: "Restock first-aid station", area: "Safety & access", dueAt: futureDate(3, 12), completed: true, priority: "normal", venueId: "venue-first-aid" },
    { id: "task-checkin", title: "Print volunteer check-in sheets", area: "People & operations", dueAt: futureDate(3, 16), completed: false, priority: "normal" },
    { id: "task-av", title: "Run sound check on Wireless Mic 02", area: "AV & equipment", dueAt: futureDate(-1, 15), completed: false, priority: "high", venueId: "venue-main-stage" },
  ],
};

export function createEmptyPlan(name: string, date: string): EventPlan {
  return {
    event: { id: `event-${crypto.randomUUID()}`, name, subtitle: "Your event workspace", date, venueName: "Add your venue details", isSample: false },
    venues: [], sessions: [], volunteers: [], equipment: [], tasks: [],
  };
}
