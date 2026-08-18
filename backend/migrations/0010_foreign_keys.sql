PRAGMA foreign_keys = OFF;

CREATE TABLE match_participants_new (
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
    PRIMARY KEY (match_id, user_id),
    FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (opponent_id) REFERENCES users (id) ON DELETE SET NULL
);

INSERT INTO match_participants_new (
    match_id, user_id, opponent_id, placement, result, score, opponent_score,
    progress, correct_chars, wpm, accuracy, disconnected, rating_before, rating_after, created_at
)
SELECT match_id, user_id, opponent_id, placement, result, score, opponent_score,
    progress, correct_chars, wpm, accuracy, disconnected, rating_before, rating_after, created_at
FROM match_participants;

DROP TABLE match_participants;
ALTER TABLE match_participants_new RENAME TO match_participants;

CREATE INDEX match_participants_match_id_idx ON match_participants (match_id);
CREATE INDEX match_participants_user_id_idx ON match_participants (user_id);
CREATE INDEX match_participants_user_date_idx ON match_participants (user_id, created_at);

CREATE TABLE user_settings_new (
    user_id text PRIMARY KEY,
    region_analytics_consent integer NOT NULL DEFAULT 0,
    created_at integer NOT NULL,
    updated_at integer NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

INSERT INTO user_settings_new (user_id, region_analytics_consent, created_at, updated_at)
SELECT user_id, region_analytics_consent, created_at, updated_at FROM user_settings;

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;

CREATE TABLE rooms_new (
    room_code text PRIMARY KEY,
    owner_id text NOT NULL,
    name text NOT NULL DEFAULT '',
    visibility text NOT NULL DEFAULT 'private',
    status text NOT NULL DEFAULT 'open',
    max_players integer NOT NULL DEFAULT 6,
    mode_seconds integer,
    word_count integer,
    created_at integer NOT NULL,
    closed_at integer,
    FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

INSERT INTO rooms_new (room_code, owner_id, name, visibility, status, max_players, mode_seconds, word_count, created_at, closed_at)
SELECT room_code, owner_id, name, visibility, status, max_players, mode_seconds, word_count, created_at, closed_at FROM rooms;

DROP TABLE rooms;
ALTER TABLE rooms_new RENAME TO rooms;

CREATE INDEX rooms_owner_id_idx ON rooms (owner_id);

CREATE TABLE room_members_new (
    room_code text NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'member',
    joined_at integer NOT NULL,
    left_at integer,
    PRIMARY KEY (room_code, user_id),
    FOREIGN KEY (room_code) REFERENCES rooms (room_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

INSERT INTO room_members_new (room_code, user_id, role, joined_at, left_at)
SELECT room_code, user_id, role, joined_at, left_at FROM room_members;

DROP TABLE room_members;
ALTER TABLE room_members_new RENAME TO room_members;

CREATE INDEX room_members_user_id_idx ON room_members (user_id);

PRAGMA foreign_keys = ON;