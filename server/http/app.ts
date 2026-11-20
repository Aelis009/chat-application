import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, setCookie } from "hono/cookie";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  friendRequests,
  groupMembers,
  groupMessages,
  groups,
  messages,
  notifications,
  users,
} from "../db/schema.js";
import { areFriends } from "../modules/friends/service.js";
import { updateFriendRequestStatus } from "../modules/friends/requests.js";
import {
  getAcceptedFriendIds,
  getGroupMembership,
  isGroupAdmin,
} from "../modules/groups/service.js";
import { getUsersByIds, type PublicUser } from "../modules/users/service.js";
import { createNotification } from "../modules/notifications/service.js";
import { publishGroupEvent } from "../realtime/group-events.js";
import { getAllowedOrigins } from "../config/cors.js";
import {
  authMiddleware,
  COOKIE_NAME,
  TOKEN_MAX_AGE_SECONDS,
  createToken,
  hashPassword,
  verifyPassword,
  type AuthVariables,
} from "../middleware/auth.js";

export const app = new Hono<{ Variables: AuthVariables }>();

app.use(
  "*",
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
  })
);

app.onError((error, c) => {
  console.error("API error:", error);
  return c.json({ error: "Something went wrong" }, 500);
});

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().email("Please enter a valid email").max(255).toLowerCase(),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
});

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email").toLowerCase(),
  password: z.string().min(1, "Password is required"),
});

const profileSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
});

const sendFriendRequestSchema = z.object({
  receiverId: z.string().uuid("Invalid receiver id"),
});

const friendRequestIdSchema = z.string().uuid("Invalid friend request id");
const friendIdSchema = z.string().uuid("Invalid friend id");
const groupIdSchema = z.string().uuid("Invalid group id");
const notificationIdSchema = z.string().uuid("Invalid notification id");

const createGroupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  memberIds: z.array(z.string().uuid()).min(1).max(50),
});

const groupMessageSchema = z.object({
  content: z.string().trim().min(1).max(10000),
});

const updateGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    onlyAdminsCanSend: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.onlyAdminsCanSend !== undefined
  );

const updateGroupMemberSchema = z.object({
  role: z.enum(["admin", "member"]),
});

type PublicGroupMember = PublicUser & {
  role: "owner" | "admin" | "member";
};

app.get("/", (c) => {
  return c.json({ message: "Chat API is running" });
});

app.post("/v1/auth/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = registerSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      {
        error: "Please check your input",
        details: result.error.flatten().fieldErrors,
      },
      400
    );
  }

  const { name, email, password } = result.data;

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existingUser) {
    return c.json({ error: "This email is already registered" }, 409);
  }

  const hashedPassword = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      name,
      email,
      password: hashedPassword,
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
    });

  return c.json(
    {
      message: "Registration successful",
      user,
    },
    201
  );
});

app.post("/v1/auth/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = loginSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: "Invalid email or password" }, 400);
  }

  const { email, password } = result.data;

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const passwordMatches = await verifyPassword(password, user.password);

  if (!passwordMatches) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const token = await createToken(user.id);
  const isProduction = process.env.NODE_ENV === "production";

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isProduction ? "None" : "Lax",
    secure: isProduction,
    path: "/",
    maxAge: TOKEN_MAX_AGE_SECONDS,
  });

  return c.json({
    message: "Login successful",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  });
});

app.post("/v1/auth/logout", (c) => {
  const isProduction = process.env.NODE_ENV === "production";

  deleteCookie(c, COOKIE_NAME, {
    path: "/",
    secure: isProduction,
    sameSite: isProduction ? "None" : "Lax",
  });

  return c.json({ message: "Logged out" });
});

app.get("/v1/auth/me", authMiddleware, async (c) => {
  const userId = c.get("userId");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
    },
  });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

