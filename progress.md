# Progress

## 2026-09-11
- Inspected the public event page, official live map, live network requests, course-map payloads, GPS payloads, event metadata, and leaderboard payloads.
- Confirmed scope with Benji: full-screen local browser map, both GPS and estimated positions, auto-director rotation.
- Created the approved project at `/Users/benjibook/Documents/Rut Live Map`.
- Locked the upstream contracts and implementation boundary; data-contract/scaffold phase is complete.
- Implemented the localhost-only Python proxy, TTL/stale cache, private-field filtering, course geometry helpers, exact GPS merge, and split-based position estimator.
- Backend live check returned all five events with 4,299 runner records, five course paths, 171 current position records, and zero upstream errors.
- Nine focused backend tests passed.

## Verification Log
- `python3 -m unittest -v test_server.py`: 9 passed.
- Live bootstrap at 2026-09-11T21:24:51Z: 5 events, 171 positions, 0 errors.
- Final live check: 5 events, 4,299 searchable runners, 142 defensible positions (1 live GPS, 5 stale GPS, 136 estimated), 0 errors, no stale upstream cache.
- Desktop browser QA at 1280×633 verified all five routes, painted OpenStreetMap tiles, exact/estimated/stale marker distinctions, active-event filtering, Jake Brucker name search, manual lock, Random, Front, Field, Resume Auto, and a real 15-second refresh.
- Mobile browser QA at 390×844 verified no document overflow, reachable course/search/director controls, upward-opening search results, and readable selected-runner details.
- One-click launcher was executed on an isolated test port; `/api/health` returned HTTP 200 and app version 1.0.0.
- Vendored Leaflet files and license are present; all handoff files are non-empty and the launcher is executable.
- Headless Chromium reports fullscreen support but denies the permission grant; the page itself fills the viewport, and the user-gesture fullscreen control plus denial fallback are implemented. Fullscreen activation remains a normal-browser click.

## Remote deployment
- Confirmed GitHub CLI authentication for `benjibrucker` with repository and workflow scopes.
- Confirmed no existing `rut-live-map` repository among the account's current repositories; a dedicated Pages repository avoids changing the unrelated `wannahump-run` site.
- Confirmed Competitive Timing API calls fail with a GitHub Pages-style cross-origin request, so direct browser-side API fetching is not viable.
- Selected a privacy-conscious Pages artifact workflow: build and deploy only the current sanitized snapshot, without committing location data snapshots into Git history.
- Added static snapshot mode, a sanitized artifact builder, a five-minute Pages workflow, a public-data minimization test, and remote-specific feed-age labeling.
- Static artifact verification passed: 10 tests, 5 events, 4,299 searchable runners, 122 positions, zero upstream errors, 10 required files, and zero forbidden personal/device fields.
- Browser QA of the static artifact loaded five routes and painted map tiles, reported the snapshot age, and found/selected Jake Brucker (bib 3787).
- Source scan found no credential/token patterns.
