# Progress

## Mobile elevation view — approved continuation
- Added dedicated Map/Elevation buttons, shared runner/course selection and a route-based SVG profile. Strava and playback excluded.
- Baseline passed: 114 Python / 19 Node. New display regressions failed with missing setView, then passed after integration.
- Local 390px browser verified all five profiles and authoritative timing-checkpoint indexes; named search without a position produces no invented marker. Pointer clicks preserve selected runner across both views.
- Narrow portrait, landscape and desktop checked; tightened short-landscape heading/graph to fit the full profile. Small 320×568 phone hit-testing confirms both view buttons, Finish watch and search remain reachable; profile scroll remains stable on clock ticks.
- Independent spec review passed. Quality review found an SVG tooltip retaining the old runner name after an anonymity refresh, plus extreme finite elevations producing invalid SVG coordinates. Fixed with identity-aware SVG invalidation and Earth-scale altitude bounds; all four added regressions failed before fix and passed after. Second rereview also required clearing hidden elevation identities on return to Map; fixed and covered by RED-first regression. Final parent tests: 114 Python / 44 Node; final independent rereview APPROVED. Local actual-browser hide/reopen retains selection and clears hidden identity markup.

## Terrain-aware pilot release — 2026-09-11
- Implemented cached elevation-effort profiles and recent observed-interval smoothing with cumulative support, chip-clock checks, optional bulk history, clear pilot/fallback labels, and unchanged hold/GPS/ranking safeguards.
- Verified source units and split contracts; did not auto-apply prior-year segment calibration across moved checkpoints. Real aggregate withheld-checkpoint results are in docs/qa; overall errors improved but some legs worsened.
- Independent reviews identified optional-history latency poisoning core freshness, including cross-event waiting. Added failing regressions, then introduced two-phase optional/core fetch scheduling without widening TTLs. Final backend review approved.
- Added neutral pre-start DNS display wording without changing raw status. Corrected fixture clock field and boolean predicate during tests; final narrow frontend review approved.
- Parent final tests: 114 Python and 19 Node pass. Local phone-size map, all five Leaflet course layers, search, isolated synthetic pilot/arrival/held states verified. No actual iPhone/Safari success claimed.
- API 1.3.0 deployed and publicly read back at https://rut-live-api.vercel.app (deployment dpl_5dLcPJjWp6HN2xXpt2ukKpjFvi2Z). Source/config paths remain 404. Initial custom privacy probes incorrectly banned public course.splits and allowed accuracy_m; schema-aware minimization checks are used instead.
- Published runtime commit ae0390883d02db0179c3482ec82a2ed9ae47eb9d; Pages workflow 34672037825 succeeded. Public frontend 1.3.0 phone-size/desktop map, all five course layers, explicit snapshot fallback and live recovery verified. No morning monitor scheduled and no paid changes.
- Made the concurrent freshness regression use its explicit fixed clock so tests remain independent of the real calendar; 114 Python tests still pass.

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
- Created public repository `https://github.com/benjibrucker/rut-live-map` on branch `main`; GitHub readback confirmed the remote tree contains no generated runner-location JSON.
- Enabled HTTPS-enforced GitHub Pages with workflow deployment and completed run `34651853682` successfully.
- Verified `https://benjibrucker.github.io/rut-live-map/` and its deployed snapshot over HTTPS: HTTP 200, 5 events, 4,299 runners, 75 current positions, zero feed errors, and zero forbidden personal/device fields.
- Public-browser QA loaded all five routes and painted map tiles, displayed snapshot age, and found/selected Jake Brucker (bib 3787).

## Finish-watch refactor and managed API
- Implemented selected-race remaining-distance finish watch, conservative GPS route matching, explicit held/stale estimates, anonymity union, source-error preservation, and pagination integrity.
- Added real read-only HTTP adapter and local/public asset allowlists.
- Final independent review APPROVED after verifying fallback → recovery cycles; parent reran 57 Python and 10 JavaScript tests successfully.
- Hosted production alias https://rut-live-api.vercel.app verified: health/bootstrap/live HTTP 200 with correct Pages CORS; source/config/credential/unknown paths HTTP 404. Hardened deployment ID: dpl_7JmpU1gDKJDJEjciwE7RBKwZEaiA.
- Public API endpoint configured in config.js; latest static build returned five events, 4,238 runner records, 30 positions, zero errors at 2026-09-11T23:04:10.789315Z. These are time-specific observations, not fixed counts.
- Generated runner snapshots, .env.local, and .vercel/project.json verified ignored.
- User approved publication after permission timeout; no paid upgrade or account-setting mutation is part of publication.

## Public finish-watch release verification
- Pushed commit 2c80414 to origin/main; the public Pages app loads config.js pointing to the verified managed endpoint.
- Public browser: five events/courses, 4,238 searchable runners, live_api delivery, zero upstream errors. Actual feed timestamp advanced automatically between checks.
- Desktop 1280×720 and mobile 390×844 verified; no horizontal overflow; mobile list hides zoom controls and tapping a finish row locks/follows the runner and returns to the map. All five race selectors retain course-specific sorted lists capped at ten.
- Name search selected Jake Brucker; his position correctly displayed EST. HELD rather than pretending it was live GPS.
- Public API-blocked test loaded a dated snapshot with SNAPSHOT ORDER · NOT LIVE. Removing the browser-local network block recovered automatically to live_api with cleared errors and live labels.
- Verification artifacts: browser workspace rut-release-race-checks.json and rut-release-recovery-check.json.
- A separate GitHub workflow-status readback command hit a permission timeout and was not retried or bypassed; no CI-status claim is made. Production publication is independently verified in the public browser. No further remote writes followed that timeout.
- These final verification notes are local documentation; deployed runtime source is commit 2c80414.
