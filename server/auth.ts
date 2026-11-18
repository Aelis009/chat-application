import "dotenv/config";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

export const COOKIE_NAME = "token";

export const TOKEN_MAX_AGE_SECONDS = 60 * 60;

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error("JWT_SECRET is missing in server/.env");
}

const secretKey = new TextEncoder().encode(jwtSecret);

export type AuthVariables = {
  userId: string;
};

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function createToken(userId: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secretKey);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}


export function getCookieValue(
  cookieHeader: string | undefined,
  name: string
) {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");

    if (key === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }

  return null;
}

export const authMiddleware = createMiddleware<{
  Variables: AuthVariables;
}>(async (c, next) => {
  const token = getCookie(c, COOKIE_NAME);

  if (!token) {
    return c.json({ error: "You must be logged in" }, 401);
  }

  const userId = await verifyToken(token);

  if (!userId) {
    return c.json({ error: "Invalid or expired login" }, 401);
  }

  c.set("userId", userId);

  await next();
});