app.patch("/v1/profile", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = profileSchema.safeParse(body);

  if (!result.success) {
    return c.json(
      {
        error: "Please check your profile",
      },
      400
    );
  }

  const [user] = await db
    .update(users)
    .set({ name: result.data.name })
    .where(eq(users.id, c.get("userId")))
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
    });

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({
    message: "Profile updated",
    user,
  });
});

app.get("/v1/notifications", authMiddleware, async (c) => {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, c.get("userId")))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  return c.json({
    notifications: rows.map((notification) => ({
      ...notification,
      data: notification.data ? JSON.parse(notification.data) : null,
    })),
  });
});

app.post("/v1/notifications/:id/read", authMiddleware, async (c) => {
  const parsedId = notificationIdSchema.safeParse(c.req.param("id"));
  if (!parsedId.success) return c.json({ error: "Invalid notification id" }, 400);

  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, parsedId.data),
        eq(notifications.userId, c.get("userId"))
      )
    )
    .returning({ id: notifications.id });

  if (!updated) return c.json({ error: "Notification not found" }, 404);
  return c.json({ message: "Notification marked as read" });
});

app.post("/v1/notifications/read-all", authMiddleware, async (c) => {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, c.get("userId")),
        isNull(notifications.readAt)
      )
    );

  return c.json({ message: "Notifications marked as read" });
});

app.delete("/v1/notifications/:id", authMiddleware, async (c) => {
  const parsedId = notificationIdSchema.safeParse(c.req.param("id"));
  if (!parsedId.success) return c.json({ error: "Invalid notification id" }, 400);

  const deleted = await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.id, parsedId.data),
        eq(notifications.userId, c.get("userId"))
      )
    )
    .returning({ id: notifications.id });

  if (deleted.length === 0) return c.json({ error: "Notification not found" }, 404);
  return c.json({ message: "Notification dismissed" });
});

// ---------- Users ----------

app.get("/v1/users", authMiddleware, async (c) => {
  const me = c.get("userId");

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(ne(users.id, me))
    .orderBy(users.name);

  const myRequests = await db
    .select()
    .from(friendRequests)
    .where(or(eq(friendRequests.senderId, me), eq(friendRequests.receiverId, me)));

  const relationships = new Map<
    string,
    "friends" | "request_sent" | "request_received"
  >();

  for (const request of myRequests) {
    const otherUserId =
      request.senderId === me ? request.receiverId : request.senderId;

    if (request.status === "accepted") {
      relationships.set(otherUserId, "friends");
    } else if (request.status === "pending" && !relationships.has(otherUserId)) {
      relationships.set(
        otherUserId,
        request.senderId === me ? "request_sent" : "request_received"
      );
    }
  }

  return c.json({
    users: userRows.map((user) => ({
      ...user,
      relationship: relationships.get(user.id) ?? "none",
    })),
  });
});

// ---------- Friend requests ----------

app.post("/v1/friend-requests", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = sendFriendRequestSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: "Please provide a valid receiverId" }, 400);
  }

  const me = c.get("userId");
  const receiverId = result.data.receiverId;

  if (receiverId === me) {
    return c.json({ error: "You cannot send a friend request to yourself" }, 400);
  }

  const receiver = await db.query.users.findFirst({
    where: eq(users.id, receiverId),
    columns: {
      id: true,
      name: true,
    },
  });

  if (!receiver) {
    return c.json({ error: "User not found" }, 404);
  }

  const requestsBetweenUsers = await db
    .select()
    .from(friendRequests)
    .where(
      or(
        and(
          eq(friendRequests.senderId, me),
          eq(friendRequests.receiverId, receiverId)
        ),
        and(
          eq(friendRequests.senderId, receiverId),
          eq(friendRequests.receiverId, me)
        )
      )
    );

  const acceptedRequest = requestsBetweenUsers.find(
    (request) => request.status === "accepted"
  );

  if (acceptedRequest) {
    return c.json({ error: `You are already friends with ${receiver.name}` }, 409);
  }

  const pendingRequest = requestsBetweenUsers.find(
    (request) => request.status === "pending"
  );

  if (pendingRequest) {
    if (pendingRequest.senderId === me) {
      return c.json(
        { error: `You already sent a friend request to ${receiver.name}` },
        409
      );
    }

    return c.json(
      {
        error:
          `${receiver.name} already sent you a friend request. Accept it instead.`,
      },
      409
    );
  }

  const [request] = await db
    .insert(friendRequests)
    .values({
      senderId: me,
      receiverId,
      status: "pending",
    })
    .returning();

  await createNotification({
    userId: receiverId,
    type: "friend_request",
    title: "New friend request",
    body: "You received a new friend request",
    data: { requestId: request.id, senderId: me },
  });

  return c.json(
    {
      message: "Friend request sent",
      request,
    },
    201
  );
});


