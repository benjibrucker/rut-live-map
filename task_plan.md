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
15. **Repair map resilience and day switching** — pending; map remains visible, next scheduled course shown when no race is live, manual course selection preserved, clear upcoming/closed status
16. **Verify wave timing and guard estimates** — pending; source-backed gun/chip/wave semantics or conservative suppression
17. **Regression, review and public verification** — pending; mobile map/empty state, tomorrow rollover, API fallback and deployed assets
18. **Separate labeled rehearsal** — optional follow-on after phone and readiness fixes; never alter live runner timestamps

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
