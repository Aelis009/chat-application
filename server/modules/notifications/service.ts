import { db } from "../../db/client.js";
import { notifications } from "../../db/schema.js";
import { publishGroupEvent } from "../../realtime/group-events.js";

export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}) {
  const [notification] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ? JSON.stringify(input.data) : null,
    })
    .returning({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      data: notifications.data,
      createdAt: notifications.createdAt,
    });

  const realtimeNotification = {
    ...notification,
    data: input.data ?? null,
  };

  await publishGroupEvent({
    type: "notification_created",
    userId: input.userId,
    notification: realtimeNotification,
  });

  return realtimeNotification;
}
