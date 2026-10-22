# What is in this project

This is the PostgreSQL version of DoorsOpen with two sets of changes merged:

## From your friend (copied in unchanged, 8 files, all in `server/`)
- `affectedResources.ts`, `branching.ts`, `conflictDeltas.ts`, `incrementalChecker.ts` (new)
- `conflictDeltas.test.ts`, `incrementalChecker.test.ts` (new tests)
- `routers.ts` (events now save conflict changes; adds `events.state` and branch routes)
- `events.test.ts` (updated)

## From the sound check-in and Vercel work
- `client/src/features/acoustic/` and `server/acoustic/` (the sound feature and its tests)
- `client/src/App.tsx` (adds the `/acoustic` page) and `client/src/pages/Home.tsx` (one sidebar link)
- `server/_core/app.ts`, `server/_core/index.ts`, `server/vercel.ts`, `api/index.mjs`, `vercel.json` (Vercel deploy)
- `server/db.ts` (one line: smaller connection pool for serverless)
- `package.json` (adds `ggwave`, `build:api`, `build:vercel`), `.gitignore`, `.env.example`

No file was changed by both of you, so nothing had to be hand-merged.

## Not included on purpose
`.env`, `node_modules`, `dist`, `.git` and `.manus-logs`. Add `DATABASE_URL` in Vercel (see `DEPLOY-VERCEL.md`).

## First steps
    pnpm install
    pnpm test
    pnpm dev
