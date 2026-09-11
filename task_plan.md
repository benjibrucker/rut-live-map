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
- The remote UI labels its data as a periodically refreshed snapshot rather than claiming 15-second live updates.

## Phases
1. **Data contract and scaffold** — complete
2. **Local proxy and estimator** — complete
3. **Interactive map UI and director modes** — complete
4. **Automated and browser verification** — complete
5. **Handoff documentation** — complete
6. **GitHub Pages static-data adaptation** — complete
7. **Public repository and Pages deployment** — in progress
8. **Remote browser verification** — pending

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
