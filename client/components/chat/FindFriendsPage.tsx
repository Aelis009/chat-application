"use client";

import { useState } from "react";
import { useChat } from "@/lib/chat-context";
import UserAvatar from "@/components/chat/UserAvatar";

export default function FindFriendsPage() {
  const {
    users,
    requests,
    onlineUserIds,
    actionId,
    refreshing,
    error,
    refresh,
    sendFriendRequest,
    acceptRequest,
    cancelRequest,
  } = useChat();
  const [searchQuery, setSearchQuery] = useState("");
  const onlineSet = new Set(onlineUserIds);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const otherUsers = users.filter((user) => user.relationship !== "friends");
  const filteredUsers = normalizedSearch
    ? otherUsers.filter((user) =>
        `${user.name} ${user.email}`.toLowerCase().includes(normalizedSearch)
      )
    : otherUsers;

  return (
    <section className="section-panel">
      <header className="section-panel-header">
        <div>
          <h1 className="section-panel-title">Find Friends</h1>
          <p className="section-panel-subtitle">
            Search for people and send a friend request.
          </p>
        </div>
        <button
          className="button button-ghost button-small"
          type="button"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </header>
      <div className="section-panel-scroll">
        {error ? (
          <div className="error-banner" role="alert">
            {error}
          </div>
        ) : null}
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
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name or email..."
              autoComplete="off"
            />
          </div>

          {otherUsers.length === 0 ? (
            <div className="empty-panel">
              <span className="empty-panel-icon" aria-hidden="true">🔎</span>
              <h2>No other users right now</h2>
              <p>New people will appear here when they join.</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="empty-panel">
              <span className="empty-panel-icon" aria-hidden="true">🔎</span>
              <h2>No matches found</h2>
              <p>Try a different name or email, or clear your search.</p>
            </div>
          ) : (
            <div className="user-list people-list">
              {filteredUsers.map((user) => {
                const incoming = requests.incoming.find(
                  (request) => request.sender.id === user.id
                );
                const outgoing = requests.outgoing.find(
                  (request) => request.receiver.id === user.id
                );

                return (
                  <div key={user.id} className="user-row user-row-static">
                    <UserAvatar
                      name={user.name}
                      online={onlineSet.has(user.id)}
                    />
                    <div className="user-info">
                      <div className="user-name">{user.name}</div>
                      <div className="user-email">{user.email}</div>
                    </div>
                    <div className="user-actions">
                      {user.relationship === "request_sent" &&
                        (outgoing ? (
                          <button
                            className="button button-danger button-small"
                            type="button"
                            onClick={() => cancelRequest(outgoing.id)}
                            disabled={actionId === outgoing.id}
                          >
                            {actionId === outgoing.id
                              ? "Cancelling..."
                              : "Cancel request"}
                          </button>
                        ) : (
                          <span className="relationship-badge">
                            Request sent
                          </span>
                        ))}
                      {user.relationship === "request_received" &&
                        (incoming ? (
                          <button
                            className="button button-primary button-small"
                            type="button"
                            onClick={() => acceptRequest(incoming.id)}
                            disabled={actionId === incoming.id}
                          >
                            {actionId === incoming.id
                              ? "Accepting..."
                              : "Accept"}
                          </button>
                        ) : (
                          <span className="relationship-badge">
                            Request received
                          </span>
                        ))}
                      {(user.relationship === "none" ||
                        !user.relationship) && (
                        <button
                          className="button button-secondary button-small"
                          type="button"
                          onClick={() => sendFriendRequest(user.id)}
                          disabled={actionId === user.id}
                        >
                          {actionId === user.id ? "Sending..." : "Add friend"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
