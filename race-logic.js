/* Shared, pure race-display rules; no DOM, network, or stored identities. */
((root, factory) => {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  else root.RutRules = rules;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const FRESH_SECONDS = 90;
  const finite = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number.isFinite(Number(value));
  function timestamp(value) {
    if (!value) return null;
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  function refreshPosition(row, now = Date.now()) {
    if (row.source !== 'GPS') return {...row};
    const recorded = timestamp(row.recorded_at);
    const valid = recorded !== null && recorded <= now + 5000;
    const age = valid ? Math.max(0,(now-recorded)/1000) : null;
    const fresh = valid && age <= FRESH_SECONDS && row.freshness !== 'STALE';
    return {...row, age_seconds:age, freshness:fresh?'LIVE':'STALE',
      rank_eligible: Boolean(row.rank_eligible) && fresh};
  }
  function nearestFinish(rows, eventId, now = Date.now(), generatedAt = null) {
    const stamp = timestamp(generatedAt);
    if (stamp === null || now-stamp > FRESH_SECONDS*1000 || stamp > now+5000) return [];
    return rows.map(row=>refreshPosition(row,now))
      .filter(row=>row.event_id===eventId && row.status==='ON COURSE' && row.rank_eligible===true && !row.estimate_overdue && !row.estimate_held && finite(row.remaining_m) && Number(row.remaining_m)>=0)
      .sort((a,b)=>Number(a.remaining_m)-Number(b.remaining_m) || String(a.key??a.id).localeCompare(String(b.key??b.id),undefined,{numeric:true}))
      .slice(0,10);
  }
  function finishView(rows, eventId, now, generatedAt, snapshot = false) {
    const stamp = timestamp(generatedAt);
    if (snapshot && (stamp === null || now-stamp > 900000 || stamp > now+5000)) return [];
    // Snapshot results describe ordering at capture, never current live order.
    return nearestFinish(rows,eventId,snapshot ? stamp : now,generatedAt);
  }
  function racePhase(event, now = Date.now()) {
    if (!event?.event_date) return 'unknown';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:event.timezone || 'America/Denver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const day = String(event.event_date).slice(0,10);
    if (day > today) return 'upcoming';
    if (day < today) return 'closed';
    const start = timestamp(event.start_at);
    const clock = `${parts.hour}:${parts.minute}:${parts.second}`;
    if ((start !== null && start > now) || (start === null && event.start_time && String(event.start_time).slice(0,8) > clock)) return 'upcoming';
    if (start === null) return 'awaiting';
    return ['active','started','in_progress'].includes(String(event.course_status).toLowerCase()) ? 'racing' : 'closed';
  }
  function preferredRace(events, now = Date.now()) {
    const priority = {racing:0,awaiting:1,upcoming:2,closed:3,unknown:4};
    return [...events].sort((a,b)=> {
      const ap=racePhase(a,now), bp=racePhase(b,now);
      const phase=priority[ap]-priority[bp];
      if (phase) return phase;
      const dates=String(a.event_date+'T'+a.start_time).localeCompare(String(b.event_date+'T'+b.start_time));
      return ap==='closed' ? -dates : dates;
    })[0] || null;
  }
  function statusLabel(runner, event, now = Date.now()) {
    const status = runner?.status || 'REGISTERED';
    const phase = racePhase(event, now);
    if (status === 'DNS' && (phase === 'upcoming' || phase === 'awaiting' ||
        (phase === 'racing' && !finite(runner.chip_start_seconds)))) return 'NOT STARTED';
    return status;
  }
  function estimateExplanation(position) {
    if (position?.source !== 'ESTIMATED') return '';
    if (position.estimate_basis === 'TERRAIN_CHECKPOINT_PILOT') {
      const count = Number(position.pace_segments_used);
      const recent = position.pace_basis === 'RECENT_SEGMENTS' && Number.isInteger(count) && count > 1 && count <= 3;
      return recent
        ? `Terrain-adjusted pilot · smoothed pace from ${count} recent completed segments. Race-day accuracy is not yet validated.`
        : 'Terrain-adjusted pilot · checkpoint-average pace with limited checkpoint history. Race-day accuracy is not yet validated.';
    }
    if (position.estimate_basis === 'CHECKPOINT_PACE_CHIP') return 'Checkpoint-average estimate; not terrain-adjusted.';
    return 'Checkpoint-based estimate.';
  }
  // Presentation only: never derive a new ETA from progress, goals or the current clock.
  function nextCheckpointEstimate(row, event, {now = Date.now(), generatedAt = null, delivery = 'live_api', degraded = false} = {}) {
    const result = {checkpoint:'—',arrival:'—',remaining:'—',note:'',kind:'unavailable'};
    const unavailable = message => ({...result,arrival:message});
    if (!row) return result;
    let phase;
    try { phase = racePhase(event, now); } catch { return unavailable('Race timing unavailable'); }
    if (phase === 'upcoming' || phase === 'awaiting') return unavailable('Awaiting race start');
    if (row.status === 'FINISHED') return unavailable('Finished');
    if (row.status !== 'ON COURSE') return unavailable('No active estimate');
    if (phase !== 'racing') return unavailable(phase === 'closed' ? 'Race closed' : 'Race timing unavailable');
    const index = finite(row.last_split_index) ? Number(row.last_split_index) : null;
    const names = event?.split_names;
    if (row.event_id !== event?.id || !Number.isInteger(index) || index < 0 || !Array.isArray(names) || index + 1 >= names.length || typeof names[index+1] !== 'string' || !names[index+1].trim()) return unavailable('Not enough timing data');
    result.checkpoint = names[index+1];
    const snapshot = delivery === 'periodic_snapshot';
    const stamp = timestamp(generatedAt);
    if (degraded || row.upstream_stale || event.upstream_stale || row.rank_exclusion === 'UPSTREAM_STALE' || row.freshness === 'STALE' || stamp === null || stamp <= 0 || stamp > now+5000 || now-stamp > (snapshot ? 900000 : FRESH_SECONDS*1000)) return unavailable('Estimate paused · stale feed');
    const awaiting = () => ({...result,arrival:'Awaiting checkpoint read',note:'No newer recorded passage; not a confirmed arrival.',kind:'awaiting'});
    if (row.estimate_overdue || row.estimate_held) return awaiting();
    if (index === 0 || row.rank_eligible !== true || row.rank_exclusion || !['GPS','ESTIMATED'].includes(row.source)) return unavailable('Not enough timing data');
    if (row.source === 'GPS' && refreshPosition(row,snapshot ? stamp : now).freshness !== 'LIVE') return unavailable('Estimate paused · stale GPS');
    // Require an explicit timezone; never interpret an arrival in the spectator's local zone.
    const raw = row.next_checkpoint_at;
    const arrival = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? timestamp(raw) : null;
    if (arrival === null) return unavailable('Not enough timing data');
    if (arrival <= now) return awaiting();
    const seconds = (arrival - (snapshot ? stamp : now)) / 1000;
    const minutes = Math.max(1, Math.round(seconds/60));
    const duration = seconds < 60 ? 'Less than 1 min' : minutes < 60 ? `About ${minutes} min` : `About ${Math.floor(minutes/60)} hr${minutes%60 ? ` ${minutes%60} min` : ''}`;
    const clock = new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',hour:'numeric',minute:'2-digit'}).format(arrival);
    const day = time => new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',month:'short',day:'numeric'}).format(time);
    const date = day(arrival) === day(now) ? '' : ` · ${day(arrival)}`;
    return {...result,arrival:`~${clock} MT${date}`,remaining:duration+(snapshot ? ' at snapshot' : ''),
      note:snapshot ? 'Snapshot pace estimate · not live; not a recorded passage.' : 'Pace/terrain pilot estimate · not a recorded passage.',kind:snapshot ? 'snapshot' : 'estimate'};
  }
  return Object.freeze({finite,timestamp,refreshPosition,nearestFinish,finishView,racePhase,preferredRace,statusLabel,estimateExplanation,nextCheckpointEstimate,FRESH_SECONDS});
});
