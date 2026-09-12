// Anonymous in-memory fixtures; no network or real participant histories.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  const source = fs.readFileSync('app.js','utf8');
  const modified = source.replace('  window.addEventListener("DOMContentLoaded", init);','  window.qa = {state,el,renderCheckpointHistory,openDetails,clearCheckpointHistory};');
  const window = {location:{hostname:'localhost',search:''},RutRules:require('./race-logic.js')};
  vm.runInNewContext(modified,{window,URLSearchParams,Map,Set,WeakMap,Date,Intl,console});
  const q=window.qa;
  for(const id of ['detailsDialog','detailsTitle','checkpointContent','guideContent','checkpointIdentity','checkpointStatus','checkpointList']) q.el[id]={open:false,hidden:false,textContent:'',innerHTML:'',dataset:{},scrollTop:0,showModal(){this.open=true;},close(){this.open=false;}};
  q.state.delivery='live_api';q.state.feedGeneratedAt=Date.now();q.state.selectedKey='qa:9';q.state.finishEventId='qa';q.state.manualLock=true;
  q.state.eventData.set('qa',{id:'qa',label:'QA 28K',split_names:['Start','Aid <script>','Finish']});
  const runner={key:'qa:9',event_id:'qa',id:9,name:'Anonymous QA',bib:9,checkpoint_passages_status:'recorded',checkpoint_passages_stale:false,checkpoint_passages:[{split_index:0,elapsed_seconds:0,passed_at:'2026-09-11T14:30:00Z'},{split_index:1,elapsed_seconds:3600,passed_at:'2026-09-11T15:30:00Z'}]};
  q.state.runners=[runner];return {q,runner};
}
test('history includes evidenced Start, checkpoint Mountain clock, elapsed and missing finish',()=>{
  const {q}=fixture();q.openDetails('checkpoints');
  assert.match(q.el.checkpointList.innerHTML,/Start/);assert.match(q.el.checkpointList.innerHTML,/8:30:00 AM/);
  assert.match(q.el.checkpointList.innerHTML,/9:30:00 AM/);assert.match(q.el.checkpointList.innerHTML,/1:00:00/);
  assert.match(q.el.checkpointList.innerHTML,/No recorded time/);assert.match(q.el.checkpointList.innerHTML,/0:00/);
  assert.doesNotMatch(q.el.checkpointList.innerHTML,/<script>/);assert.match(q.el.checkpointList.innerHTML,/Aid &lt;script&gt;/);
});
test('opening either bottom detail keeps both primary views and selection intact',()=>{
  for(const view of ['map','elevation']) {
    const {q}=fixture();q.state.viewMode=view;
    q.openDetails('checkpoints');assert.equal(q.el.detailsDialog.open,true);
    assert.equal(q.state.selectedKey,'qa:9');assert.equal(q.state.manualLock,true);assert.equal(q.state.finishEventId,'qa');assert.equal(q.state.viewMode,view);
    q.openDetails('guide');assert.equal(q.el.guideContent.hidden,false);assert.equal(q.el.checkpointContent.hidden,true);
    assert.equal(q.el.checkpointIdentity.textContent,'');assert.equal(q.el.checkpointList.innerHTML,'');
  }
});
test('history works for finished/locationless roster runner; never derives passage from progress',()=>{
  const {q,runner}=fixture();runner.status='FINISHED';runner.progress=1;runner.checkpoint_passages=[];
  q.openDetails('checkpoints');assert.equal((q.el.checkpointList.innerHTML.match(/No recorded time/g)||[]).length,3);
  assert.doesNotMatch(q.el.checkpointList.innerHTML,/8:30:00/);
});
test('missing clock retains elapsed without inventing Mountain timestamp',()=>{
  const {q,runner}=fixture();runner.checkpoint_passages=[{split_index:1,elapsed_seconds:90,passed_at:null}];q.openDetails('checkpoints');
  assert.match(q.el.checkpointList.innerHTML,/Clock time unavailable/);assert.match(q.el.checkpointList.innerHTML,/1:30/);
});
test('snapshot and stale histories remain labeled, but recorded times stay fixed',()=>{
  const {q,runner}=fixture();q.state.delivery='periodic_snapshot';q.openDetails('checkpoints');assert.match(q.el.checkpointStatus.textContent,/snapshot.*not live/i);
  const html=q.el.checkpointList.innerHTML;q.state.delivery='live_api';runner.checkpoint_passages_stale=true;q.renderCheckpointHistory();
  assert.match(q.el.checkpointStatus.textContent,/stale/i);assert.equal(q.el.checkpointList.innerHTML,html);
});
test('refresh removes prior identity while visible, closed and guide-open',()=>{
  const {q,runner}=fixture();runner.name='QA Old Identity';q.openDetails('checkpoints');
  runner.name='Anonymous';q.renderCheckpointHistory();assert.doesNotMatch(q.el.checkpointIdentity.textContent,/Old Identity/);
  q.el.detailsDialog.open=false;q.renderCheckpointHistory();assert.equal(q.el.checkpointIdentity.textContent,'');assert.equal(q.el.checkpointList.innerHTML,'');assert.equal(q.el.checkpointList.dataset.signature,'');
  q.openDetails('guide');q.renderCheckpointHistory();assert.equal(q.el.checkpointIdentity.textContent,'');
});
test('no selection and older API safely display no history',()=>{
  const {q,runner}=fixture();delete runner.checkpoint_passages;q.openDetails('checkpoints');assert.match(q.el.checkpointStatus.textContent,/unavailable/i);
  q.state.selectedKey=null;q.renderCheckpointHistory();assert.match(q.el.checkpointStatus.textContent,/Select a runner/);assert.equal(q.el.checkpointList.innerHTML,'');
});
test('bad numeric values, duplicate indexes and future dates cannot masquerade as reads',()=>{
  const {q,runner}=fixture();runner.checkpoint_passages=[{split_index:0,elapsed_seconds:null,passed_at:'2026-09-11T14:30:00Z'},{split_index:1,elapsed_seconds:Infinity,passed_at:'2026-09-11T14:30:00Z'},{split_index:2,elapsed_seconds:120,passed_at:'2099-01-01T00:00:00Z'}];
  q.openDetails('checkpoints');assert.doesNotMatch(q.el.checkpointList.innerHTML,/Infinity|NaN|2099/);assert.equal((q.el.checkpointList.innerHTML.match(/No recorded time/g)||[]).length,3);
  runner.checkpoint_passages=[{split_index:1,elapsed_seconds:90,passed_at:null},{split_index:1,elapsed_seconds:120,passed_at:null}];q.renderCheckpointHistory();assert.equal((q.el.checkpointList.innerHTML.match(/No recorded time/g)||[]).length,3);
});
test('unchanged history render preserves scroll and avoids list rebuilds',()=>{
  const {q}=fixture();q.openDetails('checkpoints');let html=q.el.checkpointList.innerHTML,writes=0;
  Object.defineProperty(q.el.checkpointList,'innerHTML',{get(){return html;},set(value){html=value;writes++;}});
  q.el.checkpointContent.scrollTop=150;q.renderCheckpointHistory();assert.equal(writes,0);assert.equal(q.el.checkpointContent.scrollTop,150);
});
