import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { initDatabase, isDbConfigured } from "../db";

/**
 * The Express app, without starting a server.
 *
 *  - server/_core/index.ts  starts it on a port (local development, or any host that runs Node)
 *  - server/vercel.ts       exports it so Vercel can run it as a serverless function
 *
 * `ready()` runs the database setup once (safe to call many times). The tRPC routes wait for it,
 * so the first request after a cold start on Vercel sets the tables up automatically.
 */
export function createApp() {
  const app = express();

  let setup: Promise<void> | null = null;
  const ready = () => {
    setup ??= initDatabase()
      .then(() => undefined)
      .catch((error) => {
        console.warn("[Database] Initialization warning, continuing:", error);
      });
    return setup;
  };

  // Body parser with a larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  app.get("/api/health", (_req, res) => res.json({ status: "ok", database: isDbConfigured() ? "configured" : "not configured" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app);

  // tRPC API: wait for the database setup first
  app.use("/api/trpc", (_req, _res, next) => {
    ready().then(() => next(), next);
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  return { app, ready };
}
