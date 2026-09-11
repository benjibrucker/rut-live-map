(() => {
  "use strict";

  const ACTIVE_FILTER = "active";
  const ALL_FILTER = "all";
  const DIRECTOR_INTERVAL_SECONDS = 18;
  const STATIC_SITE = window.location.hostname.endsWith(".github.io") || new URLSearchParams(window.location.search).has("static");
  const POLL_SECONDS = STATIC_SITE ? 60 : 15;
  const BOOTSTRAP_URL = STATIC_SITE ? "data/bootstrap.json" : "/api/bootstrap";
  const LIVE_URL = STATIC_SITE ? "data/live.json" : "/api/live";
  const state = {
    map: null,
    tileLayer: null,
    tileFallbackUsed: false,
    tileErrors: 0,
    courses: new Map(),
    eventData: new Map(),
    runners: [],
    positions: new Map(),
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
    summary: { live_gps: 0, stale_gps: 0, estimated: 0, positions: 0, errors: 0, upstream_stale: false },
  };

  const el = {};
  const byId = (id) => document.getElementById(id);
  const keyFor = (eventId, runnerId) => `${eventId}:${runnerId}`;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
  const normalize = (value) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const finite = (value) => Number.isFinite(Number(value));

  function collectElements() {
    [
      "app", "connectionDot", "connectionText", "mountainTime", "fullscreenButton", "courseBar",
      "positionCount", "runnerSearch", "clearSearch", "searchResults", "directorMode", "directorCountdown",
      "leaderButton", "randomButton", "fieldButton", "resumeButton", "liveGpsCount", "estimatedCount",
      "staleGpsCount", "runnerCard", "runnerCardEmpty", "runnerCardContent", "runnerKicker", "runnerName",
      "sourceBadge", "sourceMessage", "runnerStatus", "runnerCheckpoint", "runnerProgress", "runnerFinish",
      "runnerLocation", "releaseButton", "loadingOverlay", "toast",
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

  function installTileLayer(url, attribution) {
    if (state.tileLayer) state.map.removeLayer(state.tileLayer);
    state.tileErrors = 0;
    state.tileLayer = L.tileLayer(url, {
      attribution,
      maxZoom: 18,
      crossOrigin: true,
    });
    state.tileLayer.on("tileerror", () => {
      state.tileErrors += 1;
      if (state.tileErrors >= 5 && !state.tileFallbackUsed) {
        state.tileFallbackUsed = true;
        installTileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", "Map data © OpenStreetMap · Style © OpenTopoMap");
        showToast("Street-map tiles were unavailable; switched to the topographic map.");
      }
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
    const now = Date.now();
    const active = [...state.eventData.values()]
      .filter((event) => {
        if (event.course_status !== "active") return false;
        const start = event.start_at ? new Date(event.start_at).getTime() : NaN;
        return Number.isFinite(start) && start <= now && now - start < 24 * 60 * 60 * 1000;
      })
      .map((event) => event.id);
    if (active.length) return new Set(active);
    const dated = [...state.eventData.values()]
      .filter((event) => event.event_date)
      .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)));
    const today = new Date().toISOString().slice(0, 10);
    const sameDay = dated.filter((event) => event.event_date === today).map((event) => event.id);
    if (sameDay.length) return new Set(sameDay);
    return new Set(dated.slice(0, 1).map((event) => event.id));
  }

  function visibleEventIds() {
    if (state.filter === ALL_FILTER) return new Set(state.eventData.keys());
    if (state.filter === ACTIVE_FILTER) return activeEventIds();
    return new Set([state.filter]);
  }

  function renderCourseBar() {
    const activeCount = activeEventIds().size;
    const chips = [
      `<button class="course-chip ${state.filter === ACTIVE_FILTER ? "active" : ""}" data-course="${ACTIVE_FILTER}" type="button">Live now${activeCount ? ` · ${activeCount}` : ""}</button>`,
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
    renderCourseBar();
    applyCourseVisibility(fit);
    renderMarkers();
    if (state.selectedKey) {
      const selected = state.positions.get(state.selectedKey) || runnerByKey(state.selectedKey);
      if (selected && !visibleEventIds().has(selected.event_id)) clearSelection(false);
    }
    updateSearchResults();
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
    if (fit && bounds.isValid()) state.map.fitBounds(bounds, { padding: [45, 45], maxZoom: 14, animate: true });
  }

  function mergePayload(payload, initial = false) {
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
    state.summary = payload.summary || state.summary;
    state.lastSuccessAt = Date.now();
    const generatedAt = new Date(payload.generated_at || "").getTime();
    state.feedGeneratedAt = Number.isFinite(generatedAt) ? generatedAt : state.lastSuccessAt;
    updateStatus();
    if (initial) buildCourses(payload.events || []);
    else {
      renderCourseBar();
      applyCourseVisibility(false);
    }
    renderMarkers();
    updateRunnerCard();
    updateSearchResults();
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
    state.markers.forEach((marker) => state.map.removeLayer(marker));
    state.markers.clear();
    const ordered = [...state.positions.values()]
      .filter((position) => visible.has(position.event_id) && finite(position.lat) && finite(position.lng))
      .sort((a, b) => Number(a.key === state.selectedKey) - Number(b.key === state.selectedKey));
    ordered.forEach((position) => {
      const selected = position.key === state.selectedKey;
      const marker = L.marker([position.lat, position.lng], {
        pane: selected ? "selectedRunner" : "runnerDots",
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
    state.manualLock = manual;
    state.directorMode = mode;
    if (!manual) state.directorDeadline = Date.now() + DIRECTOR_INTERVAL_SECONDS * 1000;
    renderMarkers();
    updateRunnerCard();
    const position = state.positions.get(key);
    if (position && finite(position.lat) && finite(position.lng)) {
      const currentZoom = state.map.getZoom();
      state.map.flyTo([position.lat, position.lng], Math.max(14.5, Math.min(16, currentZoom)), { duration: 1.1 });
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
    return [...state.positions.values()].filter((position) => visible.has(position.event_id) && (position.status === "ON COURSE" || position.status === "GPS"));
  }

  function chooseLeader(candidates) {
    const ranked = candidates.filter((row) => row.status === "ON COURSE");
    ranked.sort((a, b) => {
      const progressA = finite(a.progress) ? Number(a.progress) : Number(a.last_split_index ?? -1) / 10;
      const progressB = finite(b.progress) ? Number(b.progress) : Number(b.last_split_index ?? -1) / 10;
      if (progressA !== progressB) return progressB - progressA;
      const splitA = finite(a.last_split_time) ? Number(a.last_split_time) : Number.MAX_SAFE_INTEGER;
      const splitB = finite(b.last_split_time) ? Number(b.last_split_time) : Number.MAX_SAFE_INTEGER;
      return splitA - splitB;
    });
    return ranked[0] || null;
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
    const runner = state.selectedKey ? (state.positions.get(state.selectedKey) || runnerByKey(state.selectedKey)) : null;
    el.runnerCardEmpty.hidden = Boolean(runner);
    el.runnerCardContent.hidden = !runner;
    if (!runner) {
      updateDirectorUi();
      return;
    }
    const position = state.positions.get(runner.key);
    el.runnerKicker.textContent = `${runner.course} · BIB ${runner.bib ?? "—"}${runner.overall_place ? ` · PLACE ${runner.overall_place}` : ""}`;
    el.runnerName.textContent = runner.name;
    el.runnerStatus.textContent = runner.status || "—";
    el.runnerCheckpoint.textContent = position?.last_checkpoint || "—";
    const rawProgressPct = finite(position?.progress) ? Math.round(Number(position.progress) * 100) : null;
    const progressPct = rawProgressPct === null ? null : Math.min(position?.estimate_overdue ? 99 : 100, rawProgressPct);
    el.runnerProgress.textContent = progressPct !== null ? `${progressPct}% est.${position?.estimate_overdue ? " · held" : ""}` : position?.source === "GPS" ? "GPS fix" : "—";
    el.runnerFinish.textContent = formatDuration(position?.projected_finish_seconds ?? runner.estimated_finish_seconds ?? runner.goal_time_seconds);
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
    } else if (position.estimate_overdue) {
      el.sourceBadge.textContent = "EST. HELD";
      el.sourceBadge.classList.add("estimated");
      el.sourceMessage.innerHTML = `<strong>Not GPS.</strong> No newer chip read arrived, so this estimate is held just before ${escapeHtml(nextCheckpoint(position) || "the next checkpoint")} rather than moving farther without evidence.`;
    } else {
      el.sourceBadge.textContent = "ESTIMATED";
      el.sourceBadge.classList.add("estimated");
      el.sourceMessage.innerHTML = `<strong>Not GPS.</strong> Interpolated from ${escapeHtml(position.last_checkpoint || "the last timing checkpoint")} toward the next checkpoint using the projected finish.`;
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
    const staleSnapshot = STATIC_SITE && age !== null && age > 15 * 60;
    const degraded = state.summary.errors > 0 || state.summary.upstream_stale || staleSnapshot;
    el.connectionDot.classList.toggle("connected", !degraded && state.lastSuccessAt > 0);
    el.connectionDot.classList.toggle("degraded", degraded);
    if (degraded) el.connectionText.textContent = staleSnapshot ? `Snapshot delayed · ${humanAge(age)}` : "Using partial/stale feed";
    else if (STATIC_SITE && age !== null) el.connectionText.textContent = `Timing snapshot · ${humanAge(age)}`;
    else el.connectionText.textContent = state.lastSuccessAt ? "Live timing connected" : "Connecting";
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
    if (STATIC_SITE && state.lastSuccessAt) {
      updateStatus();
    } else if (state.lastSuccessAt) {
      const age = Math.max(0, Math.floor((Date.now() - state.lastSuccessAt) / 1000));
      if (age > POLL_SECONDS * 3 && !state.refreshPending) {
        el.connectionDot.classList.add("degraded");
        el.connectionText.textContent = `Feed delayed ${humanAge(age)}`;
      }
    }
    updateDirectorUi();
    updateRunnerCardAges();
  }

  function updateRunnerCardAges() {
    if (!state.selectedKey) return;
    const position = state.positions.get(state.selectedKey);
    if (!position || position.source !== "GPS" || !position.recorded_at) return;
    const age = Math.max(0, Math.round((Date.now() - new Date(position.recorded_at).getTime()) / 1000));
    position.age_seconds = age;
    if (position.freshness === "LIVE" && age > 90) {
      position.freshness = "STALE";
      renderMarkers();
    }
    updateRunnerCard();
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
          <span class="result-copy"><strong>${escapeHtml(runner.name)}</strong><span>Bib ${escapeHtml(runner.bib ?? "—")} · ${escapeHtml(runner.status)}</span></span>
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
      const target = STATIC_SITE ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url;
      const response = await fetch(target, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function bootstrap() {
    try {
      const payload = await fetchJson(BOOTSTRAP_URL);
      mergePayload(payload, true);
      el.app.classList.remove("is-loading");
      setTimeout(() => state.map.invalidateSize(), 50);
      resumeAuto();
    } catch (error) {
      el.connectionDot.classList.add("degraded");
      el.connectionText.textContent = "Could not load live timing";
      el.loadingOverlay.querySelector("strong").textContent = "Live timing could not load";
      el.loadingOverlay.querySelector("span").textContent = `${error.message}. Leave this window open and reload when the connection returns.`;
      showToast(`Startup failed: ${error.message}`, 12000);
    }
  }

  async function refreshLive() {
    if (state.refreshPending) return;
    state.refreshPending = true;
    try {
      const payload = await fetchJson(LIVE_URL);
      mergePayload(payload, false);
      if (!state.manualLock && !state.selectedKey) directorTick(true);
    } catch (error) {
      el.connectionDot.classList.add("degraded");
      el.connectionText.textContent = "Feed refresh delayed";
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

  function bindControls() {
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
      snapshot: () => ({
        events: state.eventData.size,
        runners: state.runners.length,
        positions: state.positions.size,
        courses: state.courses.size,
        selected: state.selectedKey,
        filter: state.filter,
        mode: state.directorMode,
      }),
    };
  }

  function init() {
    collectElements();
    initMap();
    bindControls();
    exposeTestHooks();
    updateClock();
    bootstrap();
    setInterval(refreshLive, POLL_SECONDS * 1000);
    setInterval(() => directorTick(false), 1000);
    setInterval(updateClock, 1000);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
