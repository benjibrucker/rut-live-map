#!/usr/bin/env python3
"""Local read-only proxy and estimator for The Rut 2026 live map."""

from __future__ import annotations

import argparse
import bisect
import concurrent.futures
import dataclasses
import datetime as dt
import json
import math
import mimetypes
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

APP_NAME = "Rut Live Map"
APP_VERSION = "1.0.0"
APP_ROOT = Path(__file__).resolve().parent
UPSTREAM = "https://api.competitivetiming.com"
EVENTS = (
    ("the-rut-50k-2026", "50K"),
    ("the-rut-28k-2026", "28K"),
    ("the-rut-21k-2026", "21K"),
    ("the-rut-11k-2026", "11K"),
    ("the-rut-vk-2026", "VK"),
)
EVENT_LABELS = dict(EVENTS)
USER_AGENT = "RutLiveMap/1.0 (+local spectator display)"
GPS_TTL_SECONDS = 15
LEADERBOARD_TTL_SECONDS = 30
EVENT_TTL_SECONDS = 30
COURSE_TTL_SECONDS = 3600
FRESH_GPS_SECONDS = 90
MAX_LEADERBOARD_RECORDS = 5000


@dataclasses.dataclass
class CacheEntry:
    value: Any
    fetched_at: float


class JsonCache:
    """Small thread-safe TTL cache with stale-on-network-error behavior."""

    def __init__(self) -> None:
        self._entries: dict[str, CacheEntry] = {}
        self._lock = threading.Lock()
        self._key_locks: dict[str, threading.Lock] = {}

    def _lock_for(self, key: str) -> threading.Lock:
        with self._lock:
            return self._key_locks.setdefault(key, threading.Lock())

    def get(self, key: str, ttl: int, loader: Callable[[], Any]) -> tuple[Any, bool]:
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry and now - entry.fetched_at < ttl:
                return entry.value, False

        with self._lock_for(key):
            now = time.monotonic()
            with self._lock:
                entry = self._entries.get(key)
                if entry and now - entry.fetched_at < ttl:
                    return entry.value, False
            try:
                value = loader()
            except Exception:
                with self._lock:
                    stale = self._entries.get(key)
                if stale is not None:
                    return stale.value, True
                raise
            with self._lock:
                self._entries[key] = CacheEntry(value=value, fetched_at=time.monotonic())
            return value, False


CACHE = JsonCache()


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def upstream_json(path: str, ttl: int) -> tuple[dict[str, Any], bool]:
    if not path.startswith("/") or ".." in path:
        raise ValueError("invalid upstream path")
    url = UPSTREAM + path

    def load() -> dict[str, Any]:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "Origin": "https://competitivetiming.com",
                "Referer": "https://competitivetiming.com/",
                "User-Agent": USER_AGENT,
            },
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status != 200:
                raise RuntimeError(f"upstream returned HTTP {response.status}")
            payload = json.load(response)
        if not isinstance(payload, dict) or payload.get("status") not in (None, "ok"):
            raise RuntimeError("unexpected upstream payload")
        return payload

    return CACHE.get(url, ttl, load)


def as_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def haversine_m(a: dict[str, Any], b: dict[str, Any]) -> float:
    lat1 = math.radians(float(a["lat"]))
    lat2 = math.radians(float(b["lat"]))
    dlat = lat2 - lat1
    dlng = math.radians(float(b["lng"]) - float(a["lng"]))
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6_371_000 * 2 * math.asin(min(1.0, math.sqrt(h)))


def route_distances(track: list[dict[str, Any]]) -> tuple[list[float], float]:
    cumulative = [0.0]
    for index in range(1, len(track)):
        cumulative.append(cumulative[-1] + haversine_m(track[index - 1], track[index]))
    return cumulative, cumulative[-1] if cumulative else 0.0


