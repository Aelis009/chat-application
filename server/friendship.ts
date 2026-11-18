import { and, eq, or } from "drizzle-orm";
import { db } from "./db.js";
import { friendRequests } from "./schema.js";

// An accepted friend request is the friendship. This checks both directions
// because either user could have been the sender.
export async function areFriends(userId: string, otherUserId: string) {
  if (userId === otherUserId) {
    return false;
  }

  const friendship = await db.query.friendRequests.findFirst({
    where: and(
      eq(friendRequests.status, "accepted"),
      or(
        and(
          eq(friendRequests.senderId, userId),
          eq(friendRequests.receiverId, otherUserId)
        ),
        and(
          eq(friendRequests.senderId, otherUserId),
          eq(friendRequests.receiverId, userId)
        )
      )
    ),
    columns: {
      id: true,
    },
  });

  return Boolean(friendship);
}