app.get("/v1/friend-requests", authMiddleware, async (c) => {
  const me = c.get("userId");

  const incomingRows = await db
    .select()
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.receiverId, me),
        eq(friendRequests.status, "pending")
      )
    )
    .orderBy(desc(friendRequests.createdAt));

  const outgoingRows = await db
    .select()
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.senderId, me),
        eq(friendRequests.status, "pending")
      )
    )
    .orderBy(desc(friendRequests.createdAt));

  const incomingUsers = await getUsersByIds(
    incomingRows.map((row) => row.senderId)
  );
  const outgoingUsers = await getUsersByIds(
    outgoingRows.map((row) => row.receiverId)
  );

  return c.json({
    incoming: incomingRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      sender: incomingUsers.get(row.senderId)!,
    })),
    
    outgoing: outgoingRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      receiver: outgoingUsers.get(row.receiverId)!,
    })),
  });
});



app.post("/v1/friend-requests/:id/accept", authMiddleware, async (c) => {
  const parsedId = friendRequestIdSchema.safeParse(c.req.param("id"));

  if (!parsedId.success) {
    return c.json({ error: "Invalid friend request id" }, 400);
  }

  const result = await updateFriendRequestStatus(
    parsedId.data,
    c.get("userId"),
    "accepted"
  );

  if ("error" in result) {
    return c.json({ error: result.error }, result.status);
  }

  await createNotification({
    userId: result.request.senderId,
    type: "friend_request_accepted",
    title: "Friend request accepted",
    body: "Your friend request was accepted",
    data: { userId: c.get("userId") },
  });

  return c.json({
    message: "Friend request accepted",
    request: result.request,
  });
});

app.post("/v1/friend-requests/:id/decline", authMiddleware, async (c) => {
  const parsedId = friendRequestIdSchema.safeParse(c.req.param("id"));

  if (!parsedId.success) {
    return c.json({ error: "Invalid friend request id" }, 400);
  }

  const result = await updateFriendRequestStatus(
    parsedId.data,
    c.get("userId"),
    "declined"
  );

  if ("error" in result) {
    return c.json({ error: result.error }, result.status);
  }

  return c.json({
    message: "Friend request declined",
    request: result.request,
  });
});

app.delete("/v1/friend-requests/:id", authMiddleware, async (c) => {
  const me = c.get("userId");
  const parsedId = friendRequestIdSchema.safeParse(c.req.param("id"));

  if (!parsedId.success) {
    return c.json({ error: "Invalid friend request id" }, 400);
  }

  const request = await db.query.friendRequests.findFirst({
    where: eq(friendRequests.id, parsedId.data),
  });

  if (!request) {
    return c.json({ error: "Friend request not found" }, 404);
  }

  if (request.senderId !== me) {
    return c.json(
      { error: "Only the sender can cancel this friend request" },
      403
    );
  }

  if (request.status !== "pending") {
    return c.json(
      { error: "This friend request is no longer pending" },
      409
    );
  }

  await db
    .delete(friendRequests)
    .where(eq(friendRequests.id, request.id));

  return c.json({
    message: "Friend request cancelled",
    requestId: request.id,
  });
});

