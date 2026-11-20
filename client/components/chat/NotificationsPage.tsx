"use client";

import { useChat } from "@/lib/chat-context";

export default function NotificationsPage() {
  const {
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
  } = useChat();
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <section className="section-panel">
      <header className="section-panel-header">
        <div>
          <h1 className="section-panel-title">Notifications</h1>
          <p className="section-panel-subtitle">
            {unreadCount ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 ? (
          <button
            className="button button-ghost button-small"
            type="button"
            onClick={() => void markAllNotificationsRead()}
          >
            Mark all read
          </button>
        ) : null}
      </header>
      <div className="section-panel-scroll">
        <div className="section-content section-content-narrow">
          {notifications.length === 0 ? (
            <div className="empty-panel">
              <span className="empty-panel-icon" aria-hidden="true">🔔</span>
              <h2>No notifications yet</h2>
              <p>Friend request updates and group changes will appear here.</p>
            </div>
          ) : (
            <div className="notification-list">
              {notifications.map((notification) => (
                <article
                  className={`notification-card${notification.readAt ? "" : " is-unread"}`}
                  key={notification.id}
                >
                  <div className="notification-card-content">
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <small>{new Date(notification.createdAt).toLocaleString()}</small>
                  </div>
                  <div className="notification-card-actions">
                    {!notification.readAt ? (
                      <button
                        className="button button-ghost button-small"
                        type="button"
                        onClick={() => void markNotificationRead(notification.id)}
                      >
                        Mark read
                      </button>
                    ) : null}
                    <button
                      className="button button-ghost button-small"
                      type="button"
                      onClick={() => void dismissNotification(notification.id)}
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
