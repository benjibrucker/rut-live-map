# Rut Live Map

A read-only spectator map for The Rut Mountain Runs 2026, with a selected-race finish watch, a managed live API, and a dated GitHub Pages snapshot fallback.

## Remote site

<https://benjibrucker.github.io/rut-live-map/>

The GitHub Pages frontend checks its managed Vercel API every 15 seconds. GPS is cached for 15 seconds; timing/leaderboard data for 30 seconds. These are fetch cadences, not guarantees that every runner transmits GPS or crosses a timing mat that often. The page reports actual observation and feed age.

If the live API cannot load initially, the app can display a clearly labeled dated snapshot while retrying. GitHub Actions refreshes that fallback about every five minutes, with possible scheduling delays. Snapshot finish order describes capture time, never current live order; it expires after 15 minutes. Current location snapshots are deployment artifacts, not Git history.

Managed API: <https://rut-live-api.vercel.app/api/health>. The remote map does not depend on this Mac being awake. Backend changes require a separate Vercel deployment; GitHub pushes deploy the frontend and snapshot only.

## Start locally

1. Double-click **`Start Rut Live Map.command`**.
2. Leave the Terminal window open while using the map.
3. Click the square **fullscreen** button in the upper-right of the map.
4. Press **Control-C** in the Terminal window when finished.

The launcher opens:

`http://127.0.0.1:8765/`

It binds to this Mac only; it is not exposed to the local network or internet.

## Controls

- **Find a runner:** search any 2026 participant by name or bib.
- **Finish watch:** up to ten eligible, unfinished runners from the selected race, ordered by remaining distance along the route—not straight-line proximity or official placing. See estimated arrival when supported, evidence type, and observation age. Tap a row to follow it. On phones, switch between the list and map.
- **Front:** hold on the closest eligible runner to the selected race’s finish. Different race finishes are never combined.
- **Random:** choose and hold a random on-course runner.
- **Field:** release the selected runner and fit all visible courses.
- **Resume Auto:** rotate every 18 seconds among front-of-field, fresh GPS, and random on-course runners.
- **Race day / course buttons:** automatically show the current race or preview the next scheduled course. Manual course selections stay selected. Past-day status flags do not make yesterday’s race live again.
- **↻ Retry map:** the circular-arrow button beside fullscreen reloads the background map. If both tile sources fail, the course remains visible with an explicit retry notice. Phones open on the map, not an empty finish list.

## What the markers mean

- **LIVE GPS:** a runner’s opted-in phone GPS, refreshed from the event feed every 15 seconds.
- **STALE GPS:** a GPS fix older than 90 seconds, invalid-dated, or sourced from degraded upstream data. It is not eligible for current finish ranking.
- **ESTIMATED:** not GPS. Advances from the last chip checkpoint toward the next using observed checkpoint pace. The runner’s chip-start offset is included; missing or invalid real offsets do not default to the first wave. Ambiguous upstream projected-finish clocks are not used for wall-clock arrival predictions.
- **EST. HELD:** the predicted next-checkpoint arrival has passed without another chip read. The dot is held just before that checkpoint instead of being allowed to drift farther without evidence.

Measured GPS dots remain visible even when off-route or ambiguous, but they are not assigned a confident remaining distance. GPS matching uses the runner’s last checkpoint interval to avoid confusing loops, crossings, or start/finish overlap. Held/stale estimates and finished/DNS/DNF/DQ runners are excluded from current finish order. Fewer than ten usable records means fewer than ten rows—never padded data.

Registered runners remain searchable even when no position can be inferred. Names and identifying bibs are suppressed whenever either timing or GPS data requests anonymity.

## Data and safety boundary

The app reads the same public Competitive Timing data used by its spectator pages:

- event metadata and status
- course tracks and checkpoints
- public leaderboards and split state
- opted-in GPS locations

The data pipeline removes unused private-shaped upstream fields such as email, phone, date of birth, age, gender, hometown, battery, speed, and heading before either the public API response or Pages artifact is created. It does not sign in, post, follow participants, or modify the event system.

This is a spectator visualization—not an emergency, medical, or course-safety system. Estimated dots are approximate and can be held at a checkpoint when timing evidence is late.

Official event page: <https://competitivetiming.com/events/the-rut/2026>

## Manual start and verification

```bash
cd "/Users/benjibook/Documents/Rut Live Map"
python3 server.py --open
```

Run the automated checks:

```bash
cd "/Users/benjibook/Documents/Rut Live Map"
python3 -m unittest discover -v
node --test test_app.cjs test_race_logic.cjs
node --check app.js
```

Health check:

`http://127.0.0.1:8765/api/health`

## Project files

- `server.py` — localhost server, upstream cache/proxy, data minimization, and estimator
- `index.html` — app structure
- `styles.css` — responsive full-screen presentation
- `app.js` — map, search, filters, markers, and director controls
- `finish_metrics.py` — conservative route matching and distance primitives
- `race-logic.js` — shared, tested frontend freshness and ranking rules
- `api/index.py` / `vercel.json` — managed read-only API adapter and deployment configuration
- `config.js` — public API URL only; never credentials
- `test_*.py` / `test_*.cjs` — geometry, privacy, source integrity, API, freshness, ranking, and fallback integration regressions
- `build_static.py` — generates the sanitized GitHub Pages artifact
- `.github/workflows/deploy-pages.yml` — refreshes and deploys the remote snapshot
- `vendor/leaflet/` — vendored Leaflet 1.9.4 and its license
