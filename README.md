# MTL Leaderboards Tracker

Pulls the Season 3 leaderboard from `mow-the-lawn.com` every hour and shows
prestige progress over time on a small dashboard. Ships two ways to run it:

- **Local Flask app** (`app.py`) — SQLite-backed, self-scheduling while running.
- **Static site + GitHub Actions** (`docs/`) — runs 24/7 on GitHub for free,
  no server to keep alive. This is what's deployed to GitHub Pages.

Only the top 100 players per season are tracked (that's what the source API
exposes); a player who falls out of the top 100 stops appearing in new
snapshots.

## Option A: local Flask app

```
py -3 -m pip install -r requirements.txt
py -3 app.py
```

Then open http://127.0.0.1:5151

Fetches once immediately on startup, then hourly for as long as it's running.
Leave the terminal open (or run it as a background/startup task) — if it's
not running, no snapshots are taken. Data lives in `leaderboard.db` (SQLite,
created automatically, gitignored).

- `fetcher.py` polls the leaderboard hourly and writes snapshots to SQLite
  (this is what feeds the "prestige over time" chart's history).
- `app.py` / `db.py` serve a small Flask API (`/api/status`, `/api/players`,
  `/api/history`, `/api/latest`) over that stored history, plus `/api/live`,
  which fetches straight from the source on every call — no caching, no DB.
- `static/app.js` uses `/api/live` for the "latest leaderboard" table (so it's
  always current on page load/refresh, falling back to `/api/latest` if the
  source is briefly unreachable) and `/api/history` for the chart.

## Option B: static site on GitHub Pages (24/7, no server needed)

`docs/` is a static version of the same dashboard, fed by JSON files under
`docs/data/`. A GitHub Actions workflow (`.github/workflows/update-data.yml`)
runs `scripts/fetch_and_update.py` on an hourly cron schedule, which fetches
the leaderboard and commits the updated JSON straight into the repo — GitHub
Pages then serves the refreshed dashboard automatically. Nothing needs to run
on your own machine.

**GitHub Pages on the free plan only serves public repos.** To use it, this
repo needs to be public (see repo Settings → General → Danger Zone → Change
visibility). The data involved is just the public leaderboard from
mow-the-lawn.com, so there's nothing sensitive in it — but it's your call.

Setup, once the repo is public:
1. Settings → Pages → Source → **Deploy from a branch** → branch `main`,
   folder `/docs` → Save.
2. Settings → Actions → General → Workflow permissions → **Read and write
   permissions** (needed so the scheduled workflow can commit data back).
3. The workflow runs hourly automatically; trigger it manually anytime from
   the Actions tab (`Update leaderboard data` → Run workflow) to seed data
   immediately instead of waiting an hour.

Scheduled workflows pause automatically if a repo goes 60 days with no
commits — hourly data commits keep it active indefinitely once it's running.

**Note on freshness:** the static Pages site can't fetch live data on every
page load the way the local Flask app does — the source API's CORS policy
only allows requests from `mow-the-lawn.com` itself, so a browser on
`github.io` is blocked from calling it directly. Pages data is therefore only
as fresh as the last Actions run (currently hourly). If you want truly
live, up-to-the-second data, run the local Flask app instead.
