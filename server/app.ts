import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, setCookie } from "hono/cookie";
import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.js";
import { friendRequests, messages, users } from "./schema.js";
import { areFriends } from "./friendship.js";
import { getAllowedOrigins } from "./cors.js";
import {
  authMiddleware,
  COOKIE_NAME,
  TOKEN_MAX_AGE_SECONDS,
  createToken,
  hashPassword,
  verifyPassword,
  type AuthVariables,
} from "./auth.js";

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

const sendFriendRequestSchema = z.object({
  receiverId: z.string().uuid("Invalid user id"),
});

const friendRequestIdSchema = z.string().uuid("Invalid friend request id");

const friendIdSchema = z.string().uuid("Invalid friend id");

type PublicUser = {
  id: string;
  name: string;
  email: string;
};


async function getUsersByIds(userIds: string[]): Promise<Map<string, PublicUser>> {
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

async function updateFriendRequestStatus(
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
    // The Vercel frontend and API are on different sites, so production
    // needs SameSite=None. Local development stays on Lax over HTTP.
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

// ---------- Friends ----------

app.get("/v1/friends", authMiddleware, async (c) => {
  const me = c.get("userId");

  const acceptedRows = await db
    .select()
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "accepted"),
        or(eq(friendRequests.senderId, me), eq(friendRequests.receiverId, me))
      )
    );

  const friendIds = [
    ...new Set(
      acceptedRows.map((row) =>
        row.senderId === me ? row.receiverId : row.senderId
      )
    ),
  ];

  const friendUsers = await getUsersByIds(friendIds);

  const friends = friendIds
    .map((friendId) => friendUsers.get(friendId)!)
    .sort((a, b) => a.name.localeCompare(b.name));

  return c.json({ friends });
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

  const messageRows = await db
    .select()
    .from(messages)
    .where(
      or(
        and(eq(messages.senderId, me), eq(messages.receiverId, friendId)),
        and(eq(messages.senderId, friendId), eq(messages.receiverId, me))
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(50);

  return c.json({ messages: messageRows.reverse() });
});

// Vercel's zero-configuration Hono integration uses this default export.
export default app;
