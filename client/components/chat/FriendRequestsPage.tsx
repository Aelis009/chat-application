"use client";

import { useChat } from "@/lib/chat-context";
import UserAvatar from "@/components/chat/UserAvatar";

export default function FriendRequestsPage() {
  const {
    requests,
    onlineUserIds,
    actionId,
    refreshing,
    error,
    refresh,
    acceptRequest,
    declineRequest,
    cancelRequest,
  } = useChat();
  const onlineSet = new Set(onlineUserIds);

  return (
    <section className="section-panel">
      <header className="section-panel-header">
        <div>
          <h1 className="section-panel-title">Friend Requests</h1>
          <p className="section-panel-subtitle">
            Accept new friends or review requests you have sent.
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
          <div className="error-banner" role="alert">{error}</div>
        ) : null}
        <div className="section-content">
          <section className="panel-block">
            <div className="section-heading">
              <h2 className="section-title">Incoming</h2>
              <span className="count-badge">{requests.incoming.length}</span>
            </div>
            {requests.incoming.length === 0 ? (
              <p className="empty-note">No incoming friend requests.</p>
            ) : (
              <div className="request-list">
                {requests.incoming.map((request) => (
                  <div key={request.id} className="request-card">
                    <div className="request-user">
                      <UserAvatar
                        name={request.sender.name}
                        online={onlineSet.has(request.sender.id)}
                      />
                      <div className="user-info">
                        <div className="user-name">{request.sender.name}</div>
                        <div className="user-email">{request.sender.email}</div>
                      </div>
                    </div>
                    <div className="request-actions">
                      <button
                        className="button button-primary button-small"
                        type="button"
                        onClick={() => acceptRequest(request.id)}
                        disabled={actionId === request.id}
                      >
                        {actionId === request.id ? "Accepting..." : "Accept"}
                      </button>
                      <button
                        className="button button-danger button-small"
                        type="button"
                        onClick={() => declineRequest(request.id)}
                        disabled={actionId === request.id}
                      >
                        {actionId === request.id ? "Working..." : "Decline"}
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
              <span className="count-badge">{requests.outgoing.length}</span>
            </div>
            {requests.outgoing.length === 0 ? (
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
                        online={onlineSet.has(request.receiver.id)}
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
                    <span className="relationship-badge">Pending</span>
                    <button
                      className="button button-danger button-small"
                      type="button"
                      onClick={() => cancelRequest(request.id)}
                      disabled={actionId === request.id}
                    >
                      {actionId === request.id ? "Cancelling..." : "Cancel"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
