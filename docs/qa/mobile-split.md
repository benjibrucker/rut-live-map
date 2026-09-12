# Phone split workspace — verification record

Target frontend: 1.6.0. Baseline: 5f80f38 (frontend/API 1.5.0).

## Approved scope

- Phone Info in the upper half; Map/Elevation in the lower half, not behind info overlays.
- Independent expand modes fill the webpage, with a reachable Back to split action; native iPhone browser chrome may remain.
- Info scrolls independently; useful controls, source explanations, checkpoint history and official guide remain available.
- Preserve selection, race, manual/Auto state, primary view and map center/zoom across layout changes.
- Desktop presentation and backend/estimator/ranking behavior unchanged.

## Baseline

- User-provided phone screenshot inspected. Reproduced at 390×675: runner card y166–406 and controls y418–667 obscure the map (y57–675).
- Desktop 1280×800 panel rectangles saved locally as browser-workspace `split-baseline-desktop.json` for comparison.
- Before implementation: 141 Python tests passed; 53 Node tests passed.

## Acceptance checks — in progress

Verified locally on the first implementation:
- 390×675, 320×568 and 844×390 actual pointer expand/return loops in both Map and Elevation: preserved selection, manual/follow/director state, view and zoom; geographic center delta zero.
- Search actual roster via pointer; 16px input; recorded history and separate guide open; original chart loads at1606px. Dialog Escape restores opener, then pane Escape restores split.
- All five profiles rendered with authoritative checkpoint counts8/6/5/3/3. Counting a nonexistent class first returned zero; actual child elements confirmed the counts.
- Synthetic isolated privacy test: old identity disappears from all body markup after anonymous refresh while either Info or Display is hidden. Fixture never published.
- Fourteen Tab steps in expanded Display never enter hidden Info. Desktop1280×800 frame geometry exactly matches baseline after a resize event.
- CDP metric changes sometimes failed to deliver the resize event; explicit event dispatch restored split. Not presented as a physical-browser defect or proof of real orientation coverage.
- Full first-pass tests58Node /141Python; static build five events, zero source errors.

Fixed and rechecked: single Finish toggle reparented on breakpoint; actual1200×500 desktop Elevation Finish list opens. Explicit search and Finish selections reveal stats at scrollTop0 on phones; view/manual selection retained. Spec rereviewPASS61Node. Additional360×640,390×450 and844×390 tests verify44px pane/view targets and no overflow; live refresh preserves Info scroll.

Final quality APPROVED after synchronous camera correction. Parent and reviewer64Node/141Python pass; reviewer200 additional deferred-camera probes pass. Parent actual Leaflet final expand/return loops preserve center/zoom and an intervening new camera move wins. Public1.6.0 publication/readback pending.


- Portrait 390×675 and 390×844, narrow 320×568 and 360×640, landscape 844×390.
- Two equally divided, bounded panes; no document horizontal overflow; real painted tiles and route visible.
- Map and Elevation buttons and each expand/return action hit-testable; Info scroll exposes all controls.
- Search by real roster name/bib and select through actual pointer input. Search results fit in Info and remain scrollable; simulated reduced viewport does not prove physical software-keyboard behavior.
- Split → expanded Display → Map/Elevation → split; split → expanded Info → details → split. Retain all required state and geographic center/zoom.
- Finish watch opens in Info; select eligible row and preserve the prior primary display.
- Recorded checkpoint history including Start, missing rows, separate cutoff guide and original chart remain available.
- Hidden pane controls are not keyboard-focusable; Escape closes details first, then returns expanded pane to split. Restore useful focus.
- Landscape/desktop resize does not strand expansion or leave inert desktop controls.
- Anonymized fixture refresh removes prior identity even when its pane is hidden; synthetic fixtures stay local.
- All five course profiles render. Snapshot fallback remains labeled and recovers live.
- Independent spec and quality reviews; final automated tests/static build; public Pages assets and workflows read back.

Actual iPhone/Safari verification is not claimed by Chromium viewport checks.
