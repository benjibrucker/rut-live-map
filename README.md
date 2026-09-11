# Rut Live Map

A read-only spectator map for The Rut Mountain Runs 2026, available as both a local live display and a remotely viewable GitHub Pages snapshot.

## Remote site

<https://benjibrucker.github.io/rut-live-map/>

The remote page is rebuilt from the public Competitive Timing feed about every five minutes by GitHub Actions. GitHub can delay scheduled jobs, so the page reports the snapshot age and does not claim the local app's 15-second cadence. Current location data is deployed as an ephemeral Pages artifact rather than committed into Git history.

## Start it

1. Double-click **`Start Rut Live Map.command`**.
2. Leave the Terminal window open while using the map.
3. Click the square **fullscreen** button in the upper-right of the map.
4. Press **Control-C** in the Terminal window when finished.

The launcher opens:

`http://127.0.0.1:8765/`

It binds to this Mac only; it is not exposed to the local network or internet.

## Controls

- **Find a runner:** search any 2026 participant by name or bib.
- **Front:** hold on the furthest on-course runner in the current course view.
- **Random:** choose and hold a random on-course runner.
- **Field:** release the selected runner and fit all visible courses.
- **Resume Auto:** rotate every 18 seconds among front-of-field, fresh GPS, and random on-course runners.
- **Live now / course buttons:** filter the route and participant markers.

## What the markers mean

- **LIVE GPS:** a runner’s opted-in phone GPS, refreshed from the event feed every 15 seconds.
- **STALE GPS:** the last measured phone location, but no recent update has arrived.
- **ESTIMATED:** not GPS. Interpolated from the last chip checkpoint toward the next checkpoint using the projected finish.
- **EST. HELD:** the predicted next-checkpoint arrival has passed without another chip read. The dot is held just before that checkpoint instead of being allowed to drift farther without evidence.

Only runners with a defensible location appear as dots. Registered runners remain searchable even when no position can be inferred.

## Data and safety boundary

The app reads the same public Competitive Timing data used by its spectator pages:

- event metadata and status
- course tracks and checkpoints
- public leaderboards and split state
- opted-in GPS locations

The data pipeline removes unused private-shaped upstream fields such as email, phone, date of birth, age, gender, hometown, battery, speed, and heading before the public Pages artifact is created. It does not sign in, post, follow participants, or modify the event system.

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
python3 -m unittest -v test_server.py
node --check app.js
```

Health check:

`http://127.0.0.1:8765/api/health`

## Project files

- `server.py` — localhost server, upstream cache/proxy, data minimization, and estimator
- `index.html` — app structure
- `styles.css` — responsive full-screen presentation
- `app.js` — map, search, filters, markers, and director controls
- `test_server.py` — geometry, estimator, GPS-priority, and privacy tests
- `build_static.py` — generates the sanitized GitHub Pages artifact
- `.github/workflows/deploy-pages.yml` — refreshes and deploys the remote snapshot
- `vendor/leaflet/` — vendored Leaflet 1.9.4 and its license
