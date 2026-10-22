# DoorsOpen implementation plan

## Product and implementation approach

Build DoorsOpen as a responsive, single-page React + TypeScript command centre in the initialized web-db-user starter. Keep the first release frontend-only with synthetic event data and local React state; use the existing static Vite runtime rather than enabling server, database, or external services. Use existing Lucide React icons and Recharts where useful. Avoid adding a graph dependency: implement a clear SVG dependency graph and clickable SVG venue plan directly, with keyboard-accessible controls. Preserve the current starter's packages and project conventions.

Organize the interface into Overview, Venue Map, Schedule, Conflict Graph, What-If, Resources, Readiness Tasks, and Reports workspaces, selected from a persistent responsive navigation. Keep one canonical typed event model for sessions, venues, volunteers, equipment, assignments, and tasks. Central deterministic validation functions should check time overlap and same-room bookings; capacity; simultaneous or unavailable volunteer assignments; simultaneous equipment bookings; malformed or inconsistent records; and incomplete/overdue tasks. Derive readiness, severity, explanations, and the priority queue from these results rather than presenting fabricated success or statistics. Use a realistic clearly labeled demonstration event and communicate that its data is sample data.

The simulator should clone the current plan, allow moving Robotics Workshop from Room A to Room C, rerun every affected room/volunteer/equipment/capacity rule, and show before-versus-after issues. Room A's overlapping Coding Session conflict clears only when the validator confirms it; projector P1 remains explicitly unresolved until independently reassigned or made available. Do not mutate the original until an organiser applies the reviewed proposal, and do not label the event ready while blocking issues remain. Provide a browser-side CSV and Excel workbook import/validation path with clear required columns and an example/template; reject invalid or inconsistent rows with explanations instead of claiming they were imported. Load spreadsheet parsing on demand. Do not add persistence or claim durable imports in this frontend-first iteration.

Reports should be generated from current computed findings and tasks, with a print-friendly view and downloadable CSV summary. Search and severity/status filters should affect issues and relevant list views. Dashboard metrics should navigate to or reveal the corresponding filtered workspace. Venue cards/nodes and graph issue nodes should expose linked schedules, resources, and explanations. Add zoom/reset controls, graph focus/highlighting, and practical keyboard/focus states.

## Project structure

- `client/src/App.tsx`: keep the current root route and application providers; remove the starter placeholder.
- `client/src/pages/Home.tsx`: compose the command-centre shell and active workspace.
- `client/src/features/doorsopen/types.ts`: event, schedule, resource, task, issue, and simulation types.
- `client/src/features/doorsopen/demo-data.ts`: clearly identified deterministic demonstration event.
- `client/src/features/doorsopen/checks.ts`: pure validation, dependency propagation, readiness, and priority derivation.
- `client/src/features/doorsopen/components/`: navigation/header, metric panels, schedule, interactive venue SVG, dependency SVG graph, simulator, resources/tasks, and reports.
- `client/src/index.css`: dark design tokens, responsive layout, typography, states, and restrained motion.
- `client/public/manus-routes.json`: declare the implemented page route `/` before starting Preview.
- Root `app.config.ts`: add the required literal HTTPS project-logo URL while preserving any existing configuration; choose a stable DoorsOpen mark asset suitable for platform branding.

## Visual design

**Design movement:** Mission-control dashboard meets contemporary editorial data visualization: purposeful, precise, and calm under pressure.

**Core principles:** (1) Surface the next operational decision before secondary detail. (2) Make every warning traceable to its affected booking, person, place, or equipment. (3) Use consistent visual state language and plain explanations. (4) Keep density legible with generous grouping and responsive collapse.

**Color philosophy:** Deep ink-navy provides a low-glare, dependable operations backdrop; cool violet owns the DoorsOpen interface; cyan marks connected/selected/healthy system paths; amber and coral carry actionable warnings and blockers. Neutral slate supports hierarchy without making the interface feel like a generic neon console. Maintain contrast and pair color with labels/icons.

**Layout paradigm:** A persistent narrow command rail anchors navigation, while the active event workspace uses an asymmetric, information-led split: readiness and priority column alongside a larger event timeline/map/graph canvas. On smaller screens the rail becomes a compact menu and the content stacks without losing severity context.

**Signature elements:** A small split-door glyph in the wordmark; fine cyan dependency lines and small node pips; a segmented circular readiness dial with explicit score context.

**Interaction philosophy:** Every action should reveal its consequences. Select an issue to trace its related graph/map records; edit a proposed plan in an isolated simulation; explain every rule that remains unresolved. Use immediate responsive feedback and clear Apply/Discard controls.

**Animation:** Short 140–220 ms ease-out transitions for navigation, selection, and panels; subtle dash movement only on selected dependency paths; brief score/metric interpolation after a check; honor reduced-motion preferences. No looping decorative motion or delayed controls.

**Typography system:** Use a restrained contemporary sans for interface text (Inter/system fallback) and a tabular-capable mono accent for times, IDs, and metrics. Use clear, compact section labels; large numeric readiness score; readable body copy and consistent 12/14/16/22/30 px hierarchy.

**Brand essence:** The last-mile readiness console for event organisers, connecting operational conflicts to testable fixes before opening. Personality: composed, incisive, dependable.

**Brand voice:** Direct, calm, evidence-led; explain what conflicts, what is affected, and what must happen next. Examples: “Room A is booked twice from 10:00–11:00.” “Room conflict resolved; projector P1 still needs attention.”

**Wordmark & logo:** A custom geometric doorway mark made from two offset open brackets with a small cyan threshold, paired with a strongly tracked DoorsOpen wordmark; provide it as a simple authored SVG and use a durable HTTPS URL for `app.config.ts` branding.

**Signature brand color:** Signal violet (`#8B7CFF`), reserved for active DoorsOpen identity and primary actions.

## Serving and material constraints

The existing project is configured for static Vite development on port 3000, with server and database disabled. Continue using `pnpm dev:static` and the existing pinned dependencies. Do not enable managed services, authentication, or persistence for this synthetic-data frontend. Implement the route manifest before the first development-server start and keep it aligned with the single `/` application route. Static production output will be prepared from the same React app after implementation.
