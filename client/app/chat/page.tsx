"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import {
  ApiError,
  SOCKET_PATH,
  SOCKET_URL,
  apiFetch,
  type Conversation,
  type ConversationsResponse,
  type FriendRequestsResponse,
  type MeResponse,
  type Message,
  type MessagesResponse,
  type User,
  type UsersResponse,
} from "@/lib/api";

type ListsData = {
  users: User[];
  requests: FriendRequestsResponse;
  conversations: Conversation[];
};

type Section = "chats" | "find-friends" | "requests" | "notifications" | "profile";

const NAV_ITEMS: { id: Section; label: string; icon: string }[] = [
  { id: "chats", label: "Chats", icon: "💬" },
  { id: "find-friends", label: "Find Friends", icon: "🔎" },
  { id: "requests", label: "Requests", icon: "👋" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "profile", label: "Profile", icon: "👤" },
];

async function fetchLists(): Promise<ListsData> {
  const [usersResponse, requestsResponse, conversationsResponse] =
    await Promise.all([
      apiFetch<UsersResponse>("/v1/users"),
      apiFetch<FriendRequestsResponse>("/v1/friend-requests"),
      apiFetch<ConversationsResponse>("/v1/conversations"),
    ]);

  return {
    users: usersResponse.users,
    requests: requestsResponse,
    conversations: conversationsResponse.conversations,
  };
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}



function formatMessageTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (sameDay) {
    return time;
  }

  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return `${day}, ${time}`;
}

function sortConversationsByLatest(conversations: Conversation[]) {
  return [...conversations].sort((a, b) => {
    const aTime = a.lastMessage
      ? new Date(a.lastMessage.createdAt).getTime()
      : 0;
    const bTime = b.lastMessage
      ? new Date(b.lastMessage.createdAt).getTime()
      : 0;

    return bTime - aTime || a.friend.name.localeCompare(b.friend.name);
  });
}

function UserAvatar({ name, online }: { name: string; online: boolean }) {
  return (
    <span className="user-avatar-wrap">
      <span className="avatar" aria-hidden="true">
        {getInitial(name)}
      </span>
      <span
        className={`online-dot${online ? " is-online" : ""}`}
        aria-hidden="true"
      />
      <span className="sr-only">{online ? "Online" : "Offline"}</span>
    </span>
  );
}

