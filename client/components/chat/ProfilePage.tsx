"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@/lib/chat-context";
import UserAvatar from "@/components/chat/UserAvatar";

export default function ProfilePage() {
  const { me, socketConnected, actionId, error, saveProfile, logout } =
    useChat();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me?.name ?? "");

  if (!me) return null;
  const currentUser = me;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 2) return;
    await saveProfile(trimmedName);
    setEditing(false);
  }

  function cancelEdit() {
    setName(currentUser.name);
    setEditing(false);
  }

  return (
    <section className="section-panel">
      <header className="section-panel-header">
        <div>
          <h1 className="section-panel-title">Profile Settings</h1>
          <p className="section-panel-subtitle">
            Your account details and session controls.
          </p>
        </div>
      </header>
      <div className="section-panel-scroll">
        {error ? (
          <div className="error-banner" role="alert">{error}</div>
        ) : null}
        <div className="section-content section-content-narrow">
          <div className="profile-card">
            <div className="profile-card-head">
              <div className="profile-avatar">
                <UserAvatar name={currentUser.name} online={socketConnected} />
              </div>
              <div className="profile-card-identity">
                <h2 className="profile-name">{currentUser.name}</h2>
                <p className="profile-email">{currentUser.email}</p>
              </div>
            </div>
            <div className="profile-details">
              <div className="profile-detail">
                <span className="profile-detail-label">Name</span>
                {editing ? (
                  <form className="profile-edit-form" onSubmit={handleSubmit}>
                    <label className="sr-only" htmlFor="profile-name">
                      Display name
                    </label>
                    <input
                      id="profile-name"
                      className="input"
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      minLength={2}
                      maxLength={100}
                      disabled={actionId === "profile"}
                    />
                    <div className="profile-edit-actions">
                      <button
                        className="button button-primary button-small"
                        type="submit"
                        disabled={
                          actionId === "profile" || name.trim().length < 2
                        }
                      >
                        {actionId === "profile" ? "Saving..." : "Save"}
                      </button>
                      <button
                        className="button button-ghost button-small"
                        type="button"
                        onClick={cancelEdit}
                        disabled={actionId === "profile"}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <span className="profile-detail-value">{currentUser.name}</span>
                )}
              </div>
              <div className="profile-detail">
                <span className="profile-detail-label">Email</span>
                <span className="profile-detail-value">{currentUser.email}</span>
              </div>
            </div>
            <div className="profile-card-footer">
              {!editing ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => {
                    setName(currentUser.name);
                    setEditing(true);
                  }}
                >
                  Edit name
                </button>
              ) : null}
              <button
                className="button button-ghost"
                type="button"
                onClick={logout}
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
