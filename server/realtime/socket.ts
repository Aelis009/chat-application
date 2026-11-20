import type { Namespace } from "socket.io";
import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { COOKIE_NAME, getCookieValue, verifyToken } from "../middleware/auth.js";
import { db } from "../db/client.js";
import { areFriends } from "../modules/friends/service.js";
import { groupMembers, groupMessages, groups, messages } from "../db/schema.js";
import { subscribeToGroupEvents } from "./group-events.js";

const sendMessageSchema = z.object({
  receiverId: z.string().uuid("Invalid receiver id"),
  content: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(10000, "Message is too long"),
});

const sendGroupMessageSchema = z.object({
  groupId: z.string().uuid("Invalid group id"),
  content: z.string().trim().min(1, "Message cannot be empty").max(10000),
});

const messageMutationSchema = z.object({
  messageId: z.string().uuid(),
  content: z.string().trim().min(1).max(10000).optional(),
});

const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

type PrivateSocketData = {
  userId: string;
};

function userRoom(userId: string) {
  return `user:${userId}`;
}

export function setupPrivateChat(io: Namespace) {
  subscribeToGroupEvents((event) => {
    if (event.type === "notification_created") {
      io.to(`user:${event.userId}`).emit(event.type, event.notification);
      return;
    }
    io.to(`group:${event.groupId}`).emit(event.type, event);
  });

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
    void db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId))
      .then((memberships) => {
        for (const membership of memberships) {
          socket.join(`group:${membership.groupId}`);
        }
      })
      .catch((error) => {
        console.error("Failed to join group rooms:", error);
      });
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

    socket.on("send_group_message", async (payload) => {
      try {
        const result = sendGroupMessageSchema.safeParse(payload);

        if (!result.success) {
          socket.emit("chat_error", {
            message: result.error.issues[0]?.message ?? "Invalid message",
          });

          return;
        }

        const [membership] = await db
          .select({
            id: groupMembers.id,
            role: groupMembers.role,
            onlyAdminsCanSend: groups.onlyAdminsCanSend,
          })
          .from(groupMembers)
          .innerJoin(groups, eq(groupMembers.groupId, groups.id))
          .where(
            and(
              eq(groupMembers.groupId, result.data.groupId),
              eq(groupMembers.userId, userId)
            )
          )
          .limit(1);

        if (!membership) {
          socket.emit("chat_error", {
            message: "You are not a member of this group",
          });
          return;
        }
        if (membership.onlyAdminsCanSend && membership.role === "member") {
          socket.emit("chat_error", {
            message: "Only group admins can send messages in this group",
          });
          return;
        }

        const [savedMessage] = await db
          .insert(groupMessages)
          .values({
            groupId: result.data.groupId,
            senderId: userId,
            content: result.data.content,
          })
          .returning();

        io.to(`group:${result.data.groupId}`).emit(
          "receive_group_message",
          savedMessage
        );
      } catch (error) {
        console.error("Failed to send group message:", error);
        socket.emit("chat_error", {
          message: "Group message could not be sent",
        });
      }
    });

    socket.on("edit_message", async (payload) => {
      const result = messageMutationSchema.safeParse(payload);
      if (!result.success || !result.data.content) {
        socket.emit("chat_error", { message: "Invalid message update" });
        return;
      }
      const [updatedMessage] = await db
        .update(messages)
        .set({ content: result.data.content, editedAt: new Date() })
        .where(
          and(
            eq(messages.id, result.data.messageId),
            eq(messages.senderId, userId),
            gte(
              messages.createdAt,
              new Date(Date.now() - MESSAGE_EDIT_WINDOW_MS)
            )
          )
        )
        .returning();
      if (!updatedMessage) {
        socket.emit("chat_error", { message: "Message not found or cannot be edited" });
        return;
      }
      io.to(userRoom(updatedMessage.senderId))
        .to(userRoom(updatedMessage.receiverId))
        .emit("message_updated", updatedMessage);
    });

    socket.on("delete_message", async (payload) => {
      const result = messageMutationSchema.safeParse(payload);
      if (!result.success) {
        socket.emit("chat_error", { message: "Invalid message deletion" });
        return;
      }
      const [deletedMessage] = await db
        .update(messages)
        .set({ deletedAt: new Date() })
        .where(and(eq(messages.id, result.data.messageId), eq(messages.senderId, userId)))
        .returning();
      if (!deletedMessage) {
        socket.emit("chat_error", { message: "Message not found or cannot be deleted" });
        return;
      }
      io.to(userRoom(deletedMessage.senderId))
        .to(userRoom(deletedMessage.receiverId))
        .emit("message_updated", deletedMessage);
    });

    socket.on("edit_group_message", async (payload) => {
      const result = messageMutationSchema.safeParse(payload);
      if (!result.success || !result.data.content) {
        socket.emit("chat_error", { message: "Invalid group message update" });
        return;
      }
      const [updatedMessage] = await db
        .update(groupMessages)
        .set({ content: result.data.content, editedAt: new Date() })
        .where(
          and(
            eq(groupMessages.id, result.data.messageId),
            eq(groupMessages.senderId, userId),
            gte(
              groupMessages.createdAt,
              new Date(Date.now() - MESSAGE_EDIT_WINDOW_MS)
            )
          )
        )
        .returning();
      if (!updatedMessage) {
        socket.emit("chat_error", { message: "Group message not found or cannot be edited" });
        return;
      }
      io.to(`group:${updatedMessage.groupId}`).emit("group_message_updated", updatedMessage);
    });

    socket.on("delete_group_message", async (payload) => {
      const result = messageMutationSchema.safeParse(payload);
      if (!result.success) {
        socket.emit("chat_error", { message: "Invalid group message deletion" });
        return;
      }
      const [messageToDelete] = await db
        .select()
        .from(groupMessages)
        .where(eq(groupMessages.id, result.data.messageId))
        .limit(1);
      if (!messageToDelete) {
        socket.emit("chat_error", { message: "Group message not found" });
        return;
      }
      const [membership] = await db
        .select({ role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, messageToDelete.groupId), eq(groupMembers.userId, userId)))
        .limit(1);
      if (
        messageToDelete.senderId !== userId &&
        membership?.role !== "owner" &&
        membership?.role !== "admin"
      ) {
        socket.emit("chat_error", { message: "You cannot delete this group message" });
        return;
      }
      const [deletedMessage] = await db
        .update(groupMessages)
        .set({ deletedAt: new Date() })
        .where(eq(groupMessages.id, messageToDelete.id))
        .returning();
      io.to(`group:${deletedMessage.groupId}`).emit("group_message_updated", deletedMessage);
    });

    socket.on("join_group", async (payload) => {
      const result = z.object({ groupId: z.string().uuid() }).safeParse(payload);
      if (!result.success) return;

      const [membership] = await db
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, result.data.groupId),
            eq(groupMembers.userId, userId)
          )
        )
        .limit(1);

      if (membership) {
        socket.join(`group:${result.data.groupId}`);
      }
    });

    socket.on("disconnect", () => {
      void broadcastOnlineUsers();
      console.log("Private chat disconnected:", userId);
    });
  });
}
