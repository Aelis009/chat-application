export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "" 
).replace(/\/+$/, "");

export const SOCKET_URL = (
  process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL
).replace(/\/+$/, "");

export const SOCKET_PATH =
  process.env.NEXT_PUBLIC_SOCKET_PATH ?? "/socket.io";

export type Relationship =
  | "none"
  | "request_sent"
  | "request_received"
  | "friends";

export type User = {
  id: string;
  name: string;
  email: string;
  createdAt?: string;
  relationship?: Relationship;
};

export type IncomingFriendRequest = {
  id: string;
  createdAt: string;
  sender: User;
};

export type OutgoingFriendRequest = {
  id: string;
  createdAt: string;
  receiver: User;
};

export type FriendRequestsResponse = {
  incoming: IncomingFriendRequest[];
  outgoing: OutgoingFriendRequest[];
};

export type Message = {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  createdAt: string;
};

export type MeResponse = {
  user: User;
};

export type AuthResponse = {
  message: string;
  user: User;
};

export type UsersResponse = {
  users: User[];
};

export type FriendsResponse = {
  friends: User[];
};

export type MessagesResponse = {
  messages: Message[];
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getErrorMessage(data: unknown) {
  if (data && typeof data === "object") {
    const payload = data as {
      error?: unknown;
      details?: Record<string, string[]>;
    };

    if (payload.details) {
      const firstDetail = Object.values(payload.details).flat()[0];

      if (typeof firstDetail === "string") {
        return firstDetail;
      }
    }

    if (typeof payload.error === "string") {
      return payload.error;
    }
  }

  return "Something went wrong. Please try again.";
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  headers.set("Accept", "application/json");

  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      "Could not reach the server. Make sure it is running on port 4000.",
      0
    );
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(getErrorMessage(data), response.status);
  }

  return data as T;
}