// ---------- Friends ----------

app.get("/v1/friends", authMiddleware, async (c) => {
  const me = c.get("userId");
  const friendIds = await getAcceptedFriendIds(me);
  const friendUsers = await getUsersByIds(friendIds);

  const friends = friendIds
    .map((friendId) => friendUsers.get(friendId)!)
    .sort((a, b) => a.name.localeCompare(b.name));

  return c.json({ friends });
});

// ---------- Groups ----------

app.get("/v1/groups", authMiddleware, async (c) => {
  const me = c.get("userId");
  const memberships = await db
    .select({
      groupId: groupMembers.groupId,
      name: groups.name,
      createdBy: groups.createdBy,
      createdAt: groups.createdAt,
      onlyAdminsCanSend: groups.onlyAdminsCanSend,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, me))
    .orderBy(groups.name);

  if (memberships.length === 0) {
    return c.json({ groups: [] });
  }

  const groupIds = memberships.map((membership) => membership.groupId);
  const memberRows = await db
    .select({
      groupId: groupMembers.groupId,
      id: users.id,
      name: users.name,
      email: users.email,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(inArray(groupMembers.groupId, groupIds));

  const membersByGroup = new Map<string, PublicGroupMember[]>();

  for (const member of memberRows) {
    const members = membersByGroup.get(member.groupId) ?? [];
    members.push({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role as "owner" | "admin" | "member",
    });
    membersByGroup.set(member.groupId, members);
  }

  return c.json({
    groups: memberships.map((group) => ({
      ...group,
      members: membersByGroup.get(group.groupId) ?? [],
    })),
  });
});

app.post("/v1/groups", authMiddleware, async (c) => {
  const me = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const result = createGroupSchema.safeParse(body);

  if (!result.success) {
    return c.json({ error: "Please provide a valid group name and members" }, 400);
  }

  const memberIds = [...new Set(result.data.memberIds)].filter(
    (memberId) => memberId !== me
  );

  if (memberIds.length === 0) {
    return c.json({ error: "A group must include at least one friend" }, 400);
  }

  const friendIds = new Set(await getAcceptedFriendIds(me));

  if (memberIds.some((memberId) => !friendIds.has(memberId))) {
    return c.json(
      { error: "You can only add accepted friends to a group" },
      403
    );
  }

  const [group] = await db
    .insert(groups)
    .values({
      name: result.data.name,
      createdBy: me,
    })
    .returning();

  await db.insert(groupMembers).values([
    { groupId: group.id, userId: me, role: "owner" },
    ...memberIds.map((userId) => ({
      groupId: group.id,
      userId,
      role: "member",
    })),
  ]);

  return c.json({ message: "Group created", group }, 201);
});

app.patch("/v1/groups/:groupId", authMiddleware, async (c) => {
  const parsedGroupId = groupIdSchema.safeParse(c.req.param("groupId"));
  const body = await c.req.json().catch(() => null);
  const result = updateGroupSchema.safeParse(body);

  if (!parsedGroupId.success || !result.success) {
    return c.json({ error: "Please provide valid group settings" }, 400);
  }

  const membership = await getGroupMembership(
    parsedGroupId.data,
    c.get("userId")
  );

  if (!membership || !isGroupAdmin(membership.role)) {
    return c.json({ error: "Only group admins can change group settings" }, 403);
  }

  const [updatedGroup] = await db
    .update(groups)
    .set(result.data)
    .where(eq(groups.id, parsedGroupId.data))
    .returning();

  await publishGroupEvent({
    type: "group_updated",
    groupId: parsedGroupId.data,
    changedBy: c.get("userId"),
    changes: result.data,
  });
  const groupMemberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, parsedGroupId.data));
  await Promise.all(
    groupMemberRows
      .filter(({ userId }) => userId !== c.get("userId"))
      .map(({ userId }) =>
        createNotification({
          userId,
          type: "group_settings_changed",
          title: "Group settings changed",
          body: "A group administrator changed the group settings",
          data: { groupId: parsedGroupId.data },
        })
      )
  );

  return c.json({ message: "Group updated", group: updatedGroup });
});

