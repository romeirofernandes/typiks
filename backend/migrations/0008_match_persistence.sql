CREATE TABLE matches (
    id text PRIMARY KEY,
    room_code text,
    mode text NOT NULL,
    mode_seconds integer NOT NULL,
    difficulty text NOT NULL,
    seed integer NOT NULL,
    status text NOT NULL,
    started_at integer,
    ended_at integer,
    created_at integer NOT NULL
);

CREATE INDEX matches_room_code_idx ON matches (room_code);
CREATE INDEX matches_created_at_idx ON matches (created_at);
CREATE INDEX matches_status_idx ON matches (status);

CREATE TABLE match_participants (
    match_id text NOT NULL,
    user_id text NOT NULL,
    opponent_id text,
    placement integer NOT NULL DEFAULT 0,
    result text,
    score integer NOT NULL DEFAULT 0,
    opponent_score integer NOT NULL DEFAULT 0,
    progress integer NOT NULL DEFAULT 0,
    correct_chars integer NOT NULL DEFAULT 0,
    wpm real,
    accuracy real,
    disconnected integer NOT NULL DEFAULT 0,
    rating_before integer,
    rating_after integer,
    created_at integer NOT NULL,
    PRIMARY KEY (match_id, user_id)
);

CREATE INDEX match_participants_match_id_idx ON match_participants (match_id);
CREATE INDEX match_participants_user_id_idx ON match_participants (user_id);
CREATE INDEX match_participants_user_date_idx ON match_participants (user_id, created_at);

CREATE TABLE user_settings (
    user_id text PRIMARY KEY,
    region_analytics_consent integer NOT NULL DEFAULT 0,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
);

CREATE TABLE rooms (
    room_code text PRIMARY KEY,
    owner_id text NOT NULL,
    name text NOT NULL DEFAULT '',
    visibility text NOT NULL DEFAULT 'private',
    status text NOT NULL DEFAULT 'open',
    max_players integer NOT NULL DEFAULT 6,
    mode_seconds integer,
    word_count integer,
    created_at integer NOT NULL,
    closed_at integer
);

CREATE INDEX rooms_owner_id_idx ON rooms (owner_id);

CREATE TABLE room_members (
    room_code text NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    joined_at integer NOT NULL,
    left_at integer,
    PRIMARY KEY (room_code, user_id)
);

CREATE INDEX room_members_user_id_idx ON room_members (user_id);