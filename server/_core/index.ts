import "dotenv/config";
import { createServer } from "http";
import { createApp } from "./app";
import { serveStatic, setupVite } from "./vite";

async function startServer() {
  const { app, ready } = createApp();
  const server = createServer(app);

  // Run database migrations now (if DATABASE_URL is set) so problems show up at startup
  await ready();

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
