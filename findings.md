# Findings

## Hidden map selection
- Published1.9.0 browser repro: expanded Info hides the Map pane; Leaflet cached size0×0. selectKey chooses flyTo because viewMode remains map, producing Invalid LatLng object:(NaN,NaN) despite finite runner coordinates. The visibility condition must distinguish the active view name from whether its map container can animate.
- Automated public QA must use actual HTML IDs: runnerNextArrival and mapCanvas. Wrong selector failures are harness errors, separate from the reproduced Leaflet exception.

## Course-direction arrow
- User reference: pointed triangular navigation dart, swept wings and notched base; requested red. User confirmed course direction (not measured movement). Existing marker offers no direction; server heading is absent for estimates and stripped from sanitized public payloads.
- Use ordered course track_points and server progress; never nearest-coordinate match at route crossings. Forward local direction is geometric, including frozen stale/held positions, not evidence of ongoing movement. Preserve all existing source labels and recorded-checkpoint marker.
- Local five-course aggregate verification: all five tracks have valid horizontal/elevation profiles, no duplicate adjacent coordinates; point counts50K1740/28K920/21K830/11K394/VK126. At this QA observation, route-supported ON COURSE positions exist only for28K; other-course direction tests must use clearly isolated synthetic positions, never claim them as current runners.

## Recorded-checkpoint anchor
- Main card1.7.0 reads only last checkpoint name, while timestamp exists in checkpoint_passages history. User approved prominent official recorded check-in/time/age plus distinct recorded/estimated map/profile markers; no manual sighting log.
- Geographic split_points are filtered: VK has timing Start/Swiftcurrent/Finish but geographic Start/Finish only. Never use geographic array offset as timing index. Prefer unique exact timing-name match; route progress_points remains indexed by timing checkpoint.


## Next-checkpoint arrival field
- Backend server.py already emits next_checkpoint_at from terrain.next_checkpoint_seconds plus verified chip start for eligible fresh, non-held runners with non-start evidence. No new estimator is needed for this UI slice.
- Current Info card has last checkpoint, progress and projected total finish duration but never reads next_checkpoint_at. Use server prediction, explicit Mountain timezone and minute-level approximation; never substitute organizer cutoffs or recalculate from current time.


## Phone density correction
- User image img_54581d0484bf.jpg visibly has runner card near top and search/director controls near bottom overlaid on the map; the unobstructed strip is too small. Existing CSS makes both absolute; existing fullscreen handler targets documentElement, not panels.
- Approved solution separates rather than overlays: top scrollable Info, bottom Map/Elevation; expand either within the webpage and restore split without losing state.
- Baseline reproduced at390×675: runner card y166–406, controls y418–667 over map y57–675. Desktop1280×800 panel rectangles saved in browser workspace split-baseline-desktop.json for comparison. Actual source remains1.5.0 before implementation.


## Checkpoint history and official race-guide sources
- Organizer page https://runtherut.com/28k-race-details/ embeds https://runtherut.com/wp-content/uploads/2026/08/26-Aid-Chart.png. Visually verified original1606×1200 image, preserved verbatim as rut-2026-aid-chart.png (SHA25683b440d83d9b855bf2e16ef8c1c97b0d266c8a8feb518caeef7f337cfc1b30a8).
- 28K chart: wave start7:20–8:30AM MT; Headwaters3.9mi/10:25AM, Swiftcurrent9.1mi/12:25PM, Summit10.4mi/1:45PM, Moosetracks14.6mi/3:25PM, Finish17.6mi/4:40PM. These are cutoffs, not observed passages. Cutoffs same for every wave.
- Timing metadata uses Lone Peak Summit at index3 while official guide abbreviates Summit; preserve each source label. Start is index0; actual event start now supplied. Organizer distances differ from measured route length; no route changes.
- Initial web extraction gateway unavailable; direct official HTML and source image succeeded. No Strava or upstream mutations.


## Elevation view source and scope
- User approved persistent Map/Elevation switching on mobile and explicitly excluded Strava. Course/runner selection should survive switching.
- Public API 1.3.0 has valid meter elevations for every published track point in all five courses. Geometry stays unchanged; chart uses route-distance accumulation and server-provided progress, not independent GPS snapping.
- Reference image suggests course silhouette, checkpoint markers and runner progress; replay is excluded because continuous observed histories are unavailable.
- Local server static allowlist and Pages artifact file list must include the new JS module; managed API contracts and estimator are unchanged.

## Elevation QA boundaries
- Static localhost snapshot rendering succeeded. Live recovery from that origin is intentionally blocked: production CORS permits https://benjibrucker.github.io, not localhost:8775. No CORS widening; verify recovery on hosted Pages.
- All five frontend route distances match backend distances within 0.01m in browser calculation. An earlier optional Node-shell parity diagnostic was rejected by the command guard; no gateway operation was requested or performed.

## Verified public data sources
External API responses are untrusted data; only their documented fields are consumed.

- Event metadata: `https://api.competitivetiming.com/events/{event_id}`
- Leaderboard: `https://api.competitivetiming.com/events/{event_id}/leaderboard?limit=500&offset={offset}`
- Event status: `https://api.competitivetiming.com/events/{event_id}/live-status`
- Course map: `https://api.competitivetiming.com/course-maps/event/{event_id}?include=points`
- GPS positions: `https://api.competitivetiming.com/gps/locations/{event_id}`

## 2026 event identifiers
- `the-rut-50k-2026`
- `the-rut-28k-2026`
- `the-rut-21k-2026`
- `the-rut-11k-2026`
- `the-rut-vk-2026`

