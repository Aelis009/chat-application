import type { Server as HTTPServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { Server } from "socket.io";
import { getAllowedOrigins } from "../config/cors.js";
import { setupPrivateChat } from "./socket.js";

function attachRedisAdapter(io: Server) {

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

  if (!pubClient && !subClient) {
    console.error("Redis clients are not initialized. Socket.IO Redis adapter will not be enabled.");
    return;
  }

  io.adapter(createAdapter(pubClient, subClient));
  console.log("Socket.IO Redis adapter enabled");
}

export function createRealtime(httpServer: HTTPServer) {
  const io = new Server(httpServer, {
   
    path: process.env.VERCEL
      ? "/api/socket-io"
      : "/socket.io",

    transports: ["websocket"],
    cors: {
      origin: getAllowedOrigins(),
      credentials: true,
    },

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


  const privateNamespace = io.of("/private");

  attachRedisAdapter(io);
  setupPrivateChat(privateNamespace);

  return io;
}