app.patch(
  "/v1/groups/:groupId/members/:memberId",
  authMiddleware,
  async (c) => {
    const parsedGroupId = groupIdSchema.safeParse(c.req.param("groupId"));
    const parsedMemberId = friendIdSchema.safeParse(c.req.param("memberId"));
    const body = await c.req.json().catch(() => null);
    const result = updateGroupMemberSchema.safeParse(body);

    if (!parsedGroupId.success || !parsedMemberId.success || !result.success) {
      return c.json({ error: "Invalid group member update" }, 400);
    }

    const adminMembership = await getGroupMembership(
      parsedGroupId.data,
      c.get("userId")
    );
    if (!adminMembership || !isGroupAdmin(adminMembership.role)) {
      return c.json({ error: "Only group admins can manage members" }, 403);
    }

    const member = await getGroupMembership(
      parsedGroupId.data,
      parsedMemberId.data
    );
    if (!member) {
      return c.json({ error: "Group member not found" }, 404);
    }
    if (member.role === "owner") {
      return c.json({ error: "The group owner role cannot be changed" }, 400);
    }

    await db
      .update(groupMembers)
      .set({ role: result.data.role })
      .where(
        and(
          eq(groupMembers.groupId, parsedGroupId.data),
          eq(groupMembers.userId, parsedMemberId.data)
        )
      );

    await publishGroupEvent({
      type: "group_member_role_updated",
      groupId: parsedGroupId.data,
      memberId: parsedMemberId.data,
      role: result.data.role,
    });
    await createNotification({
      userId: parsedMemberId.data,
      type: "group_role_changed",
      title: result.data.role === "admin" ? "You are a group admin" : "Admin access removed",
      body:
        result.data.role === "admin"
          ? "You can now manage this group"
          : "Your group admin access was removed",
      data: { groupId: parsedGroupId.data },
    });

    return c.json({ message: "Member role updated" });
  }
);

app.delete(
  "/v1/groups/:groupId/members/:memberId",
  authMiddleware,
  async (c) => {
    const parsedGroupId = groupIdSchema.safeParse(c.req.param("groupId"));
    const parsedMemberId = friendIdSchema.safeParse(c.req.param("memberId"));

    if (!parsedGroupId.success || !parsedMemberId.success) {
      return c.json({ error: "Invalid group member" }, 400);
    }

    const adminMembership = await getGroupMembership(
      parsedGroupId.data,
      c.get("userId")
    );
    if (!adminMembership || !isGroupAdmin(adminMembership.role)) {
      return c.json({ error: "Only group admins can remove members" }, 403);
    }

    const member = await getGroupMembership(
      parsedGroupId.data,
      parsedMemberId.data
    );
    if (!member) {
      return c.json({ error: "Group member not found" }, 404);
    }
    if (member.role === "owner") {
      return c.json({ error: "The group owner cannot be removed" }, 400);
    }

    await db
      .delete(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, parsedGroupId.data),
          eq(groupMembers.userId, parsedMemberId.data)
        )
      );

    await publishGroupEvent({
      type: "group_member_removed",
      groupId: parsedGroupId.data,
      memberId: parsedMemberId.data,
    });
    await createNotification({
      userId: parsedMemberId.data,
      type: "group_removed",
      title: "Removed from group",
      body: "You were removed from a group",
      data: { groupId: parsedGroupId.data },
    });

    return c.json({ message: "Member removed" });
  }
);

