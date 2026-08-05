import logging

from flask import Flask, jsonify, render_template, request

import db
import fetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    last = fetcher.get_last_result()
    snapshot_count = db.query_one("SELECT COUNT(*) AS n FROM snapshots")["n"]
    return jsonify(
        {
            "season": fetcher.SEASON,
            "fetchIntervalSeconds": fetcher.FETCH_INTERVAL_SECONDS,
            "lastFetch": last,
            "snapshotCount": snapshot_count,
        }
    )


@app.route("/api/poll-now", methods=["POST"])
def api_poll_now():
    fetcher.fetch_once()
    last = fetcher.get_last_result()
    return jsonify(last), (200 if last.get("ok") else 502)


@app.route("/api/live")
def api_live():
    try:
        return jsonify(fetcher.fetch_live())
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 502


@app.route("/api/latest")
def api_latest():
    snapshot = db.query_one("SELECT * FROM snapshots ORDER BY id DESC LIMIT 1")
    if not snapshot:
        return jsonify({"snapshot": None, "entries": []})
    entries = db.query(
        "SELECT rank, steam_id, display_name, prestige_level, achieved_at, badge_id "
        "FROM entries WHERE snapshot_id = ? ORDER BY rank ASC",
        (snapshot["id"],),
    )
    return jsonify({"snapshot": snapshot, "entries": entries})


@app.route("/api/players")
def api_players():
    rows = db.query(
        """
        SELECT steam_id, display_name, prestige_level
        FROM entries
        WHERE (steam_id, id) IN (
            SELECT steam_id, MAX(id) FROM entries GROUP BY steam_id
        )
        ORDER BY prestige_level DESC
        """
    )
    return jsonify(rows)


@app.route("/api/history")
def api_history():
    steam_ids = request.args.getlist("steamId")
    top_n = request.args.get("top", type=int)

    if top_n:
        top_rows = db.query(
            """
            SELECT steam_id FROM entries
            WHERE (steam_id, id) IN (SELECT steam_id, MAX(id) FROM entries GROUP BY steam_id)
            ORDER BY prestige_level DESC LIMIT ?
            """,
            (top_n,),
        )
        steam_ids = [r["steam_id"] for r in top_rows]

    if not steam_ids:
        return jsonify({})

    placeholders = ",".join("?" for _ in steam_ids)
    rows = db.query(
        f"""
        SELECT e.steam_id, e.display_name, e.prestige_level, e.rank, s.fetched_at
        FROM entries e JOIN snapshots s ON e.snapshot_id = s.id
        WHERE e.steam_id IN ({placeholders})
        ORDER BY s.fetched_at ASC
        """,
        tuple(steam_ids),
    )

    series: dict[str, dict] = {}
    for row in rows:
        sid = row["steam_id"]
        if sid not in series:
            series[sid] = {"steamId": sid, "displayName": row["display_name"], "points": []}
        series[sid]["displayName"] = row["display_name"]
        series[sid]["points"].append(
            {"t": row["fetched_at"], "prestigeLevel": row["prestige_level"], "rank": row["rank"]}
        )

    return jsonify(series)


if __name__ == "__main__":
    db.init_db()
    fetcher.sync_from_github()
    fetcher.start_background_fetching()
    app.run(host="127.0.0.1", port=5151, debug=False, use_reloader=False)