def nearest_route_progress(
    point: dict[str, Any], track: list[dict[str, Any]], cumulative: list[float], total: float
) -> float:
    if not track or total <= 0:
        return 0.0
    best_index = min(range(len(track)), key=lambda i: haversine_m(point, track[i]))
    return cumulative[best_index] / total


def interpolate_route(
    track: list[dict[str, Any]], cumulative: list[float], total: float, progress: float
) -> tuple[float, float] | None:
    if not track:
        return None
    if len(track) == 1 or total <= 0:
        return float(track[0]["lat"]), float(track[0]["lng"])
    target = max(0.0, min(1.0, progress)) * total
    right = bisect.bisect_left(cumulative, target)
    if right <= 0:
        return float(track[0]["lat"]), float(track[0]["lng"])
    if right >= len(track):
        return float(track[-1]["lat"]), float(track[-1]["lng"])
    left = right - 1
    span = cumulative[right] - cumulative[left]
    fraction = 0.0 if span <= 0 else (target - cumulative[left]) / span
    lat = float(track[left]["lat"]) + (float(track[right]["lat"]) - float(track[left]["lat"])) * fraction
    lng = float(track[left]["lng"]) + (float(track[right]["lng"]) - float(track[left]["lng"])) * fraction
    return lat, lng


def event_start_utc(event: dict[str, Any]) -> dt.datetime | None:
    date_text = str(event.get("event_date") or "")[:10]
    time_text = str(event.get("start_time") or event.get("estimated_start_time") or "")
    if not date_text or not time_text:
        return None
    try:
        local_date = dt.date.fromisoformat(date_text)
        local_time = dt.time.fromisoformat(time_text)
        zone = ZoneInfo(str(event.get("timezone") or "America/Denver"))
        return dt.datetime.combine(local_date, local_time, zone).astimezone(dt.timezone.utc)
    except (ValueError, TypeError, KeyError):
        return None


def split_progresses(
    event_response: dict[str, Any], course: dict[str, Any], track: list[dict[str, Any]], cumulative: list[float], total: float
) -> list[float]:
    event = event_response.get("event") or {}
    count = len(event.get("split_names") or [])
    by_index: dict[int, float] = {}
    for row in event_response.get("multipliers") or []:
        index = as_int(row.get("split_index"))
        progress = as_float(row.get("progress_pct"))
        if index is not None and progress is not None:
            by_index[index] = max(0.0, min(1.0, progress))

    split_points = course.get("splitPoints") or []
    values: list[float] = []
    for index in range(count):
        if index in by_index:
            value = by_index[index]
        elif index < len(split_points):
            value = nearest_route_progress(split_points[index], track, cumulative, total)
        elif count > 1:
            value = index / (count - 1)
        else:
            value = 0.0
        values.append(value)

    if values:
        values[0] = 0.0
        values[-1] = 1.0
        for index in range(1, len(values)):
            values[index] = max(values[index], values[index - 1])
    return values


def segment_weights(event_response: dict[str, Any], progresses: list[float]) -> list[float]:
    event = event_response.get("event") or {}
    distances = event.get("split_distances") or {}
    multipliers = {
        as_int(row.get("split_index")): as_float(row.get("pace_multiplier"))
        for row in event_response.get("multipliers") or []
    }
    weights = [0.0]
    for index in range(1, len(progresses)):
        segment = distances.get(str(index)) or distances.get(index) or {}
        distance = as_float(segment.get("value"))
        if distance is None or distance <= 0:
            distance = max(0.001, progresses[index] - progresses[index - 1])
        multiplier = multipliers.get(index) or 1.0
        weights.append(max(0.001, distance * multiplier))
    return weights


def runner_status(runner: dict[str, Any], finish_index: int) -> str:
    if runner.get("dq"):
        return "DQ"
    if runner.get("dnq"):
        return "DNQ"
    if runner.get("dns"):
        return "DNS"
    if runner.get("dropped") or runner.get("dnf"):
        return "DROPPED"
    if runner.get("finish_time_seconds") is not None:
        return "FINISHED"
    last_index = as_int(runner.get("last_split_index"))
    if last_index is not None and last_index >= finish_index:
        return "FINISHED"
    if last_index is not None and last_index >= 0:
        return "ON COURSE"
    return "REGISTERED"


