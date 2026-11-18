import type { Namespace } from "socket.io";
import { z } from "zod";
import { COOKIE_NAME, getCookieValue, verifyToken } from "./auth";
import { db } from "./db";
import { areFriends } from "./friendship";
import { messages } from "./schema";

const sendMessageSchema = z.object({
  receiverId: z.string().uuid("Invalid receiver id"),
  content: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(2000, "Message is too long"),
});

type PrivateSocketData = {
  userId: string;
};

function userRoom(userId: string) {
  return `user:${userId}`;
}

export function setupPrivateChat(io: Namespace) {
  // fetchSockets() reads through the active adapter. With the Redis adapter
  // enabled, this includes sockets connected to other Vercel instances.
  async function broadcastOnlineUsers() {
    try {
      const sockets = await io.fetchSockets();

      const onlineUserIds = [
        ...new Set(
          sockets
            .map(
              (connectedSocket) =>
                (connectedSocket.data as PrivateSocketData).userId
            )
            .filter((userId): userId is string => Boolean(userId))
        ),
      ];

      io.emit("online_users", onlineUserIds);
    } catch (error) {
      console.error("Failed to broadcast online users:", error);
    }
  }

  // The socket handshake contains the same HttpOnly cookie as normal requests.
  io.use(async (socket, next) => {
    const token = getCookieValue(socket.handshake.headers.cookie, COOKIE_NAME);

    if (!token) {
      next(new Error("Unauthorized"));
      return;
    }

    const userId = await verifyToken(token);

    if (!userId) {
      next(new Error("Unauthorized"));
      return;
    }

    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId = (socket.data as PrivateSocketData).userId;

    socket.join(userRoom(userId));
    void broadcastOnlineUsers();

    console.log("Private chat connected:", userId);

    socket.on("send_message", async (payload) => {
      try {
        const result = sendMessageSchema.safeParse(payload);

        if (!result.success) {
          socket.emit("chat_error", {
            message: result.error.issues[0]?.message ?? "Invalid message",
          });
          return;
        }

        const { receiverId, content } = result.data;

        if (receiverId === userId) {
          socket.emit("chat_error", {
            message: "You cannot message yourself",
          });
          return;
        }
        
        if (!(await areFriends(userId, receiverId))) {
          socket.emit("chat_error", {
            message: "You can only message friends",
          });
          return;
        }
        if(!content.trim()){
          socket.emit("chat_error", {
            message: "Message cannot be empty",
          });
          return;
        }

        const [savedMessage] = await db
          .insert(messages)
          .values({
            senderId: userId,
            receiverId,
            content,
          })
          .returning();

        io.to(userRoom(userId))
          .to(userRoom(receiverId))
          .emit("receive_message", savedMessage);
      } catch (error) {
        console.error("Failed to send message:", error);
        socket.emit("chat_error", {
          message: "Message could not be sent",
        });
      }
    });

    socket.on("disconnect", () => {
      void broadcastOnlineUsers();
      console.log("Private chat disconnected:", userId);
    });
  });
}
