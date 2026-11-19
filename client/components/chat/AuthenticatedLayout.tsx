"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import AppNavigation from "@/components/chat/AppNavigation";
import { ChatProvider, useChat } from "@/lib/chat-context";

function AppLayout({ children }: { children: ReactNode }) {
  const { loading, me, error, mobileChatOpen } = useChat();
  const pathname = usePathname();

  if (loading) {
    return (
      <main className="page-loading">
        <div className="loading-card">
          <div className="spinner" aria-hidden="true" />
          <p>Loading your account...</p>
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="page-error">
        <section className="error-card">
          <h1>Could not open the app</h1>
          <p>{error ?? "Please log in to continue."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="chat-page">
      <div
        className={`chat-shell ${
          pathname === "/chat" ? "is-chat-view" : "is-panel-view"
        }${pathname === "/chat" && mobileChatOpen ? " is-mobile-chat-open" : ""}`}
      >
        <AppNavigation />
        {children}
      </div>
    </main>
  );
}

export default function AuthenticatedLayoutClient({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ChatProvider>
      <AppLayout>{children}</AppLayout>
    </ChatProvider>
  );
}
