const DEFAULT_CLIENT_ORIGIN = "http://localhost:3000";

// CLIENT_ORIGIN can contain one origin or a comma-separated list of origins.
// Example: "https://my-chat.vercel.app,https://my-chat-git-main.vercel.app"
export function getAllowedOrigins(): string[] {
  const configuredOrigins = process.env.CLIENT_ORIGIN ?? DEFAULT_CLIENT_ORIGIN;

  const origins = configuredOrigins
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return origins.length > 0 ? origins : [DEFAULT_CLIENT_ORIGIN];
}
