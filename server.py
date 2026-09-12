#!/usr/bin/env python3
"""Local read-only proxy and estimator for The Rut 2026 live map."""

from __future__ import annotations

import argparse
import bisect
import concurrent.futures
import dataclasses
import datetime as dt
import functools
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
from terrain_model import build_profile, predict

from finish_metrics import (
    after_seconds, coordinate, finite_number, great_circle_m, match_route,
    parse_timestamp, prepare_route, timestamp,
)

APP_NAME = "Rut Live Map"
APP_VERSION = "1.6.0"
TERRAIN_PILOT_ENABLED = True
HISTORY_TTL_SECONDS = 60
TERRAIN_MODEL = "terrain-pilot-v1"
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
SOURCE_ASSEMBLY_GRACE_SECONDS = 5
FRESH_GPS_SECONDS = 90
MAX_LEADERBOARD_RECORDS = 5000
MAX_CHECKPOINT_FORECAST_SECONDS = 24 * 60 * 60


@dataclasses.dataclass
class CacheEntry:
    value: Any
    fetched_at: float
    fetched_wall: float = dataclasses.field(default_factory=time.time)


class JsonCache:
    """Small thread-safe TTL cache with stale-on-network-error behavior."""

    def __init__(self) -> None:
        self._entries: dict[str, CacheEntry] = {}
        self._lock = threading.Lock()
        self._key_locks: dict[str, threading.Lock] = {}

    def _lock_for(self, key: str) -> threading.Lock:
        with self._lock:
            return self._key_locks.setdefault(key, threading.Lock())

    def source_fetched_at(self, key: str) -> str | None:
        with self._lock:
            entry = self._entries.get(key)
            return timestamp(dt.datetime.fromtimestamp(entry.fetched_wall, dt.timezone.utc)) if entry else None

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
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


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
    return finite_number(value)


def as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    if isinstance(value, float) and math.isfinite(value) and value.is_integer() and abs(value) <= 2 ** 53:
        return int(value)
    return None


def haversine_m(a: dict[str, Any], b: dict[str, Any]) -> float:
    return great_circle_m((float(a["lat"]), float(a["lng"])), (float(b["lat"]), float(b["lng"])))


def route_distances(track: list[dict[str, Any]]) -> tuple[list[float], float]:
    route = prepare_route(tuple((point["lat"], point["lng"]) for point in track))
    return list(route.cumulative), route.total


def nearest_route_progress(
    point: dict[str, Any], track: list[dict[str, Any]], cumulative: list[float], total: float
) -> float | None:
    if not track or total <= 0:
        return None
    location = coordinate(point.get("lat"), point.get("lng"))
    if location is None:
        return None
    route = prepare_route(tuple((p["lat"], p["lng"]) for p in track))
    along, _ = match_route(location, route, 0.0, 1.0)
    return along / total if along is not None else None


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


def event_start_utc(event: dict[str, Any], actual_only: bool = False) -> dt.datetime | None:
    date_text = str(event.get("event_date") or "")[:10]
    time_text = str(event.get("start_time") or (None if actual_only else event.get("estimated_start_time")) or "")
    if not date_text or not time_text:
        return None
    try:
        local_date = dt.date.fromisoformat(date_text)
        local_time = dt.time.fromisoformat(time_text)
        zone = ZoneInfo(str(event.get("timezone") or "America/Denver"))
        return dt.datetime.combine(local_date, local_time, zone).astimezone(dt.timezone.utc)
    except (ValueError, TypeError, KeyError, OverflowError):
        return None


def split_progresses(
    event_response: dict[str, Any], course: dict[str, Any], track: list[dict[str, Any]], cumulative: list[float], total: float
) -> list[float | None]:
    """Unknown or ambiguous checkpoints stay unknown, never equally spaced."""
    event = event_response.get("event") or {}
    count = len(event.get("split_names") or [])
    values: list[float | None] = [None] * count
    if count < 2:
        return values
    for row in event_response.get("multipliers") or []:
        if not isinstance(row, dict):
            continue
        index = as_int(row.get("split_index"))
        progress = as_float(row.get("progress_pct"))
        if index is not None and 0 <= index < count and progress is not None and 0 <= progress <= 1:
            values[index] = progress

    values[0], values[-1] = 0.0, 1.0
    split_points = course.get("splitPoints") or []
    route = prepare_route(tuple((p["lat"], p["lng"]) for p in track))
    for index in range(1, count - 1):
        if values[index] is None and index < len(split_points) and isinstance(split_points[index], dict):
            location = coordinate(split_points[index].get("lat"), split_points[index].get("lng"))
            lower = next(value for value in reversed(values[:index]) if value is not None)
            upper = next(value for value in values[index + 1:] if value is not None)
            along, _ = match_route(location, route, lower, upper) if location else (None, None)
            values[index] = along / total if along is not None and total > 0 else None
    known = [value for value in values if value is not None]
    if any(right <= left for left, right in zip(known, known[1:])):
        return [0.0] + [None] * (count - 2) + [1.0]
    return values


