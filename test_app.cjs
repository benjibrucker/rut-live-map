// In-memory integration fixtures; no network or participant records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rules = require('./race-logic.js');
function fixture(delivery, age) {
 const source=fs.readFileSync('app.js','utf8');
 const modified=source.replace('  window.addEventListener("DOMContentLoaded", init);','  window.qa = {state,el,renderFinishWatch,finishWatchRows};');
 assert.ok(modified!==source, 'Expected startup hook must be present');
 const window={location:{hostname:'benjibrucker.github.io',search:''},RUT_CONFIG:{apiBase:'https://example.invalid'},RutRules:rules};
 vm.runInNewContext(modified,{window,URLSearchParams,Map,Set,Date,Intl,console});
 const {state,el}=window.qa;
 for (const name of ['finishRace','finishCount','finishStatus','finishExcluded','finishList']) el[name]={dataset:{},value:'',innerHTML:'',textContent:'',querySelectorAll:()=>[]};
 const row={key:'race:1',id:1,event_id:'race',name:'QA fixture',status:'ON COURSE',source:'ESTIMATED',rank_eligible:true,remaining_m:50};
 state.eventData.set('race',{id:'race',label:'QA race'});state.finishEventId='race';state.positions.set(row.key,row);state.snapshotPositions=[row];state.delivery=delivery;state.feedGeneratedAt=Date.now()-age*1000;
 window.qa.renderFinishWatch();
 return window.qa;
}
test('configured live API does not relabel a fallback snapshot live',()=>{
 for (const age of [30,120]) {
  const q=fixture('periodic_snapshot',age);
  assert.equal(q.finishWatchRows().length,1);
  assert.match(q.el.finishStatus.textContent,/SNAPSHOT ORDER · NOT LIVE/);
  assert.doesNotMatch(q.el.finishStatus.textContent,/checks every 15s/);
 }
});
test('actual live delivery retains the strict 90-second ranking limit',()=>{
 const q=fixture('live_api',120);
 assert.equal(q.finishWatchRows().length,0);
 assert.match(q.el.finishStatus.textContent,/paused/);
});
