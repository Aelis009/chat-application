# Chat Features and Event Flow

This document describes how groups, message editing/deletion, mobile and
desktop actions, and notifications work in the application.

## 1. Group data model

Groups use three database tables:

- `groups`: group name, owner, creation time, and the admin-only sending flag.
- `group_members`: one row per user in a group, including the role.
- `group_messages`: messages sent inside a group.

Group roles are:

| Role | Permissions |
| --- | --- |
| `owner` | Full group administration. The owner cannot be removed or demoted. |
| `admin` | Rename the group, change admin-only sending, promote/demote members, remove members, and delete group messages. |
| `member` | Read and send messages unless the group is admin-only. |

The server always checks the role. Hiding a button in the client is not used
as an authorization mechanism.

## 2. Creating a group

### Client function

`createGroup(name, memberIds)` is exposed by
[`ChatProvider`](../client/lib/chat-context.tsx).

Parameters:

| Parameter | Type | Rules |
| --- | --- | --- |
| `name` | `string` | Trimmed; 2–100 characters. |
| `memberIds` | `string[]` | UUIDs; at least 1 and at most 50 members. |

The client sends:

```http
POST /v1/groups
Content-Type: application/json
```

```json
{
  "name": "Project Team",
  "memberIds": [
    "friend-user-uuid-1",
    "friend-user-uuid-2"
  ]
}
```

The server implementation is in
[`server/http/app.ts`](../server/http/app.ts).

The authenticated user is automatically added as the `owner`. The selected
users must already be accepted friends. Duplicate IDs are removed, and the
current user is removed from the submitted list because they are added as the
owner automatically.

### Group creation flow

1. The user opens **New group**.
2. The client lists accepted friends.
3. The user searches and selects one or more friends.
4. The client calls `createGroup(name, memberIds)`.
5. The server validates the name, UUIDs, friendship status, and membership
   count.
6. The server inserts the group and its `group_members` rows.
7. The client reloads its group list.

## 3. Group administration functions

### Updating group settings

Client function:

```ts
updateGroup(
  groupId: string,
  updates: {
    name?: string;
    onlyAdminsCanSend?: boolean;
  }
)
```

Endpoint:

```http
PATCH /v1/groups/:groupId
```

The `updates` object must contain at least one property:

- `name`: trimmed string, 2–100 characters.
- `onlyAdminsCanSend`: boolean toggle.

Only owners and admins can call this endpoint. Setting
`onlyAdminsCanSend` to `true` prevents regular members from sending messages.

### Changing a member role

Client function:

```ts
updateGroupMemberRole(
  groupId: string,
  memberId: string,
  role: "admin" | "member"
)
```

Endpoint:

```http
PATCH /v1/groups/:groupId/members/:memberId
```

```json
{
  "role": "admin"
}
```

The owner cannot be demoted. The target must already be a group member.

### Removing a member

Client function:

```ts
removeGroupMember(groupId: string, memberId: string)
```

Endpoint:

```http
DELETE /v1/groups/:groupId/members/:memberId
```

Only owners and admins can remove members. The owner cannot be removed.

## 4. Group messaging

The client sends group messages through Socket.IO:

```ts
socket.emit("send_group_message", {
  groupId: string,
  content: string
});
```

Validation:

- `groupId` must be a UUID.
- `content` is trimmed and must contain 1–2,000 characters.
- The sender must be a current group member.
- A regular member is rejected when `onlyAdminsCanSend` is enabled.

The server broadcasts successful messages to:

```text
group:<groupId>
```

Clients receive them through:

```ts
socket.on("receive_group_message", message => {
  // Add the message to the group message list.
});
```

## 5. Message history and scrolling

Private and group history use the same cursor-based pagination.

### Initial request

Only the newest 50 messages are returned:

```http
GET /v1/messages/:friendId
GET /v1/groups/:groupId/messages
```

The client opens directly at the newest message instead of rendering a large
conversation and visibly scrolling from the top.

### Older messages

When the user reaches the top, the client sends the oldest loaded message
timestamp as the cursor:

```http
GET /v1/messages/:friendId?before=<ISO-timestamp>
GET /v1/groups/:groupId/messages?before=<ISO-timestamp>
```

The response shape is:

```json
{
  "messages": [],
  "nextCursor": "2026-11-18T05:43:00.000Z",
  "hasMore": true
}
```

