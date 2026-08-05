import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).parent / "leaderboard.db"

_lock = threading.Lock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row


def init_db():
    with _lock:
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                season TEXT NOT NULL,
                generated_at TEXT NOT NULL,
                fetched_at TEXT NOT NULL,
                total_entries INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
                rank INTEGER NOT NULL,
                steam_id TEXT NOT NULL,
                display_name TEXT NOT NULL,
                prestige_level INTEGER NOT NULL,
                achieved_at TEXT,
                badge_id TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_entries_snapshot ON entries(snapshot_id);
            CREATE INDEX IF NOT EXISTS idx_entries_steam_id ON entries(steam_id);
            """
        )
        _conn.commit()


def insert_snapshot(season: str, generated_at: str, fetched_at: str, entries: list[dict]) -> int:
    with _lock:
        cur = _conn.execute(
            "INSERT INTO snapshots (season, generated_at, fetched_at, total_entries) VALUES (?, ?, ?, ?)",
            (season, generated_at, fetched_at, len(entries)),
        )
        snapshot_id = cur.lastrowid
        _conn.executemany(
            """
            INSERT INTO entries (snapshot_id, rank, steam_id, display_name, prestige_level, achieved_at, badge_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    snapshot_id,
                    e["rank"],
                    e["steamId"],
                    e["displayName"],
                    e["prestigeLevel"],
                    e.get("achievedAt"),
                    e.get("badgeId"),
                )
                for e in entries
            ],
        )
        _conn.commit()
        return snapshot_id


def query(sql: str, params: tuple = ()):
    with _lock:
        cur = _conn.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def query_one(sql: str, params: tuple = ()):
    rows = query(sql, params)
    return rows[0] if rows else None