function LoadingScreen() {
  return (
    <main className="page-loading">
      <div className="loading-card">
        <div className="spinner" aria-hidden="true" />
        <p>Loading your chats...</p>
      </div>
    </main>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <header className="section-panel-header">
      <div>
        <h1 className="section-panel-title">{title}</h1>
        <p className="section-panel-subtitle">{subtitle}</p>
      </div>
      {action ? <div className="section-panel-action">{action}</div> : null}
    </header>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const openConversationIdRef = useRef<string | null>(null);

  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [requests, setRequests] = useState<FriendRequestsResponse>({
    incoming: [],
    outgoing: [],
  });
  const [activeSection, setActiveSection] = useState<Section>("chats");
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null);
  const [messagesByFriend, setMessagesByFriend] = useState<
    Record<string, Message[]>
  >({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let redirecting = false;

      try {
        const meResponse = await apiFetch<MeResponse>("/v1/auth/me");

        if (cancelled) {
          return;
        }

        setMe(meResponse.user);

        const lists = await fetchLists();

        if (cancelled) {
          return;
        }

        setUsers(lists.users);
        setRequests(lists.requests);
        setConversations(lists.conversations);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        if (loadError instanceof ApiError && loadError.status === 401) {
          redirecting = true;
          router.replace("/login");
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the chat."
        );
      } finally {
        if (!cancelled && !redirecting) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    openConversationIdRef.current =
      activeSection === "chats" && mobileChatOpen
        ? (selectedFriend?.id ?? null)
        : null;
  }, [activeSection, mobileChatOpen, selectedFriend]);

  useEffect(() => {
    if (!me) {
      return;
    }

    const currentUserId = me.id;
    const socket = io(`${SOCKET_URL}/private`, {
      path: SOCKET_PATH,
      // Vercel WebSocket Functions require the WebSocket transport directly.
      // HTTP long-polling needs sticky sessions, which Vercel does not provide.
      transports: ["websocket"],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });
    socketRef.current = socket;

    socket.io.on("error", (error) => {
      console.error("[Socket.IO] Manager error:", error);
    });

    socket.io.engine.on("error", (error) => {
      console.error("[Socket.IO] Transport error:", error);
    });

    function handleConnect() {
      console.info("[Socket.IO] Connected", {
        url: `${SOCKET_URL}/private`,
        path: SOCKET_PATH,
      });
      setSocketConnected(true);
      setChatError(null);
      // Vercel closes long-lived connections at the function's max duration.
      // Reload the open conversation after every reconnect so messages sent
      // while the socket was down are not missing.
      setHistoryVersion((version) => version + 1);
    }

    function handleDisconnect() {
      console.warn("[Socket.IO] Disconnected");
      setSocketConnected(false);
      setOnlineUserIds([]);
    }

    function handleOnlineUsers(userIds: string[]) {
      setOnlineUserIds(userIds);
    }

    function handleReceiveMessage(message: Message) {
      const otherUserId =
        message.senderId === currentUserId
          ? message.receiverId
          : message.senderId;
      const isIncoming = message.senderId !== currentUserId;
      const isOpen = openConversationIdRef.current === otherUserId;

      setMessagesByFriend((previous) => {
        const existing = previous[otherUserId] ?? [];

        if (existing.some((item) => item.id === message.id)) {
          return previous;
        }

        return {
          ...previous,
          [otherUserId]: [...existing, message],
        };
      });

      setConversations((previous) => {
        let found = false;

        const next = previous.map((conversation) => {
          if (conversation.friend.id !== otherUserId) {
            return conversation;
          }

          found = true;

          return {
            ...conversation,
            lastMessage: message,
            unreadCount:
              isIncoming && !isOpen
                ? conversation.unreadCount + 1
                : isIncoming
                  ? 0
                  : conversation.unreadCount,
          };
        });

        return found ? next : previous;
      });

      if (isIncoming && isOpen) {
        void apiFetch<{ message: string }>(
          `/v1/conversations/${otherUserId}/read`,
          { method: "POST" }
        ).catch((readError) => {
          if (readError instanceof ApiError && readError.status === 401) {
            router.replace("/login");
            return;
          }

          console.error("Failed to mark conversation as read:", readError);
        });
      }
    }

    function handleChatError(payload: { message?: string }) {
      setChatError(payload.message ?? "Could not send the message.");
    }

    function handleConnectError(connectError: Error) {
      console.error("[Socket.IO] Connection error", {
        message: connectError.message,
        url: `${SOCKET_URL}/private`,
        path: SOCKET_PATH,
      });
      setSocketConnected(false);
      setOnlineUserIds([]);

      if (connectError.message === "Unauthorized") {
        socket.disconnect();
        router.replace("/login");
        return;
      }

      setChatError(connectError.message || "Could not connect to the chat.");
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("online_users", handleOnlineUsers);
    socket.on("receive_message", handleReceiveMessage);
    socket.on("chat_error", handleChatError);
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [me, router]);

  useEffect(() => {
    if (!selectedFriend) {
      return;
    }

    let cancelled = false;

    apiFetch<MessagesResponse>(`/v1/messages/${selectedFriend.id}`)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setMessagesByFriend((previous) => {
          const existing = previous[selectedFriend.id] ?? [];
          const merged = [...response.messages];

          for (const message of existing) {
            if (!merged.some((item) => item.id === message.id)) {
              merged.push(message);
            }
          }

          merged.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );

          return {
            ...previous,
            [selectedFriend.id]: merged,
          };
        });
      })
      .catch((historyError) => {
        if (cancelled) {
          return;
        }

        if (historyError instanceof ApiError && historyError.status === 401) {
          router.replace("/login");
          return;
        }

        setChatError(
          historyError instanceof Error
            ? historyError.message
            : "Could not load messages."
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFriend, router, historyVersion]);

  const selectedFriendId = selectedFriend?.id ?? null;
  const onlineUserIdsSet = new Set(onlineUserIds);
  const selectedFriendOnline = selectedFriendId
    ? onlineUserIdsSet.has(selectedFriendId)
    : false;
  const selectedMessages = selectedFriendId
    ? messagesByFriend[selectedFriendId] ?? []
    : [];
  const selectedMessageCount = selectedMessages.length;
  const otherUsers = users.filter((user) => user.relationship !== "friends");
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredOtherUsers = normalizedSearch
    ? otherUsers.filter((user) =>
        `${user.name} ${user.email}`.toLowerCase().includes(normalizedSearch)
      )
    : otherUsers;
  const incomingRequestCount = requests.incoming.length;
  const outgoingRequestCount = requests.outgoing.length;
  const sortedConversations = sortConversationsByLatest(conversations);
  const totalUnread = conversations.reduce(
    (total, conversation) => total + conversation.unreadCount,
    0
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [activeSection, mobileChatOpen, selectedFriendId, selectedMessageCount]);

  function applyLists(lists: ListsData) {
    setUsers(lists.users);
    setRequests(lists.requests);
    setConversations(lists.conversations);
  }

  function handlePageError(pageError: unknown) {
    if (pageError instanceof ApiError && pageError.status === 401) {
      router.replace("/login");
      return;
    }

    setError(
      pageError instanceof Error
        ? pageError.message
        : "Something went wrong. Please try again."
    );
  }

  function markConversationRead(friendId: string) {
    setConversations((previous) => {
      let changed = false;

      const next = previous.map((conversation) => {
        if (
          conversation.friend.id !== friendId ||
          conversation.unreadCount === 0
        ) {
          return conversation;
        }

        changed = true;
        return { ...conversation, unreadCount: 0 };
      });

      return changed ? next : previous;
    });

    void apiFetch<{ message: string }>(
      `/v1/conversations/${friendId}/read`,
      { method: "POST" }
    ).catch((readError) => {
      if (readError instanceof ApiError && readError.status === 401) {
        router.replace("/login");
        return;
      }

      console.error("Failed to mark conversation as read:", readError);
    });
  }

  function handleSectionChange(section: Section) {
    setActiveSection(section);

    const openFriendId =
      section === "chats" && mobileChatOpen ? selectedFriendId : null;

    openConversationIdRef.current = openFriendId;

    if (openFriendId) {
      const conversation = conversations.find(
        (item) => item.friend.id === openFriendId
      );

      if (conversation && conversation.unreadCount > 0) {
        markConversationRead(openFriendId);
      }
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);

    try {
      const lists = await fetchLists();
      applyLists(lists);

      if (activeSection === "chats" && mobileChatOpen && selectedFriendId) {
        const conversation = lists.conversations.find(
          (item) => item.friend.id === selectedFriendId
        );

        if (conversation && conversation.unreadCount > 0) {
          markConversationRead(selectedFriendId);
        }
      }
    } catch (refreshError) {
      handlePageError(refreshError);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAcceptRequest(requestId: string) {
    const request =
      requests.incoming.find((item) => item.id === requestId) ?? null;

    setActionId(requestId);
    setError(null);

    try {
      await apiFetch<{ message: string }>(
        `/v1/friend-requests/${requestId}/accept`,
        { method: "POST" }
      );

      applyLists(await fetchLists());

      if (request) {
        openConversation(request.sender);
      }
    } catch (acceptError) {
      handlePageError(acceptError);
    } finally {
      setActionId(null);
    }
  }

  async function handleDeclineRequest(requestId: string) {
    setActionId(requestId);
    setError(null);

    try {
      await apiFetch<{ message: string }>(
        `/v1/friend-requests/${requestId}/decline`,
        { method: "POST" }
      );

      applyLists(await fetchLists());
    } catch (declineError) {
      handlePageError(declineError);
    } finally {
      setActionId(null);
    }
  }

  async function handleCancelRequest(requestId: string) {
    setActionId(requestId);
    setError(null);

    try {
      await apiFetch<{ message: string }>(
        `/v1/friend-requests/${requestId}`,
        { method: "DELETE" }
      );

      applyLists(await fetchLists());
    } catch (cancelError) {
      handlePageError(cancelError);
    } finally {
      setActionId(null);
    }
  }

  async function handleRemoveFriend(friendId: string) {
    const friend = selectedFriend;

    if (!friend || friend.id !== friendId) {
      return;
    }

    const confirmed = window.confirm(
      `Remove ${friend.name} from your friends?`
    );

    if (!confirmed) {
      return;
    }

    setActionId(friendId);
    setError(null);

    try {
      await apiFetch<{ message: string }>(`/v1/friends/${friendId}`, {
        method: "DELETE",
      });

      setSelectedFriend(null);
      setMobileChatOpen(false);
      openConversationIdRef.current = null;
      setDraft("");
      applyLists(await fetchLists());
    } catch (removeError) {
      handlePageError(removeError);
    } finally {
      setActionId(null);
    }
  }

  async function handleSendFriendRequest(receiverId: string) {
    setActionId(receiverId);
    setError(null);

    try {
      await apiFetch<{ message: string }>("/v1/friend-requests", {
        method: "POST",
        body: JSON.stringify({ receiverId }),
      });

      applyLists(await fetchLists());
    } catch (sendError) {
      handlePageError(sendError);
    } finally {
      setActionId(null);
    }
  }

  function openConversation(friend: User) {
    setActiveSection("chats");
    setMobileChatOpen(true);
    setChatError(null);
    openConversationIdRef.current = friend.id;

    if (selectedFriendId !== friend.id) {
      setLoadingHistory(true);
    }

    setSelectedFriend(friend);

    const conversation = conversations.find(
      (item) => item.friend.id === friend.id
    );

    if (conversation && conversation.unreadCount > 0) {
      markConversationRead(friend.id);
    }
  }

  function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFriend) {
      return;
    }

    const content = draft.trim();
    const socket = socketRef.current;

    if (!content) {
      return;
    }

    if (!socket?.connected) {
      setChatError("Not connected. Please wait a moment and try again.");
      return;
    }

    socket.emit("send_message", {
      receiverId: selectedFriend.id,
      content,
    });

    setDraft("");
    setChatError(null);
  }

  async function handleLogout() {
    setError(null);

    try {
      await apiFetch<{ message: string }>("/v1/auth/logout", {
        method: "POST",
      });

      socketRef.current?.disconnect();
      router.replace("/login");
    } catch (logoutError) {
      handlePageError(logoutError);
    }
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!me) {
    return (
      <main className="page-error">
        <section className="error-card">
          <h1>Could not open your chats</h1>
          <p>{error ?? "Please log in to continue."}</p>
          <div className="error-actions">
            <Link className="button button-primary" href="/login">
              Go to login
            </Link>
            <button
              className="button button-ghost"
              type="button"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </div>
        </section>
      </main>
    );
  }

  const errorBanner = error ? (
    <div className="error-banner" role="alert">
      {error}
    </div>
  ) : null;

  return (
    <main className="chat-page">
      <div
        className={`chat-shell ${
          activeSection === "chats" ? "is-chat-view" : "is-panel-view"
        }${mobileChatOpen ? " is-mobile-chat-open" : ""}`}
      >
        <nav className="app-nav" aria-label="Main navigation">
          <div className="app-nav-brand" aria-hidden="true">
            <span className="brand-mark">C</span>
          </div>

          <div className="app-nav-links">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`app-nav-item${
                  activeSection === item.id ? " is-active" : ""
                }`}
                type="button"
                onClick={() => handleSectionChange(item.id)}
                aria-current={activeSection === item.id ? "page" : undefined}
                title={item.label}
              >
                <span className="app-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="app-nav-label">{item.label}</span>
                {item.id === "chats" && totalUnread > 0 ? (
                  <span className="app-nav-badge">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                ) : null}
                {item.id === "requests" && incomingRequestCount > 0 ? (
                  <span className="app-nav-badge">{incomingRequestCount}</span>
                ) : null}
              </button>
            ))}
          </div>

          <button
            className="app-nav-logout"
            type="button"
            onClick={handleLogout}
          >
            Log out
          </button>
        </nav>

        {activeSection === "chats" ? (
          <>
            <aside className="sidebar">
              <div className="sidebar-header sidebar-header-compact">
                <div className="panel-heading">
                  <div>
                    <h1 className="panel-title">Chats</h1>
                    <p className="panel-subtitle">
                      {sortedConversations.length}{" "}
                      {sortedConversations.length === 1
                        ? "friend"
                        : "friends"}
                    </p>
                  </div>
                  <button
                    className="button button-ghost button-small"
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshing}
                  >
                    {refreshing ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="sidebar-scroll">
                {errorBanner}

                {sortedConversations.length === 0 ? (
                  <div className="empty-panel">
                    <span className="empty-panel-icon" aria-hidden="true">
                      💬
                    </span>
                    <h2>No chats yet</h2>
                    <p>Find a friend and send your first message.</p>
                    <button
                      className="button button-primary button-small"
                      type="button"
                      onClick={() => handleSectionChange("find-friends")}
                    >
                      Find friends
                    </button>
                  </div>
                ) : (
                  <div className="user-list">
                    {sortedConversations.map((conversation) => {
                      const friend = conversation.friend;
                      const lastMessage = conversation.lastMessage;
                      const isOnline = onlineUserIdsSet.has(friend.id);
                      const preview = lastMessage
                        ? `${
                            lastMessage.senderId === me.id ? "You: " : ""
                          }${lastMessage.content}`
                        : "No messages yet";

                      return (
                        <button
                          key={friend.id}
                          className={`user-row${
                            selectedFriendId === friend.id
                              ? " is-selected"
                              : ""
                          }`}
                          type="button"
                          onClick={() => openConversation(friend)}
                        >
                          <UserAvatar name={friend.name} online={isOnline} />
                          <span className="user-info conversation-info">
                            <span className="conversation-top">
                              <span className="user-name">{friend.name}</span>
                              {lastMessage ? (
                                <span className="conversation-time">
                                  {formatMessageTime(lastMessage.createdAt)}
                                </span>
                              ) : null}
                            </span>
                            <span className="conversation-bottom">
                              <span className="conversation-preview">
                                {preview}
                              </span>
                              {conversation.unreadCount > 0 ? (
                                <span
                                  className="unread-badge"
                                  aria-label={`${conversation.unreadCount} unread messages`}
                                >
                                  {conversation.unreadCount > 99
                                    ? "99+"
                                    : conversation.unreadCount}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            <section className="chat-main">
              {chatError ? (
                <div className="error-banner chat-error-banner" role="alert">
                  {chatError}
                </div>
              ) : null}

              {!selectedFriend ? (
                <div className="chat-empty-state">
                  <div className="chat-empty-icon" aria-hidden="true">
                    📩
                  </div>
                  <h2>Pick a friend to start chatting</h2>
                  <p>
                    Your private conversations appear here. Use Find Friends in
                    the navigation if your list is empty.
                  </p>
                  <button
                    className="button button-secondary button-small chat-empty-action"
                    type="button"
                    onClick={() => handleSectionChange("find-friends")}
                  >
                    Find friends
                  </button>
                </div>
              ) : (
                <>
                  <header className="chat-header">
                    <div className="chat-person">
                      <button
                        className="chat-back-button"
                        type="button"
                        onClick={() => {
                          setMobileChatOpen(false);
                          openConversationIdRef.current = null;
                        }}
                        aria-label="Back to chats"
                      >
                        ←
                      </button>
                      <UserAvatar
                        name={selectedFriend.name}
                        online={selectedFriendOnline}
                      />
                      <div className="chat-person-info">
                        <h2 className="chat-title">{selectedFriend.name}</h2>
                        <div className="chat-presence">
                          <span
                            className={`presence-dot${
                              selectedFriendOnline ? " is-online" : ""
                            }`}
                            aria-hidden="true"
                          />
                          {selectedFriendOnline ? "Online" : "Offline"}
                        </div>
                      </div>
                    </div>

                    <div className="chat-header-actions">
                      <span
                        className={`live-pill${
                          socketConnected
                            ? " is-connected"
                            : " is-disconnected"
                        }`}
                      >
                        {socketConnected ? "Live" : "Connecting..."}
                      </span>
                      <button
                        className="button button-danger button-small"
                        type="button"
                        onClick={() => handleRemoveFriend(selectedFriend.id)}
                        disabled={actionId === selectedFriend.id}
                      >
                        {actionId === selectedFriend.id
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    </div>
                  </header>

                  <div className="chat-body">
                    <div className="messages">
                      {loadingHistory && selectedMessages.length === 0 ? (
                        <p className="empty-note chat-loading-note">
                          Loading messages...
                        </p>
                      ) : null}

                      {!loadingHistory && selectedMessages.length === 0 ? (
                        <p className="empty-note chat-loading-note">
                          Say hello to {selectedFriend.name}.
                        </p>
                      ) : null}

                      {selectedMessages.map((message) => {
                        const isMine = message.senderId === me.id;

                        return (
                          <div
                            key={message.id}
                            className={`message-row${
                              isMine ? " is-mine" : ""
                            }`}
                          >
                            <div className="message-bubble">
                              {message.content}
                              <span className="message-time">
                                {formatMessageTime(message.createdAt)}
                              </span>
                            </div>
                          </div>
                        );
                      })}

                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  <footer className="chat-footer">
                    <form className="message-form" onSubmit={handleSendMessage}>
                      <input
                        className="input"
                        type="text"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={
                          socketConnected
                            ? `Message ${selectedFriend.name}...`
                            : "Connecting..."
                        }
                        aria-label={`Message ${selectedFriend.name}`}
                        maxLength={2000}
                        autoComplete="off"
                        disabled={!socketConnected}
                      />
                      <button
                        className="button button-primary"
                        type="submit"
                        disabled={!socketConnected || !draft.trim()}
                      >
                        Send
                      </button>
                    </form>
                  </footer>
                </>
              )}
            </section>
          </>
        ) : (
          <section className="section-panel">
            {activeSection === "find-friends" ? (
              <>
                <SectionHeader
                  title="Find Friends"
                  subtitle="Search for people and send a friend request."
                  action={
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={handleRefresh}
                      disabled={refreshing}
                    >
                      {refreshing ? "Refreshing..." : "Refresh"}
                    </button>
                  }
                />
                <div className="section-panel-scroll">
                  {errorBanner}
                  <div className="section-content">
                    <div className="search-box">
                      <label className="sr-only" htmlFor="friend-search">
                        Search people by name or email
                      </label>
                      <input
                        id="friend-search"
                        className="input"
                        type="search"
                        value={searchQuery}
                        onChange={(event) =>
                          setSearchQuery(event.target.value)
                        }
                        placeholder="Search by name or email..."
                        aria-label="Search people by name or email"
                        autoComplete="off"
                      />
                    </div>

                    {otherUsers.length === 0 ? (
                      <div className="empty-panel">
                        <span className="empty-panel-icon" aria-hidden="true">
                          🔎
                        </span>
                        <h2>No other users right now</h2>
                        <p>New people will appear here when they join.</p>
                      </div>
                    ) : filteredOtherUsers.length === 0 ? (
                      <div className="empty-panel">
                        <span className="empty-panel-icon" aria-hidden="true">
                          🔎
                        </span>
                        <h2>No matches found</h2>
                        <p>
                          Try a different name or email, or clear your search.
                        </p>
                      </div>
                    ) : (
                      <div className="user-list people-list">
                        {filteredOtherUsers.map((user) => {
                          const incomingRequest = requests.incoming.find(
                            (request) => request.sender.id === user.id
                          );
                          const outgoingRequest = requests.outgoing.find(
                            (request) => request.receiver.id === user.id
                          );

                          return (
                            <div
                              key={user.id}
                              className="user-row user-row-static"
                            >
                              <UserAvatar
                                name={user.name}
                                online={onlineUserIdsSet.has(user.id)}
                              />
                              <div className="user-info">
                                <div className="user-name">{user.name}</div>
                                <div className="user-email">{user.email}</div>
                              </div>

                              <div className="user-actions">
                                {user.relationship === "request_sent" ? (
                                  outgoingRequest ? (
                                    <button
                                      className="button button-danger button-small"
                                      type="button"
                                      onClick={() =>
                                        handleCancelRequest(outgoingRequest.id)
                                      }
                                      disabled={
                                        actionId === outgoingRequest.id
                                      }
                                    >
                                      {actionId === outgoingRequest.id
                                        ? "Cancelling..."
                                        : "Cancel request"}
                                    </button>
                                  ) : (
                                    <span className="relationship-badge">
                                      Request sent
                                    </span>
                                  )
                                ) : null}

                                {user.relationship === "request_received" ? (
                                  incomingRequest ? (
                                    <button
                                      className="button button-primary button-small"
                                      type="button"
                                      onClick={() =>
                                        handleAcceptRequest(incomingRequest.id)
                                      }
                                      disabled={
                                        actionId === incomingRequest.id
                                      }
                                    >
                                      {actionId === incomingRequest.id
                                        ? "Accepting..."
                                        : "Accept"}
                                    </button>
                                  ) : (
                                    <span className="relationship-badge">
                                      Request received
                                    </span>
                                  )
                                ) : null}

                                {user.relationship === "none" ||
                                !user.relationship ? (
                                  <button
                                    className="button button-secondary button-small"
                                    type="button"
                                    onClick={() =>
                                      handleSendFriendRequest(user.id)
                                    }
                                    disabled={actionId === user.id}
                                  >
                                    {actionId === user.id
                                      ? "Sending..."
                                      : "Add friend"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : activeSection === "requests" ? (
              <>
                <SectionHeader
                  title="Friend Requests"
                  subtitle="Accept new friends or review requests you have sent."
                  action={
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={handleRefresh}
                      disabled={refreshing}
                    >
                      {refreshing ? "Refreshing..." : "Refresh"}
                    </button>
                  }
                />
                <div className="section-panel-scroll">
                  {errorBanner}
                  <div className="section-content">
                    <section className="panel-block">
                      <div className="section-heading">
                        <h2 className="section-title">Incoming</h2>
                        <span className="count-badge">
                          {incomingRequestCount}
                        </span>
                      </div>

                      {incomingRequestCount === 0 ? (
                        <p className="empty-note">
                          No incoming friend requests.
                        </p>
                      ) : (
                        <div className="request-list">
                          {requests.incoming.map((request) => (
                            <div key={request.id} className="request-card">
                              <div className="request-user">
                                <UserAvatar
                                  name={request.sender.name}
                                  online={onlineUserIdsSet.has(
                                    request.sender.id
                                  )}
                                />
                                <div className="user-info">
                                  <div className="user-name">
                                    {request.sender.name}
                                  </div>
                                  <div className="user-email">
                                    {request.sender.email}
                                  </div>
                                </div>
                              </div>

                              <div className="request-actions">
                                <button
                                  className="button button-primary button-small"
                                  type="button"
                                  onClick={() =>
                                    handleAcceptRequest(request.id)
                                  }
                                  disabled={actionId === request.id}
                                >
                                  {actionId === request.id
                                    ? "Accepting..."
                                    : "Accept"}
                                </button>
                                <button
                                  className="button button-danger button-small"
                                  type="button"
                                  onClick={() =>
                                    handleDeclineRequest(request.id)
                                  }
                                  disabled={actionId === request.id}
                                >
                                  {actionId === request.id
                                    ? "Working..."
                                    : "Decline"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="panel-block">
                      <div className="section-heading">
                        <h2 className="section-title">Outgoing</h2>
                        <span className="count-badge">
                          {outgoingRequestCount}
                        </span>
                      </div>

                      {outgoingRequestCount === 0 ? (
                        <p className="empty-note">
                          You have not sent any friend requests.
                        </p>
                      ) : (
                        <div className="request-list">
                          {requests.outgoing.map((request) => (
                            <div
                              key={request.id}
                              className="request-card request-card-muted"
                            >
                              <div className="request-user">
                                <UserAvatar
                                  name={request.receiver.name}
                                  online={onlineUserIdsSet.has(
                                    request.receiver.id
                                  )}
                                />
                                <div className="user-info">
                                  <div className="user-name">
                                    {request.receiver.name}
                                  </div>
                                  <div className="user-email">
                                    Request sent to {request.receiver.email}
                                  </div>
                                </div>
                              </div>

                              <span className="relationship-badge">
                                Pending
                              </span>
                              <button
                                className="button button-danger button-small"
                                type="button"
                                onClick={() =>
                                  handleCancelRequest(request.id)
                                }
                                disabled={actionId === request.id}
                              >
                                {actionId === request.id
                                  ? "Cancelling..."
                                  : "Cancel"}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </>
            ) : activeSection === "notifications" ? (
              <>
                <SectionHeader
                  title="Notifications"
                  subtitle="Updates about friend requests and messages."
                />
                <div className="section-panel-scroll">
                  {errorBanner}
                  <div className="section-content section-content-narrow">
                    <div className="empty-panel">
                      <span className="empty-panel-icon" aria-hidden="true">
                        🔔
                      </span>
                      <h2>No notifications yet</h2>
                      <p>
                        Friend request updates and new message alerts will
                        appear here.
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <SectionHeader
                  title="Profile Settings"
                  subtitle="Your account details and session controls."
                />
                <div className="section-panel-scroll">
                  {errorBanner}
                  <div className="section-content section-content-narrow">
                    <div className="profile-card">
                      <div className="profile-card-head">
                        <div className="profile-avatar">
                          <UserAvatar
                            name={me.name}
                            online={socketConnected}
                          />
                        </div>
                        <div className="profile-card-identity">
                          <h2 className="profile-name">{me.name}</h2>
                          <p className="profile-email">{me.email}</p>
                        </div>
                      </div>

                      <div className="profile-details">
                        <div className="profile-detail">
                          <span className="profile-detail-label">Name</span>
                          <span className="profile-detail-value">
                            {me.name}
                          </span>
                        </div>
                        <div className="profile-detail">
                          <span className="profile-detail-label">Email</span>
                          <span className="profile-detail-value">
                            {me.email}
                          </span>
                        </div>
                      </div>

                      <p className="form-hint profile-hint">
                        Name and profile photo editing will be added in a later
                        stage.
                      </p>

                      <div className="profile-card-footer">
                        <button
                          className="button button-ghost"
                          type="button"
                          onClick={handleLogout}
                        >
                          Log out
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
