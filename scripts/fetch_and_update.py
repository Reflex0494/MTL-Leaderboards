"""Fetch the current leaderboard snapshot and fold it into the static JSON
data files served by GitHub Pages (docs/data/*.json). Run hourly by the
'update-data' GitHub Actions workflow; safe to run manually too.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import requests

SEASON = "s3"
LEADERBOARD_URL = f"https://cdn.mow-the-lawn.com/leaderboard/{SEASON}/top.json"
FETCH_INTERVAL_SECONDS = 15 * 60

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "docs" / "data"
HISTORY_PATH = DATA_DIR / "history.json"
LATEST_PATH = DATA_DIR / "latest.json"
STATUS_PATH = DATA_DIR / "status.json"


def load_json(path: Path, default):
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data, indent=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent, separators=None if indent else (",", ":"))


def main():
    fetched_at = datetime.now(timezone.utc).isoformat()
    status = load_json(STATUS_PATH, {"season": SEASON, "snapshotCount": 0, "lastFetch": {}})
    # Always resync to the current constant — a persisted status.json from an
    # older run would otherwise carry a stale interval forward indefinitely.
    status["fetchIntervalSeconds"] = FETCH_INTERVAL_SECONDS

    try:
        resp = requests.get(LEADERBOARD_URL, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        entries = data["entries"]

        history = load_json(HISTORY_PATH, {"players": {}})
        for e in entries:
            sid = e["steamId"]
            player = history["players"].setdefault(sid, {"displayName": e["displayName"], "points": []})
            player["displayName"] = e["displayName"]
            player["points"].append({"t": fetched_at, "prestigeLevel": e["prestigeLevel"], "rank": e["rank"]})
        save_json(HISTORY_PATH, history)

        save_json(LATEST_PATH, {
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
                for e in entries
            ],
        }, indent=2)

        status["snapshotCount"] += 1
        status["lastFetch"] = {"ok": True, "at": fetched_at, "error": None}
        print(f"Fetched {len(entries)} entries for season {data['season']}")
    except Exception as exc:  # noqa: BLE001
        status["lastFetch"] = {"ok": False, "at": fetched_at, "error": str(exc)}
        print(f"Fetch failed: {exc}")
        raise
    finally:
        save_json(STATUS_PATH, status, indent=2)


if __name__ == "__main__":
    main()
