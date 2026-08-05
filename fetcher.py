import logging
import threading
from datetime import datetime, timedelta, timezone

import requests

import db

LEADERBOARD_URL = "https://cdn.mow-the-lawn.com/leaderboard/{season}/top.json"
SEASON = "s3"
FETCH_INTERVAL_SECONDS = 60 * 60  # 1 hour

log = logging.getLogger("fetcher")

_stop_event = threading.Event()
_last_result = {"ok": None, "at": None, "error": None}


def fetch_once():
    fetched_at = datetime.now(timezone.utc).isoformat()
    try:
        resp = requests.get(LEADERBOARD_URL.format(season=SEASON), timeout=15)
        resp.raise_for_status()
        data = resp.json()
        db.insert_snapshot(
            season=data["season"],
            generated_at=data["generatedAt"],
            fetched_at=fetched_at,
            entries=data["entries"],
        )
        _last_result.update(ok=True, at=fetched_at, error=None)
        log.info("Fetched %d entries for season %s", len(data["entries"]), data["season"])
    except Exception as exc:  # noqa: BLE001
        _last_result.update(ok=False, at=fetched_at, error=str(exc))
        log.exception("Fetch failed")


def fetch_live() -> dict:
    """Fetch the leaderboard fresh from the source right now, without
    touching the DB. Used to serve always-current data on page load,
    independent of the hourly-recorded history."""
    fetched_at = datetime.now(timezone.utc).isoformat()
    resp = requests.get(LEADERBOARD_URL.format(season=SEASON), timeout=15)
    resp.raise_for_status()
    data = resp.json()
    return {
        "snapshot": {
            "season": data["season"],
            "generated_at": data["generatedAt"],
            "fetched_at": fetched_at,
            "total_entries": data["totalEntries"],
        },
        "entries": [
            {
                "rank": e["rank"],
                "steam_id": e["steamId"],
                "display_name": e["displayName"],
                "prestige_level": e["prestigeLevel"],
                "achieved_at": e.get("achievedAt"),
                "badge_id": e.get("badgeId"),
            }
            for e in data["entries"]
        ],
    }


def _seconds_until_next_hour() -> float:
    now = datetime.now(timezone.utc)
    next_hour = (now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
    return (next_hour - now).total_seconds()


def _loop():
    fetch_once()
    while not _stop_event.is_set():
        # Recomputed each cycle (rather than a flat 3600s sleep) so the
        # schedule stays pinned to :00 and can't drift over time.
        if _stop_event.wait(_seconds_until_next_hour()):
            break
        fetch_once()


def start_background_fetching():
    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    return thread


def get_last_result():
    return dict(_last_result)
