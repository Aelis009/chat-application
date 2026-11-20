"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChat } from "@/lib/chat-context";

const items = [
  { href: "/chat", label: "Chats", icon: "💬" },
  { href: "/find-friends", label: "Find Friends", icon: "🔎" },
  { href: "/friend-requests", label: "Requests", icon: "👋" },
  { href: "/notifications", label: "Notifications", icon: "🔔" },
  { href: "/profile", label: "Profile", icon: "👤" },
];

export default function AppNavigation() {
  const pathname = usePathname();
  const {
    conversations,
    requests,
    notifications,
    logout,
  } = useChat();
  const unreadCount = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0
  );
  const unreadNotificationCount = notifications.filter(
    (notification) => !notification.readAt
  ).length;

  return (
    <nav className="app-nav" aria-label="Main navigation">
      <div className="app-nav-brand" aria-hidden="true">
        <span className="brand-mark">C</span>
      </div>
      <div className="app-nav-links">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href === "/chat" && pathname?.startsWith("/chat"));
          return (
            <Link
              key={item.href}
              className={`app-nav-item${active ? " is-active" : ""}`}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
            >
              <span className="app-nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="app-nav-label">{item.label}</span>
              {item.href === "/chat" && unreadCount > 0 ? (
                <span className="app-nav-badge">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
              {item.href === "/friend-requests" &&
              requests.incoming.length > 0 ? (
                <span className="app-nav-badge">
                  {requests.incoming.length}
                </span>
              ) : null}
              {item.href === "/notifications" && unreadNotificationCount > 0 ? (
                <span className="app-nav-badge">
                  {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
      <button className="app-nav-logout" type="button" onClick={logout}>
        Log out
      </button>
    </nav>
  );
}
