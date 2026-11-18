import "dotenv/config";
import type { Server as HTTPServer } from "node:http";
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { createRealtime } from "./realtime.js";

const port = 4000;

// On Vercel, app.ts is used as the Hono entry point and api/socket-io.ts
// handles Socket.IO. This file is only started during local development.
if (!process.env.VERCEL) {
  const httpServer = serve({
    fetch: app.fetch,
    port,
  });

  createRealtime(httpServer as HTTPServer);

  console.log("Hono + Socket.IO server running on port 4000");
}

export default app;
