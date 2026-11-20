import { and, eq, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import { friendRequests, groupMembers } from "../../db/schema.js";

export async function getAcceptedFriendIds(userId: string) {
  const acceptedRows = await db
    .select()
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "accepted"),
        or(
          eq(friendRequests.senderId, userId),
          eq(friendRequests.receiverId, userId)
        )
      )
    );

  return [
    ...new Set(
      acceptedRows.map((row) =>
        row.senderId === userId ? row.receiverId : row.senderId
      )
    ),
  ];
}

export async function getGroupMembership(groupId: string, userId: string) {
  const [membership] = await db
    .select({ id: groupMembers.id, role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
    )
    .limit(1);
  return membership;
}

export function isGroupAdmin(role: string) {
  return role === "owner" || role === "admin";
}
