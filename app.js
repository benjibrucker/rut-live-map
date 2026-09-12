(() => {
  "use strict";

  const ACTIVE_FILTER = "active";
  const ALL_FILTER = "all";
  const DIRECTOR_INTERVAL_SECONDS = 18;
  const STATIC_SITE = window.location.hostname.endsWith(".github.io") || new URLSearchParams(window.location.search).has("static");
  const API_BASE = STATIC_SITE ? String(window.RUT_CONFIG?.apiBase || "").replace(/\/$/, "") : "";
  const LIVE_API = !STATIC_SITE || Boolean(API_BASE);
  const POLL_SECONDS = LIVE_API ? 15 : 60;
  const BOOTSTRAP_URL = LIVE_API ? `${API_BASE}/api/bootstrap` : "data/bootstrap.json";
  const LIVE_URL = LIVE_API ? `${API_BASE}/api/live` : "data/live.json";
  const state = {
    map: null,
    viewMode: "map",
    profileCache: new WeakMap(),
    tileLayer: null,
    tileFallbackUsed: false,
    tileErrors: 0,
    tileReady: false,
    tileWatchdog: null,
    courses: new Map(),
    eventData: new Map(),
    runners: [],
    positions: new Map(),
    snapshotPositions: [],
    markers: new Map(),
    filter: ACTIVE_FILTER,
    selectedKey: null,
    manualLock: false,
    directorMode: "AUTO",
    directorStep: 0,
    directorDeadline: 0,
    refreshPending: false,
    lastSuccessAt: 0,
    feedGeneratedAt: 0,
    finishEventId: null,
    loaded: false,
    feedError: null,
    delivery: null,
    followSelected: true,
    summary: { live_gps: 0, stale_gps: 0, estimated: 0, positions: 0, errors: 0, upstream_stale: false },
  };

  const el = {};
  const byId = (id) => document.getElementById(id);
  const keyFor = (eventId, runnerId) => `${eventId}:${runnerId}`;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
  const normalize = (value) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const finite = window.RutRules.finite;

  function collectElements() {
    [
      "app", "connectionDot", "connectionText", "mountainTime", "fullscreenButton", "courseBar",
      "positionCount", "runnerSearch", "clearSearch", "searchResults", "directorMode", "directorCountdown",
      "leaderButton", "randomButton", "fieldButton", "resumeButton", "liveGpsCount", "estimatedCount",
      "staleGpsCount", "runnerCard", "runnerCardEmpty", "runnerCardContent", "runnerKicker", "runnerName",
      "sourceBadge", "sourceMessage", "runnerStatus", "runnerCheckpoint", "runnerProgress", "runnerFinish",
      "runnerLocation", "releaseButton", "loadingOverlay", "toast",
      "finishToggle", "finishPanel", "finishRace", "finishCount", "finishList", "finishStatus", "finishExcluded",
      "mapNotice", "mapNoticeText", "retryMap", "mapRepairButton", "mapCanvas",
      "mapViewButton", "elevationViewButton", "elevationPanel", "elevationTitle", "elevationSubtitle",
      "elevationChart", "elevationSummary", "elevationCheckpoints", "elevationRunner", "elevationNote",
    ].forEach((id) => { el[id] = byId(id); });
  }

  function initMap() {
    state.map = L.map("mapCanvas", {
      zoomControl: false,
      preferCanvas: false,
      minZoom: 5,
      maxZoom: 18,
      zoomSnap: 0.5,
    });
    L.control.zoom({ position: "bottomright" }).addTo(state.map);
    state.map.setView([45.282, -111.418], 13);
    state.map.on("dragstart", () => { state.followSelected = false; });
    installTileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", "© OpenStreetMap contributors");
    state.map.createPane("courseUnderlay");
    state.map.getPane("courseUnderlay").style.zIndex = "390";
    state.map.createPane("courseLines");
    state.map.getPane("courseLines").style.zIndex = "400";
    state.map.createPane("runnerDots");
    state.map.getPane("runnerDots").style.zIndex = "620";
    state.map.createPane("selectedRunner");
    state.map.getPane("selectedRunner").style.zIndex = "660";
  }

  function repairMap() {
    state.map?.invalidateSize({pan:false});
    if (state.map && !state.map._loaded) state.map.setView([45.282, -111.418], 13);
  }

  function installTileLayer(url, attribution) {
    if (state.tileLayer) state.map.removeLayer(state.tileLayer);
    clearTimeout(state.tileWatchdog);
    state.tileErrors = 0;
    state.tileReady = false;
    state.tileLayer = L.tileLayer(url, {
      attribution,
      maxZoom: 18,
      // Display-only tiles do not need CORS permission.
      crossOrigin: false,
    });
    const layer = state.tileLayer;
    const unavailable = () => {
      if (state.tileLayer !== layer || state.tileReady) return;
      if (!state.tileFallbackUsed) {
        state.tileFallbackUsed = true;
        installTileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", "Map data © OpenStreetMap · Style © OpenTopoMap");
      } else {
        el.mapNotice.hidden = false;
        el.mapNoticeText.textContent = "Background map unavailable. Course outlines still work.";
      }
    };
    layer.on("tileload", () => {
      if (state.tileLayer !== layer) return;
      state.tileReady = true;
      clearTimeout(state.tileWatchdog);
      el.mapNotice.hidden = true;
    });
    layer.on("loading", () => {
      if (state.tileLayer !== layer) return;
      state.tileReady = false;
      clearTimeout(state.tileWatchdog);
      state.tileWatchdog = setTimeout(unavailable, 12000);
    });
    state.tileWatchdog = setTimeout(unavailable, 12000);
    state.tileLayer.on("tileerror", () => {
      state.tileErrors += 1;
      if (state.tileErrors >= 3) unavailable();
    });
    state.tileLayer.addTo(state.map);
  }

  function courseLayer(event) {
    const points = event.course?.track_points || [];
    if (!points.length) return null;
    const latLngs = points.map((point) => [point.lat, point.lng]);
    const group = L.layerGroup();
    L.polyline(latLngs, {
      pane: "courseUnderlay",
      color: "#061019",
      opacity: 0.72,
      weight: 8,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(group);
    L.polyline(latLngs, {
      pane: "courseLines",
      color: event.color,
      opacity: 0.94,
      weight: 4,
      lineCap: "round",
      lineJoin: "round",
      interactive: false,
    }).addTo(group);
    (event.course?.split_points || []).forEach((split, index) => {
      if (!finite(split.lat) || !finite(split.lng)) return;
      const checkpoint = L.circleMarker([split.lat, split.lng], {
        pane: "courseLines",
        radius: index === 0 || index === (event.course?.split_points || []).length - 1 ? 5 : 3,
        color: "#061019",
        weight: 2,
        fillColor: event.color,
        fillOpacity: 1,
      });
      checkpoint.bindTooltip(`${escapeHtml(event.label)} · ${escapeHtml(split.name || `Checkpoint ${index}`)}`, {
        direction: "top",
        className: "runner-tooltip",
      });
      checkpoint.addTo(group);
    });
    group._rutBounds = L.latLngBounds(latLngs);
    return group;
  }

  function buildCourses(events) {
    state.courses.forEach((layer) => state.map.removeLayer(layer));
    state.courses.clear();
    events.forEach((event) => {
      const layer = courseLayer(event);
      if (layer) state.courses.set(event.id, layer);
    });
    renderCourseBar();
    applyCourseVisibility(true);
  }

  function activeEventIds() {
    return new Set([...state.eventData.values()].filter(e=>window.RutRules.racePhase(e)==="racing").map(e=>e.id));
  }

  function visibleEventIds() {
    if (state.filter === ALL_FILTER) return new Set(state.eventData.keys());
    if (state.filter === ACTIVE_FILTER) {
      if (state.manualLock && state.eventData.has(state.finishEventId)) return new Set([state.finishEventId]);
      const active = activeEventIds();
      if (active.size) return active;
      const next = window.RutRules.preferredRace([...state.eventData.values()]);
      return new Set(next ? [next.id] : []);
    }
    return new Set([state.filter]);
  }

  function renderCourseBar() {
    const activeCount = activeEventIds().size;
    const chips = [
      `<button class="course-chip ${state.filter === ACTIVE_FILTER ? "active" : ""}" data-course="${ACTIVE_FILTER}" type="button">Race day${activeCount ? ` · ${activeCount}` : ""}</button>`,
      ...[...state.eventData.values()].map((event) => `<button class="course-chip ${state.filter === event.id ? "active" : ""}" data-course="${escapeHtml(event.id)}" type="button" style="--course-color:${escapeHtml(event.color)}"><i></i>${escapeHtml(event.label)}</button>`),
      `<button class="course-chip ${state.filter === ALL_FILTER ? "active" : ""}" data-course="${ALL_FILTER}" type="button">All</button>`,
    ];
    el.courseBar.innerHTML = chips.join("");
    el.courseBar.querySelectorAll("[data-course]").forEach((button) => {
      button.addEventListener("click", () => setCourseFilter(button.dataset.course, true));
    });
  }

  function setCourseFilter(filter, fit = false) {
    state.filter = filter;
    if (state.eventData.has(filter)) state.finishEventId = filter;
    if (filter === ACTIVE_FILTER) { state.manualLock = false; syncRaceSelection(); }
    renderCourseBar();
    applyCourseVisibility(fit);
    renderMarkers();
    if (state.selectedKey) {
      const selected = state.positions.get(state.selectedKey) || runnerByKey(state.selectedKey);
      if (selected && !visibleEventIds().has(selected.event_id)) clearSelection(false);
    }
    updateSearchResults();
    renderFinishWatch();
    renderElevation();
  }

  function applyCourseVisibility(fit) {
    const visible = visibleEventIds();
    const bounds = L.latLngBounds();
    state.courses.forEach((layer, eventId) => {
      if (visible.has(eventId)) {
        if (!state.map.hasLayer(layer)) layer.addTo(state.map);
        if (layer._rutBounds) bounds.extend(layer._rutBounds);
      } else if (state.map.hasLayer(layer)) {
        state.map.removeLayer(layer);
      }
    });
    if (fit && bounds.isValid()) {
      state.map.stop();
      state.map.invalidateSize({pan:false});
      state.map.fitBounds(bounds, { padding: [45, 45], maxZoom: 14, animate: false });
    }
  }

  function syncRaceSelection(now = Date.now()) {
    const previous = state.finishEventId;
    if (!previous || (state.filter === ACTIVE_FILTER && !state.manualLock)) {
      state.finishEventId = window.RutRules.preferredRace([...state.eventData.values()], now)?.id || null;
      if (previous && previous !== state.finishEventId) state.selectedKey = null;
    }
    return previous !== state.finishEventId;
  }

  function mergePayload(payload, initial = false) {
    if (!Array.isArray(payload.events) || !payload.events.length) throw new Error("Empty timing response");
    const oldCourses = new Map([...state.eventData.entries()].map(([id, event]) => [id, event.course]));
    state.eventData.clear();
    state.runners = [];
    state.positions.clear();
    (payload.events || []).forEach((event) => {
      if (!event.course && oldCourses.has(event.id)) event.course = oldCourses.get(event.id);
      state.eventData.set(event.id, event);
      (event.runners || []).forEach((runner) => {
        const key = keyFor(event.id, runner.id);
        state.runners.push({ ...runner, key, event_color: event.color });
      });
      (event.positions || []).forEach((position) => {
        const key = keyFor(event.id, position.id);
        state.positions.set(key, { ...position, key, event_color: event.color });
      });
    });
    state.snapshotPositions = [...state.positions.values()].map(p => ({...p}));
    state.summary = payload.summary || state.summary;
    state.lastSuccessAt = Date.now();
    const generatedAt = new Date(payload.generated_at || "").getTime();
    state.feedGeneratedAt = Number.isFinite(generatedAt) ? generatedAt : 0;
    state.delivery = payload.delivery || "live_api";
    state.feedError = null;
    ageAllPositions();
    const raceChanged = syncRaceSelection();
    updateStatus();
    if (initial) buildCourses(payload.events || []);
    else {
      renderCourseBar();
      applyCourseVisibility(raceChanged);
    }
    renderMarkers();
    updateRunnerCard();
    updateSearchResults();
    renderFinishWatch();
    if (state.selectedKey && state.followSelected) {
      const position = state.positions.get(state.selectedKey);
      if (position && finite(position.lat) && finite(position.lng)) state.map.panTo([position.lat, position.lng], {animate: false});
    }
  }

  function markerIcon(position, selected) {
    const sourceClass = position.source === "GPS" ? "gps" : "estimated";
    const freshClass = position.freshness === "LIVE" ? "live" : position.freshness === "STALE" ? "stale" : "";
    return L.divIcon({
      className: "",
      html: `<div class="runner-pin ${sourceClass} ${freshClass} ${selected ? "selected" : ""}" style="--course-color:${escapeHtml(position.event_color)}"></div>`,
      iconSize: selected ? [30, 30] : [18, 18],
      iconAnchor: selected ? [15, 15] : [9, 9],
    });
  }

  function renderMarkers() {
    const visible = visibleEventIds();
    const ordered = [...state.positions.values()]
      .filter((position) => visible.has(position.event_id) && finite(position.lat) && finite(position.lng))
      .sort((a, b) => Number(a.key === state.selectedKey) - Number(b.key === state.selectedKey));
    const wanted = new Set(ordered.map(p => p.key));
    state.markers.forEach((marker, key) => {
      if (!wanted.has(key)) { state.map.removeLayer(marker); state.markers.delete(key); }
    });
    ordered.forEach((position) => {
      const selected = position.key === state.selectedKey;
      const signature = `${position.source}:${position.freshness}:${selected}:${position.event_color}`;
      const existing = state.markers.get(position.key);
      const tooltip = `${escapeHtml(position.name)} · ${escapeHtml(position.course)} · ${escapeHtml(position.freshness)}`;
      if (existing) {
        existing.setLatLng([position.lat, position.lng]);
        if (existing._rutSignature !== signature) existing.setIcon(markerIcon(position, selected));
        existing._rutSignature = signature;
        existing.setZIndexOffset(selected ? 1000 : 0);
        existing.setTooltipContent(tooltip);
        const dom = existing.getElement();
        if (dom) dom.title = `${position.name} · ${position.course} · ${position.source}`;
        if (selected) existing.openTooltip(); else existing.closeTooltip();
        return;
      }
      const marker = L.marker([position.lat, position.lng], {
        pane: "runnerDots",
        zIndexOffset: selected ? 1000 : 0,
        icon: markerIcon(position, selected),
        keyboard: true,
        riseOnHover: true,
        title: `${position.name} · ${position.course} · ${position.source}`,
      });
      marker.bindTooltip(`${escapeHtml(position.name)} · ${escapeHtml(position.course)} · ${escapeHtml(position.freshness)}`, {
        direction: "top",
        offset: [0, -8],
        className: "runner-tooltip",
      });
      marker.on("click", () => selectKey(position.key, true, "MANUAL"));
      marker.addTo(state.map);
      marker._rutSignature = signature;
      state.markers.set(position.key, marker);
      if (selected) marker.openTooltip();
    });
    const count = ordered.length;
    el.positionCount.textContent = `${count.toLocaleString()} position${count === 1 ? "" : "s"}`;
  }

  function runnerByKey(key) {
    return state.runners.find((runner) => runner.key === key) || null;
  }

  function selectKey(key, manual = true, mode = "MANUAL") {
    const record = state.positions.get(key) || runnerByKey(key);
    if (!record) return false;
    if (!visibleEventIds().has(record.event_id)) {
      state.filter = record.event_id;
      renderCourseBar();
      applyCourseVisibility(false);
    }
    state.selectedKey = key;
    state.finishEventId = record.event_id;
    state.followSelected = true;
    state.manualLock = manual;
    state.directorMode = mode;
    if (!manual) state.directorDeadline = Date.now() + DIRECTOR_INTERVAL_SECONDS * 1000;
    renderMarkers();
    updateRunnerCard();
    renderFinishWatch();
    const position = state.positions.get(key);
    if (position && finite(position.lat) && finite(position.lng)) {
      const currentZoom = state.map.getZoom();
      const zoom = Math.max(14.5, Math.min(16, currentZoom));
      if (state.viewMode === "elevation") state.map.setView([position.lat, position.lng], zoom, {animate:false});
      else state.map.flyTo([position.lat, position.lng], zoom, { duration: 1.1 });
      setTimeout(() => state.markers.get(key)?.openTooltip(), 1200);
    } else {
      showToast(`${record.name} has no reliable current location yet.`);
    }
    return true;
  }

  function clearSelection(fit = false) {
    state.selectedKey = null;
    renderMarkers();
    updateRunnerCard();
    if (fit) applyCourseVisibility(true);
  }

  function resumeAuto() {
    state.manualLock = false;
    state.directorMode = "AUTO";
    state.directorStep = 0;
    state.directorDeadline = Date.now();
    directorTick(true);
  }

  function directorCandidates() {
    const visible = visibleEventIds();
    return [...state.positions.values()].filter(position => visible.has(position.event_id)
      && window.RutRules.racePhase(state.eventData.get(position.event_id)) === "racing"
      && (position.status === "ON COURSE" || position.status === "GPS")
      && !position.estimate_held && !position.estimate_overdue
      && (position.source !== "GPS" || position.freshness === "LIVE"));
  }

  function chooseLeader(candidates) {
    return window.RutRules.nearestFinish(candidates, state.finishEventId, Date.now(), state.feedGeneratedAt)[0] || null;
  }

  function chooseFreshGps(candidates) {
    const fresh = candidates.filter((row) => row.source === "GPS" && row.freshness === "LIVE");
    fresh.sort((a, b) => Number(a.age_seconds ?? 999999) - Number(b.age_seconds ?? 999999));
    return fresh[state.directorStep % Math.max(1, fresh.length)] || null;
  }

  function chooseRandom(candidates) {
    if (!candidates.length) return null;
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  function directorTick(force = false) {
    if (state.manualLock || (!force && Date.now() < state.directorDeadline)) return;
    const candidates = directorCandidates();
    if (!candidates.length) {
      clearSelection(false);
      state.directorMode = "AUTO · WAITING";
      state.directorDeadline = Date.now() + DIRECTOR_INTERVAL_SECONDS * 1000;
      updateDirectorUi();
      return;
    }
    const sequence = [
      { name: "AUTO · FRONT", pick: chooseLeader },
      { name: "AUTO · LIVE GPS", pick: chooseFreshGps },
      { name: "AUTO · RANDOM", pick: chooseRandom },
    ];
    let chosen = null;
    let mode = "AUTO";
    for (let attempts = 0; attempts < sequence.length; attempts += 1) {
      const step = sequence[state.directorStep % sequence.length];
      state.directorStep += 1;
      chosen = step.pick(candidates);
      mode = step.name;
      if (chosen) break;
    }
    if (chosen) selectKey(chosen.key, false, mode);
    state.directorDeadline = Date.now() + DIRECTOR_INTERVAL_SECONDS * 1000;
    updateDirectorUi();
  }

  function updateDirectorUi() {
    el.directorMode.textContent = state.directorMode;
    el.directorMode.classList.toggle("hold", state.manualLock);
    const seconds = Math.max(0, Math.ceil((state.directorDeadline - Date.now()) / 1000));
    el.directorCountdown.textContent = state.manualLock ? "Selection locked" : `Next ${seconds}s`;
  }

  function formatDuration(seconds) {
    if (!finite(seconds) || Number(seconds) < 0) return "—";
    const total = Math.round(Number(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  function humanAge(seconds) {
    if (!finite(seconds)) return "unknown age";
    const value = Math.max(0, Number(seconds));
    if (value < 60) return `${Math.round(value)}s ago`;
    if (value < 3600) return `${Math.round(value / 60)}m ago`;
    return `${Math.round(value / 3600)}h ago`;
  }

  function updateRunnerCard() {
    renderElevation();
    const runner = state.selectedKey ? (state.positions.get(state.selectedKey) || runnerByKey(state.selectedKey)) : null;
    el.runnerCardEmpty.hidden = Boolean(runner);
    el.runnerCardContent.hidden = !runner;
    if (!runner) {
      const event = state.eventData.get(state.finishEventId);
      const phase = window.RutRules.racePhase(event);
      const title = el.runnerCardEmpty.querySelector("strong");
      const text = el.runnerCardEmpty.querySelector("p");
      title.textContent = phase === "upcoming" ? `Next: ${event.label} · ${scheduledLabel(event)}` : phase === "closed" ? `${event.label} · race closed` : phase === "awaiting" ? `${event.label} · awaiting official start` : "Waiting for runner positions";
      text.textContent = phase === "upcoming" ? "Course preview. Tracking starts when the event feed confirms the start." : phase === "closed" ? "Showing the course and last-known data, not active finish predictions." : "The map is ready. No current runner positions are available in this view.";
      if (event?.estimator?.terrain_ready && phase === "upcoming") text.textContent = "Course preview. Terrain pace pilot starts after valid runner check-ins.";
      updateDirectorUi();
      return;
    }
    const position = state.positions.get(runner.key);
    el.runnerKicker.textContent = `${runner.course} · BIB ${runner.bib ?? "—"}${runner.overall_place ? ` · PLACE ${runner.overall_place}` : ""}`;
    el.runnerName.textContent = runner.name;
    const runnerPhase = window.RutRules.racePhase(state.eventData.get(runner.event_id));
    el.runnerStatus.textContent = runnerPhase === "upcoming" || runnerPhase === "awaiting" ? "Awaiting race start" : window.RutRules.statusLabel(runner, state.eventData.get(runner.event_id));
    el.runnerCheckpoint.textContent = position?.last_checkpoint || "—";
    const rawProgressPct = finite(position?.progress) ? Math.round(Number(position.progress) * 100) : null;
    const progressPct = rawProgressPct === null ? null : Math.min(position?.estimate_overdue || position?.estimate_held ? 99 : 100, rawProgressPct);
    el.runnerProgress.textContent = progressPct !== null ? `${progressPct}% est.${position?.estimate_overdue || position?.estimate_held ? " · held" : ""}` : position?.source === "GPS" ? "GPS fix" : "—";
    el.runnerFinish.textContent = formatDuration(position?.projected_finish_seconds ?? ("chip_start_seconds" in runner ? null : runner.estimated_finish_seconds ?? runner.goal_time_seconds));
    el.runnerLocation.textContent = [runner.city, runner.state].filter(Boolean).join(", ") || "Big Sky course";

    el.sourceBadge.className = "source-badge";
    if (!position) {
      el.sourceBadge.textContent = "NO FIX";
      el.sourceBadge.classList.add("stale");
      el.sourceMessage.innerHTML = "No reliable live position yet. The runner remains searchable, but the map will not invent a location.";
    } else if (position.source === "GPS" && position.freshness === "LIVE") {
      el.sourceBadge.textContent = "LIVE GPS";
      const accuracy = finite(position.accuracy_m) ? ` · ±${Math.round(Number(position.accuracy_m))}m` : "";
      el.sourceMessage.innerHTML = `<strong>Measured phone GPS</strong> · updated ${escapeHtml(humanAge(position.age_seconds))}${accuracy}.`;
    } else if (position.source === "GPS") {
      el.sourceBadge.textContent = "STALE GPS";
      el.sourceBadge.classList.add("stale");
      el.sourceMessage.innerHTML = `<strong>Last measured phone GPS</strong> · ${escapeHtml(humanAge(position.age_seconds))}. This dot is not moving until a new fix arrives.`;
    } else if (position.rank_exclusion === "UPSTREAM_STALE") {
      el.sourceBadge.textContent = "EST. HELD";
      el.sourceBadge.classList.add("stale");
      el.sourceMessage.innerHTML = `<strong>Not GPS.</strong> The timing feed is stale. This estimate is held at the last observed checkpoint, ${escapeHtml(position.last_checkpoint || "unknown")}; it is not eligible for finish ranking.`;
    } else if (position.estimate_overdue || position.estimate_held) {
      el.sourceBadge.textContent = "EST. HELD";
      el.sourceBadge.classList.add("estimated");
      el.sourceMessage.innerHTML = `<strong>Not GPS.</strong> No newer chip read arrived, so this estimate is held just before ${escapeHtml(nextCheckpoint(position) || "the next checkpoint")} rather than moving farther without evidence.`;
    } else {
      el.sourceBadge.textContent = position.estimate_basis === "TERRAIN_CHECKPOINT_PILOT" ? "TERRAIN EST." : "ESTIMATED";
      el.sourceBadge.classList.add("estimated");
      el.sourceMessage.innerHTML = `<strong>Not GPS.</strong> ${escapeHtml(window.RutRules.estimateExplanation(position))} From ${escapeHtml(position.last_checkpoint || "the last timing checkpoint")} toward ${escapeHtml(nextCheckpoint(position) || "the next checkpoint")}.`;
    }
    updateDirectorUi();
  }

  function nextCheckpoint(position) {
    const event = state.eventData.get(position.event_id);
    const index = Number(position.last_split_index);
    if (!event || !Number.isInteger(index)) return null;
    return event.split_names?.[index + 1] || null;
  }

  function updateStatus() {
    const age = snapshotAgeSeconds();
    const staleSnapshot = age !== null && age > (state.delivery === "periodic_snapshot" ? 900 : 90);
    const degraded = Boolean(state.feedError) || state.summary.errors > 0 || state.summary.upstream_stale || staleSnapshot;
    el.connectionDot.classList.toggle("connected", !degraded && state.lastSuccessAt > 0);
    el.connectionDot.classList.toggle("degraded", degraded);
    if (state.feedError) el.connectionText.textContent = `Feed interrupted · ${age === null ? "retrying" : humanAge(age)}`;
    else if (degraded) el.connectionText.textContent = staleSnapshot ? `Feed old · ${humanAge(age)}` : "Using partial/stale feed";
    else if (state.delivery === "periodic_snapshot" && age !== null) el.connectionText.textContent = `Snapshot · ${humanAge(age)}`;
    else el.connectionText.textContent = state.lastSuccessAt ? `Live feed · ${humanAge(age)}` : "Connecting";
    el.liveGpsCount.textContent = Number(state.summary.live_gps || 0).toLocaleString();
    el.staleGpsCount.textContent = Number(state.summary.stale_gps || 0).toLocaleString();
    el.estimatedCount.textContent = Number(state.summary.estimated || 0).toLocaleString();
  }

  function snapshotAgeSeconds() {
    if (!state.feedGeneratedAt) return null;
    return Math.max(0, Math.floor((Date.now() - state.feedGeneratedAt) / 1000));
  }

  function updateClock() {
    el.mountainTime.textContent = `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date())} MT`;
    if (ageAllPositions()) renderMarkers();
    updateStatus();
    updateDirectorUi();
    updateRunnerCard();
    renderFinishWatch();
  }

  function ageAllPositions() {
    let changed = false, live = 0, stale = 0, estimated = 0;
    state.positions.forEach((row, key) => {
      const fresh = window.RutRules.refreshPosition(row);
      changed ||= fresh.freshness !== row.freshness;
      state.positions.set(key, fresh);
      if (fresh.source === "GPS") { if (fresh.freshness === "LIVE") live++; else stale++; }
      else estimated++;
    });
    Object.assign(state.summary, {live_gps: live, stale_gps: stale, estimated});
    return changed;
  }

  function updateSearchResults() {
    const query = normalize(el.runnerSearch.value.trim());
    if (!query) {
      el.searchResults.hidden = true;
      el.runnerSearch.setAttribute("aria-expanded", "false");
      return;
    }
    const visible = visibleEventIds();
    const matches = state.runners
      .filter((runner) => normalize(`${runner.name} ${runner.bib ?? ""}`).includes(query))
      .sort((a, b) => {
        const aVisible = visible.has(a.event_id) ? 1 : 0;
        const bVisible = visible.has(b.event_id) ? 1 : 0;
        if (aVisible !== bVisible) return bVisible - aVisible;
        const aLocated = state.positions.has(a.key) ? 1 : 0;
        const bLocated = state.positions.has(b.key) ? 1 : 0;
        if (aLocated !== bLocated) return bLocated - aLocated;
        return String(a.name).localeCompare(String(b.name));
      })
      .slice(0, 10);
    if (!matches.length) {
      el.searchResults.innerHTML = `<div class="no-results">No runner found for “${escapeHtml(el.runnerSearch.value)}”</div>`;
    } else {
      el.searchResults.innerHTML = matches.map((runner) => {
        const position = state.positions.get(runner.key);
        const source = position ? position.freshness : "NO POSITION";
        return `<button class="search-result" type="button" role="option" data-runner-key="${escapeHtml(runner.key)}">
          <span class="result-course" style="--result-color:${escapeHtml(runner.event_color)}">${escapeHtml(runner.course)}</span>
          <span class="result-copy"><strong>${escapeHtml(runner.name)}</strong><span>Bib ${escapeHtml(runner.bib ?? "—")} · ${escapeHtml(window.RutRules.statusLabel(runner, state.eventData.get(runner.event_id)))}</span></span>
          <span class="result-source">${escapeHtml(source)}</span>
        </button>`;
      }).join("");
      el.searchResults.querySelectorAll("[data-runner-key]").forEach((button) => {
        button.addEventListener("click", () => {
          selectKey(button.dataset.runnerKey, true, "MANUAL");
          el.runnerSearch.value = "";
          updateSearchResults();
          el.runnerSearch.blur();
        });
      });
    }
    el.searchResults.hidden = false;
    el.runnerSearch.setAttribute("aria-expanded", "true");
  }

  async function fetchJson(url, timeoutMs = 50000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const target = url.startsWith("data/") ? `${url}?t=${Date.now()}` : url;
      const response = await fetch(target, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function bootstrap() { return refreshLive(); }

  async function refreshLive() {
    if (state.refreshPending) return;
    state.refreshPending = true;
    try {
      const initial = !state.loaded;
      let payload;
      try { payload = await fetchJson(initial ? BOOTSTRAP_URL : LIVE_URL); }
      catch (error) {
        if (!initial || !STATIC_SITE || !API_BASE) throw error;
        payload = await fetchJson("data/bootstrap.json");
        showToast("Live API unavailable. Showing a dated snapshot; retrying the live feed.", 9000);
      }
      const needsCourses = initial || state.courses.size !== state.eventData.size;
      if (needsCourses && !initial && !payload.events?.some(e=>e.course)) payload = await fetchJson(BOOTSTRAP_URL);
      mergePayload(payload, needsCourses);
      if (initial) {
        state.loaded = true;
        el.loadingOverlay.hidden = true;
        el.app.classList.remove("is-loading");
        setTimeout(() => state.map.invalidateSize(), 50);
        resumeAuto();
      }
      if (!state.manualLock && !state.selectedKey) directorTick(true);
    } catch (error) {
      state.feedError = error.message;
      updateStatus();
      el.loadingOverlay.querySelector("strong").textContent = "Timing unavailable — retrying automatically";
      el.loadingOverlay.querySelector("span").textContent = error.message;
      showToast(`Refresh delayed: ${error.message}`);
    } finally {
      state.refreshPending = false;
    }
  }

  function showToast(message, duration = 5000) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { el.toast.hidden = true; }, duration);
  }

  function scheduledLabel(event) {
    if (!event?.event_date) return "start time pending";
    const date = new Date(`${event.event_date}T12:00:00`);
    const day = new Intl.DateTimeFormat("en-US",{weekday:"short"}).format(date);
    const [hour,minute] = String(event.start_time || "").split(":");
    if (!hour || !minute) return day;
    return `${day} ${Number(hour)%12 || 12}:${minute} ${Number(hour)<12 ? "AM" : "PM"} MT`;
  }

  function finishWatchRows() {
    const phase = window.RutRules.racePhase(state.eventData.get(state.finishEventId));
    if (phase !== "racing") return [];
    const snapshot = state.delivery === "periodic_snapshot";
    const source = snapshot ? state.snapshotPositions : [...state.positions.values()];
    return window.RutRules.finishView(source, state.finishEventId, Date.now(), state.feedGeneratedAt, snapshot);
  }

  function renderFinishWatch() {
    if (!el.finishRace) return;
    const events = [...state.eventData.values()];
    const optionsKey = events.map(e=>`${e.id}:${e.label}`).join("|");
    if (el.finishRace.dataset.optionsKey !== optionsKey) {
      el.finishRace.innerHTML = events.map(e=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.label)}</option>`).join("");
      el.finishRace.dataset.optionsKey = optionsKey;
    }
    el.finishRace.value = state.finishEventId || "";
    const event = state.eventData.get(state.finishEventId);
    const snapshot = state.delivery === "periodic_snapshot";
    const all = (snapshot ? state.snapshotPositions : [...state.positions.values()]).filter(p=>p.event_id===state.finishEventId);
    const rows = finishWatchRows();
    const age = snapshotAgeSeconds();
    const phase = window.RutRules.racePhase(event);
    const feedOld = age === null || age > (snapshot ? 900 : 90);
    el.finishCount.textContent = `${rows.length} / 10`;
    if (!event) el.finishStatus.textContent = "Waiting for timing data.";
    else if (phase === "upcoming") el.finishStatus.textContent = `Upcoming · ${scheduledLabel(event)}. No live ranking before the start.`;
    else if (phase === "awaiting") el.finishStatus.textContent = "Waiting for the official start signal from timing.";
    else if (phase === "closed") el.finishStatus.textContent = "Race closed. Last-known dots are not active finish predictions.";
    else if (phase === "unknown") el.finishStatus.textContent = "Waiting for verified race schedule and start data.";
    else if (feedOld) el.finishStatus.textContent = "Finish watch paused: timing data is too old to rank safely.";
    else if (!rows.length) el.finishStatus.textContent = "No runners have enough current evidence to rank confidently.";
    else el.finishStatus.textContent = !snapshot ? `Feed ${humanAge(age)} · checks every 15s` : `SNAPSHOT ORDER · NOT LIVE · ${humanAge(age)} · five-minute snapshots`;
    const excluded = all.filter(p=>p.status==="ON COURSE" && (!p.rank_eligible || p.estimate_overdue)).length;
    const pilot = event?.estimator?.model === "terrain-pilot-v1";
    const modelNote = pilot ? (event.estimator.terrain_ready ? "Terrain pace pilot · not GPS; race-day accuracy unvalidated." : "Checkpoint-average fallback · terrain unavailable.") : "GPS and timing estimates remain distinct.";
    el.finishExcluded.textContent = `${excluded ? `${excluded} on-course positions excluded: stale, held or uncertain. ` : ""}Finished runners leave this list. ${modelNote}`;
    const signature = JSON.stringify(rows.map(p=>[p.key,p.name,p.bib,p.remaining_m,p.source,p.estimate_basis,p.eta_basis,p.pace_basis,p.pace_segments_used,p.eta_at,p.observation_at,p.key===state.selectedKey]));
    if (el.finishList.dataset.signature !== signature) {
      el.finishList.dataset.signature = signature;
      el.finishList.innerHTML = rows.map((p,i)=>{
        const meters = Number(p.remaining_m);
        const distance = meters < 1000 ? `${Math.round(meters/10)*10} m` : `${(meters/1000).toFixed(2)} km`;
        const eta = Date.parse(p.eta_at || "");
        const etaText = Number.isFinite(eta) && eta > Date.now() ? `${p.eta_basis === "TERRAIN_CHECKPOINT_PILOT" ? "Pilot" : "Est."} arrival ${new Intl.DateTimeFormat("en-US",{timeZone:"America/Denver",hour:"numeric",minute:"2-digit"}).format(eta)} MT` : "Arrival time uncertain";
        return `<button class="finish-row ${p.key===state.selectedKey ? "selected" : ""}" type="button" data-finish-key="${escapeHtml(p.key)}">
          <span class="finish-rank">${i+1}</span><span class="finish-person"><strong>${escapeHtml(p.name)}</strong><span>Bib ${escapeHtml(p.bib??"—")} · ${p.source === "GPS" ? "GPS-matched" : p.estimate_basis === "TERRAIN_CHECKPOINT_PILOT" ? "Terrain estimate · pilot" : "Estimated"}</span><small>${escapeHtml(etaText)}</small><small data-observed="${escapeHtml(p.observation_at || p.recorded_at || "")}"></small></span><span class="finish-distance">~${distance}<small>to finish</small></span></button>`;
      }).join("");
    }
    el.finishList.querySelectorAll("[data-observed]").forEach(node=>{
      const when = Date.parse(node.dataset.observed);
      node.textContent = Number.isFinite(when) ? `Observation ${humanAge((Date.now()-when)/1000)}` : "Observation time unavailable";
    });
  }

  function setView(mode) {
    if (mode !== "map" && mode !== "elevation") return;
    state.viewMode = mode;
    const elevation = mode === "elevation";
    el.app.classList.toggle("show-elevation", elevation);
    el.app.classList.toggle("show-finish", false);
    el.finishToggle.setAttribute("aria-expanded", "false");
    el.finishToggle.textContent = "Finish watch · 10";
    el.mapViewButton.setAttribute("aria-pressed", String(!elevation));
    el.elevationViewButton.setAttribute("aria-pressed", String(elevation));
    el.elevationPanel.hidden = !elevation;
    el.mapCanvas.setAttribute("aria-hidden", String(elevation));
    el.mapCanvas.inert = elevation;
    state.map?.stop();
    if (elevation) renderElevation();
    else {
      // Hidden views must not retain identities while feed updates skip rendering.
      el.elevationChart.innerHTML = el.elevationRunner.innerHTML = "";
      el.elevationSubtitle.textContent = "";
      el.elevationChart.dataset.signature = "";
      repairMap(); // Keep the existing center, zoom, selection and manual lock.
    }
  }

  function profileEvent() {
    const runner = state.selectedKey && (state.positions.get(state.selectedKey) || runnerByKey(state.selectedKey));
    return state.eventData.get(runner?.event_id) || state.eventData.get(state.filter) || state.eventData.get(state.finishEventId) || null;
  }

  function elevationSource(row, phase) {
    if (!row) return {label:"NO COURSE POSITION", style:"stale"};
    if (state.delivery === "periodic_snapshot") return {label:"SNAPSHOT · NOT LIVE", style:"stale"};
    if (phase !== "racing") return {label:"LAST KNOWN · NOT LIVE", style:"stale"};
    const age = snapshotAgeSeconds();
    if (age === null || age > 90 || state.feedError || row.rank_exclusion === "UPSTREAM_STALE") return {label:"OLD FEED · HELD", style:"stale"};
    if (row.source === "GPS") return {label:row.freshness === "LIVE" ? "GPS-MATCHED" : "STALE GPS", style:row.freshness === "LIVE" ? "gps" : "stale"};
    if (row.estimate_held || row.estimate_overdue) return {label:"EST. HELD", style:"held"};
    return {label:row.estimate_basis === "TERRAIN_CHECKPOINT_PILOT" ? "TERRAIN EST." : "ESTIMATED", style:"estimated"};
  }

  function renderElevation() {
    if (state.viewMode !== "elevation" || !el.elevationChart) return;
    const event = profileEvent(), course = event?.course;
    let profile = null;
    if (course && typeof course === "object" && window.RutElevation) {
      if (!state.profileCache.has(course)) state.profileCache.set(course, window.RutElevation.buildProfile(course));
      profile = state.profileCache.get(course);
    }
    el.elevationTitle.textContent = event ? `${event.label} · Elevation` : "Elevation profile";
    if (!profile) {
      el.elevationSubtitle.textContent = "The map and runner search remain available.";
      el.elevationChart.innerHTML = '<p class="elevation-empty">Elevation profile unavailable. No terrain is invented for missing or invalid course data.</p>';
      el.elevationChart.dataset.signature = "";
      el.elevationSummary.innerHTML = el.elevationRunner.innerHTML = el.elevationCheckpoints.innerHTML = "";
      el.elevationNote.textContent = "Use Map to return to the course.";
      return;
    }
    const phase = window.RutRules.racePhase(event);
    const runner = state.selectedKey && (state.positions.get(state.selectedKey) || runnerByKey(state.selectedKey));
    const row = runner?.event_id === event.id ? state.positions.get(state.selectedKey) : null;
    const point = ["racing", "closed"].includes(phase) ? window.RutElevation.runnerPoint(profile, row) : null;
    const source = elevationSource(point ? row : null, phase);
    const checkpoints = window.RutElevation.checkpointPoints(profile, course, event.split_names || []);
    const feet = meters => finite(meters) ? Math.round(Number(meters) / .3048).toLocaleString() : "—";
    const miles = meters => (meters / 1609.344).toFixed(1);
    const stat = (label,value) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
    el.elevationSubtitle.textContent = phase === "upcoming" ? `Course preview · ${scheduledLabel(event)}` : phase === "closed" ? "Race closed · last-known positions only" : phase === "awaiting" ? "Course preview · awaiting official start" : "Select a runner to locate them along this profile.";
    if (runner) el.elevationSubtitle.textContent = `${runner.name} · Bib ${runner.bib ?? "—"} · ${source.label}`;
    el.elevationSummary.innerHTML = stat("Course distance",`${miles(profile.total_m)} mi`) + stat("Course climb*",`${feet(event.estimator?.elevation_gain_m)} ft`) + stat("Course descent*",`${feet(event.estimator?.elevation_loss_m)} ft`);
    const width = Math.max(260, Math.round(el.elevationChart.clientWidth || 600));
    const height = Math.max(140, Math.min(width < 500 ? 230 : 300, (el.elevationPanel.clientHeight || 600) - 110));
    const signature = JSON.stringify([event.id, event.label, checkpoints, width, height, event.color, point, source, runner?.key, runner?.name]);
    if (el.elevationChart.dataset.signature !== signature || el.elevationChart._rutCourse !== course) {
      el.elevationChart._rutCourse = course;
      el.elevationChart.dataset.signature = signature;
      const left=54, right=16, top=30, bottom=38;
      const low = Math.floor(profile.min_m / .3048 / 500) * 500;
      const high = Math.max(low + 500, Math.ceil(profile.max_m / .3048 / 500) * 500);
      const x = d => left + (width-left-right) * d / profile.total_m;
      const y = e => top + (height-top-bottom) * (1-(e/.3048-low)/(high-low));
      const n = value => value.toFixed(2);
      const line = profile.points.map((p,i)=>`${i ? "L" : "M"}${n(x(p.distance_m))},${n(y(p.elevation_m))}`).join(" ");
      const color = /^#[0-9a-f]{6}$/i.test(event.color || "") ? event.color : "#d7ff4f";
      let grid="";
      for(let i=0;i<=4;i++) {
        const altitude=low+(high-low)*i/4, yy=y(altitude*.3048), d=profile.total_m*i/4;
        grid += `<line x1="${left}" x2="${width-right}" y1="${n(yy)}" y2="${n(yy)}" class="profile-grid"/><text x="${left-8}" y="${n(yy+4)}" text-anchor="end">${Math.round(altitude).toLocaleString()}</text><text x="${n(x(d))}" y="${height-14}" text-anchor="${i===0?'start':i===4?'end':'middle'}">${miles(d)}</text>`;
      }
      const dots = checkpoints.map(cp=>`<g class="profile-checkpoint"><title>${escapeHtml(cp.name)} · ${miles(cp.distance_m)} mi</title><circle cx="${n(x(cp.distance_m))}" cy="${n(y(cp.elevation_m))}" r="4"/><text x="${n(x(cp.distance_m))}" y="${n(y(cp.elevation_m)-11)}" text-anchor="middle">${cp.index+1}</text></g>`).join("");
      const px=point?x(point.distance_m):0, py=point?y(point.elevation_m):0;
      const marker = point ? `<g class="profile-runner ${source.style}" data-progress="${point.progress}"><title>${escapeHtml(runner.name)} · ${escapeHtml(source.label)} · course elevation ${feet(point.elevation_m)} ft</title><line x1="${n(px)}" x2="${n(px)}" y1="${top}" y2="${height-bottom}"/><circle cx="${n(px)}" cy="${n(py)}" r="8"/></g>` : "";
      el.elevationChart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${escapeHtml(event.label)} course elevation in feet against distance in miles${point ? `; selected runner ${escapeHtml(source.label)}` : '; no runner position plotted'}" style="--profile-color:${color}"><text x="4" y="14">feet</text><text x="${width-right}" y="${height-1}" text-anchor="end">miles</text>${grid}<path class="profile-fill" d="${line} L${width-right},${height-bottom} L${left},${height-bottom} Z"/><path class="profile-line" d="${line}"/>${dots}${marker}</svg>`;
    }
    let runnerHtml = "";
    if (runner) {
      runnerHtml = `<div class="elevation-runner-heading"><strong>${escapeHtml(runner.name)} <small>· Bib ${escapeHtml(runner.bib ?? "—")}</small></strong><span class="profile-badge ${source.style}">${escapeHtml(source.label)}</span></div>`;
      if (point) {
        const pct = Math.min(row.estimate_held || row.estimate_overdue ? 99 : 100,Math.round(point.progress*100));
        runnerHtml += `<dl class="elevation-summary">${stat("Along course",`~${miles(point.distance_m)} mi · ${pct}%`)}${stat("Remaining",`~${miles(profile.total_m-point.distance_m)} mi`)}${stat("Course elevation",`~${feet(point.elevation_m)} ft`)}</dl>`;
      } else runnerHtml += '<p>No reliable course position to plot. Use Map for any available GPS fix; an unmatched fix is not guessed onto this profile.</p>';
    } else runnerHtml = '<p>Search by name or bib below, or use Front, Random or Auto to follow a runner.</p>';
    if(el.elevationRunner.innerHTML!==runnerHtml) el.elevationRunner.innerHTML=runnerHtml;
    const checkpointHtml = checkpoints.map(cp=>`<span><b>${cp.index+1}</b>${escapeHtml(cp.name)} <small>${miles(cp.distance_m)} mi</small></span>`).join("");
    if(el.elevationCheckpoints.innerHTML!==checkpointHtml) el.elevationCheckpoints.innerHTML=checkpointHtml;
    const observation = Date.parse(row?.observation_at || row?.recorded_at || "");
    const ageText = point && Number.isFinite(observation) ? ` Observation ${humanAge((Date.now()-observation)/1000)}.` : "";
    const basis = point && row.source === "ESTIMATED" ? ` Not GPS. ${window.RutRules.estimateExplanation(row)}${row.estimate_held || row.estimate_overdue ? " Position held; no movement beyond the evidence." : ""}` : point ? " GPS matched to the course; elevation comes from the route, not the runner's altitude sensor." : "";
    const delivery = state.delivery === "periodic_snapshot" ? " Dated snapshot, not live." : source.label === "OLD FEED · HELD" ? " Old feed: position frozen until new data arrives." : "";
    el.elevationNote.textContent = `Course elevation, not measured runner altitude. *Climb/descent use the smoothed course profile.${basis}${ageText}${delivery}`;
  }

  function bindControls() {
    el.mapViewButton.addEventListener("click", () => setView("map"));
    el.elevationViewButton.addEventListener("click", () => setView("elevation"));
    window.addEventListener("resize", renderElevation);
    el.retryMap.addEventListener("click", () => {
      repairMap();
      state.tileFallbackUsed = false;
      el.mapNoticeText.textContent = "Retrying background map…";
      installTileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", "© OpenStreetMap contributors");
    });
    el.mapRepairButton.addEventListener("click", () => {
      el.mapNotice.hidden = false;
      el.retryMap.click();
    });
    window.addEventListener("resize", repairMap);
    window.addEventListener("pageshow", repairMap);
    window.visualViewport?.addEventListener("resize", repairMap);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) {repairMap();refreshLive();} });
    el.finishToggle.addEventListener("click", () => {
      const shown = el.app.classList.toggle("show-finish");
      el.finishToggle.setAttribute("aria-expanded", String(shown));
      el.finishToggle.textContent = shown ? `← ${state.viewMode === "elevation" ? "Elevation" : "Map"}` : "Finish watch · 10";
      setTimeout(repairMap, 50);
    });
    el.finishRace.addEventListener("change", () => setCourseFilter(el.finishRace.value, true));
    el.finishList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-finish-key]");
      if (!button) return;
      selectKey(button.dataset.finishKey, true, "FINISH WATCH");
      if (el.app.classList.contains("show-finish")) el.finishToggle.click();
    });
    el.runnerSearch.addEventListener("input", updateSearchResults);
    el.runnerSearch.addEventListener("focus", updateSearchResults);
    el.runnerSearch.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        el.runnerSearch.value = "";
        updateSearchResults();
        el.runnerSearch.blur();
      } else if (event.key === "Enter") {
        const first = el.searchResults.querySelector("[data-runner-key]");
        if (first) first.click();
      }
    });
    el.clearSearch.addEventListener("click", () => {
      el.runnerSearch.value = "";
      updateSearchResults();
      el.runnerSearch.focus();
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".search-wrap")) {
        el.searchResults.hidden = true;
        el.runnerSearch.setAttribute("aria-expanded", "false");
      }
    });
    el.leaderButton.addEventListener("click", () => {
      const leader = chooseLeader(directorCandidates());
      if (leader) selectKey(leader.key, true, "FRONT HOLD");
      else showToast("No on-course runner with a position is available in this view.");
    });
    el.randomButton.addEventListener("click", () => {
      const random = chooseRandom(directorCandidates());
      if (random) selectKey(random.key, true, "RANDOM HOLD");
      else showToast("No on-course runner with a position is available in this view.");
    });
    el.fieldButton.addEventListener("click", () => {
      state.manualLock = true;
      state.directorMode = "FIELD HOLD";
      clearSelection(true);
      updateDirectorUi();
    });
    el.resumeButton.addEventListener("click", resumeAuto);
    el.releaseButton.addEventListener("click", resumeAuto);
    el.fullscreenButton.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
        else await document.exitFullscreen();
      } catch (error) {
        showToast(`Fullscreen unavailable: ${error.message}`);
      }
    });
    document.addEventListener("fullscreenchange", () => {
      el.fullscreenButton.setAttribute("aria-label", document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen");
      setTimeout(() => state.map.invalidateSize(), 100);
    });
  }

  function exposeTestHooks() {
    window.__rutApp = {
      state,
      setCourse: (filter) => setCourseFilter(filter, true),
      selectByName: (name) => {
        const match = state.runners.find((runner) => normalize(runner.name).includes(normalize(name)));
        return match ? selectKey(match.key, true, "MANUAL") : false;
      },
      random: () => el.randomButton.click(),
      leader: () => el.leaderButton.click(),
      resumeAuto,
      refreshLive,
      mergePayload,
      finishRows: finishWatchRows,
      setView,
      renderElevation,
      snapshot: () => ({
        view: state.viewMode,
        events: state.eventData.size,
        runners: state.runners.length,
        positions: state.positions.size,
        courses: state.courses.size,
        selected: state.selectedKey,
        filter: state.filter,
        mode: state.directorMode,
        finishRace: state.finishEventId,
        finishCount: finishWatchRows().length,
        delivery: state.delivery,
      }),
    };
  }

  function init() {
    collectElements();
    initMap();
    bindControls();
    exposeTestHooks();
    updateClock();
    // Open the map first on phones; the finish list is an explicit view.
    bootstrap();
    setInterval(refreshLive, POLL_SECONDS * 1000);
    setInterval(() => directorTick(false), 1000);
    setInterval(updateClock, 1000);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