def projected_progress(
    runner: dict[str, Any], event_response: dict[str, Any], progresses: list[float], now: dt.datetime
) -> tuple[float, float, bool] | None:
    event = event_response.get("event") or {}
    if len(progresses) < 2:
        return None
    last_index = as_int(runner.get("last_split_index"))
    if last_index is None or last_index < 0 or last_index >= len(progresses) - 1:
        return None
    if runner_status(runner, len(progresses) - 1) != "ON COURSE":
        return None

    start = event_start_utc(event)
    if start is None:
        return None
    race_clock = (now.astimezone(dt.timezone.utc) - start).total_seconds()
    if race_clock < 0:
        return None

    last_time = as_float(runner.get("last_split_time")) or 0.0
    base_progress = progresses[last_index]
    projected_finish = as_float(runner.get("estimated_finish_seconds"))
    if projected_finish is None:
        projected_finish = as_float(runner.get("goal_time_seconds"))
    if projected_finish is None and last_time > 0 and base_progress > 0:
        projected_finish = last_time / base_progress
    if projected_finish is None:
        return None
    projected_finish = max(projected_finish, last_time + 60.0)

    travel_time = max(0.0, race_clock - last_time)
    remaining_time = max(60.0, projected_finish - last_time)
    weights = segment_weights(event_response, progresses)
    remaining_weights = weights[last_index + 1 :]
    total_weight = sum(remaining_weights)
    if total_weight <= 0:
        next_progress = progresses[last_index + 1]
        fraction = min(0.99, travel_time / remaining_time)
        return (
            base_progress + (next_progress - base_progress) * fraction,
            projected_finish,
            travel_time >= remaining_time,
        )

    # An estimate may move only toward the next checkpoint. If expected
    # arrival passes without a chip read, hold just before that checkpoint
    # instead of inventing movement through later course segments.
    next_index = last_index + 1
    next_duration = remaining_time * weights[next_index] / total_weight
    overdue = travel_time >= next_duration
    fraction = 0.99 if overdue else max(0.0, min(0.99, travel_time / max(1.0, next_duration)))
    progress = progresses[last_index] + (progresses[next_index] - progresses[last_index]) * fraction
    return min(0.995, progress), projected_finish, overdue


def protected_name(record: dict[str, Any]) -> str:
    if record.get("is_anonymous") or record.get("athlete_anonymous"):
        return "Anonymous Participant"
    return str(record.get("name") or record.get("runner_name") or "Unknown Runner")


def sanitize_runner(runner: dict[str, Any], finish_index: int) -> dict[str, Any]:
    return {
        "id": as_int(runner.get("id")),
        "bib": runner.get("bib"),
        "name": protected_name(runner),
        "city": runner.get("city") or "",
        "state": runner.get("state") or "",
        "age": runner.get("age"),
        "gender": runner.get("gender") or "",
        "status": runner_status(runner, finish_index),
        "last_split_index": as_int(runner.get("last_split_index")),
        "last_split_time": as_float(runner.get("last_split_time")),
        "estimated_finish_seconds": as_float(runner.get("estimated_finish_seconds")),
        "goal_time_seconds": as_float(runner.get("goal_time_seconds")),
        "overall_place": runner.get("gun_place") or runner.get("chip_place"),
        "has_gps": bool(runner.get("has_gps")),
    }


def parse_recorded_at(value: Any) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return None


