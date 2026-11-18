import "dotenv/config";
import type { Server as HTTPServer } from "node:http";
import { serve } from "@hono/node-server";
import { Server } from "socket.io";
import { app } from "./app";
import { setupPrivateChat } from "./socket";

const port = 4000;

const httpServer = serve({
  fetch: app.fetch,
  port,
});

const io = new Server(httpServer as HTTPServer, {
  cors: {
    origin: "http://localhost:3000",
    credentials: true,
  },
});

setupPrivateChat(io.of("/private"));

io.on("connection", (socket) => {
  console.log("User Connected:", socket.id);

  socket.on("send_message", (message) => {
    console.log("Message received:", message);

    io.emit("receive_message", message);
  });

  socket.on("disconnect", () => {
    console.log("User Disconnected:", socket.id);
  });
});

console.log("Hono + Socket.IO server running on port 4000");

