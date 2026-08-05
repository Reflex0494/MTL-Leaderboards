import logging
import threading
from datetime import datetime, timezone

import requests

import db

LEADERBOARD_URL = "https://cdn.mow-the-lawn.com/leaderboard/{season}/top.json"
SEASON = "s3"
FETCH_INTERVAL_SECONDS = 15 * 60  # 15 minutes

# Published by the GitHub Actions workflow every 15 minutes regardless of
# whether this local app is running — used to backfill snapshots recorded
# while this machine was off/asleep.
GITHUB_HISTORY_URL = "https://raw.githubusercontent.com/Reflex0494/MTL-Leaderboards/main/docs/data/history.json"

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


def sync_from_github() -> int:
    """Backfill snapshots recorded by the GitHub Actions workflow while this
    app wasn't running, using the published history.json. Only fills the gap
    after the most recent locally-recorded snapshot — never touches anything
    already covered locally, and does nothing on a fresh/empty DB (nothing to
    have a "gap" relative to yet)."""
    last_row = db.query_one("SELECT MAX(fetched_at) AS t FROM snapshots")
    last_fetched_at = last_row["t"] if last_row else None
    if not last_fetched_at:
        log.info("No local snapshots yet — skipping GitHub catch-up sync.")
        return 0

    try:
        resp = requests.get(GITHUB_HISTORY_URL, timeout=15)
        resp.raise_for_status()
        remote = resp.json()
    except Exception as exc:  # noqa: BLE001
        log.warning("GitHub catch-up sync failed (will retry on next fetch): %s", exc)
        return 0

    by_t: dict[str, list[dict]] = {}
    for steam_id, player in remote.get("players", {}).items():
        display_name = player.get("displayName", "")
        for point in player.get("points", []):
            t = point["t"]
            if t <= last_fetched_at:
                continue
            by_t.setdefault(t, []).append({
                "rank": point["rank"],
                "steamId": steam_id,
                "displayName": display_name,
                "prestigeLevel": point["prestigeLevel"],
            })

    inserted = 0
    for t in sorted(by_t):
        entries = sorted(by_t[t], key=lambda e: e["rank"])
        db.insert_snapshot(season=SEASON, generated_at=t, fetched_at=t, entries=entries)
        inserted += 1

    if inserted:
        log.info("Caught up on %d snapshot(s) from GitHub recorded while offline.", inserted)
    else:
        log.info("No gap to catch up on — local data is already current.")
    return inserted


def _seconds_until_next_boundary() -> float:
    # Epoch-aligned, so FETCH_INTERVAL_SECONDS=900 lands on :00/:15/:30/:45
    # and 3600 lands on :00 — works for any interval that divides evenly
    # into an hour or day, recomputed each cycle so it can't drift.
    now_ts = datetime.now(timezone.utc).timestamp()
    next_ts = (now_ts // FETCH_INTERVAL_SECONDS + 1) * FETCH_INTERVAL_SECONDS
    return next_ts - now_ts


def _loop():
    fetch_once()
    while not _stop_event.is_set():
        if _stop_event.wait(_seconds_until_next_boundary()):
            break
        fetch_once()


def start_background_fetching():
    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    return thread


def get_last_result():
    return dict(_last_result)
