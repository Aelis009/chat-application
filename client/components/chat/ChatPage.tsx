"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@/lib/chat-context";
import type { Conversation, Message } from "@/lib/api";
import UserAvatar from "@/components/chat/UserAvatar";

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

function sortConversations(conversations: Conversation[]) {
  return [...conversations].sort((a, b) => {
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return bTime - aTime || a.friend.name.localeCompare(b.friend.name);
  });
}

export default function ChatPage() {
  const {
    me, conversations, onlineUserIds, socketConnected, selectedFriend,
    messagesByFriend, draft, loadingHistory, chatError, refreshing, actionId,
    error, mobileChatOpen, setMobileChatOpen, refresh, openConversation,
    setDraft, sendMessage, removeFriend,
  } = useChat();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const onlineSet = new Set(onlineUserIds);
  const sortedConversations = sortConversations(conversations);
  const selectedMessages = selectedFriend
    ? messagesByFriend[selectedFriend.id] ?? []
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [selectedFriend, selectedMessages.length, mobileChatOpen]);

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
            <button className="button button-ghost button-small" type="button" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
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
        </div>
      </aside>

      <section className="chat-main">
        {chatError ? <div className="error-banner chat-error-banner" role="alert">{chatError}</div> : null}
        {!selectedFriend ? (
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
                <UserAvatar name={selectedFriend.name} online={onlineSet.has(selectedFriend.id)} />
                <div className="chat-person-info">
                  <h2 className="chat-title">{selectedFriend.name}</h2>
                  <div className="chat-presence">
                    <span className={`presence-dot${onlineSet.has(selectedFriend.id) ? " is-online" : ""}`} />
                    {onlineSet.has(selectedFriend.id) ? "Online" : "Offline"}
                  </div>
                </div>
              </div>
              <div className="chat-header-actions">
                <span className={`live-pill${socketConnected ? " is-connected" : " is-disconnected"}`}>
                  {socketConnected ? "Live" : "Connecting..."}
                </span>
                <button
                  className="button button-danger button-small"
                  type="button"
                  onClick={() => removeFriend(selectedFriend.id)}
                  disabled={actionId === selectedFriend.id}
                >
                  {actionId === selectedFriend.id ? "Removing..." : "Remove"}
                </button>
              </div>
            </header>

            <div className="chat-body">
              <div className="messages">
                {loadingHistory && selectedMessages.length === 0 ? <p className="empty-note chat-loading-note">Loading messages...</p> : null}
                {!loadingHistory && selectedMessages.length === 0 ? <p className="empty-note chat-loading-note">Say hello to {selectedFriend.name}.</p> : null}
                {selectedMessages.map((message: Message) => (
                  <div key={message.id} className={`message-row${message.senderId === me?.id ? " is-mine" : ""}`}>
                    <div className="message-bubble">
                      {message.content}
                      <span className="message-time">{formatMessageTime(message.createdAt)}</span>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <footer className="chat-footer">
              <form className="message-form" onSubmit={(event) => sendMessage(event)}>
                <input
                  className="input"
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={socketConnected ? `Message ${selectedFriend.name}...` : "Connecting..."}
                  maxLength={2000}
                  autoComplete="off"
                  disabled={!socketConnected}
                />
                <button className="button button-primary" type="submit" disabled={!socketConnected || !draft.trim()}>
                  Send
                </button>
              </form>
            </footer>
          </>
        )}
      </section>
    </>
  );
}
