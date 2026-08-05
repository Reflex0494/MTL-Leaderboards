import logging
import threading
import time
from datetime import datetime, timezone

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


def _loop():
    while not _stop_event.is_set():
        fetch_once()
        _stop_event.wait(FETCH_INTERVAL_SECONDS)


def start_background_fetching():
    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    return thread


def get_last_result():
    return dict(_last_result)
