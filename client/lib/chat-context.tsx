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
  type Group,
  type GroupMessage,
  type GroupsResponse,
  type GroupMessagesResponse,
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
  groups: Group[];
};

type GroupEventPayload =
  | {
      groupId: string;
      changedBy: string;
      changes: { name?: string; onlyAdminsCanSend?: boolean };
    }
  | {
      groupId: string;
      memberId: string;
      role: "admin" | "member";
    }
  | {
      groupId: string;
      memberId: string;
    };

type ChatContextValue = {
  me: User | null;
  users: User[];
  conversations: Conversation[];
  groups: Group[];
  requests: FriendRequestsResponse;
  onlineUserIds: string[];
  socketConnected: boolean;
  selectedFriend: User | null;
  selectedGroup: Group | null;
  messagesByFriend: Record<string, Message[]>;
  messagesByGroup: Record<string, GroupMessage[]>;
  draft: string;
  groupDraft: string;
  loading: boolean;
  loadingHistory: boolean;
  refreshing: boolean;
  mobileChatOpen: boolean;
  setMobileChatOpen: (open: boolean) => void;
  actionId: string | null;
  error: string | null;
  chatError: string | null;
  setDraft: (draft: string) => void;
  setGroupDraft: (draft: string) => void;
  clearError: () => void;
  refresh: () => Promise<void>;
  openConversation: (friend: User) => void;
  openGroup: (group: Group) => void;
  sendMessage: (event: FormEvent<HTMLFormElement>) => void;
  sendGroupMessage: (event: FormEvent<HTMLFormElement>) => void;
  createGroup: (name: string, memberIds: string[]) => Promise<boolean>;
  updateGroup: (
    groupId: string,
    updates: { name?: string; onlyAdminsCanSend?: boolean }
  ) => Promise<boolean>;
  updateGroupMemberRole: (
    groupId: string,
    memberId: string,
    role: "admin" | "member"
  ) => Promise<boolean>;
  removeGroupMember: (groupId: string, memberId: string) => Promise<boolean>;
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
  const [usersResponse, requestsResponse, conversationsResponse, groupsResponse] =
    await Promise.all([
      apiFetch<UsersResponse>("/v1/users"),
      apiFetch<FriendRequestsResponse>("/v1/friend-requests"),
      apiFetch<ConversationsResponse>("/v1/conversations"),
      apiFetch<GroupsResponse>("/v1/groups"),
    ]);

  return {
    users: usersResponse.users,
    requests: requestsResponse,
    conversations: conversationsResponse.conversations,
    groups: groupsResponse.groups,
  };
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const openConversationIdRef = useRef<string | null>(null);

  const [me, setMe] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [requests, setRequests] = useState<FriendRequestsResponse>({
    incoming: [],
    outgoing: [],
  });
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<User | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [messagesByFriend, setMessagesByFriend] = useState<
    Record<string, Message[]>
  >({});
  const [messagesByGroup, setMessagesByGroup] = useState<
    Record<string, GroupMessage[]>
  >({});
  const [draft, setDraft] = useState("");
  const [groupDraft, setGroupDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const temporaryNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const applyLists = useCallback((lists: ListsData) => {
    setUsers(lists.users);
    setRequests(lists.requests);
    setConversations(lists.conversations);
    setGroups(lists.groups);
    setSelectedGroup((current) => {
      if (!current) return current;
      return lists.groups.find((group) => group.groupId === current.groupId) ?? null;
    });
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

  const showTemporaryNotice = useCallback((message: string) => {
    if (temporaryNoticeTimeoutRef.current) {
      clearTimeout(temporaryNoticeTimeoutRef.current);
    }
    setChatError(message);
    temporaryNoticeTimeoutRef.current = setTimeout(() => {
      setChatError(null);
      temporaryNoticeTimeoutRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (temporaryNoticeTimeoutRef.current) {
        clearTimeout(temporaryNoticeTimeoutRef.current);
      }
    };
  }, []);

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

    function handleReceiveGroupMessage(message: GroupMessage) {
      setMessagesByGroup((previous) => {
        const existing = previous[message.groupId] ?? [];
        if (existing.some((item) => item.id === message.id)) return previous;
        return {
          ...previous,
          [message.groupId]: [...existing, message],
        };
      });
    }

    function handleGroupEvent(payload: GroupEventPayload) {
      void refresh().then(() => {
        if (
          "memberId" in payload &&
          payload.memberId === currentUserId &&
          "role" in payload &&
          payload.role === "admin"
        ) {
          showTemporaryNotice("You are now a group admin.");
        } else if (
          "memberId" in payload &&
          payload.memberId === currentUserId &&
          "role" in payload &&
          payload.role === "member"
        ) {
          showTemporaryNotice("Your group admin access was removed.");
        } else if (
          "memberId" in payload &&
          payload.memberId === currentUserId &&
          !("role" in payload)
        ) {
          setSelectedGroup(null);
          setMobileChatOpen(false);
          showTemporaryNotice("You were removed from this group.");
        } else if ("changes" in payload) {
          showTemporaryNotice(
            payload.changes.onlyAdminsCanSend === true
              ? "This group is now admin-only for sending messages."
              : payload.changes.onlyAdminsCanSend === false
                ? "All group members can send messages again."
                : "Group settings were updated."
          );
        }
      }).catch(handlePageError);
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
    socket.on("receive_group_message", handleReceiveGroupMessage);
    socket.on("group_updated", handleGroupEvent);
    socket.on("group_member_role_updated", handleGroupEvent);
    socket.on("group_member_removed", handleGroupEvent);
    socket.on("chat_error", (payload: { message?: string }) =>
      setChatError(payload.message ?? "Could not send the message.")
    );
    socket.on("connect_error", handleConnectError);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [handlePageError, me, refresh, router, showTemporaryNotice]);

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

  useEffect(() => {
    if (!selectedGroup) return;
    let cancelled = false;

    apiFetch<GroupMessagesResponse>(
      `/v1/groups/${selectedGroup.groupId}/messages`
    )
      .then((response) => {
        if (cancelled) return;
        setMessagesByGroup((previous) => ({
          ...previous,
          [selectedGroup.groupId]: response.messages,
        }));
      })
      .catch(handlePageError)
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [handlePageError, historyVersion, selectedGroup]);

  function openConversation(friend: User) {
    setChatError(null);
    openConversationIdRef.current = friend.id;
    setLoadingHistory(true);
    setSelectedGroup(null);
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

  function openGroup(group: Group) {
    setChatError(null);
    setLoadingHistory(true);
    setSelectedFriend(null);
    setSelectedGroup(group);
    setMobileChatOpen(true);
    socketRef.current?.emit("join_group", { groupId: group.groupId });
    router.push("/chat");
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

  function sendGroupMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = groupDraft.trim();
    if (!selectedGroup || !content) return;
    if (!socketRef.current?.connected) {
      setChatError("Not connected. Please wait a moment and try again.");
      return;
    }
    socketRef.current.emit("send_group_message", {
      groupId: selectedGroup.groupId,
      content,
    });
    setGroupDraft("");
  }

  async function createGroup(name: string, memberIds: string[]) {
    setActionId("create-group");
    setError(null);
    try {
      await apiFetch<{ message: string }>("/v1/groups", {
        method: "POST",
        body: JSON.stringify({ name, memberIds }),
      });
      applyLists(await fetchLists());
      return true;
    } catch (groupError) {
      handlePageError(groupError);
      return false;
    } finally {
      setActionId(null);
    }

  }

  async function updateGroup(
    groupId: string,
    updates: { name?: string; onlyAdminsCanSend?: boolean }
  ) {
    setActionId(`group-settings-${groupId}`);
    setError(null);
    try {
      await apiFetch<{ message: string }>(`/v1/groups/${groupId}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      });
      applyLists(await fetchLists());
      return true;
    } catch (groupError) {
      handlePageError(groupError);
      return false;
    } finally {
      setActionId(null);
    }
  }

  async function updateGroupMemberRole(
    groupId: string,
    memberId: string,
    role: "admin" | "member"
  ) {
    setActionId(`group-role-${memberId}`);
    setError(null);
    try {
      await apiFetch<{ message: string }>(
        `/v1/groups/${groupId}/members/${memberId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ role }),
        }
      );
      applyLists(await fetchLists());
      return true;
    } catch (groupError) {
      handlePageError(groupError);
      return false;
    } finally {
      setActionId(null);
    }
  }

  async function removeGroupMember(groupId: string, memberId: string) {
    setActionId(`group-remove-${memberId}`);
    setError(null);
    try {
      await apiFetch<{ message: string }>(
        `/v1/groups/${groupId}/members/${memberId}`,
        { method: "DELETE" }
      );
      applyLists(await fetchLists());
      return true;
    } catch (groupError) {
      handlePageError(groupError);
      return false;
    } finally {
      setActionId(null);
    }
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
        groups,
        requests,
        onlineUserIds,
        socketConnected,
        selectedFriend,
        selectedGroup,
        messagesByFriend,
        messagesByGroup,
        draft,
        groupDraft,
        loading,
        loadingHistory,
        refreshing,
        mobileChatOpen,
        setMobileChatOpen,
        actionId,
        error,
        chatError,
        setDraft,
        setGroupDraft,
        clearError: () => setError(null),
        refresh,
        openConversation,
        openGroup,
        sendMessage,
        sendGroupMessage,
        createGroup,
        updateGroup,
        updateGroupMemberRole,
        removeGroupMember,
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
