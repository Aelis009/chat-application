"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
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
  type ProfileResponse,
  type User,
  type UsersResponse,
} from "@/lib/api";

type ListsData = {
  users: User[];
  requests: FriendRequestsResponse;
  conversations: Conversation[];
};

type ChatContextValue = {
  me: User | null;
  users: User[];
  conversations: Conversation[];
  requests: FriendRequestsResponse;
  onlineUserIds: string[];
  socketConnected: boolean;
  selectedFriend: User | null;
  messagesByFriend: Record<string, Message[]>;
  draft: string;
  loading: boolean;
  loadingHistory: boolean;
  refreshing: boolean;
  mobileChatOpen: boolean;
  setMobileChatOpen: (open: boolean) => void;
  actionId: string | null;
  error: string | null;
  chatError: string | null;
  setDraft: (draft: string) => void;
  clearError: () => void;
  refresh: () => Promise<void>;
  openConversation: (friend: User) => void;
  sendMessage: (event: FormEvent<HTMLFormElement>) => void;
  sendFriendRequest: (receiverId: string) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  declineRequest: (requestId: string) => Promise<void>;
  cancelRequest: (requestId: string) => Promise<void>;
  removeFriend: (friendId: string) => Promise<void>;
  saveProfile: (name: string) => Promise<User>;
  logout: () => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

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

export function ChatProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const openConversationIdRef = useRef<string | null>(null);

  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [requests, setRequests] = useState<FriendRequestsResponse>({
    incoming: [],
    outgoing: [],
  });
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null);
  const [messagesByFriend, setMessagesByFriend] = useState<
    Record<string, Message[]>
  >({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const applyLists = useCallback((lists: ListsData) => {
    setUsers(lists.users);
    setRequests(lists.requests);
    setConversations(lists.conversations);
  }, []);

  const handlePageError = useCallback(
    (pageError: unknown) => {
      if (pageError instanceof ApiError && pageError.status === 401) {
        router.replace("/login");
        return;
      }

      setError(
        pageError instanceof Error
          ? pageError.message
          : "Something went wrong. Please try again."
      );
    },
    [router]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);

    try {
      applyLists(await fetchLists());
    } catch (refreshError) {
      handlePageError(refreshError);
    } finally {
      setRefreshing(false);
    }
  }, [applyLists, handlePageError]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const meResponse = await apiFetch<MeResponse>("/v1/auth/me");
        if (cancelled) return;
        setMe(meResponse.user);

        applyLists(await fetchLists());
      } catch (loadError) {
        if (cancelled) return;
        if (loadError instanceof ApiError && loadError.status === 401) {
          router.replace("/login");
          return;
        }
        handlePageError(loadError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [applyLists, handlePageError, router]);

  useEffect(() => {
    if (!me) return;
    const currentUserId = me.id;
    const socket = io(`${SOCKET_URL}/private`, {
      path: SOCKET_PATH,
      transports: ["websocket"],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });
    socketRef.current = socket;

    function handleConnect() {
      setSocketConnected(true);
      setChatError(null);
      setHistoryVersion((version) => version + 1);
    }

    function handleDisconnect() {
      setSocketConnected(false);
      setOnlineUserIds([]);
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
        if (existing.some((item) => item.id === message.id)) return previous;
        return {
          ...previous,
          [otherUserId]: [...existing, message],
        };
      });

      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.friend.id === otherUserId
            ? {
                ...conversation,
                lastMessage: message,
                unreadCount:
                  isIncoming && !isOpen
                    ? conversation.unreadCount + 1
                    : isIncoming
                      ? 0
                      : conversation.unreadCount,
              }
            : conversation
        )
      );

      if (isIncoming && isOpen) {
        void apiFetch<{ message: string }>(
          `/v1/conversations/${otherUserId}/read`,
          { method: "POST" }
        ).catch(handlePageError);
      }
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
    socket.on("online_users", setOnlineUserIds);
    socket.on("receive_message", handleReceiveMessage);
    socket.on("chat_error", (payload: { message?: string }) =>
      setChatError(payload.message ?? "Could not send the message.")
    );
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [handlePageError, me, router]);

  useEffect(() => {
    if (!selectedFriend) return;
    let cancelled = false;

    apiFetch<MessagesResponse>(`/v1/messages/${selectedFriend.id}`)
      .then((response) => {
        if (cancelled) return;
        setMessagesByFriend((previous) => {
          const merged = [...response.messages];
          for (const message of previous[selectedFriend.id] ?? []) {
            if (!merged.some((item) => item.id === message.id)) {
              merged.push(message);
            }
          }
          merged.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() -
              new Date(b.createdAt).getTime()
          );
          return { ...previous, [selectedFriend.id]: merged };
        });
      })
      .catch(handlePageError)
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [handlePageError, historyVersion, selectedFriend]);

  function openConversation(friend: User) {
    setChatError(null);
    openConversationIdRef.current = friend.id;
    setLoadingHistory(true);
    setSelectedFriend(friend);
    setMobileChatOpen(true);
    router.push("/chat");

    setConversations((previous) =>
      previous.map((conversation) => {
        if (conversation.friend.id !== friend.id) return conversation;
        if (conversation.unreadCount > 0) {
          void apiFetch<{ message: string }>(
            `/v1/conversations/${friend.id}/read`,
            { method: "POST" }
          ).catch(handlePageError);
        }
        return { ...conversation, unreadCount: 0 };
      })
    );
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!selectedFriend || !content) return;
    if (!socketRef.current?.connected) {
      setChatError("Not connected. Please wait a moment and try again.");
      return;
    }
    socketRef.current.emit("send_message", {
      receiverId: selectedFriend.id,
      content,
    });
    setDraft("");
  }

  async function sendFriendRequest(receiverId: string) {
    setActionId(receiverId);
    setError(null);
    try {
      await apiFetch<{ message: string }>("/v1/friend-requests", {
        method: "POST",
        body: JSON.stringify({ receiverId }),
      });
      applyLists(await fetchLists());
    } catch (requestError) {
      handlePageError(requestError);
    } finally {
      setActionId(null);
    }
  }

  async function acceptRequest(requestId: string) {
    setActionId(requestId);
    setError(null);
    const request = requests.incoming.find((item) => item.id === requestId);
    try {
      await apiFetch<{ message: string }>(
        `/v1/friend-requests/${requestId}/accept`,
        { method: "POST" }
      );
      const lists = await fetchLists();
      applyLists(lists);
      if (request) openConversation(request.sender);
    } catch (requestError) {
      handlePageError(requestError);
    } finally {
      setActionId(null);
    }
  }

  async function declineRequest(requestId: string) {
    setActionId(requestId);
    setError(null);
    try {
      await apiFetch<{ message: string }>(
        `/v1/friend-requests/${requestId}/decline`,
        { method: "POST" }
      );
      applyLists(await fetchLists());
    } catch (requestError) {
      handlePageError(requestError);
    } finally {
      setActionId(null);
    }
  }

  async function cancelRequest(requestId: string) {
    setActionId(requestId);
    setError(null);
    try {
      await apiFetch<{ message: string }>(
        `/v1/friend-requests/${requestId}`,
        { method: "DELETE" }
      );
      applyLists(await fetchLists());
    } catch (requestError) {
      handlePageError(requestError);
    } finally {
      setActionId(null);
    }
  }

  async function removeFriend(friendId: string) {
    if (!selectedFriend || selectedFriend.id !== friendId) return;
    if (!window.confirm(`Remove ${selectedFriend.name} from your friends?`))
      return;

    setActionId(friendId);
    setError(null);
    try {
      await apiFetch<{ message: string }>(`/v1/friends/${friendId}`, {
        method: "DELETE",
      });
      setSelectedFriend(null);
      openConversationIdRef.current = null;
      setDraft("");
      applyLists(await fetchLists());
    } catch (removeError) {
      handlePageError(removeError);
    } finally {
      setActionId(null);
    }
  }

  async function saveProfile(name: string) {
    setActionId("profile");
    setError(null);
    try {
      const response = await apiFetch<ProfileResponse>("/v1/profile", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setMe(response.user);
      applyLists(await fetchLists());
      return response.user;
    } catch (profileError) {
      handlePageError(profileError);
      throw profileError;
    } finally {
      setActionId(null);
    }
  }

  async function logout() {
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

  return (
    <ChatContext.Provider
      value={{
        me,
        users,
        conversations,
        requests,
        onlineUserIds,
        socketConnected,
        selectedFriend,
        messagesByFriend,
        draft,
        loading,
        loadingHistory,
        refreshing,
        mobileChatOpen,
        setMobileChatOpen,
        actionId,
        error,
        chatError,
        setDraft,
        clearError: () => setError(null),
        refresh,
        openConversation,
        sendMessage,
        sendFriendRequest,
        acceptRequest,
        declineRequest,
        cancelRequest,
        removeFriend,
        saveProfile,
        logout,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return context;
}
