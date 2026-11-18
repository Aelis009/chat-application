"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import Brand from "@/components/Brand";
import {
  API_URL,
  ApiError,
  apiFetch,
  type FriendRequestsResponse,
  type FriendsResponse,
  type MeResponse,
  type Message,
  type MessagesResponse,
  type User,
  type UsersResponse,
} from "@/lib/api";

type ListsData = {
  users: User[];
  requests: FriendRequestsResponse;
  friends: User[];
};

async function fetchLists(): Promise<ListsData> {
  const [usersResponse, requestsResponse, friendsResponse] = await Promise.all([
    apiFetch<UsersResponse>("/api/users"),
    apiFetch<FriendRequestsResponse>("/api/friend-requests"),
    apiFetch<FriendsResponse>("/api/friends"),
  ]);

  return {
    users: usersResponse.users,
    requests: requestsResponse,
    friends: friendsResponse.friends,
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

export default function ChatPage() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [friends, setFriends] = useState<User[]>([]);
  const [requests, setRequests] = useState<FriendRequestsResponse>({
    incoming: [],
    outgoing: [],
  });
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      let redirecting = false;

      try {
        const meResponse = await apiFetch<MeResponse>("/api/auth/me");

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
        setFriends(lists.friends);
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
    if (!me) {
      return;
    }

    const currentUserId = me.id;
    const socket = io(`${API_URL}/private`, {
      withCredentials: true,
    });
    socketRef.current = socket;

    function handleConnect() {
      setSocketConnected(true);
      setChatError(null);
    }

    function handleDisconnect() {
      setSocketConnected(false);
      setOnlineUserIds([]);
    }

    function handleOnlineUsers(userIds: string[]) {
      setOnlineUserIds(userIds);
    }

    function handleReceiveMessage(message: Message) {
      setMessagesByFriend((previous) => {
        const otherUserId =
          message.senderId === currentUserId
            ? message.receiverId
            : message.senderId;
        const existing = previous[otherUserId] ?? [];

        if (existing.some((item) => item.id === message.id)) {
          return previous;
        }

        return {
          ...previous,
          [otherUserId]: [...existing, message],
        };
      });
    }

    function handleChatError(payload: { message?: string }) {
      setChatError(payload.message ?? "Could not send the message.");
    }

    function handleConnectError(connectError: Error) {
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

    apiFetch<MessagesResponse>(`/api/messages/${selectedFriend.id}`)
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
  }, [selectedFriend, router]);

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
  const requestCount = requests.incoming.length + requests.outgoing.length;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [selectedFriendId, selectedMessageCount]);

  function applyLists(lists: ListsData) {
    setUsers(lists.users);
    setRequests(lists.requests);
    setFriends(lists.friends);
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

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);

    try {
      applyLists(await fetchLists());
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
        `/api/friend-requests/${requestId}/accept`,
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
        `/api/friend-requests/${requestId}/decline`,
        { method: "POST" }
      );

      applyLists(await fetchLists());
    } catch (declineError) {
      handlePageError(declineError);
    } finally {
      setActionId(null);
    }
  }

  async function handleSendFriendRequest(receiverId: string) {
    setActionId(receiverId);
    setError(null);

    try {
      await apiFetch<{ message: string }>("/api/friend-requests", {
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
    setChatError(null);

    if (selectedFriendId !== friend.id) {
      setLoadingHistory(true);
    }

    setSelectedFriend(friend);
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
      await apiFetch<{ message: string }>("/api/auth/logout", {
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

  return (
    <main className="chat-page">
      <div className="chat-shell">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-brand-row">
              <Brand />
              <div className="sidebar-actions">
                <button
                  className="button button-ghost button-small"
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  {refreshing ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  className="button button-ghost button-small"
                  type="button"
                  onClick={handleLogout}
                >
                  Log out
                </button>
              </div>
            </div>

            <div className="current-user">
              <UserAvatar
                name={me.name}
                online={onlineUserIdsSet.has(me.id)}
              />
              <div className="current-user-info">
                <div className="current-user-name">{me.name}</div>
                <div className="current-user-email">{me.email}</div>
              </div>
            </div>
          </div>

          <div className="sidebar-scroll">
            {error ? (
              <div className="error-banner" role="alert">
                {error}
              </div>
            ) : null}

            <section className="sidebar-section">
              <div className="section-heading">
                <h2 className="section-title">Friends</h2>
                <span className="count-badge">{friends.length}</span>
              </div>

              {friends.length === 0 ? (
                <p className="empty-note">
                  No friends yet. Send a request below.
                </p>
              ) : (
                <div className="user-list">
                  {friends.map((friend) => (
                    <button
                      key={friend.id}
                      className={`user-row${
                        selectedFriendId === friend.id ? " is-selected" : ""
                      }`}
                      type="button"
                      onClick={() => openConversation(friend)}
                    >
                      <UserAvatar
                        name={friend.name}
                        online={onlineUserIdsSet.has(friend.id)}
                      />
                      <span className="user-info">
                        <span className="user-name">{friend.name}</span>
                        <span className="user-email">{friend.email}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="sidebar-section">
              <div className="section-heading">
                <h2 className="section-title">Requests</h2>
                <span className="count-badge">{requestCount}</span>
              </div>

              {requestCount === 0 ? (
                <p className="empty-note">No pending requests.</p>
              ) : (
                <div className="request-list">
                  {requests.incoming.map((request) => (
                    <div key={request.id} className="request-card">
                      <div className="request-user">
                        <UserAvatar
                          name={request.sender.name}
                          online={onlineUserIdsSet.has(request.sender.id)}
                        />
                        <div className="user-info">
                          <div className="user-name">{request.sender.name}</div>
                          <div className="user-email">wants to be friends</div>
                        </div>
                      </div>

                      <div className="request-actions">
                        <button
                          className="button button-primary button-small"
                          type="button"
                          onClick={() => handleAcceptRequest(request.id)}
                          disabled={actionId === request.id}
                        >
                          {actionId === request.id ? "Accepting..." : "Accept"}
                        </button>
                        <button
                          className="button button-danger button-small"
                          type="button"
                          onClick={() => handleDeclineRequest(request.id)}
                          disabled={actionId === request.id}
                        >
                          {actionId === request.id ? "Working..." : "Decline"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {requests.outgoing.map((request) => (
                    <div
                      key={request.id}
                      className="request-card request-card-muted"
                    >
                      <div className="request-user">
                        <UserAvatar
                          name={request.receiver.name}
                          online={onlineUserIdsSet.has(request.receiver.id)}
                        />
                        <div className="user-info">
                          <div className="user-name">{request.receiver.name}</div>
                          <div className="user-email">Request sent</div>
                        </div>
                      </div>

                      <span className="relationship-badge">Pending</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="sidebar-section">
              <div className="section-heading">
                <h2 className="section-title">Find people</h2>
                <span className="count-badge">{otherUsers.length}</span>
              </div>

              {otherUsers.length === 0 ? (
                <p className="empty-note">No other users right now.</p>
              ) : (
                <div className="user-list">
                  {otherUsers.map((user) => {
                    const incomingRequest = requests.incoming.find(
                      (request) => request.sender.id === user.id
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
                            <span className="relationship-badge">
                              Request sent
                            </span>
                          ) : null}

                          {user.relationship === "request_received" ? (
                            incomingRequest ? (
                              <button
                                className="button button-primary button-small"
                                type="button"
                                onClick={() =>
                                  handleAcceptRequest(incomingRequest.id)
                                }
                                disabled={actionId === incomingRequest.id}
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
                              onClick={() => handleSendFriendRequest(user.id)}
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
            </section>
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
                Your private conversations appear here. Add a friend from the
                sidebar if your list is empty.
              </p>
            </div>
          ) : (
            <>
              <header className="chat-header">
                <div className="chat-person">
                  <UserAvatar
                    name={selectedFriend.name}
                    online={selectedFriendOnline}
                  />
                  <div className="chat-person-info">
                    <h1 className="chat-title">{selectedFriend.name}</h1>
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

                <span
                  className={`live-pill${
                    socketConnected ? " is-connected" : " is-disconnected"
                  }`}
                >
                  {socketConnected ? "Live" : "Connecting..."}
                </span>
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
                        className={`message-row${isMine ? " is-mine" : ""}`}
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
      </div>
    </main>
  );
}
