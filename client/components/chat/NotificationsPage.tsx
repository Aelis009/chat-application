"use client";

export default function NotificationsPage() {
  return (
    <section className="section-panel">
      <header className="section-panel-header">
        <div>
          <h1 className="section-panel-title">Notifications</h1>
          <p className="section-panel-subtitle">
            Updates about friend requests and messages.
          </p>
        </div>
      </header>
      <div className="section-panel-scroll">
        <div className="section-content section-content-narrow">
          <div className="empty-panel">
            <span className="empty-panel-icon" aria-hidden="true">🔔</span>
            <h2>No notifications yet</h2>
            <p>
              Friend request updates and new message alerts will appear here.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
