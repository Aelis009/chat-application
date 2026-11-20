import { EventEmitter } from "node:events";
import { Redis } from "ioredis";

export type GroupEvent =
  | {
      type: "group_updated";
      groupId: string;
      changedBy: string;
      changes: { name?: string; onlyAdminsCanSend?: boolean };
    }
  | {
      type: "group_member_role_updated";
      groupId: string;
      memberId: string;
      role: "admin" | "member";
    }
  | {
      type: "group_member_removed";
      groupId: string;
      memberId: string;
    };

const channel = "chat:group-events";
const localEvents = new EventEmitter();
const redisUrl = process.env.REDIS_URL ?? process.env.KV_URL;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;

function getPublisher() {
  if (!redisUrl) return null;
  publisher ??= new Redis(redisUrl);
  return publisher;
}

export async function publishGroupEvent(event: GroupEvent) {
  const client = getPublisher();
  if (!client) {
    localEvents.emit("group-event", event);
    return;
  }

  try {
    await client.publish(channel, JSON.stringify(event));
  } catch (error) {
    console.error("Failed to publish group event:", error);
  }
}

export function subscribeToGroupEvents(
  callback: (event: GroupEvent) => void
) {
  localEvents.on("group-event", callback);

  if (redisUrl && !subscriber) {
    subscriber = new Redis(redisUrl);
    subscriber.on("error", (error) => {
      console.error("Group event subscriber error:", error);
    });
    void subscriber.subscribe(channel);
    subscriber.on("message", (_receivedChannel, message) => {
      try {
        callback(JSON.parse(message) as GroupEvent);
      } catch (error) {
        console.error("Invalid group event received:", error);
      }
    });
  }

  return () => {
    localEvents.off("group-event", callback);
  };
}