def build_event_view(bundle: dict[str, Any], now: dt.datetime, include_course: bool) -> dict[str, Any]:
    event_response = bundle["event_response"]
    event = event_response.get("event") or {}
    label = EVENT_LABELS.get(event.get("id"), event.get("display_name") or event.get("name") or "Race")
    maps = (bundle.get("course_response") or {}).get("courseMaps") or []
    course = maps[0] if maps else {}
    track = [
        {"lat": float(point["lat"]), "lng": float(point["lng"]), **({"ele": point["ele"]} if "ele" in point else {})}
        for point in course.get("trackPoints") or []
        if as_float(point.get("lat")) is not None and as_float(point.get("lng")) is not None
    ]
    cumulative, total = route_distances(track)
    progresses = split_progresses(event_response, course, track, cumulative, total)
    finish_index = max(0, len(progresses) - 1)
    split_names = list(event.get("split_names") or [])

    leaderboard = bundle.get("leaderboard") or []
    gps_rows = (bundle.get("gps_response") or {}).get("positions") or []
    gps_by_id = {as_int(row.get("runner_id")): row for row in gps_rows if as_int(row.get("runner_id")) is not None}
    runners_by_id = {as_int(row.get("id")): row for row in leaderboard if as_int(row.get("id")) is not None}

    runners: list[dict[str, Any]] = []
    positions: list[dict[str, Any]] = []
    for raw in leaderboard:
        clean = sanitize_runner(raw, finish_index)
        clean["event_id"] = event.get("id")
        clean["course"] = label
        runners.append(clean)
        runner_id = clean["id"]
        gps = gps_by_id.get(runner_id)
        if gps is not None:
            recorded = parse_recorded_at(gps.get("recorded_at"))
            age = max(0.0, (now - recorded).total_seconds()) if recorded else None
            positions.append(
                {
                    **clean,
                    "lat": as_float(gps.get("latitude")),
                    "lng": as_float(gps.get("longitude")),
                    "source": "GPS",
                    "freshness": "LIVE" if age is not None and age <= FRESH_GPS_SECONDS else "STALE",
                    "recorded_at": gps.get("recorded_at"),
                    "age_seconds": round(age) if age is not None else None,
                    "accuracy_m": as_float(gps.get("accuracy")),
                    "speed_mps": as_float(gps.get("speed")),
                    "heading": as_float(gps.get("heading")),
                    "battery_pct": as_float(gps.get("battery_pct")),
                    "progress": None,
                    "last_checkpoint": split_names[clean["last_split_index"]]
                    if clean["last_split_index"] is not None and 0 <= clean["last_split_index"] < len(split_names)
                    else None,
                }
            )
            continue

        projection = projected_progress(raw, event_response, progresses, now)
        if projection is None:
            continue
        progress, projected_finish, estimate_overdue = projection
        coordinate = interpolate_route(track, cumulative, total, progress)
        if coordinate is None:
            continue
        checkpoint_index = clean["last_split_index"]
        positions.append(
            {
                **clean,
                "lat": coordinate[0],
                "lng": coordinate[1],
                "source": "ESTIMATED",
                "freshness": "ESTIMATED",
                "recorded_at": None,
                "age_seconds": None,
                "accuracy_m": None,
                "speed_mps": None,
                "heading": None,
                "battery_pct": None,
                "progress": round(progress, 6),
                "projected_finish_seconds": projected_finish,
                "estimate_overdue": estimate_overdue,
                "last_checkpoint": split_names[checkpoint_index]
                if checkpoint_index is not None and 0 <= checkpoint_index < len(split_names)
                else None,
            }
        )

    # GPS sharing may begin before the runner appears in a loaded leaderboard page.
    for runner_id, gps in gps_by_id.items():
        if runner_id in runners_by_id:
            continue
        recorded = parse_recorded_at(gps.get("recorded_at"))
        age = max(0.0, (now - recorded).total_seconds()) if recorded else None
        anonymous = bool(gps.get("is_anonymous"))
        clean = {
            "id": runner_id,
            "bib": gps.get("bib"),
            "name": "Anonymous Participant" if anonymous else str(gps.get("runner_name") or "Unknown Runner"),
            "city": "",
            "state": "",
            "age": None,
            "gender": "",
            "status": "GPS",
            "last_split_index": None,
            "last_split_time": None,
            "estimated_finish_seconds": None,
            "goal_time_seconds": None,
            "overall_place": None,
            "has_gps": True,
            "event_id": event.get("id"),
            "course": label,
        }
        runners.append(clean)
        positions.append(
            {
                **clean,
                "lat": as_float(gps.get("latitude")),
                "lng": as_float(gps.get("longitude")),
                "source": "GPS",
                "freshness": "LIVE" if age is not None and age <= FRESH_GPS_SECONDS else "STALE",
                "recorded_at": gps.get("recorded_at"),
                "age_seconds": round(age) if age is not None else None,
                "accuracy_m": as_float(gps.get("accuracy")),
                "speed_mps": as_float(gps.get("speed")),
                "heading": as_float(gps.get("heading")),
                "battery_pct": as_float(gps.get("battery_pct")),
                "progress": None,
                "last_checkpoint": None,
            }
        )

    start = event_start_utc(event)
    view: dict[str, Any] = {
        "id": event.get("id"),
        "label": label,
        "display_name": event.get("display_name") or label,
        "event_date": str(event.get("event_date") or "")[:10] or None,
        "start_time": event.get("start_time") or event.get("estimated_start_time"),
        "start_at": start.isoformat().replace("+00:00", "Z") if start else None,
        "timezone": event.get("timezone") or "America/Denver",
        "course_status": event.get("course_status") or "unknown",
        "distance_miles": as_float(event.get("course_distance_miles")),
        "split_names": split_names,
        "color": course.get("color") or "#ff6b35",
        "runners": runners,
        "positions": [row for row in positions if row.get("lat") is not None and row.get("lng") is not None],
        "upstream_stale": bool(bundle.get("upstream_stale")),
        "errors": bundle.get("errors") or [],
    }
    if include_course:
        view["course"] = {
            "track_points": track,
            "split_points": course.get("splitPoints") or [],
            "progress_points": progresses,
        }
    return view