Older messages are inserted before the existing list. The client adjusts
`scrollTop` by the added height, so the message currently being read stays in
the same visual position.

If a new message arrives while the user is near the bottom, the chat follows
the new message. If the user is reading older messages, the chat does not
force them to the bottom; it shows a **New messages** button instead.

The client implementation is in
[`client/lib/chat-context.tsx`](../client/lib/chat-context.tsx) and
[`client/components/chat/ChatPage.tsx`](../client/components/chat/ChatPage.tsx).

## 6. Editing messages

### Rules

- Only the original sender can edit a private message.
- Only the original sender can edit a group message.
- Editing is allowed for 15 minutes after message creation.
- The server enforces the time limit; client-side hiding is only a UI
  convenience.
- Edited messages retain their original `createdAt` value and receive an
  `editedAt` timestamp.

### Desktop behavior

1. Hover over the user's own message.
2. The vertical `⋮` button appears at the fixed top-right of the bubble.
3. Click `⋮`.
4. Select **Edit**.
5. Save the updated text.

### Mobile behavior

1. Press and hold the user's own message for approximately 500ms.
2. The same action menu opens.
3. Select **Edit**.
4. Save the updated text.

The implementation uses pointer events, so the server does not need to know
whether the request came from a phone, tablet, or desktop.

### Socket.IO events

Private messages:

```ts
socket.emit("edit_message", {
  messageId: string,
  content: string
});

socket.on("message_updated", message => {
  // Replace the matching message in the private conversation.
});
```

Group messages:

```ts
socket.emit("edit_group_message", {
  messageId: string,
  content: string
});

socket.on("group_message_updated", message => {
  // Replace the matching group message.
});
```

## 7. Deleting messages

### Rules

- A user can delete their own private message.
- A user can delete their own group message.
- A group owner or admin can delete any group message.
- Deleted messages keep their position and display `Message deleted`.
- The server checks ownership or admin membership.

### Desktop and mobile

Both platforms use the same menu:

- Desktop: hover, then click `⋮`.
- Mobile: press and hold.
- Select **Delete**.

Socket.IO events:

```ts
socket.emit("delete_message", {
  messageId: string
});

socket.emit("delete_group_message", {
  messageId: string
});
```

The server broadcasts the updated message to the relevant user or group room.

## 8. Notifications

Notifications are stored in the `notifications` table with:

| Field | Meaning |
| --- | --- |
| `id` | Notification UUID. |
| `userId` | User who should receive it. |
| `type` | Machine-readable notification type. |
| `title` | Short heading shown in the UI. |
| `body` | Notification text. |
| `data` | Optional JSON metadata such as `groupId` or `requestId`. |
| `readAt` | Null until the notification is marked read. |
| `createdAt` | Creation timestamp. |

### Notification types currently created

- `friend_request`
- `friend_request_accepted`
- `group_settings_changed`
- `group_role_changed`
- `group_removed`

### Creation flow

1. A protected API action succeeds.
2. The server calls `createNotification(input)`.
3. The notification is inserted into PostgreSQL.
4. The server publishes a realtime notification event.
5. The recipient's user Socket.IO room receives it.
6. The client adds it to the notification state and shows a temporary notice.

The shared helper is in
[`server/modules/notifications/service.ts`](../server/modules/notifications/service.ts).

### Notification endpoints

```http
GET    /v1/notifications
POST   /v1/notifications/:id/read
POST   /v1/notifications/read-all
DELETE /v1/notifications/:id
```

All notification endpoints require authentication and only operate on the
authenticated user's own notifications.

### Realtime delivery

Each authenticated socket joins:

```text
user:<userId>
```

The server sends a notification only to the intended user's room. This works
when the same account is open in multiple tabs or devices because all of the
account's sockets join the same room.

The client listens for:

```ts
socket.on("notification_created", notification => {
  // Add the notification and update the unread badge.
});
```

## 9. Device and security model

The server does not trust the device type or the visibility of client buttons.
Every protected operation is checked using the authenticated user ID:

- Authentication comes from the HttpOnly JWT cookie.
- Message ownership is checked on the server.
- Edit expiration is checked on the server.
- Group membership and role are checked on the server.
- Notifications are filtered by authenticated `userId`.

Therefore, desktop and mobile clients use the same API and Socket.IO events,
while only the interaction layer changes between hover and long press.