app.get("/v1/groups/:groupId/messages", authMiddleware, async (c) => {
  const parsedGroupId = groupIdSchema.safeParse(c.req.param("groupId"));

  if (!parsedGroupId.success) {
    return c.json({ error: "Invalid group id" }, 400);
  }

  const membership = await getGroupMembership(
    parsedGroupId.data,
    c.get("userId")
  );

  if (!membership) {
    return c.json({ error: "You are not a member of this group" }, 403);
  }

  const before = c.req.query("before");
  const beforeDate = before ? new Date(before) : null;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) {
    return c.json({ error: "Invalid message cursor" }, 400);
  }
  const limit = 50;
  const messageRows = await db
    .select({
      id: groupMessages.id,
      groupId: groupMessages.groupId,
      senderId: groupMessages.senderId,
      content: groupMessages.content,
      editedAt: groupMessages.editedAt,
      deletedAt: groupMessages.deletedAt,
      createdAt: groupMessages.createdAt,
    })
    .from(groupMessages)
    .where(
      before
        ? and(
            eq(groupMessages.groupId, parsedGroupId.data),
            lt(groupMessages.createdAt, beforeDate!)
          )
        : eq(groupMessages.groupId, parsedGroupId.data)
    )
    .orderBy(desc(groupMessages.createdAt))
    .limit(limit + 1);

  const hasMore = messageRows.length > limit;
  const page = messageRows.slice(0, limit).reverse();
  return c.json({
    messages: page,
    nextCursor: hasMore ? page[0]?.createdAt.toISOString() ?? null : null,
    hasMore,
  });
});

app.delete("/v1/friends/:friendId", authMiddleware, async (c) => {
  const me = c.get("userId");
  const parsedFriendId = friendIdSchema.safeParse(c.req.param("friendId"));

  if (!parsedFriendId.success) {
    return c.json({ error: "Invalid friend id" }, 400);
  }

  const friendId = parsedFriendId.data;

  if (friendId === me) {
    return c.json({ error: "You cannot remove yourself as a friend" }, 400);
  }

  const deletedRows = await db
    .delete(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "accepted"),
        or(
          and(
            eq(friendRequests.senderId, me),
            eq(friendRequests.receiverId, friendId)
          ),
          and(
            eq(friendRequests.senderId, friendId),
            eq(friendRequests.receiverId, me)
          )
        )
      )
    )
    .returning({ id: friendRequests.id });

  if (deletedRows.length === 0) {
    return c.json({ error: "Friendship not found" }, 404);
  }

  return c.json({
    message: "Friend removed",
    removedFriendId: friendId,
  });
});

// ---------- Conversations ----------

app.get("/v1/conversations", authMiddleware, async (c) => {
  const me = c.get("userId");
  const friendIds = await getAcceptedFriendIds(me);

  if (friendIds.length === 0) {
    return c.json({ conversations: [] });
  }

  const friendUsers = await getUsersByIds(friendIds);
  const friendIdSet = new Set(friendIds);
  const friends = friendIds
    .map((friendId) => friendUsers.get(friendId)!)
    .sort((a, b) => a.name.localeCompare(b.name));

  const [latestMessageRows, unreadRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        senderId: messages.senderId,
        receiverId: messages.receiverId,
        content: messages.content,
        editedAt: messages.editedAt,
        deletedAt: messages.deletedAt,
        readAt: messages.readAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(or(eq(messages.senderId, me), eq(messages.receiverId, me)))
      .orderBy(desc(messages.createdAt)),
    db
      .select({
        senderId: messages.senderId,
        unreadCount: sql<number>`count(*)::int`,
      })
      .from(messages)
      .where(and(eq(messages.receiverId, me), isNull(messages.readAt)))
      .groupBy(messages.senderId),
  ]);

  const latestMessageByFriend = new Map<
    string,
    {
      id: string;
      senderId: string;
      receiverId: string;
      content: string;
      editedAt: Date | null;
      deletedAt: Date | null;
      readAt: Date | null;
      createdAt: Date;
    }
  >();

  for (const row of latestMessageRows) {
    const otherUserId =
      row.senderId === me ? row.receiverId : row.senderId;

    if (
      !friendIdSet.has(otherUserId) ||
      latestMessageByFriend.has(otherUserId)
    ) {
      continue;
    }

    latestMessageByFriend.set(otherUserId, {
      id: row.id,
      senderId: row.senderId,
      receiverId: row.receiverId,
      content: row.content,
      editedAt: row.editedAt,
      deletedAt: row.deletedAt,
      readAt: row.readAt,
      createdAt: row.createdAt,
    });
  }

  const unreadByFriend = new Map(
    unreadRows.map((row) => [row.senderId, Number(row.unreadCount)])
  );

  const conversations = friends.map((friend) => ({
    friend,
    lastMessage: latestMessageByFriend.get(friend.id) ?? null,
    unreadCount: unreadByFriend.get(friend.id) ?? 0,
  }));

  conversations.sort((a, b) => {
    const aTime = a.lastMessage
      ? new Date(a.lastMessage.createdAt).getTime()
      : 0;
    const bTime = b.lastMessage
      ? new Date(b.lastMessage.createdAt).getTime()
      : 0;

    return bTime - aTime || a.friend.name.localeCompare(b.friend.name);
  });

  return c.json({ conversations });
});