def load_leaderboard(event_id: str) -> tuple[list[dict[str, Any]], bool]:
    output: list[dict[str, Any]] = []
    offset = 0
    stale = False
    while offset < MAX_LEADERBOARD_RECORDS:
        payload, was_stale = upstream_json(
            f"/events/{urllib.parse.quote(event_id)}/leaderboard?limit=500&offset={offset}",
            LEADERBOARD_TTL_SECONDS,
        )
        stale = stale or was_stale
        batch = payload.get("leaderboard") or []
        if not isinstance(batch, list):
            raise RuntimeError("leaderboard was not a list")
        output.extend(batch)
        if len(batch) < 500:
            break
        offset += 500
    return output, stale


def load_event_bundle(event_id: str) -> dict[str, Any]:
    errors: list[str] = []
    stale = False
    try:
        event_response, was_stale = upstream_json(
            f"/events/{urllib.parse.quote(event_id)}", EVENT_TTL_SECONDS
        )
        stale = stale or was_stale
    except Exception as exc:
        return {"event_response": {"event": {"id": event_id}}, "errors": [f"event: {exc}"]}

    course_response: dict[str, Any] = {}
    gps_response: dict[str, Any] = {}
    leaderboard: list[dict[str, Any]] = []
    try:
        course_response, was_stale = upstream_json(
            f"/course-maps/event/{urllib.parse.quote(event_id)}?include=points", COURSE_TTL_SECONDS
        )
        stale = stale or was_stale
    except Exception as exc:
        errors.append(f"course: {exc}")
    try:
        gps_response, was_stale = upstream_json(
            f"/gps/locations/{urllib.parse.quote(event_id)}", GPS_TTL_SECONDS
        )
        stale = stale or was_stale
    except Exception as exc:
        errors.append(f"gps: {exc}")
    try:
        leaderboard, was_stale = load_leaderboard(event_id)
        stale = stale or was_stale
    except Exception as exc:
        errors.append(f"leaderboard: {exc}")

    return {
        "event_response": event_response,
        "course_response": course_response,
        "gps_response": gps_response,
        "leaderboard": leaderboard,
        "upstream_stale": stale,
        "errors": errors,
    }


