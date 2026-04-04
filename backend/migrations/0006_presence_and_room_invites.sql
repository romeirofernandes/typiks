ALTER TABLE users ADD COLUMN last_seen_at integer;

CREATE TABLE room_invites (
  id text PRIMARY KEY NOT NULL,
  room_code text NOT NULL,
  inviter_id text NOT NULL,
  invitee_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at integer NOT NULL,
  responded_at integer
);

CREATE INDEX room_invites_invitee_status_idx ON room_invites (invitee_id, status);
CREATE INDEX room_invites_room_code_idx ON room_invites (room_code);
CREATE INDEX room_invites_inviter_id_idx ON room_invites (inviter_id);
CREATE UNIQUE INDEX room_invites_unique_pending ON room_invites (room_code, inviter_id, invitee_id, status);
