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
  return Object.freeze({finite,timestamp,refreshPosition,nearestFinish,finishView,FRESH_SECONDS});
});