def build_payload(include_courses: bool = False, now: dt.datetime | None = None) -> dict[str, Any]:
    now = (now or utc_now()).astimezone(dt.timezone.utc)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(EVENTS)) as executor:
        futures = {event_id: executor.submit(load_event_bundle, event_id) for event_id, _ in EVENTS}
        bundles = [(event_id, futures[event_id].result()) for event_id, _ in EVENTS]
    views = [build_event_view(bundle, now, include_courses) for _, bundle in bundles]
    positions = [position for event in views for position in event["positions"]]
    live_gps = sum(1 for row in positions if row["source"] == "GPS" and row["freshness"] == "LIVE")
    stale_gps = sum(1 for row in positions if row["source"] == "GPS" and row["freshness"] == "STALE")
    estimated = sum(1 for row in positions if row["source"] == "ESTIMATED")
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "poll_after_seconds": GPS_TTL_SECONDS,
        "summary": {
            "live_gps": live_gps,
            "stale_gps": stale_gps,
            "estimated": estimated,
            "positions": len(positions),
            "upstream_stale": any(event["upstream_stale"] for event in views),
            "errors": sum(len(event["errors"]) for event in views),
        },
        "events": views,
    }


class RutHandler(BaseHTTPRequestHandler):
    server_version = "RutLiveMap/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))
        sys.stdout.flush()

    def send_payload(self, status: int, payload: Any) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                self.send_payload(200, {"status": "ok", "app": APP_NAME, "version": APP_VERSION})
                return
            if parsed.path == "/api/bootstrap":
                self.send_payload(200, build_payload(include_courses=True))
                return
            if parsed.path == "/api/live":
                self.send_payload(200, build_payload(include_courses=False))
                return
            if parsed.path.startswith("/api/"):
                self.send_payload(404, {"status": "error", "message": "not found"})
                return
            self.serve_static(parsed.path)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as exc:
            self.send_payload(502, {"status": "error", "message": str(exc)})

    def serve_static(self, request_path: str) -> None:
        relative = "index.html" if request_path in ("", "/") else urllib.parse.unquote(request_path.lstrip("/"))
        candidate = (APP_ROOT / relative).resolve()
        try:
            candidate.relative_to(APP_ROOT)
        except ValueError:
            self.send_error(403)
            return
        if not candidate.is_file():
            self.send_error(404)
            return
        body = candidate.read_bytes()
        content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type + ("; charset=utf-8" if content_type.startswith("text/") else ""))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.tile.opentopomap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self';")
        self.end_headers()
        self.wfile.write(body)


def own_server_running(port: int) -> bool:
    try:
        request = urllib.request.Request(f"http://127.0.0.1:{port}/api/health", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=1) as response:
            payload = json.load(response)
        return payload.get("app") == APP_NAME
    except Exception:
        return False


def serve(port: int, open_browser: bool) -> int:
    url = f"http://127.0.0.1:{port}/"
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), RutHandler)
    except OSError as exc:
        if own_server_running(port):
            if open_browser:
                webbrowser.open(url)
            print(f"{APP_NAME} is already running at {url}")
            return 0
        print(f"Could not start {APP_NAME} on port {port}: {exc}", file=sys.stderr)
        return 1

    print(f"{APP_NAME} {APP_VERSION} — {url}")
    print("Press Control-C to stop.")
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("RUT_LIVE_PORT", "8765")))
    parser.add_argument("--open", action="store_true", help="open the app in the default browser")
    parser.add_argument("--snapshot", action="store_true", help="print one live snapshot and exit")
    args = parser.parse_args()
    if args.snapshot:
        print(json.dumps(build_payload(include_courses=False), indent=2))
        return 0
    return serve(args.port, args.open)


if __name__ == "__main__":
    raise SystemExit(main())
