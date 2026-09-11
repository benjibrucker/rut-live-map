# Rut Live Map — refactor audit

## Status
Read-only code/public-site audit completed before scope confirmation. No application code, deployment, or upstream race data changed. Requested follow-up: near-real-time display of the ten runners closest to their finish.

## Verified baseline
- Local branch main matches origin/main at 7206573; working tree was clean at audit start.
- Ten existing Python tests and `node --check app.js` passed.
- Public site loaded five routes and 4,299 searchable runners.
- Pages workflow uses `*/5 * * * *`, while the static browser polls snapshots once per minute. This cannot deliver 15-second upstream freshness.
- At the first audit read (2026-09-11 around 22:03 UTC), public snapshot generated at 21:59:41Z was 220 seconds old. Counts describe that snapshot, not current race positions.
- Repository has no formal ADR directory or files; existing architecture constraints are in task_plan.md and findings.md. Those accept periodic static snapshots for delivery, not near-real-time ranking.

## Reproduced defects
1. `app.js` finite helper accepts null and empty string as numeric zero. Running the actual chooseLeader function on synthetic records selected a halfway estimate ahead of a GPS runner with a later checkpoint, because GPS progress null was treated as zero.
2. GPS age is refreshed only for the selected runner. The public browser retained two nonselected LIVE badges when their timestamps were 233 and 243 seconds old, beyond the 90-second freshness threshold. Header GPS counts remain derived from the older snapshot too.
3. `build_event_view` merges leaderboard identity into GPS positions without honoring an anonymity flag set only on the matching GPS row. Synthetic test with `is_anonymous: true` returned the named leaderboard identity. No claim that an actual participant was exposed; this is a reproducible merge-path defect.
4. Current Front sorts route progress percentage across visible events, not route meters remaining or defensible arrival order. It cannot serve as the requested ten-nearest-finish algorithm. Held estimates can remain candidates despite missing newer checkpoint evidence.

## Additional code-review gaps
- Refresh recreates every marker; selected runner location updates do not continuously pan the camera.
- Initial bootstrap failure does not fully recover through the later live-only refresh (courses/loading state are not rebuilt).
- Static build does not fail closed on incomplete feeds; a fresh degraded/empty artifact can replace a useful one.
- Existing tests do not cover frontend ranking, stale-clock transitions, interrupted feeds, or camera following.
- Phone emulation initially raised an Object-reference-chain error because a JS expression returned the Leaflet map object. Retry returns a boolean instead; no application defect inferred from that harness error.

## Proposed scope, not yet approved
- Preserve the public GitHub URL and controls.
- Add a separately hosted, read-only cached API; target GPS fetches about every 15 seconds and checkpoint/leaderboard fetches about every 30 seconds, subject to source limits.
- Extract ranking and freshness into testable pure functions; distinguish unavailable/null values from zero.
- Rank up to ten eligible, unfinished runners by remaining distance along the correct course, never straight-line proximity. Separate low-confidence/held/stale candidates rather than manufacture precision or pad ten entries.
- Display bib, name, race, distance remaining, defensible ETA where available, source confidence, and observation age. Clicking a row follows its marker.
- Preserve source privacy preferences across all merged views.

## User decisions
- Approved top ten for the selected race, not combined across courses.
- Approved an independent managed live backend while keeping the GitHub page URL.
- Any paid plan or cost must be confirmed before provisioning. No paid plan approved.

## Hosting investigation
- No project hosting config, Vercel CLI authentication file, or relevant exported provider credential found. Cloudflare's local Wrangler directory contained logs but no default auth config.
- Vercel documentation supports hosting Python; Hobby is free and restricted to personal noncommercial use. Reuse of the current Python data service is the least disruptive candidate for this spectator map; account and plan must be verified before deployment.
- Launched Vercel CLI device-login flow. Deployment is gated on user authorization, not on possession of GitHub publishing credentials.
- Nous web tools were unavailable; Vercel's official `.md` documentation fetched successfully over direct HTTPS. Cloudflare docs returned HTTP 403; no claims made from those failed fetches.
