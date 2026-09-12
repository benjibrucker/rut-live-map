# Rut Live Map — Task Plan

## Goal
Build and verify a local full-screen browser map for The Rut 2026 that combines exact GPS positions with clearly labeled split-based estimates and supports search, selection, random/leader controls, and automatic director rotation.

## Definition of Done
- One-click macOS launcher starts the local server and opens the app.
- Five official course routes load.
- GPS and leaderboard data refresh without browser CORS failures.
- Search by runner name or bib works across all 2026 distances.
- Manual selection locks focus; Resume Auto restarts rotation.
- Auto-director rotates among leader, fresh GPS, and random on-course modes.
- GPS, stale GPS, and estimated positions are visually and textually distinct.
- Desktop and mobile layouts are browser-checked.
- Automated tests cover API normalization and position-estimation behavior.
- A dedicated public GitHub Pages URL works from outside the local network.
- The remote site deploys current sanitized data without committing location snapshots to Git history.
- The remote UI checks the managed live API every 15 seconds, labels observation age honestly, and explicitly distinguishes dated snapshot fallback from live delivery.

## Phases
1. **Data contract and scaffold** — complete
2. **Local proxy and estimator** — complete
3. **Interactive map UI and director modes** — complete
4. **Automated and browser verification** — complete
5. **Handoff documentation** — complete
6. **GitHub Pages static-data adaptation** — complete
7. **Public repository and Pages deployment** — complete
8. **Remote browser verification** — complete
9. **Refactor audit and scope** — complete; selected-race top ten and independent managed backend approved
10. **Managed hosting authentication and no-paid-plan check** — complete; Vercel account verified, dedicated project on active Hobby plan
11. **Ranking, freshness, privacy and recovery refactor** — complete locally; 57 Python + 10 JavaScript tests pass
12. **Selected-race top-ten UI and live API integration** — complete; commit 2c80414 pushed and the public Pages app consumes the managed live API
13. **Regression tests and deployed desktop/mobile verification** — complete; public desktop/mobile, all five selectors, search/follow, automatic refresh, snapshot fallback and live recovery verified

## Phone failure and next-day readiness — approved continuation
14. **Investigate phone blank map** — complete within available browsers; screenshot inspected, Chromium loads, WebKit runner blocked/hung. Hardened map sizing/compositing plus explicit retry; physical iPhone confirmation remains open.
15. **Repair map resilience and day switching** — complete; explicit map size/retry, animation-independent startup, next-course preview, prior-day exclusion and preserved manual course/runner views. Actual iPhone confirmation remains user-side.
16. **Verify wave timing and guard estimates** — complete; verified chip-relative checkpoint times and chip offsets. Real projections use observed checkpoint pace; missing or invalid offsets fail closed rather than defaulting to the first wave.
17. **Regression, review and public verification** — complete; independent reviews approved, 70 Python + 16 Node tests pass. API 1.2.0 read back publicly. Frontend 1.2.1 at commit 0425353c3e493ef05ced38e7c5677e55e1bcff5c; workflow 34668809250 succeeded. Public mobile page verified current assets, fully framed 28K course, painted tiles, hidden loader and no horizontal overflow; five course selectors, runner search and API fallback/recovery also exercised.
18. **Separate labeled rehearsal** — optional follow-on after phone and readiness fixes; never alter live runner timestamps

## Terrain-aware pace pilot — approved
19. **Verify elevation, checkpoint-history and historical-baseline contracts** — completed; verified bulk chip histories and meter elevations; incompatible prior-year checkpoint calibration excluded.
20. **Implement bounded terrain + recent-pace estimator** — completed; stdlib model, cached profiles, optional bulk history, and preserved chip/GPS/privacy/freshness/hold safeguards.
21. **Expose pilot basis and validate** — complete locally; 114 Python / 19 Node tests pass, real aggregate retrospective comparisons, five-course mobile geometry, synthetic pilot/held labels and neutral pre-start search wording. Two-phase history/core scheduling resolves both reviewed freshness blockers without TTL relaxation; final backend rereview APPROVED.
22. **Publish for tomorrow's pilot** — complete; API/frontend 1.3.0 publicly verified, runtime commit ae0390883d02db0179c3482ec82a2ed9ae47eb9d, Pages workflow 34672037825 succeeded. Phone-size/desktop, all five courses, snapshot fallback and live recovery passed. No paid changes or morning monitor.

## Mobile Map / Elevation toggle — approved
23. **Profile geometry and safe position mapping** — complete locally; use existing course data only, no Strava or estimator changes.
24. **Responsive toggle and synchronized runner/course selection** — complete locally; both views remain directly reachable on mobile; no invented replay.
25. **Regression, independent review and local/public browser checks** — local 114 Python / 44 Node pass; spec and final quality rereview APPROVED. Both visible and hidden identity invalidation covered. Public checks follow publication.
26. **Publish updated Pages frontend and hand off** — pending; existing API stays unchanged unless a required contract fix is separately justified.

## Constraints
- Read-only use of public Competitive Timing endpoints.
- No account login, posting, or upstream mutation.
- Python standard library backend where practical.
- Estimated positions must never be presented as measured GPS.
- Keep polling aligned with the source site's cadence.

## Errors Encountered
- Hermes Nous web search/extraction backend was unavailable; public direct HTTP, agent-reach Exa, and headless browser inspection succeeded instead.
- Broad filename search under the home directory timed out and protected folders were skipped; no existing Rut project was identified, so the approved destination is used.
- Headless Chromium denied browser-level fullscreen permission even with a synthetic trusted gesture; the app fills its viewport and exposes the standard user-gesture fullscreen control for a normal browser.
- The first inline Git initialization command hit Hermes's parser guard; its auto-saved script was reviewed before execution.
- `git diff --cached --check` flagged upstream Leaflet's vendored CRLF files as trailing whitespace. Source checks are run with the untouched vendor CSS/license excluded rather than rewriting third-party files.
- The first combined repository-create/push command timed out after creating the empty public repository. Readback confirmed the repository existed but remained empty, so creation was not repeated.
- The first standalone HTTPS push timed out without creating the remote branch; GitHub authentication is being reconfigured for Git before retrying by a different bounded path.
- The first Vercel device flow expired; the second authenticated successfully. The dedicated API was deployed and publicly verified. A later read-only account recheck hit a permission timeout; it was not retried. User explicitly approved continuing publication without paid upgrades or account-setting changes.
- Audit/reviews found numeric null conversion, stale marker labels, anonymity merging, bootstrap recovery, source errors, pagination integrity, fallback semantics, and a test-hook mismatch. All are fixed; final independent review APPROVED, 57 Python and 10 JavaScript tests pass.
- The initial hosted rewrite allowed static source-file serving. Replaced with explicit API routes and catch-all rejection; public source/config/secret paths now return JSON 404.
