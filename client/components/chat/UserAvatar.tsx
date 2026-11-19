"use client";

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export default function UserAvatar({
  name,
  online,
}: {
  name: string;
  online: boolean;
}) {
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
