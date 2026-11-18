import type { Server as HTTPServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { Server } from "socket.io";
import { getAllowedOrigins } from "./cors.js";
import { setupPrivateChat } from "./socket.js";

// One Redis connection publishes, the other subscribes. The adapter forwards
// events between Vercel Function instances, not just within one instance.
function attachRedisAdapter(io: Server) {
  // Upstash's Vercel integration exposes the Redis-protocol URL as KV_URL.
  const redisUrl = process.env.REDIS_URL ?? process.env.KV_URL;

  if (!redisUrl) {
    return;
  }

  const pubClient = new Redis(redisUrl);
  const subClient = pubClient.duplicate();

  pubClient.on("error", (error) => {
    console.error("Redis publish client error:", error);
  });

  subClient.on("error", (error) => {
    console.error("Redis subscribe client error:", error);
  });

  io.adapter(createAdapter(pubClient, subClient));
  console.log("Socket.IO Redis adapter enabled");
}

export function createRealtime(httpServer: HTTPServer) {
  const io = new Server(httpServer, {
    // The Socket.IO transport path is the Vercel function route in production.
    // The namespace (/private) remains separate.
    path: process.env.VERCEL
      ? "/api/socket-io"
      : "/socket.io",
    // Vercel WebSocket Functions cannot use Socket.IO's HTTP long-polling
    // handshake because every request may land on a different instance.
    transports: ["websocket"],
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },
    // WebSocket upgrades are not covered by browser CORS. Reject a
    // handshake from an unknown browser origin, while still allowing
    // non-browser clients that send no Origin header.
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      const allowedOrigins = getAllowedOrigins();

      if (origin && !allowedOrigins.includes(origin)) {
        callback("Origin not allowed", false);
        return;
      }

      callback(null, true);
    },
  });

  // The namespace (/private) and the transport path (/socket.io) are separate.
  const privateNamespace = io.of("/private");

  attachRedisAdapter(io);
  setupPrivateChat(privateNamespace);

  return io;
}
