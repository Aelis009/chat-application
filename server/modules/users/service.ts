import { inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users } from "../../db/schema.js";

export type PublicUser = {
  id: string;
  name: string;
  email: string;
};

export async function getUsersByIds(
  userIds: string[]
): Promise<Map<string, PublicUser>> {
  if (userIds.length === 0) {
    return new Map<string, PublicUser>();
  }

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  return new Map(userRows.map((user) => [user.id, user]));
}
