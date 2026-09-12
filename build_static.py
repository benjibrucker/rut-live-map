#!/usr/bin/env python3
"""Build the current sanitized GitHub Pages artifact."""

from __future__ import annotations

import copy
import json
import shutil
from pathlib import Path
from typing import Any

import server

ROOT = Path(__file__).resolve().parent
SITE_DIR = ROOT / "_site"
PUBLIC_FILES = (
    "index.html",
    "styles.css",
    "app.js",
    "config.js",
    "race-logic.js",
    "elevation-profile.js",
    "favicon.svg",
    "rut-2026-aid-chart.png",
)
PUBLIC_DIRS = ("vendor",)
DROP_PUBLIC_FIELDS = {
    "age",
    "gender",
    "city",
    "state",
    "battery_pct",
    "speed_mps",
    "heading",
}


def sanitize_public(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a minimized copy suitable for the public Pages artifact."""
    clean = copy.deepcopy(payload)
    clean["delivery"] = "periodic_snapshot"
    clean["refresh_expected_seconds"] = 300
    for event in clean.get("events") or []:
        for collection in ("runners", "positions"):
            for record in event.get(collection) or []:
                for field in DROP_PUBLIC_FIELDS:
                    record.pop(field, None)
    return clean


def make_live_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Make the smaller refresh payload while retaining the full roster."""
    live = copy.deepcopy(payload)
    for event in live.get("events") or []:
        event.pop("course", None)
    return live


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def validate_snapshot(payload: dict[str, Any]) -> None:
    events = payload.get("events") or []
    if {e.get("id") for e in events} != set(server.EVENT_LABELS):
        raise RuntimeError("Snapshot missing expected races; do not replace published data")
    if payload.get("summary", {}).get("errors") or payload.get("summary", {}).get("upstream_stale"):
        raise RuntimeError("Incomplete/stale source; do not publish a new snapshot")
    if any(len(e.get("course", {}).get("track_points", [])) < 2 or not e.get("runners") for e in events):
        raise RuntimeError("Snapshot missing course or roster; do not publish")


def build() -> Path:
    payload = sanitize_public(server.build_payload(include_courses=True))
    validate_snapshot(payload)
    if SITE_DIR.exists():
        shutil.rmtree(SITE_DIR)
    SITE_DIR.mkdir(parents=True)

    for name in PUBLIC_FILES:
        shutil.copy2(ROOT / name, SITE_DIR / name)
    for name in PUBLIC_DIRS:
        shutil.copytree(ROOT / name, SITE_DIR / name)

    write_json(SITE_DIR / "data" / "bootstrap.json", payload)
    write_json(SITE_DIR / "data" / "live.json", make_live_payload(payload))
    (SITE_DIR / ".nojekyll").write_text("", encoding="utf-8")
    return SITE_DIR


def main() -> int:
    site = build()
    bootstrap = json.loads((site / "data" / "bootstrap.json").read_text(encoding="utf-8"))
    print(json.dumps({
        "site": str(site),
        "generated_at": bootstrap.get("generated_at"),
        "events": len(bootstrap.get("events") or []),
        "runners": sum(len(event.get("runners") or []) for event in bootstrap.get("events") or []),
        "positions": bootstrap.get("summary", {}).get("positions", 0),
        "errors": bootstrap.get("summary", {}).get("errors", 0),
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
