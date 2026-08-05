# MTL Leaderboards Tracker

Pulls the Season 3 leaderboard from `mow-the-lawn.com` every hour, stores each
snapshot in SQLite, and shows prestige progress over time on a small dashboard.

## Run it

```
py -3 -m pip install -r requirements.txt
py -3 app.py
```

Then open http://127.0.0.1:5151

The app fetches once immediately on startup, then every hour for as long as
it's running. Leave the terminal window open (or run it as a background
task) to keep collecting data — if it's not running, no snapshots are taken.

## How it works

- `fetcher.py` polls `https://cdn.mow-the-lawn.com/leaderboard/s3/top.json`
  (the same JSON API the live site's leaderboard UI uses) once an hour and
  writes a snapshot into `leaderboard.db` (SQLite, created automatically).
- `app.py` / `db.py` serve a small Flask API (`/api/status`, `/api/players`,
  `/api/history`, `/api/latest`) over that data.
- `static/app.js` draws the chart (top-N players or a custom picked list, up
  to 8 lines) and renders the latest top-100 table.

Only the top 100 players per season are tracked (that's what the source API
exposes); a player who falls out of the top 100 will stop appearing in new
snapshots.

## Running it continuously

This is a dev server — fine for personal use on your own machine. To keep it
collecting data in the background you can either leave `py -3 app.py` running
in a terminal, or set it up as a scheduled/startup task in Windows so it
restarts automatically after a reboot.
