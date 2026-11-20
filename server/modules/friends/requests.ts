import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { friendRequests } from "../../db/schema.js";

export async function updateFriendRequestStatus(
  requestId: string,
  userId: string,
  newStatus: "accepted" | "declined"
) {
  const request = await db.query.friendRequests.findFirst({
    where: eq(friendRequests.id, requestId),
  });

  if (!request) {
    return { error: "Friend request not found", status: 404 as const };
  }

  if (request.receiverId !== userId) {
    return {
      error: "Only the receiver can respond to this request",
      status: 403 as const,
    };
  }

  if (request.status !== "pending") {
    return {
      error: "This friend request is no longer pending",
      status: 409 as const,
    };
  }

  const [updatedRequest] = await db
    .update(friendRequests)
    .set({ status: newStatus })
    .where(eq(friendRequests.id, requestId))
    .returning();

  return { request: updatedRequest };
}