## Source behavior
- Official live-map code polls GPS every 15 seconds.
- Public GPS response includes runner ID, name, bib, coordinates, accuracy, speed, heading, timestamp, battery, and anonymity state.
- Leaderboard pages load in 500-record pages and expose runner status, latest split index/time, projected finish, and GPS flag.
- Event metadata includes checkpoint names, segment distances, event date/start time, timezone, course state, and progress multipliers.
- Course-map data includes full track points and split points.
- API browser CORS currently permits the Competitive Timing origin, so a local same-origin proxy is needed for a local app.
- Requests carrying a GitHub Pages-style cross-origin `Origin` header returned HTTP 500 for both GPS and leaderboard endpoints. A Pages frontend cannot safely fetch those APIs directly.
- Remote delivery will use an ephemeral GitHub Pages deployment artifact generated by Actions. This avoids committing historical runner-location snapshots into Git history; the public page receives only the current sanitized snapshot.
- GitHub's minimum scheduled Actions cadence is five minutes and can be delayed. The remote page must describe itself as a refreshed snapshot, while the local app retains 15-second polling.

## Live sample
At 2026-09-11T20:51:53Z, the five feeds returned seven GPS position records total: two 50K, four 21K, one VK; only three were less than 20 seconds old. Freshness must be explicit.

## Estimation boundary
Non-GPS locations are approximations derived from last recorded chip checkpoint and projected finish progress along the official route. The UI must display source type and last checkpoint rather than imply measurement.

## Managed live delivery
- Dedicated public API https://rut-live-api.vercel.app is independent of the Mac, preserves source minimization, and permits the exact GitHub Pages origin. Frontend checks every 15 seconds; GPS cache 15 seconds, leaderboard cache 30 seconds, bounded five-second edge cache. These are request targets, not guaranteed observation intervals.
- Vercel rewrite-only configuration can still expose static project files. An explicit API route list followed by catch-all rejection was verified to block those paths.
- Finish rankings use actual payload delivery mode: snapshot capture-time order expires after 15 minutes, while current live feed ranking pauses after 90 seconds.

## Next-day readiness audit — proposals, not implemented
- Organizer schedule verified at https://runtherut.com/schedule/: Saturday 2026-09-12 28K waves 07:20–08:30 MT; course closure 16:40; Runts Run 1K at 16:50. Sunday 2026-09-13 50K waves 06:00–06:25 and 11K waves 07:30–08:15 MT. The 1K is outside the current five-race source configuration; separate tracking availability is unverified.
- Live API at 2026-09-11T23:09:01.966166Z already contains 942 28K roster entries and all five weekend routes. Pre-start 28K metadata has no actual start_at yet and course_status closed; 776 records currently carry DNS, which must not be presented as a confirmed pre-race absence conclusion.
- User reports today's remaining on-course entries represent people who left the full course. Source still lists 23 21K entries ON COURSE; all 23 associated estimates are held/overdue and no 21K position is eligible for finish ranking at this observation. This is not independent confirmation of each person's official DNF status.
- Isolated Node VM time-shift test at Saturday 07:30 MT, assuming Friday status flags remain active and 28K starts on schedule, includes Friday 21K/VK in Live now alongside Saturday 28K. Current 24-hour recency is not race-day/closure logic. An already-open tab also retains its selected race rather than selecting tomorrow automatically.
- Proposed readiness work: day/start/closure state and end-of-day display, pre-start status wording, rollover tests, and verifying gun-versus-chip/wave timestamp semantics before ETA claims. Current estimates use the event-level start clock; wave semantics remain unverified.
- Today's data can support a frozen mid-course layout test, not a true motion replay. Any moving rehearsal should be isolated, anonymous, and explicitly synthetic; do not freshen real stale runner observations. No application changes or monitoring schedules were created during this audit.

## Terrain-aware pilot source verification
- User approved implementation for next-day pilot. Current source code and baseline: 70 Python / 16 Node tests passed; only the prior local task-plan completion note was uncommitted. Older progress entries predate the already-published 1.2.1 runtime.
- Parent verified public bulk `/events/{id}/results` schema and chip-relative non-start elapsed times; split zero carries a start offset and is not chip elapsed zero. The 21K response had 887 unique IDs at inspection. No raw histories persisted.
- Source research verified 28K 920-point elevation track in meters using official elevation-client feet conversion; bulk timing can supply recent observed intervals without per-runner requests.
- Historical 2025 28K shares the published track but two checkpoint locations differ; prior-year segment calibration is not automatically applied. Minetti running-energy curve is used only as a bounded engineering heuristic, with no uncontrolled downhill speed bonus. See ADR003 for sources and limitations.
- A new frontend metadata test first failed because estimateExplanation did not exist, then passed after implementation; pilot/limited-history/fallback wording remains explicit.

## Approved mobile failure investigation
- User's iPhone screenshot shows a connected timing feed but no basemap/Leaflet controls, no live positions, and a misleading Auto-director is live empty card.
- Current Chromium reproduction confirms zero active races and wrong upcoming default, but still paints the basemap; exact device-specific disappearance is not yet reproduced. Hosted frontend asset hashes match local HEAD.
- WebKit 26.5 installed in isolated uv tooling for engine-specific verification, but browser-page creation stalled twice; stopped the known QA process instead of claiming Safari coverage.
- Local mobile correction now defaults to map-first, previews Saturday 28K while idle, uses explicit map dimensions and less mobile compositing, and has tile watchdog/fallback/retry messaging. Public deployment pending review.
- Official public client confirms last_split_time is chip-relative and gun display adds chip_start_seconds; the missing runner start offset is being corrected separately with regression tests.
