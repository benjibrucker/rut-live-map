const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./race-logic.js');
const NOW = Date.parse('2026-09-11T22:00:00Z');
const row = (id, remaining, extra = {}) => ({id, key:`race:${id}`, event_id:'race', status:'ON COURSE', source:'ESTIMATED', rank_eligible:true, remaining_m:remaining, ...extra});
test('numeric missing values are not zero', () => {
  for (const x of [null, undefined, '', ' ', false, [], {}, Infinity, 'NaN']) assert.equal(R.finite(x), false);
  for (const x of [0, '0', 1.2]) assert.equal(R.finite(x), true);
});
test('GPS freshness is timestamp based, including unselected records', () => {
  const stale = R.refreshPosition(row(1,10,{source:'GPS',freshness:'LIVE',recorded_at:'2026-09-11T21:55:00Z'}),NOW);
  assert.equal(stale.freshness,'STALE'); assert.equal(stale.rank_eligible,false);
  for (const recorded_at of [null,'bad','2026-09-11T22:01:00Z']) assert.equal(R.refreshPosition(row(1,10,{source:'GPS',recorded_at}),NOW).freshness,'STALE');
});
test('ten nearest sorts meters within one race and caps actual eligible records', () => {
  const rows = Array.from({length:15},(_,i)=>row(i,(15-i)*100));
  rows.push(row(99,1,{event_id:'other'}));
  const nearest=R.nearestFinish(rows,'race',NOW,NOW);
  assert.equal(nearest.length,10); assert.equal(nearest[0].id,14); assert.equal(nearest.at(-1).id,5);
});
test('held, finished, invalid, unknown and stale positions do not fill top ten', () => {
 const rows=[row(1,20),row(2,0,{status:'FINISHED'}),row(3,null),row(4,-1),row(5,5,{estimate_overdue:true}),row(6,1,{rank_eligible:false}),row(7,1,{source:'GPS',recorded_at:'2026-09-11T21:00:00Z'})];
 assert.deepEqual(R.nearestFinish(rows,'race',NOW,NOW).map(p=>p.id),[1]);
 assert.equal(R.nearestFinish(rows,'race',NOW,NOW-91000).length,0);
});
test('fresh GPS distance ranks without numeric progress', () => {
 const rows=[row(1,50,{progress:null,source:'GPS',recorded_at:'2026-09-11T21:59:55Z'}),row(2,900,{progress:0.9})];
 assert.equal(R.nearestFinish(rows,'race',NOW,NOW)[0].id,1);
});
test('server-degraded GPS cannot regain a live badge', () => {
 const stale = row(1,20,{source:'GPS',freshness:'STALE',recorded_at:'2026-09-11T21:59:55Z'});
 assert.equal(R.refreshPosition(stale,NOW).freshness,'STALE');
 assert.equal(R.nearestFinish([stale],'race',NOW,NOW).length,0);
});
test('snapshot order describes capture time and expires rather than renewing live status', () => {
 const captured=NOW-240000;
 const sample=row(1,20,{source:'GPS',freshness:'LIVE',recorded_at:new Date(captured-5000).toISOString()});
 assert.equal(R.finishView([sample],'race',NOW,captured,true).length,1);
 assert.equal(R.finishView([sample],'race',NOW,captured,false).length,0);
 assert.equal(R.finishView([sample],'race',NOW,captured-900000,true).length,0);
 assert.equal(R.refreshPosition(sample,NOW).freshness,'STALE');
});
test('tie ordering stable without mutating source collection', () => {
 const rows=[row(2,50),row(1,50)];
 assert.deepEqual(R.nearestFinish(rows,'race',NOW,NOW).map(p=>p.id),[1,2]);
 assert.equal(rows[0].id,2);
});
