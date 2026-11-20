"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useChat } from "@/lib/chat-context";
import type { Conversation, Group, Message } from "@/lib/api";
import UserAvatar from "@/components/chat/UserAvatar";

const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

function formatMessageTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function canEditMessage(createdAt: string) {
  return Date.now() - new Date(createdAt).getTime() <= MESSAGE_EDIT_WINDOW_MS;
}

function sortConversations(conversations: Conversation[]) {
  return [...conversations].sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return bTime - aTime || a.friend.name.localeCompare(b.friend.name);
  });
}

function sortGroups(groups: Group[]) {
  return [...groups].sort((a, b) => a.name.localeCompare(b.name));
}

export default function ChatPage() {
  const {
    me, users, conversations, groups, onlineUserIds, socketConnected, selectedFriend,
    selectedGroup, messagesByFriend, messagesByGroup, draft, groupDraft,
    hasMoreMessagesByFriend, hasMoreMessagesByGroup, loadOlderMessages,
    loadingHistory, chatError, refreshing, actionId,
    error, mobileChatOpen, setMobileChatOpen, refresh, openConversation,
    openGroup, setDraft, setGroupDraft, sendMessage, sendGroupMessage,
    editMessage, deleteMessage,
    createGroup, updateGroup, updateGroupMemberRole, removeGroupMember,
    removeFriend,
  } = useChat();
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingOlderRef = useRef(false);
  const nearBottomRef = useRef(true);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [isGroupProfileOpen, setIsGroupProfileOpen] = useState(false);
  const [groupNameEdit, setGroupNameEdit] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [, setCurrentTime] = useState(() => Date.now());
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const onlineSet = new Set(onlineUserIds);
  const sortedConversations = sortConversations(conversations);
  const sortedGroups = sortGroups(groups);
  const selectedMessages = selectedFriend
    ? messagesByFriend[selectedFriend.id] ?? []
    : [];
  const selectedGroupMessages = selectedGroup
    ? messagesByGroup[selectedGroup.groupId] ?? []
    : [];
  const acceptedFriends = useMemo(
    () => users.filter((user) => user.relationship === "friends"),
    [users]
  );
  const filteredFriends = acceptedFriends.filter((friend) => {
    const search = memberSearch.trim().toLowerCase();
    return (
      !search ||
      friend.name.toLowerCase().includes(search) ||
      friend.email.toLowerCase().includes(search)
    );
  });
  const currentGroupMember = selectedGroup?.members.find(
    (member) => member.id === me?.id
  );
  const canManageGroup = currentGroupMember?.role === "owner" ||
    currentGroupMember?.role === "admin";
  const canSendGroupMessage = !selectedGroup ||
    !selectedGroup.onlyAdminsCanSend ||
    canManageGroup;

  const activeConversationId = selectedFriend?.id ?? selectedGroup?.groupId ?? null;
  const activeConversationType: "friend" | "group" = selectedFriend
    ? "friend"
    : "group";
  const hasMoreOlder = activeConversationId
    ? activeConversationType === "friend"
      ? hasMoreMessagesByFriend[activeConversationId]
      : hasMoreMessagesByGroup[activeConversationId]
    : false;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!openMessageMenuId) return;

    function closeMenuOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        !target.closest("[data-message-menu]")
      ) {
        setOpenMessageMenuId(null);
      }
    }

    document.addEventListener(
      "pointerdown",
      closeMenuOnOutsidePointer,
      true
    );
    return () =>
      document.removeEventListener(
        "pointerdown",
        closeMenuOnOutsidePointer,
        true
      );
  }, [openMessageMenuId]);

  function closeCreateGroup() {
    setIsCreateGroupOpen(false);
    setGroupName("");
    setMemberSearch("");
    setSelectedMemberIds([]);
  }

  function openGroupProfile() {
    if (!selectedGroup) return;
    setGroupNameEdit(selectedGroup.name);
    setIsGroupProfileOpen(true);
  }

  function startEditing(id: string, content: string) {
    setEditingMessageId(id);
    setEditingContent(content);
  }

  function saveEditing(group: boolean) {
    if (!editingMessageId || !editingContent.trim()) return;
    editMessage(editingMessageId, editingContent, group);
    setEditingMessageId(null);
    setEditingContent("");
  }

  async function saveGroupName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroup || !groupNameEdit.trim()) return;
    const updated = await updateGroup(selectedGroup.groupId, {
      name: groupNameEdit.trim(),
    });
    if (updated) setGroupNameEdit(groupNameEdit.trim());
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupName.trim() || selectedMemberIds.length === 0) return;
    const created = await createGroup(groupName.trim(), selectedMemberIds);
    if (created) closeCreateGroup();
  }

  useEffect(() => {
    const body = chatBodyRef.current;
    if (!body) return;
    nearBottomRef.current = true;
    setShowNewMessages(false);
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  }, [selectedFriend?.id, selectedGroup?.groupId, mobileChatOpen]);

  useEffect(() => {
    const body = chatBodyRef.current;
    if (!body || loadingOlderRef.current) return;
    if (nearBottomRef.current) {
      body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    } else {
      setShowNewMessages(true);
    }
  }, [selectedMessages.length, selectedGroupMessages.length]);

  function clearLongPressTimer() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function startLongPress(messageId: string, pointerType: string) {
    clearLongPressTimer();
    if (pointerType !== "touch") return;
    longPressTimerRef.current = setTimeout(() => {
      setOpenMessageMenuId(messageId);
      longPressTimerRef.current = null;
    }, 500);
  }

  function handleChatScroll() {
    const body = chatBodyRef.current;
    if (!body) return;
    nearBottomRef.current =
      body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    if (nearBottomRef.current) setShowNewMessages(false);

    if (
      body.scrollTop > 120 ||
      !activeConversationId ||
      !hasMoreOlder ||
      loadingOlderRef.current
    ) {
      return;
    }

    loadingOlderRef.current = true;
    setIsLoadingOlder(true);
    const previousHeight = body.scrollHeight;
    const previousTop = body.scrollTop;
    void loadOlderMessages(activeConversationType, activeConversationId)
      .then(() => {
        requestAnimationFrame(() => {
          const currentBody = chatBodyRef.current;
          if (currentBody) {
            currentBody.scrollTop =
              previousTop + currentBody.scrollHeight - previousHeight;
          }
          loadingOlderRef.current = false;
          setIsLoadingOlder(false);
        });
      });
  }

  function handleMessagePointerDown(
    messageId: string,
    pointerType: string
  ) {
    startLongPress(messageId, pointerType);
  }

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-header sidebar-header-compact">
          <div className="panel-heading">
            <div>
              <h1 className="panel-title">Chats</h1>
              <p className="panel-subtitle">
                {sortedConversations.length} {sortedConversations.length === 1 ? "friend" : "friends"}
              </p>
            </div>
            <div className="panel-heading-actions">
              <button className="button button-ghost button-small" type="button" onClick={() => setIsCreateGroupOpen(true)}>
                New group
              </button>
              <button className="button button-ghost button-small" type="button" onClick={refresh} disabled={refreshing}>
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>
        <div className="sidebar-scroll">
          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          {sortedConversations.length === 0 ? (
            <div className="empty-panel">
              <span className="empty-panel-icon" aria-hidden="true">💬</span>
              <h2>No chats yet</h2>
              <p>Find a friend and send your first message.</p>
              <a className="button button-primary button-small" href="/find-friends">Find friends</a>
            </div>
          ) : (
            <div className="user-list">
              {sortedConversations.map((conversation) => {
                const friend = conversation.friend;
                const lastMessage = conversation.lastMessage;
                const preview = lastMessage
                  ? `${lastMessage.senderId === me?.id ? "You: " : ""}${lastMessage.content}`
                  : "No messages yet";
                return (
                  <button
                    key={friend.id}
                    className={`user-row${selectedFriend?.id === friend.id ? " is-selected" : ""}`}
                    type="button"
                    onClick={() => {
                      openConversation(friend);
                      setMobileChatOpen(true);
                    }}
                  >
                    <UserAvatar name={friend.name} online={onlineSet.has(friend.id)} />
                    <span className="user-info conversation-info">
                      <span className="conversation-top">
                        <span className="user-name">{friend.name}</span>
                        {lastMessage ? <span className="conversation-time">{formatMessageTime(lastMessage.createdAt)}</span> : null}
                      </span>
                      <span className="conversation-bottom">
                        <span className="conversation-preview">{preview}</span>
                        {conversation.unreadCount > 0 ? (
                          <span className="unread-badge">
                            {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="sidebar-section-heading">
            <h2 className="panel-title">Groups</h2>
          </div>
          {sortedGroups.length > 0 ? (
            <div className="user-list">
              {sortedGroups.map((group) => (
                <button
                  key={group.groupId}
                  className={`user-row${selectedGroup?.groupId === group.groupId ? " is-selected" : ""}`}
                  type="button"
                  onClick={() => openGroup(group)}
                >
                  <span className="avatar avatar-group" aria-hidden="true">#</span>
                  <span className="user-info">
                    <span className="user-name">{group.name}</span>
                    <span className="user-email">{group.members.length} members</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-note">Create a group with accepted friends.</p>
          )}
        </div>
      </aside>

      <section className="chat-main">
        {chatError ? <div className="error-banner chat-error-banner" role="alert">{chatError}</div> : null}
        {!selectedFriend && !selectedGroup ? (
          <div className="chat-empty-state">
            <div className="chat-empty-icon" aria-hidden="true">📩</div>
            <h2>Pick a friend to start chatting</h2>
            <p>Your private conversations appear here. Use Find Friends if your list is empty.</p>
            <a className="button button-secondary button-small chat-empty-action" href="/find-friends">Find friends</a>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <div className="chat-person">
                <button className="chat-back-button" type="button" onClick={() => setMobileChatOpen(false)} aria-label="Back to chats">←</button>
                {selectedFriend ? (
                  <UserAvatar name={selectedFriend.name} online={onlineSet.has(selectedFriend.id)} />
                ) : (
                  <span className="avatar avatar-group" aria-hidden="true">#</span>
                )}
                <div className="chat-person-info">
                  {selectedGroup ? (
                    <button className="chat-title group-title-button" type="button" onClick={openGroupProfile}>
                      {selectedGroup.name}
                    </button>
                  ) : <h2 className="chat-title">{selectedFriend?.name}</h2>}
                  <div className="chat-presence">{selectedFriend ? (onlineSet.has(selectedFriend.id) ? "Online" : "Offline") : `${selectedGroup?.members.length} members`}</div>
                </div>
              </div>
              <div className="chat-header-actions">
                <span className={`live-pill${socketConnected ? " is-connected" : " is-disconnected"}`}>
                  {socketConnected ? "Live" : "Connecting..."}
                </span>
                {selectedFriend ? <button
                  className="button button-danger button-small"
                  type="button"
                  onClick={() => removeFriend(selectedFriend.id)}
                  disabled={actionId === selectedFriend.id}
                >
                  {actionId === selectedFriend.id ? "Removing..." : "Remove"}
                </button> : null}
              </div>
            </header>

            <div
              className="chat-body"
              ref={chatBodyRef}
              onScroll={handleChatScroll}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  setOpenMessageMenuId(null);
                }
              }}
            >
              {showNewMessages ? (
                <button
                  className="new-messages-button"
                  type="button"
                  onClick={() => {
                    nearBottomRef.current = true;
                    setShowNewMessages(false);
                    chatBodyRef.current?.scrollTo({
                      top: chatBodyRef.current.scrollHeight,
                      behavior: "smooth",
                    });
                  }}
                >
                  New messages
                </button>
              ) : null}
              <div className="messages">
                {loadingHistory && (selectedMessages.length + selectedGroupMessages.length) === 0 ? <p className="empty-note chat-loading-note"><span className="loading-spinner" aria-hidden="true" />Loading messages...</p> : null}
                {isLoadingOlder ? <p className="empty-note chat-loading-note"><span className="loading-spinner" aria-hidden="true" />Loading older messages...</p> : null}
                {!loadingHistory && selectedMessages.length === 0 && selectedGroupMessages.length === 0 ? <p className="empty-note chat-loading-note">Start the conversation.</p> : null}
                {selectedFriend && selectedMessages.map((message: Message) => (
                  <div
                    key={message.id}
                    className={`message-row${message.senderId === me?.id ? " is-mine" : ""}`}
                    onPointerDown={(event) => handleMessagePointerDown(message.id, event.pointerType)}
                    onPointerUp={clearLongPressTimer}
                    onPointerCancel={clearLongPressTimer}
                    onContextMenu={(event) => {
                      if (openMessageMenuId === message.id) event.preventDefault();
                    }}
                  >
                    <div className="message-bubble">
                      {message.deletedAt ? (
                        <em>Message deleted</em>
                      ) : editingMessageId === message.id ? (
                        <div className="message-edit-form">
                          <input className="input" value={editingContent} onChange={(event) => setEditingContent(event.target.value)} maxLength={2000} />
                          <button className="button button-primary button-small" type="button" onClick={() => saveEditing(false)}>Save</button>
                          <button className="button button-ghost button-small" type="button" onClick={() => setEditingMessageId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          {message.content}
                          {message.editedAt ? <small className="message-edited">edited</small> : null}
                          {message.senderId === me?.id ? (
                            <span
                              className={`message-actions${openMessageMenuId === message.id ? " is-open" : ""}`}
                              data-message-menu
                            >
                              <button
                                className="message-menu-trigger"
                                type="button"
                                aria-label="Message actions"
                                aria-expanded={openMessageMenuId === message.id}
                                onClick={() => setOpenMessageMenuId((current) => current === message.id ? null : message.id)}
                              >
                                ⋮
                              </button>
                              {openMessageMenuId === message.id ? (
                                <span className="message-action-menu">
                                  {canEditMessage(message.createdAt) ? (
                                    <button type="button" onClick={() => { startEditing(message.id, message.content); setOpenMessageMenuId(null); }}>Edit</button>
                                  ) : null}
                                  <button type="button" onClick={() => { deleteMessage(message.id, false); setOpenMessageMenuId(null); }}>Delete</button>
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </>
                      )}
                      <span className="message-time">{formatMessageTime(message.createdAt)}</span>
                    </div>
                  </div>
                ))}
                {selectedGroup && selectedGroupMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`message-row${message.senderId === me?.id ? " is-mine" : ""}`}
                    onPointerDown={(event) => handleMessagePointerDown(message.id, event.pointerType)}
                    onPointerUp={clearLongPressTimer}
                    onPointerCancel={clearLongPressTimer}
                    onContextMenu={(event) => {
                      if (openMessageMenuId === message.id) event.preventDefault();
                    }}
                  >
                    <div className="message-bubble">
                      {message.senderId !== me?.id ? <strong>{selectedGroup.members.find((member) => member.id === message.senderId)?.name ?? "Member"}: </strong> : null}
                      {message.deletedAt ? (
                        <em>Message deleted</em>
                      ) : editingMessageId === message.id ? (
                        <div className="message-edit-form">
                          <input className="input" value={editingContent} onChange={(event) => setEditingContent(event.target.value)} maxLength={2000} />
                          <button className="button button-primary button-small" type="button" onClick={() => saveEditing(true)}>Save</button>
                          <button className="button button-ghost button-small" type="button" onClick={() => setEditingMessageId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          {message.content}
                          {message.editedAt ? <small className="message-edited">edited</small> : null}
                          {message.senderId === me?.id || canManageGroup ? (
                            <span
                              className={`message-actions${openMessageMenuId === message.id ? " is-open" : ""}`}
                              data-message-menu
                            >
                              <button
                                className="message-menu-trigger"
                                type="button"
                                aria-label="Message actions"
                                aria-expanded={openMessageMenuId === message.id}
                                onClick={() => setOpenMessageMenuId((current) => current === message.id ? null : message.id)}
                              >
                                ⋮
                              </button>
                              {openMessageMenuId === message.id ? (
                                <span className="message-action-menu">
                                  {message.senderId === me?.id && canEditMessage(message.createdAt) ? (
                                    <button type="button" onClick={() => { startEditing(message.id, message.content); setOpenMessageMenuId(null); }}>Edit</button>
                                  ) : null}
                                  <button type="button" onClick={() => { deleteMessage(message.id, true); setOpenMessageMenuId(null); }}>Delete</button>
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </>
                      )}
                      <span className="message-time">{formatMessageTime(message.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <footer className="chat-footer">
              <form className="message-form" onSubmit={(event) => selectedFriend ? sendMessage(event) : sendGroupMessage(event)}>
                <input
                  className="input"
                  type="text"
                  value={selectedFriend ? draft : groupDraft}
                  onChange={(event) => selectedFriend ? setDraft(event.target.value) : setGroupDraft(event.target.value)}
                  placeholder={!canSendGroupMessage ? "Only admins can send messages" : socketConnected ? `Message ${selectedFriend?.name ?? selectedGroup?.name}...` : "Connecting..."}
                  maxLength={2000}
                  autoComplete="off"
                  disabled={!socketConnected || !canSendGroupMessage}
                />
                <button className="button button-primary" type="submit" disabled={!socketConnected || !canSendGroupMessage || !(selectedFriend ? draft : groupDraft).trim()}>
                  Send
                </button>
              </form>
            </footer>
          </>
        )}
      </section>
      {isGroupProfileOpen && selectedGroup ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setIsGroupProfileOpen(false);
        }}>
          <div className="dialog-card group-profile-card">
            <div className="dialog-header">
              <div>
                <h2 className="dialog-title">Group info</h2>
                <p className="dialog-subtitle">{selectedGroup.members.length} members</p>
              </div>
              <button className="dialog-close" type="button" onClick={() => setIsGroupProfileOpen(false)} aria-label="Close group profile">×</button>
            </div>
            {canManageGroup ? (
              <form className="group-name-form" onSubmit={saveGroupName}>
                <label className="field-label" htmlFor="edit-group-name">Group name</label>
                <div className="inline-form">
                  <input id="edit-group-name" className="input" value={groupNameEdit} onChange={(event) => setGroupNameEdit(event.target.value)} maxLength={100} />
                  <button className="button button-primary button-small" type="submit" disabled={!groupNameEdit.trim() || actionId === `group-settings-${selectedGroup.groupId}`}>Save</button>
                </div>
              </form>
            ) : null}
            {canManageGroup ? (
              <label className="settings-toggle">
                <span>
                  <strong>Only admins can send</strong>
                  <small>Members can read but cannot send messages.</small>
                </span>
                <input
                  type="checkbox"
                  checked={selectedGroup.onlyAdminsCanSend}
                  onChange={(event) => void updateGroup(selectedGroup.groupId, { onlyAdminsCanSend: event.target.checked })}
                />
              </label>
            ) : null}
            <div className="group-member-list">
              {selectedGroup.members.map((member) => {
                const isOwner = member.role === "owner";
                const isSelf = member.id === me?.id;
                return (
                  <div className="group-member-row" key={member.id}>
                    <UserAvatar name={member.name} online={onlineSet.has(member.id)} />
                    <span className="user-info">
                      <span className="user-name">{member.name}{isSelf ? " (You)" : ""}</span>
                      <span className="user-email">{isOwner ? "Owner" : member.role === "admin" ? "Admin" : member.email}</span>
                    </span>
                    {canManageGroup && !isOwner && !isSelf ? (
                      <div className="member-actions">
                        <button
                          className="button button-ghost button-small"
                          type="button"
                          onClick={() => void updateGroupMemberRole(selectedGroup.groupId, member.id, member.role === "admin" ? "member" : "admin")}
                          disabled={actionId === `group-role-${member.id}`}
                        >
                          {member.role === "admin" ? "Remove admin" : "Make admin"}
                        </button>
                        <button
                          className="button button-danger button-small"
                          type="button"
                          onClick={() => void removeGroupMember(selectedGroup.groupId, member.id)}
                          disabled={actionId === `group-remove-${member.id}`}
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {isCreateGroupOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCreateGroup();
        }}>
          <form className="dialog-card" onSubmit={handleCreateGroup}>
            <div className="dialog-header">
              <div>
                <h2 className="dialog-title">Create new group</h2>
                <p className="dialog-subtitle">Choose a name and add friends.</p>
              </div>
              <button className="dialog-close" type="button" onClick={closeCreateGroup} aria-label="Close dialog">×</button>
            </div>
            <label className="field-label" htmlFor="group-name">Group name</label>
            <input
              id="group-name"
              className="input"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="e.g. Weekend plans"
              maxLength={100}
              autoFocus
            />
            <label className="field-label" htmlFor="group-member-search">Add friends</label>
            <input
              id="group-member-search"
              className="input"
              value={memberSearch}
              onChange={(event) => setMemberSearch(event.target.value)}
              placeholder="Search friends by name or email"
            />
            <div className="selected-members">
              {selectedMemberIds.length > 0
                ? `${selectedMemberIds.length} friend${selectedMemberIds.length === 1 ? "" : "s"} selected`
                : "Select at least one friend"}
            </div>
            <div className="member-picker-list">
              {filteredFriends.length === 0 ? (
                <p className="empty-note">No accepted friends found.</p>
              ) : filteredFriends.map((friend) => {
                const isSelected = selectedMemberIds.includes(friend.id);
                return (
                  <button
                    className={`member-picker-row${isSelected ? " is-selected" : ""}`}
                    key={friend.id}
                    type="button"
                    onClick={() => setSelectedMemberIds((current) =>
                      isSelected
                        ? current.filter((id) => id !== friend.id)
                        : [...current, friend.id]
                    )}
                  >
                    <UserAvatar name={friend.name} online={onlineSet.has(friend.id)} />
                    <span className="user-info">
                      <span className="user-name">{friend.name}</span>
                      <span className="user-email">{friend.email}</span>
                    </span>
                    <span className={`member-check${isSelected ? " is-selected" : ""}`} aria-hidden="true">
                      {isSelected ? "✓" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="dialog-actions">
              <button className="button button-ghost" type="button" onClick={closeCreateGroup}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={!groupName.trim() || selectedMemberIds.length === 0 || actionId === "create-group"}>
                {actionId === "create-group" ? "Creating..." : "Create group"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
