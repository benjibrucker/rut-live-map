# Hidden map selection — frontend1.9.1

## Reproduction
Published1.9.0: expand Info on phone with Map selected, then select a located runner. Leaflet reports0×0 map size and flyTo raises `Invalid LatLng object: (NaN, NaN)`. The selection key changes but camera update fails. Captured in isolated public browser; no upstream write.

## Approved fix contract
Update the hidden map target without animation; preserve newest selected target/zoom for reveal, manual/Auto/follow, red arrow and checkpoint timeline. Visible Map retains animation; Elevation remains nonanimated. No backend or estimator change.

## Verification
- RED: five expected zero-size crash failures and two controls passed before the fix. GREEN: seven regressions passed; full133Node/159Python and syntax/diff checks pass.
- Independent precommit review PASS: no security/logic concerns or suggestions; actual selection/reveal implementation plus focused/timeline tests checked.
- Local actual pointer search with Info expanded passes: hidden target update, manual/follow and next ETA intact. Nine browser checks cover repeated Map/Elevation selections, hidden Auto, newest-target reveal (≤1px Leaflet precision), one selected red arrow, no overflow, no captured JS errors. Visible-map actual search click completes animation to the target with0px error; timeline opens with recorded and forecast rows. The first programmatic-only flight probe was background-frame throttled; actual input/capture verified completion. Hosted replay remains.
- Hosted runtime bytes, Pages result and same public interaction: pending.
- Physical iPhone/Safari not tested.