def segment_weights(event_response: dict[str, Any], progresses: list[float]) -> list[float]:
    event = event_response.get("event") or {}
    distances = event.get("split_distances") or {}
    multipliers = {
        as_int(row.get("split_index")): as_float(row.get("pace_multiplier"))
        for row in event_response.get("multipliers") or []
        if isinstance(row, dict)
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
    explicit = str(runner.get("status") or "").upper()
    if explicit in {"FINISHED", "DNS", "DQ", "DNQ", "DNF", "DROPPED"}:
        return "DROPPED" if explicit == "DNF" else explicit
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
    if explicit == "REGISTERED":
        return "REGISTERED"
    last_index = as_int(runner.get("last_split_index"))
    if finish_index > 0 and last_index is not None and last_index >= finish_index:
        return "FINISHED"
    if last_index is not None and last_index >= 0:
        return "ON COURSE"
    return "REGISTERED"


def runner_start_utc(runner: dict[str, Any], start: dt.datetime | None) -> dt.datetime | None:
    """Chip elapsed uses event actual start plus the runner's chip offset.

    Only legacy in-memory callers may omit the key. Live ingestion explicitly
    inserts None for missing offsets; unknown is never evidence of a zero start.
    gun_start_seconds is a different clock and must not substitute for chip.
    """
    offset = as_float(runner.get("chip_start_seconds", 0))
    if offset is None or offset < 0:
        return None
    return after_seconds(start, offset)


def projected_progress(
    runner: dict[str, Any], event_response: dict[str, Any], progresses: list[float | None], now: dt.datetime
) -> tuple[float, float, bool] | None:
    event = event_response.get("event") or {}
    if len(progresses) < 2 or any(value is None for value in progresses):
        return None
    last_index = as_int(runner.get("last_split_index"))
    if last_index is None or last_index < 0 or last_index >= len(progresses) - 1:
        return None
    if runner_status(runner, len(progresses) - 1) != "ON COURSE":
        return None

    start = runner_start_utc(runner, event_start_utc(event, actual_only=True))
    if start is None:
        return None
    race_clock = (now.astimezone(dt.timezone.utc) - start).total_seconds()
    if race_clock < 0:
        return None

    last_time = as_float(runner.get("last_split_time"))
    if last_time is None or last_time < 0 or last_time > race_clock or (last_index > 0 and last_time == 0):
        return None
    base_progress = progresses[last_index]
    # Public leaderboard JS verifies last_split_time is chip-relative, but does
    # not establish estimated_finish_seconds' clock basis. Live chip records
    # therefore use observed checkpoint pace only, never ambiguous ETA/goal data.
    chip_timing = "chip_start_seconds" in runner
    projected_finish = None if chip_timing else as_float(runner.get("estimated_finish_seconds"))
    if projected_finish is None and last_time > 0 and base_progress > 0:
        projected_finish = last_time / base_progress
    if projected_finish is None and not chip_timing:
        projected_finish = as_float(runner.get("goal_time_seconds"))
    if projected_finish is None or projected_finish <= last_time or after_seconds(start, projected_finish) is None:
        return None

    travel_time = max(0.0, race_clock - last_time)
    remaining_time = projected_finish - last_time
    weights = segment_weights(event_response, progresses)
    if any(not math.isfinite(weight) or weight <= 0 for weight in weights[1:]):
        return None
    remaining_weights = weights[last_index + 1 :]
    total_weight = sum(remaining_weights)
    if not math.isfinite(total_weight):
        return None
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
    next_duration = remaining_time * (weights[next_index] / total_weight)
    overdue = travel_time >= next_duration
    fraction = 0.99 if overdue else max(0.0, min(0.99, travel_time / max(1.0, next_duration)))
    progress = progresses[last_index] + (progresses[next_index] - progresses[last_index]) * fraction
    return progress, projected_finish, overdue


def checkpoint_forecasts(event_response: dict, progresses: list, index: int,
                         last_time: float, finish_seconds: float, terrain,
                         chip_start: dt.datetime, now: dt.datetime) -> list[dict[str, Any]]:
    """All-or-nothing future clocks, evaluated without changing the estimator.

    The fallback's finish duration is already fitted; distribute only remaining
    time by its exact segment weights, not by naive distance progress. Validate
    original checkpoint ordering before weights can conceal bad geometry.
    """
    if (not 0 < index < len(progresses) - 1
            or not all(as_float(p) is not None and 0 <= p <= 1 for p in progresses)
            or progresses[0] != 0 or progresses[-1] != 1
            or any(b <= a for a, b in zip(progresses, progresses[1:]))
            or as_float(last_time) is None or as_float(finish_seconds) is None
            or not 0 < last_time < finish_seconds):
        return []
    if terrain is not None:
        seconds = terrain.checkpoint_seconds
    else:
        weights = segment_weights(event_response, progresses)[index + 1:]
        total = sum(weights)
        if not math.isfinite(total) or total <= 0 or any(not math.isfinite(w) or w <= 0 for w in weights):
            return []
        seconds, cumulative = [], 0.0
        for i, weight in enumerate(weights, index + 1):
            cumulative += weight
            elapsed = finish_seconds if i == len(progresses) - 1 else last_time + (finish_seconds - last_time) * (cumulative / total)
            seconds.append((i, elapsed))
    if [i for i, _ in seconds] != list(range(index + 1, len(progresses))):
        return []
    output, previous = [], now
    for i, elapsed in seconds:
        arrival = after_seconds(chip_start, elapsed)
        if (arrival is None or arrival <= previous or elapsed <= last_time
                or (arrival - now).total_seconds() > MAX_CHECKPOINT_FORECAST_SECONDS):
            return []  # Never slide expired arrivals forward or publish a suffix.
        output.append({"split_index": i, "estimated_at": timestamp(arrival)})
        previous = arrival
    if output[-1]["estimated_at"] != timestamp(after_seconds(chip_start, finish_seconds)):
        return []
    return output


def protected_name(record: dict[str, Any]) -> str:
    if record.get("is_anonymous") or record.get("athlete_anonymous"):
        return "Anonymous Participant"
    return str(record.get("name") or record.get("runner_name") or "Unknown Runner")


def sanitize_runner(runner: dict[str, Any], finish_index: int) -> dict[str, Any]:
    anonymous = bool(runner.get("is_anonymous") or runner.get("athlete_anonymous"))
    return {
        "id": as_int(runner.get("id")),
        "bib": None if anonymous else runner.get("bib"),
        "name": protected_name(runner),
        "is_anonymous": anonymous,
        "city": "" if anonymous else runner.get("city") or "",
        "state": "" if anonymous else runner.get("state") or "",
        "age": None if anonymous else as_int(runner.get("age")),
        "gender": "" if anonymous else runner.get("gender") or "",
        "status": runner_status(runner, finish_index),
        "last_split_index": as_int(runner.get("last_split_index")),
        "last_split_time": as_float(runner.get("last_split_time")),
        **({"chip_start_seconds": as_float(runner.get("chip_start_seconds"))}
           if "chip_start_seconds" in runner else {}),
        "estimated_finish_seconds": as_float(runner.get("estimated_finish_seconds")),
        "goal_time_seconds": as_float(runner.get("goal_time_seconds")),
        "overall_place": None if anonymous else runner.get("gun_place") or runner.get("chip_place"),
        "has_gps": bool(runner.get("has_gps")),
        "checkpoint_passages": [],
        "checkpoint_passages_status": "unavailable",
        "checkpoint_passages_stale": False,
    }


def parse_recorded_at(value: Any) -> dt.datetime | None:
    return parse_timestamp(value)


def deduplicate_records(rows: list[dict[str, Any]], id_key: str) -> dict[int, dict[str, Any]]:
    """Keep one observation per ID, but union privacy and terminal evidence."""
    output: dict[int, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = as_int(row.get(id_key))
        if key is None:
            continue
        previous = output.get(key)
        if previous is None:
            output[key] = dict(row)
            continue
        anonymous = any(record.get(flag) for record in (previous, row)
                        for flag in ("is_anonymous", "athlete_anonymous"))
        if id_key == "runner_id":
            minimum = dt.datetime.min.replace(tzinfo=dt.timezone.utc)
            chosen = max((previous, row), key=lambda r: parse_recorded_at(r.get("recorded_at")) or minimum)
        else:
            def evidence(record: dict[str, Any]) -> tuple:
                return (runner_status(record, 0) not in {"ON COURSE", "REGISTERED"},
                        as_int(record.get("last_split_index")) if as_int(record.get("last_split_index")) is not None else -1,
                        as_float(record.get("last_split_time")) or 0)
            chosen = max((previous, row), key=evidence)
        output[key] = {**chosen, "is_anonymous": bool(anonymous)}
        for record in (previous, row):
            status = runner_status(record, 0)
            if status not in {"ON COURSE", "REGISTERED"}:
                output[key]["status"] = status
    return output


def checkpoint_observation(clean: dict[str, Any], start: dt.datetime | None, now: dt.datetime) -> dt.datetime | None:
    index, elapsed = clean["last_split_index"], clean["last_split_time"]
    if index is None or index < 0 or elapsed is None or elapsed < 0 or (index > 0 and elapsed == 0):
        return None
    observed = after_seconds(runner_start_utc(clean, start), elapsed)
    return observed if observed is not None and observed <= now else None


@functools.lru_cache(maxsize=16)
def terrain_profile(cumulative: tuple, elevations: tuple):
    """Immutable course geometry is shared across runners and warm polls."""
    return build_profile(list(cumulative), list(elevations))


def validate_history_payload(payload: Any) -> str | None:
    """Bulk results have no pagination contract; incomplete is not complete."""
    if not isinstance(payload, dict) or payload.get("status") not in (None, "ok"):
        return "history: malformed"
    rows = payload.get("results")
    if not isinstance(rows, list):
        return "history: malformed"
    ids = [as_int(row.get("id")) if isinstance(row, dict) else None for row in rows]
    if None in ids or len(set(ids)) != len(ids):
        return "history: invalid or duplicate ids"
    if payload.get("has_more") is True:
        return "history: incomplete"
    for field in ("total", "total_count", "count"):
        if field in payload and as_int(payload[field]) != len(ids):
            return "history: conflicting total"
    return None


def checkpoint_history(record: dict | None, runner: dict, race_clock: float) -> tuple[list, str]:
    """Keep chip elapsed intact: split zero is an offset, not elapsed pace."""
    index, elapsed = as_int(runner.get("last_split_index")), as_float(runner.get("last_split_time"))
    fallback = [(0, 0.0), (index, elapsed)]
    if record is None:
        return fallback, "missing"
    offset = as_float(runner.get("chip_start_seconds"))
    history_offset = as_float(record.get("chip_start_seconds"))
    history_time = as_float(record.get("last_split_time"))
    if (as_int(record.get("id")) != as_int(runner.get("id"))
            or offset is None or history_offset is None or abs(offset - history_offset) > .01
            or as_int(record.get("last_split_index")) != index or history_time is None
            or elapsed is None or abs(history_time - elapsed) > .01):
        return fallback, "mismatch"
    splits = record.get("splits")
    if not isinstance(splits, list):
        return fallback, "malformed"
    output, previous = [(0, 0.0)], -1
    for split in splits:
        if not isinstance(split, dict):
            return fallback, "malformed"
        i, t = as_int(split.get("split_index")), as_float(split.get("elapsed_seconds"))
        if i is None or t is None or i <= previous or i < 0 or i > index or t < 0:
            return fallback, "malformed"
        previous = i
        if i == 0:
            if abs(t - offset) > .01:
                return fallback, "mismatch"
            continue
        if t <= output[-1][1] or t > race_clock or t > elapsed + .01:
            return fallback, "malformed"
        output.append((i, t))
    if output[-1][0] != index or abs(output[-1][1] - elapsed) > .01:
        return fallback, "mismatch"
    output[-1] = (index, elapsed)  # Leaderboard remains authoritative.
    if len(output) < 2 or output[-1][1] <= output[-2][1]:
        return fallback, "malformed"
    return output, "matched"


def checkpoint_passages(record: dict | None, runner: dict, split_count: int,
                        start: dt.datetime | None, now: dt.datetime,
                        history_status: str, timing_stale: bool = False) -> dict[str, Any]:
    """Public observations, not the estimator's virtual start/pace anchors.

    A recorded history is contiguous through the latest read, not necessarily
    through Finish. Bad/unavailable history retains only the leaderboard read;
    an absent Start split is never filled from an offset alone.
    """
    stale = bool(timing_stale or history_status == "stale")

    def result(rows: list, complete: bool = False) -> dict[str, Any]:
        return {"checkpoint_passages": rows,
                "checkpoint_passages_status": "recorded" if complete else "partial" if rows else "unavailable",
                "checkpoint_passages_stale": stale}

    index, elapsed = as_int(runner.get("last_split_index")), as_float(runner.get("last_split_time"))
    if (runner.get("status") in {"DNS", "REGISTERED"} or index is None or not 0 <= index < split_count
            or elapsed is None or elapsed < 0 or (index > 0 and elapsed == 0)
            or after_seconds(now, elapsed) is None or (start is not None and start > now)):
        return result([])
    # No legacy zero default here: offset absence is unknown in every caller.
    offset = as_float(runner.get("chip_start_seconds"))
    if offset is not None and offset < 0:
        offset = None
    chip_start = after_seconds(start, offset)
    if start is not None and offset is not None and (chip_start is None or chip_start > now):
        return result([])
    # Even an unknown nonnegative offset cannot make a future event-clock read
    # possible. With no actual clock, keep proven chip elapsed but no wall time.
    clock = (now - (chip_start or start)).total_seconds() if start is not None else None
    if index > 0 and clock is not None and elapsed > clock:
        return result([])

    def start_read(value: float) -> bool:
        return offset is not None and (value == 0 or abs(value - offset) <= .01)

    def row(i: int, seconds: float) -> dict[str, Any]:
        return {"split_index": i, "elapsed_seconds": seconds,
                "passed_at": timestamp(after_seconds(chip_start, seconds))}

    if index == 0 and (chip_start is None or not start_read(elapsed)):
        return result([])
    fallback = result([row(index, 0.0 if index == 0 else elapsed)])
    if history_status != "fresh" or timing_stale or not isinstance(record, dict):
        return fallback
    history_offset, history_time = as_float(record.get("chip_start_seconds")), as_float(record.get("last_split_time"))
    runner_id = as_int(runner.get("id"))
    if (runner_id is None or as_int(record.get("id")) != runner_id
            or offset is None or history_offset is None or history_offset < 0 or abs(history_offset - offset) > .01
            or as_int(record.get("last_split_index")) != index or history_time is None or history_time < 0
            or abs(history_time - elapsed) > .01):
        return fallback
    splits = record.get("splits")
    if not isinstance(splits, list) or not splits:
        return fallback
    observed, previous_index, previous_time = [], -1, -1.0
    for split in splits:
        if not isinstance(split, dict):
            return fallback
        i, seconds = as_int(split.get("split_index")), as_float(split.get("elapsed_seconds"))
        if i is None or not previous_index < i <= index or seconds is None or seconds < 0:
            return fallback
        if i == 0:
            if not start_read(seconds):
                return fallback
            seconds = 0.0
        elif seconds <= previous_time or seconds <= 0 or seconds > elapsed + .01 or (clock is not None and seconds > clock):
            return fallback
        if i == index:
            latest = 0.0 if index == 0 else elapsed
            if abs(seconds - latest) > .01 or latest <= previous_time:
                return fallback
            seconds = latest  # Leaderboard remains authoritative.
        previous_index, previous_time = i, seconds
        if i > 0 or chip_start is not None:
            observed.append(row(i, seconds))
    if previous_index != index:
        return fallback
    return result(observed, complete=len(observed) == index + 1)


def build_event_view(bundle: dict[str, Any], now: dt.datetime, include_course: bool) -> dict[str, Any]:
    now = now.astimezone(dt.timezone.utc)
    event_response = bundle["event_response"]
    event = event_response.get("event") or {}
    label = EVENT_LABELS.get(event.get("id"), event.get("display_name") or event.get("name") or "Race")
    maps = (bundle.get("course_response") or {}).get("courseMaps") or []
    matching = [m for m in maps if isinstance(m, dict)
                and (m.get("eventId") or m.get("event_id")) == event.get("id")]
    # A single untagged legacy course is compatible; never guess among routes.
    if not matching and len(maps) == 1 and isinstance(maps[0], dict) and not (maps[0].get("eventId") or maps[0].get("event_id")):
        matching = maps
    course = matching[0] if len(matching) == 1 else {}
    track = []
    for point in course.get("trackPoints") or []:
        location = coordinate(point.get("lat"), point.get("lng")) if isinstance(point, dict) else None
        if location is None:
            track = []  # Do not silently connect a gap across an invalid route point.
            break
        elevation = as_float(point.get("ele"))
        track.append({"lat": location[0], "lng": location[1], **({"ele": elevation} if elevation is not None else {})})
    route = prepare_route(tuple((p["lat"], p["lng"]) for p in track))
    cumulative, total = list(route.cumulative), route.total
    progresses = split_progresses(event_response, course, track, cumulative, total)
    profile = terrain_profile(tuple(cumulative), tuple(p.get("ele") for p in track)) if TERRAIN_PILOT_ENABLED else None
    history_status = bundle.get("history_status", "not_loaded")
    history_fetched_at = bundle.get("history_fetched_at")
    history_error = bundle.get("history_error")
    if history_status == "fresh":
        fetched = parse_timestamp(history_fetched_at)
        if fetched is None or not 0 <= (now - fetched).total_seconds() < HISTORY_TTL_SECONDS:
            history_status, history_error = "stale", "history: stale"
    history_by_id = deduplicate_records(bundle.get("history") or [], "id")
    # Do not let deduplication turn conflicting bulk rows into public history.
    # Keep estimator behavior and privacy/terminal evidence unions unchanged.
    passages_history_status = history_status
    if history_status == "fresh" and (history_error or validate_history_payload({"results": bundle.get("history") or []})):
        passages_history_status = "unavailable"
    finish_index = max(0, len(progresses) - 1)
    split_names = list(event.get("split_names") or [])
    start = event_start_utc(event, actual_only=True)
    degraded = bool(bundle.get("upstream_stale") or bundle.get("errors"))
    source_freshness = {name: dict(state) for name, state in (bundle.get("source_freshness") or {}).items()}
    for state in source_freshness.values():
        fetched = parse_timestamp(state.get("fetched_at"))
        ttl = as_float(state.get("ttl_seconds"))
        age = (now - fetched).total_seconds() if fetched else None
        # Cache refresh TTLs stay unchanged; allow only bounded assembly latency.
        if age is None or age < 0 or ttl is None or ttl <= 0 or age >= ttl + SOURCE_ASSEMBLY_GRACE_SECONDS:
            state["stale"] = True
    degraded = degraded or any(s.get("stale") or s.get("error") for s in source_freshness.values())
    timing_stale = any(source_freshness.get(name, {}).get("stale") or source_freshness.get(name, {}).get("error")
                       for name in ("event", "leaderboard")) if source_freshness else degraded

    leaderboard = deduplicate_records(bundle.get("leaderboard") or [], "id")
    # Mixed/late-wave in-memory bundles also cannot treat a missing runner
    # offset as zero merely because a legacy caller bypassed live ingestion.
    if any("chip_start_seconds" in runner for runner in leaderboard.values()):
        leaderboard = {key: {**runner, "chip_start_seconds": runner.get("chip_start_seconds")}
                       for key, runner in leaderboard.items()}
    gps_by_id = deduplicate_records((bundle.get("gps_response") or {}).get("positions") or [], "runner_id")
    runners, positions = [], []
    for runner_id in dict.fromkeys([*leaderboard, *gps_by_id]):
        gps = gps_by_id.get(runner_id)
        raw = leaderboard.get(runner_id) or {"id": runner_id, "name": (gps or {}).get("runner_name"),
                                             "bib": (gps or {}).get("bib"), "has_gps": True}
        evidence = (raw, gps or {}, history_by_id.get(runner_id) or {})
        anonymous = any(record.get(flag) for record in evidence
                        for flag in ("is_anonymous", "athlete_anonymous"))
        raw = {**raw, "is_anonymous": bool(anonymous)}
        for record in evidence:
            status = runner_status(record, finish_index)
            if status not in {"ON COURSE", "REGISTERED"}:
                raw["status"] = status
        clean = sanitize_runner({**raw, "is_anonymous": bool(anonymous)}, finish_index)
        clean.update(event_id=event.get("id"), course=label, has_gps=gps is not None or clean["has_gps"])
        if runner_id not in leaderboard and clean["status"] in {"ON COURSE", "REGISTERED"}:
            clean["status"] = "GPS"
        clean.update(checkpoint_passages(history_by_id.get(runner_id), clean, len(split_names),
                                         start, now, passages_history_status, timing_stale))
        runners.append(clean)
        index = clean["last_split_index"]
        observation = checkpoint_observation(clean, start, now)
        interval = None
        if index is not None and 0 <= index < len(progresses) - 1:
            lower, upper = progresses[index:index + 2]
            if lower is not None and upper is not None and 0 <= lower < upper <= 1:
                interval = (lower, upper)

        reason = None
        if clean["status"] != "ON COURSE":
            reason = "NOT_ON_COURSE"
        elif start is None or start > now:
            reason = "EVENT_NOT_STARTED"
        elif str(event.get("course_status") or "active").lower() not in {"active", "started", "in_progress"}:
            reason = "EVENT_NOT_ACTIVE"
        elif observation is None:
            reason = "INVALID_CHECKPOINT_TIME"
        elif degraded:
            reason = "UPSTREAM_STALE"
        elif total <= 0:
            reason = "ROUTE_UNAVAILABLE"
        elif interval is None:
            reason = "CHECKPOINT_INTERVAL_UNAVAILABLE"

        # On failure return the last observed checkpoint, not time-driven motion.
        projection = None
        terrain = None
        row_history_status = history_status
        chip_start = runner_start_utc(clean, start) if "chip_start_seconds" in clean else None
        if (profile is not None and chip_start is not None and observation is not None
                and clean["status"] == "ON COURSE" and index is not None and index > 0 and interval):
            clock = ((observation if degraded else now) - chip_start).total_seconds()
            history = [(0, 0.0), (index, clean["last_split_time"])]
            if history_status == "fresh":
                history, row_history_status = checkpoint_history(history_by_id.get(runner_id), clean, clock)
            terrain = predict(profile, progresses, history, index, clean["last_split_time"], clock)
            if terrain is not None and after_seconds(chip_start, terrain.finish_seconds) is not None:
                projection = (progresses[index] if degraded else terrain.progress, terrain.finish_seconds, terrain.overdue)
            else:
                terrain = None
        if projection is None:
            projection = projected_progress(raw, event_response, progresses, observation if degraded and observation else now)
        row = {**clean, "remaining_m": None, "distance_source": None, "rank_eligible": False,
               "rank_exclusion": reason, "eta_at": None, "eta_basis": None, "observation_at": None,
               "checkpoint_forecasts": [], "checkpoint_forecast_basis": None,
               "progress": None, "last_checkpoint": split_names[index] if index is not None and 0 <= index < len(split_names) else None}
        if terrain is not None:
            row.update(estimate_model=TERRAIN_MODEL, estimate_basis="TERRAIN_CHECKPOINT_PILOT",
                       pace_basis=terrain.pace_basis, pace_segments_used=terrain.pace_segments_used,
                       pace_window_seconds=terrain.pace_window_seconds, checkpoint_history_status=row_history_status)
        if gps is not None:
            location = coordinate(gps.get("latitude"), gps.get("longitude"))
            if location is None:
                continue  # GPS precedence: an invalid fix is never replaced with an estimate.
            recorded = parse_recorded_at(gps.get("recorded_at"))
            age = (now - recorded).total_seconds() if recorded else None
            fresh = age is not None and 0 <= age <= FRESH_GPS_SECONDS and not degraded
            accuracy = as_float(gps.get("accuracy"))
            along, match_error = match_route(location, route, *interval, accuracy_m=accuracy) if interval and total > 0 else (None, "ROUTE_UNAVAILABLE")
            if along is not None:
                row.update(progress=along / total, remaining_m=max(0.0, total - along), distance_source="GPS_MATCHED")
            row.update(lat=location[0], lng=location[1], source="GPS", freshness="LIVE" if fresh else "STALE",
                       recorded_at=timestamp(recorded), observation_at=timestamp(recorded),
                       age_seconds=round(age) if age is not None else None,
                       accuracy_m=accuracy, speed_mps=as_float(gps.get("speed")),
                       heading=as_float(gps.get("heading")), battery_pct=as_float(gps.get("battery_pct")))
            if not reason:
                if recorded is None:
                    reason = "INVALID_GPS_TIME"
                elif age < 0:
                    reason = "FUTURE_GPS_TIME"
                elif age > FRESH_GPS_SECONDS:
                    reason = "STALE_GPS"
                elif observation and recorded < observation:
                    reason = "GPS_BEFORE_CHECKPOINT"
                elif gps.get("accuracy") is not None and accuracy is None:
                    reason = "GPS_INACCURATE"
                else:
                    reason = match_error
        else:
            if projection is None or total <= 0:
                continue
            progress, duration, overdue = projection
            location = interpolate_route(track, cumulative, total, progress)
            if location is None:
                continue
            capped = interval is not None and progress >= interval[0] + (interval[1] - interval[0]) * .99
            held = overdue or degraded or capped
            row.update(lat=location[0], lng=location[1], source="ESTIMATED", freshness="STALE" if degraded else "ESTIMATED",
                       recorded_at=None, observation_at=timestamp(observation),
                       age_seconds=round((now - observation).total_seconds()) if observation else None,
                       accuracy_m=None, speed_mps=None, heading=None, battery_pct=None,
                       progress=progress, remaining_m=max(0.0, total * (1 - progress)), distance_source="SPLIT_ESTIMATE",
                       projected_finish_seconds=duration, estimate_overdue=overdue, estimate_held=held,
                       estimate_basis="TERRAIN_CHECKPOINT_PILOT" if terrain else
                       "CHECKPOINT_PACE_CHIP" if "chip_start_seconds" in clean else "LEGACY_EVENT_CLOCK")
            if not reason and overdue:
                reason = "ESTIMATE_OVERDUE"
            if not reason and held:
                reason = "ESTIMATE_HELD"
            if not reason and (index is None or index == 0):
                reason = "UNSUPPORTED_PROJECTION"

        row.update(rank_eligible=reason is None, rank_exclusion=reason)
        # Timing must be supported by a non-start checkpoint, not a goal alone.
        if reason is None and projection and not projection[2] and index is not None and index > 0:
            eta = after_seconds(runner_start_utc(clean, start), projection[1])
            if eta is not None and eta > now:
                row["eta_at"] = timestamp(eta)
                row["eta_basis"] = "TERRAIN_CHECKPOINT_PILOT" if terrain else "CHECKPOINT_PACE_CHIP" if "chip_start_seconds" in clean else "LEGACY_EVENT_CLOCK"
                if terrain is not None and not row.get("estimate_held"):
                    next_at = after_seconds(chip_start, terrain.next_checkpoint_seconds)
                    if next_at is not None and next_at > now:
                        row["next_checkpoint_at"] = timestamp(next_at)
                if chip_start is not None and not row.get("estimate_held"):
                    forecasts = checkpoint_forecasts(event_response, progresses, index,
                        clean["last_split_time"], projection[1], terrain, chip_start, now)
                    if forecasts:
                        row.update(checkpoint_forecasts=forecasts, checkpoint_forecast_basis=row["eta_basis"],
                                   next_checkpoint_at=forecasts[0]["estimated_at"])
        positions.append(row)

    view: dict[str, Any] = {
        "id": event.get("id"), "label": label, "display_name": event.get("display_name") or label,
        "event_date": str(event.get("event_date") or "")[:10] or None,
        "start_time": event.get("start_time") or event.get("estimated_start_time"),
        "start_at": timestamp(start), "timezone": event.get("timezone") or "America/Denver",
        "course_status": event.get("course_status") or "unknown",
        "distance_miles": as_float(event.get("course_distance_miles")), "route_length_m": total if total > 0 else None,
        "split_names": split_names, "color": course.get("color") or "#ff6b35",
        "runners": runners, "positions": positions, "upstream_stale": degraded,
        "source_freshness": source_freshness, "errors": bundle.get("errors") or [],
        "estimator": {"model": TERRAIN_MODEL, "terrain_ready": profile is not None,
                      "enabled": TERRAIN_PILOT_ENABLED, "history_status": history_status,
                      "history_fetched_at": history_fetched_at, "history_error": history_error,
                      "historical_baseline": "not_applied",
                      **({"elevation_gain_m": profile.gain_m, "elevation_loss_m": profile.loss_m} if profile else {})},
    }
    if include_course:
        view["course"] = {
            "track_points": track,
            "split_points": [{"lat": p["lat"], "lng": p["lng"], "name": str(p.get("name") or "")}
                             for p in course.get("splitPoints") or []
                             if isinstance(p, dict) and coordinate(p.get("lat"), p.get("lng")) is not None],
            "progress_points": progresses,
        }
    return view


def load_leaderboard(event_id: str) -> tuple[list[dict[str, Any]], bool]:
    output: dict[int, dict[str, Any]] = {}
    offset, stale = 0, False
    totals: set[int] = set()
    while offset < MAX_LEADERBOARD_RECORDS:
        try:
            payload, was_stale = upstream_json(
                f"/events/{urllib.parse.quote(event_id)}/leaderboard?limit=500&offset={offset}",
                LEADERBOARD_TTL_SECONDS,
            )
        except Exception:
            if not output:
                raise
            return list(output.values()), True
        stale = stale or was_stale
        batch = payload.get("leaderboard") or []
        if not isinstance(batch, list):
            raise RuntimeError("leaderboard was not a list")
        before = len(output)
        output = deduplicate_records([*output.values(), *batch], "id")
        offset += len(batch)
        for field in ("total", "total_count"):
            if field in payload:
                total = as_int(payload[field])
                if total is None or total < 0:
                    stale = True
                else:
                    totals.add(total)
        more = payload.get("has_more")
        count = len(output)
        # Totals remain hard assertions across pages, including zero and aliases.
        stale = stale or len(totals) > 1 or any(count > total for total in totals)
        if more is True:
            stale = stale or any(count >= total for total in totals)
        elif more is False or (totals and count >= max(totals)):
            stale = stale or any(count != total for total in totals)
            break
        if not batch or len(output) == before:
            stale = stale or bool(batch) or more is True or any(count != total for total in totals)
            break
        if len(batch) < 500 and more is not True and not totals:
            break
    else:
        stale = True  # A capped or ignored-pagination response is incomplete.
    return list(output.values()), stale


def load_checkpoint_history(event_id: str) -> dict[str, Any]:
    # Recorded passage display is independent of the optional terrain model.
    history = []
    path = f"/events/{urllib.parse.quote(event_id)}/results"
    try:
        payload, stale = upstream_json(path, HISTORY_TTL_SECONDS)
        # Preserve privacy/terminal evidence even if timing is unusable.
        if isinstance(payload, dict) and isinstance(payload.get("results"), list):
            history = [row for row in payload["results"] if isinstance(row, dict)]
        error = validate_history_payload(payload)
        status = "unavailable" if error else "stale" if stale else "fresh"
        if stale and not error:
            error = "history: stale"
    except Exception:
        status, error = "unavailable", "history: unavailable"
    fetched_at = CACHE.source_fetched_at(UPSTREAM + path)
    return {"history": history, "history_status": status,
            "history_error": error, "history_fetched_at": fetched_at}


def load_event_bundle(event_id: str, history_bundle: dict | None = None) -> dict[str, Any]:
    errors: list[str] = []
    source_freshness: dict[str, dict[str, Any]] = {}
    quoted = urllib.parse.quote(event_id)

    def fetch(source: str, path: str, ttl: int, fallback: Any) -> Any:
        try:
            value, stale = load_leaderboard(event_id) if source == "leaderboard" else upstream_json(path, ttl)
            # Both cached fallback and partial pagination need a public signal,
            # but never include arbitrary upstream exceptions or response bodies.
            error = f"{source}: stale or incomplete" if stale else None
            if error:
                errors.append(error)
            source_freshness[source] = {"fetched_at": CACHE.source_fetched_at(UPSTREAM + path),
                                        "stale": bool(stale), "error": error, "ttl_seconds": ttl}
            return value
        except Exception:
            # Never relay arbitrary upstream text or participant payloads as errors.
            error = f"{source}: unavailable"
            errors.append(error)
            source_freshness[source] = {"fetched_at": CACHE.source_fetched_at(UPSTREAM + path),
                                        "stale": True, "error": error, "ttl_seconds": ttl}
            return fallback

    if history_bundle is None:
        history_bundle = load_checkpoint_history(event_id)
    # Finish optional work before all core freshness-sensitive fetches.
    event_response = fetch("event", f"/events/{quoted}", EVENT_TTL_SECONDS, {"event": {"id": event_id}})
    course_response = fetch("course", f"/course-maps/event/{quoted}?include=points", COURSE_TTL_SECONDS, {})
    gps_response = fetch("gps", f"/gps/locations/{quoted}", GPS_TTL_SECONDS, {})
    leaderboard = fetch("leaderboard", f"/events/{quoted}/leaderboard?limit=500&offset=0", LEADERBOARD_TTL_SECONDS, [])
    # The upstream UI defaults missing chip offsets to zero for display only;
    # that cannot prove a late-wave runner's wall-clock start. Preserve unknown
    # explicitly at ingestion so every live projection fails closed.
    leaderboard = [{**runner, "chip_start_seconds": runner.get("chip_start_seconds")}
                   for runner in leaderboard]
    return {
        "event_response": event_response, "course_response": course_response,
        "gps_response": gps_response, "leaderboard": leaderboard,
        "upstream_stale": any(s["stale"] for s in source_freshness.values()),
        "source_freshness": source_freshness, "errors": errors,
        **history_bundle,
    }


def build_payload(include_courses: bool = False, now: dt.datetime | None = None) -> dict[str, Any]:
    requested_now = now
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(EVENTS)) as executor:
        # Complete optional history for EVERY event before fetching any core
        # snapshot. Otherwise one race's slow history can age another's GPS.
        history_futures = {event_id: executor.submit(load_checkpoint_history, event_id) for event_id, _ in EVENTS}
        histories = {event_id: future.result() for event_id, future in history_futures.items()}
        futures = {event_id: executor.submit(load_event_bundle, event_id, histories[event_id]) for event_id, _ in EVENTS}
        bundles = [(event_id, futures[event_id].result()) for event_id, _ in EVENTS]
    now = (requested_now or utc_now()).astimezone(dt.timezone.utc)
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
        public = {"index.html", "styles.css", "app.js", "race-logic.js", "elevation-profile.js", "config.js", "favicon.svg",
                  "rut-2026-aid-chart.png",
                  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/leaflet/LICENSE"}
        resolved_relative = candidate.relative_to(APP_ROOT).as_posix()
        image_asset = resolved_relative.startswith("vendor/leaflet/images/") and candidate.suffix.lower() in {".png", ".svg"}
        if resolved_relative not in public and not image_asset:
            self.send_error(404)
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
