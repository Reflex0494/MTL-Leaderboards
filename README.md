# MTL Leaderboards Tracker

Pulls the Season 4 leaderboard from `mow-the-lawn.com` every 15 minutes and
shows prestige progress over time on a small dashboard. Ships two ways to
run it:

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

Fetches once immediately on startup, then every 15 minutes (aligned to
:00/:15/:30/:45) for as long as it's running. Leave the terminal open (or
run it as a background/startup task) — if it's not running, no snapshots
are taken. Data lives in `leaderboard.db` (SQLite, created automatically,
gitignored).

- `fetcher.py` polls the leaderboard every 15 minutes and writes snapshots
  to SQLite (this is what feeds the "prestige over time" chart's history,
  and the avg-time-to-prestige column).
- `app.py` / `db.py` serve a small Flask API (`/api/status`, `/api/players`,
  `/api/history`, `/api/latest`) over that stored history, plus `/api/live`,
  which fetches straight from the source on every call — no caching, no DB.
- `static/app.js` uses `/api/live` for the "latest leaderboard" table (so it's
  always current on page load/refresh, falling back to `/api/latest` if the
  source is briefly unreachable) and `/api/history` for the chart.

### Auto-start at logon

A shortcut in the Windows Startup folder (`shell:startup`) launches the
server hidden on login — see `start_server.ps1`. Output goes to
`server.log` (gitignored) since there's no visible console window. To
remove it, delete `MTL Leaderboards Tracker.lnk` from
`shell:startup`, or open that folder from Run (`Win+R`).

Since this machine won't always be on, `fetcher.sync_from_github()` runs
once at every startup before the regular fetch loop: it pulls the
published `docs/data/history.json` from GitHub (kept current by the
Actions workflow regardless of whether this app is running) and backfills
any snapshot timestamps newer than the most recent one already in
`leaderboard.db` — so the local chart doesn't have a gap for however long
the PC was off. It's a no-op if there's nothing new to catch up on.

## Option B: static site on GitHub Pages (24/7, no server needed)

`docs/` is a static version of the same dashboard, fed by JSON files under
`docs/data/`. A GitHub Actions workflow (`.github/workflows/update-data.yml`)
runs `scripts/fetch_and_update.py`, which fetches the leaderboard and
commits the updated JSON straight into the repo — GitHub Pages then serves
the refreshed dashboard automatically. Nothing needs to run on your own
machine.

**Triggered externally, not by GitHub's own schedule.** The workflow only
listens for `workflow_dispatch`; a free [cron-job.org](https://cron-job.org)
job calls the GitHub API every 15 minutes to fire it (POSTs to
`.../actions/workflows/update-data.yml/dispatches` with a fine-grained PAT
scoped to Actions:write on this repo). GitHub's own `schedule:` trigger was
tried first and turned out unreliable for this repo — it sat dormant for
90+ minutes after being added, then fired inconsistently, and later (once
cron-job.org was also running) occasionally landed a few minutes apart from
the external trigger, which the concurrency group below would resolve by
cancelling whichever run arrived first — showing up as spurious "run
failed"/"run cancelled" emails. Removing the native schedule and keeping
only the external trigger eliminated that.

There's a `concurrency: group: update-data` block so two runs (however
triggered) can never execute in parallel and race to `git push` — a
second run just queues behind the first instead.

Note: at 15-minute cadence `docs/data/history.json` grows roughly 4x faster
than an hourly schedule would (still just plain JSON — this only matters if
the repo runs for a very long time). If it ever gets unwieldy, the fix is
widening the cron-job.org interval.

**GitHub Pages on the free plan only serves public repos.** To use it, this
repo needs to be public (see repo Settings → General → Danger Zone → Change
visibility). The data involved is just the public leaderboard from
mow-the-lawn.com, so there's nothing sensitive in it — but it's your call.

Setup, once the repo is public:
1. Settings → Pages → Source → **Deploy from a branch** → branch `main`,
   folder `/docs` → Save.
2. Settings → Actions → General → Workflow permissions → **Read and write
   permissions** (needed so the workflow can commit data back).
3. Set up the cron-job.org trigger described above so the workflow
   actually fires every 15 minutes — it does nothing on its own since it
   has no `schedule:` trigger. You can also fire it manually anytime from
   the Actions tab (`Update leaderboard data` → Run workflow) to seed data
   immediately.

**Note on freshness:** the static Pages site can't fetch live data on every
page load the way the local Flask app does — the source API's CORS policy
only allows requests from `mow-the-lawn.com` itself, so a browser on
`github.io` is blocked from calling it directly. Pages data is therefore only
as fresh as the last Actions run (currently every 15 minutes). If you want
truly live, up-to-the-second data, run the local Flask app instead.