app.post("/v1/conversations/:friendId/read", authMiddleware, async (c) => {
  const me = c.get("userId");
  const parsedFriendId = friendIdSchema.safeParse(c.req.param("friendId"));

  if (!parsedFriendId.success) {
    return c.json({ error: "Invalid friend id" }, 400);
  }

  const friendId = parsedFriendId.data;

  if (friendId === me) {
    return c.json(
      { error: "You cannot mark a conversation with yourself as read" },
      400
    );
  }

  if (!(await areFriends(me, friendId))) {
    return c.json(
      { error: "You can only update conversations with friends" },
      403
    );
  }

  const updatedRows = await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.senderId, friendId),
        eq(messages.receiverId, me),
        isNull(messages.readAt)
      )
    )
    .returning({ id: messages.id });

  return c.json({
    message: "Conversation marked as read",
    updatedCount: updatedRows.length,
  });
});

// ---------- Messages ----------

app.get("/v1/messages/:friendId", authMiddleware, async (c) => {
  const me = c.get("userId");
  const parsedFriendId = friendIdSchema.safeParse(c.req.param("friendId"));

  if (!parsedFriendId.success) {
    return c.json({ error: "Invalid friend id" }, 400);
  }

  const friendId = parsedFriendId.data;

  if (friendId === me) {
    return c.json(
      { error: "You cannot view a conversation with yourself" },
      400
    );
  }

  if (!(await areFriends(me, friendId))) {
    return c.json({ error: "You can only view messages with friends" }, 403);
  }

  const before = c.req.query("before");
  const beforeDate = before ? new Date(before) : null;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) {
    return c.json({ error: "Invalid message cursor" }, 400);
  }
  const limit = 50;
  const messageRows = await db
    .select()
    .from(messages)
    .where(
      before
        ? and(
            or(
              and(eq(messages.senderId, me), eq(messages.receiverId, friendId)),
              and(eq(messages.senderId, friendId), eq(messages.receiverId, me))
            ),
            lt(messages.createdAt, beforeDate!)
          )
        : or(
            and(eq(messages.senderId, me), eq(messages.receiverId, friendId)),
            and(eq(messages.senderId, friendId), eq(messages.receiverId, me))
          )
    )
    .orderBy(desc(messages.createdAt))
    .limit(limit + 1);

  const hasMore = messageRows.length > limit;
  const page = messageRows.slice(0, limit).reverse();
  return c.json({
    messages: page,
    nextCursor: hasMore ? page[0]?.createdAt.toISOString() ?? null : null,
    hasMore,
  });
});

// Vercel's zero-configuration Hono integration uses this default export.
export default app;
