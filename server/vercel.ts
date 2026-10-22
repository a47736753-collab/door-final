import { createApp } from "./_core/app";

/**
 * Entry point for Vercel. `pnpm build:api` bundles this file into api/index.mjs,
 * which Vercel runs as one serverless function for everything under /api.
 * (The website itself is the static build in dist/public.)
 */
const { app } = createApp();

export default app;
