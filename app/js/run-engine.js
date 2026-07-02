// ── Reflection engine: black screen, one card at a time, blink between cards ───────
let currentRun=null;     // { runId, steps:[{nodeId,answer,next}], complete }
let tnode=null;
let _runSaveTimer=null;
let _commitSourceNode=null;   // node the user credits for this commitment (turns it gold)
let _holdTimer=null;          // "sit with this" timer on the "next" button for text nodes
let _holdTimerDone=false;     // has the timer elapsed for the CURRENT card
const HOLD_MS=2200;           // minimum time before commit can even be considered
const REFLECT_WINDOW_MIN=100; // the reflect window is this many minutes, starting at your reminder time

function currentRunId(){return currentRun?currentRun.runId:null;}
function firstNode(){return Object.keys(parsedTree)[0]||null;}

// ── reflect window: gated to a 100-minute window starting at your reminder time
// (js/outcomes-settings.js's notifTime(), default 8pm) — this isn't something you
// reach for at 2pm to get it out of the way; it happens once, at night. ──────────
function reflectWindowRange(){
  const time=(typeof notifTime==='function')?notifTime():'20:00';
  const parts=time.split(':').map(Number);
  const start=new Date();start.setHours(parts[0]||20,parts[1]||0,0,0);
  const end=new Date(start.getTime()+REFLECT_WINDOW_MIN*60000);
  return{start,end};
}
function withinReflectWindow(){
  const{start,end}=reflectWindowRange();
  const now=new Date();
  return now>=start&&now<=end;
}
function fmtClock(d){return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase();}
function refreshReflectAvailability(){
  const btn=document.querySelector('.reflect-btn');
  if(!btn)return;
  btn.classList.toggle('window-closed',!withinReflectWindow());
  const{start,end}=reflectWindowRange();
  btn.title='reflect · opens '+fmtClock(start)+', closes '+fmtClock(end);
}
setInterval(refreshReflectAvailability,30000);

// ── reflect entry — tree has to parse clean AND the window has to be open ──
function attemptReflect(){
  if(!Object.keys(parsedTree).length)return;
  if(window._parseErrors&&window._parseErrors.length){flashReflectError();return;}
  if(!withinReflectWindow()){flashReflectClosed();return;}
  startReflection();
}
function flashReflectError(){
  const btn=document.querySelector('.reflect-btn');
  if(!btn)return;
  btn.classList.remove('shake');
  void btn.offsetWidth; // restart the animation if it's already mid-shake
  btn.classList.add('shake');
  setTimeout(()=>btn.classList.remove('shake'),400);
}
function flashReflectClosed(){
  const btn=document.querySelector('.reflect-btn');
  if(!btn)return;
  const{start}=reflectWindowRange();
  const now=new Date();
  const label=now<start?('opens '+fmtClock(start)):('opens '+fmtClock(start)+' tomorrow');
  const original=btn.textContent;
  btn.textContent=label;
  btn.classList.remove('shake');
  void btn.offsetWidth;
  btn.classList.add('shake');
  setTimeout(()=>{btn.classList.remove('shake');btn.textContent=original;},1700);
}

// ── start / exit ──
function startReflection(){
  currentRun={runId:'run_'+Date.now(),steps:[],complete:false};
  tnode=firstNode();
  const sc=document.getElementById('reflectScreen');if(sc)sc.classList.add('on');
  renderCard();
}
function exitReflection(){
  const sc=document.getElementById('reflectScreen');if(sc)sc.classList.remove('on');
  clearHoldLock();
  currentRun=null;tnode=null;
}

// ── card render ──
function renderCard(){
  const node=parsedTree[tnode];
  document.getElementById('rcardEnd').style.display='none';
  document.getElementById('rcardMain').style.display='';
  const brand=document.getElementById('reflectTopBrand');if(brand)brand.textContent='reflect';
  const prompt=document.getElementById('rcardPrompt');if(prompt)prompt.textContent=node?node.title:'';
  const rc=document.getElementById('rcardRecall');if(rc)rc.innerHTML=buildRecall(node);
  updateReflectCounter();
  const input=document.getElementById('rcardInput'),choices=document.getElementById('rcardChoices'),next=document.getElementById('rNext');
  if(node&&node.type==='text'){
    input.style.display='';choices.style.display='none';choices.innerHTML='';next.style.display='';
    const ip=document.getElementById('rInput');if(ip){ip.value='';setTimeout(()=>ip.focus(),60);}
    bindReflectInputOnce();
    startHoldLock();
  }else if(node){
    input.style.display='none';choices.style.display='';next.style.display='none';
    choices.innerHTML=node.opts.map((o,i)=>'<button class="ropt" onclick="chooseSingle('+i+')">'+esc(o.l)+'</button>').join('');
    clearHoldLock();
  }
  // always allow going back — the record isn't a one-way door
  const back=document.getElementById('rBack');if(back)back.style.display=(currentRun&&currentRun.steps.length>0)?'':'none';
}

// ── "3 / 7" — which question you're on, out of how many the tree currently has.
// top-right corner of the card itself, not the screen chrome. (Branching means
// your actual path may end well before 7 — this is the tree's size, a sense of
// how much is here, not a literal countdown to the end.) ────────────────────────
function updateReflectCounter(){
  const el=document.getElementById('rcardCounter');if(!el)return;
  // completed / total — how many you've actually answered so far, not which
  // one you're currently on. Starts at 0, same as any honest progress count.
  const done=currentRun?currentRun.steps.length:0;
  const total=Object.keys(parsedTree||{}).length||Math.max(done,1);
  el.textContent=done+' / '+total;
}

// ── next only unlocks once BOTH are true: you've sat with the question for a
// beat (HOLD_MS), and you've actually filled the line — not just typed a few
// words into it. Two different kinds of "this is a real answer," checked together. ──
function lineFilled(){
  const ip=document.getElementById('rInput');
  if(!ip)return false;
  // has to overflow the box by a full width's worth of extra text, not just
  // spill past the edge — a couple overflowing characters isn't "filled the line"
  return ip.value.trim().length>0&&ip.scrollWidth>=ip.clientWidth*2;
}
function refreshNextGate(){
  const node=parsedTree[tnode];
  if(!node||node.type!=='text')return;
  const next=document.getElementById('rNext');
  if(!next)return;
  const ok=_holdTimerDone&&lineFilled();
  next.disabled=!ok;
  next.classList.toggle('locked',!ok);
}
function bindReflectInputOnce(){
  const ip=document.getElementById('rInput');
  if(!ip||ip._gateBound)return;
  ip._gateBound=true;
  ip.addEventListener('input',refreshNextGate);
}
function clearHoldLock(){
  clearTimeout(_holdTimer);_holdTimer=null;_holdTimerDone=false;
  const next=document.getElementById('rNext');if(next){next.classList.remove('locked');next.disabled=false;}
  const track=document.getElementById('rHoldTrack');if(track)track.style.display='none';
  const fill=document.getElementById('rHoldFill');if(fill)fill.style.width='0%';
}
function startHoldLock(){
  clearHoldLock();
  const track=document.getElementById('rHoldTrack'),fill=document.getElementById('rHoldFill');
  if(track)track.style.display='';
  refreshNextGate();
  const start=Date.now();
  const tick=()=>{
    const pct=Math.min(100,((Date.now()-start)/HOLD_MS)*100);
    if(fill)fill.style.width=pct+'%';
    if(pct>=100){
      _holdTimerDone=true;
      if(track)track.style.display='none';
      refreshNextGate();
      return;
    }
    _holdTimer=setTimeout(tick,60);
  };
  tick();
}
function buildRecall(node){
  if(!node||!node.title)return'';
  const sources=window._effectiveRecallSources?window._effectiveRecallSources(node.title):[];
  if(!sources||!sources.length)return'';
  let html='';
  sources.forEach(sourceId=>{
    const past=getPastAnswers(sourceId,1,7);
    // self-recall (the default) doesn't need to name the question — it's the one
    // right above. only label it when it's pulling from a DIFFERENT question.
    const hd=(sourceId===node.title)?'↩ you, 1–7d ago':'↩ you, 1–7d ago · '+esc(sourceId);
    html+='<div class="recall"><div class="recall-hd">'+hd+'</div>';
    if(!past.length)html+='<div class="recall-empty">nothing in this window</div>';
    else past.forEach(p=>{const dd=p.date?new Date(p.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';html+='<div class="recall-row"><span class="recall-date">'+esc(dd)+'</span><span class="recall-txt">'+esc(p.text.slice(0,160))+'</span></div>';});
    html+='</div>';
  });
  return html;
}

// ── answers / recall ──
function answerText(a){if(!a)return'';if(a.type==='text')return a.text||'';if(a.type==='single')return a.label||'';if(a.type==='multi')return(a.selected||[]).join(', ');return'';}
function getPastAnswers(nodeId,a,b){
  const lo=Math.min(a,b),hi=Math.max(a,b),now=Date.now(),newC=now-lo*86400000,oldC=now-hi*86400000,out=[];
  getTreeRuns(_activeTreeId).forEach(r=>{
    if(currentRun&&r.id===currentRun.runId)return;
    const ts=r.savedAt?new Date(r.savedAt).getTime():0;if(ts>newC||ts<oldC)return;
    (r.steps||[]).forEach(s=>{if(s.nodeId===nodeId&&s.answer){const txt=answerText(s.answer);if(txt)out.push({text:txt,date:r.savedAt});}});
  });
  return out.slice(0,12);
}

// ── autosave (silent — reflections save but aren't browsable) ──
function saveRunNow(){if(currentRun&&_activeTreeId&&window._saveRun)window._saveRun(_activeTreeId,currentRun);}
function saveRunSoon(){clearTimeout(_runSaveTimer);_runSaveTimer=setTimeout(saveRunNow,700);}

// ── advance (blink, no camera) ──
function advance(answer,next){
  currentRun.steps.push({nodeId:tnode,answer,next:next||'done'});
  const done=(!next||next==='done'||!parsedTree[next]);
  if(done){
    currentRun.complete=true;saveRunNow();
    blinkTo(()=>{tnode=null;showEndScreen();});
    return;
  }
  saveRunSoon();
  blinkTo(()=>{tnode=next;renderCard();});
}
function blinkTo(midFn){
  const card=document.getElementById('rcard');
  if(!card){midFn();return;}
  card.classList.add('blinking');
  setTimeout(midFn,220);
  setTimeout(()=>card.classList.remove('blinking'),460);
}
function chooseSingle(i){const node=parsedTree[tnode];if(!node)return;const o=node.opts[i];if(!o)return;advance({type:'single',label:o.l},o.n);}
function submitCard(){
  const node=parsedTree[tnode];if(!node||node.type!=='text')return;
  const next=document.getElementById('rNext');if(next&&next.disabled)return; // still on hold
  const ip=document.getElementById('rInput');const text=(ip?ip.value:'').trim();
  if(ip){ip.value='';ip.blur();}
  advance({type:'text',text},node.def);
}
function onCardKey(e){
  if(e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    const next=document.getElementById('rNext');if(next&&next.disabled)return;
    submitCard();
  }
}
function runBack(){
  if(!currentRun||!currentRun.steps.length)return;
  const s=currentRun.steps.pop();currentRun.complete=false;saveRunSoon();
  blinkTo(()=>{tnode=s.nodeId;renderCard();});
}
// textbox grows to a sensible number of lines per screen size, then scrolls
function autoGrowInput(el){
  if(!el)return;el.style.height='auto';
  const lines=(window.innerWidth<=680?8:15);
  el.style.height=Math.min(el.scrollHeight,lines*26)+'px';
}

// ── commitment node (end of every path) ──
function showEndScreen(){
  document.getElementById('rcardMain').style.display='none';
  const end=document.getElementById('rcardEnd');end.style.display='';
  const brand=document.getElementById('reflectTopBrand');if(brand)brand.textContent='commit';
  _commitDateVal='';
  const ct=document.getElementById('commitText');if(ct)ct.value='';
  const dl=document.getElementById('commitDateLabel');if(dl)dl.textContent='add a date';
  const cd=document.getElementById('commitDate');if(cd)cd.value='';
  const en=document.getElementById('endNotes');if(en)en.style.display='none';
  const nt=document.getElementById('endNotesText');if(nt)nt.value=window._notes||'';
  _commitSourceNode=null;
  const pop=document.getElementById('commitNodePop');if(pop)pop.style.display='none';
  const nb=document.getElementById('commitNodeBtn');if(nb)nb.classList.remove('on');
  refreshEndCommit();
  setTimeout(()=>{const c=document.getElementById('commitText');if(c)c.focus();},80);
}

// ── "which question led you here?" — credit a node, which turns its response gold ──
function commitRunNodes(){
  if(!currentRun)return[];
  const seen=new Set(),out=[];
  currentRun.steps.forEach(s=>{if(s.nodeId&&!seen.has(s.nodeId)){seen.add(s.nodeId);out.push(s.nodeId);}});
  return out;
}
function branchCountOf(id){
  const n=parsedTree[id];if(!n)return 0;
  if(n.type==='single')return n.opts.length;
  return(n.def&&n.def!=='done')?1:0;
}
function commitCountOf(id){return(window._commitments||[]).filter(c=>c.sourceNode===id).length;}
function toggleCommitNodePop(){
  const pop=document.getElementById('commitNodePop');if(!pop)return;
  if(pop.style.display!=='none'){pop.style.display='none';return;}
  renderCommitNodePop();pop.style.display='';
}
function renderCommitNodePop(){
  const pop=document.getElementById('commitNodePop');if(!pop)return;
  const ids=commitRunNodes();
  if(!ids.length){pop.innerHTML='<div class="cnp-empty">no path to credit yet</div>';return;}
  let html='<div class="cnp-h">which question led you here?</div>';
  ids.forEach((id,i)=>{
    const rc=branchCountOf(id),cc=commitCountOf(id),meta=[];
    if(rc)meta.push(rc+(rc===1?' reply':' replies'));            // hide when no replies
    if(cc)meta.push(cc+(cc===1?' commitment':' commitments'));   // hide when no commitments
    const sel=(_commitSourceNode===id)?' sel':'';
    html+='<button class="cnp-item'+sel+'" onclick="pickCommitNode('+i+')">'
        +'<span class="cnp-txt">'+esc(id)+'</span>'
        +(meta.length?'<span class="cnp-meta">'+esc(meta.join('  ·  '))+'</span>':'')
        +'</button>';
  });
  pop.innerHTML=html;
}
function pickCommitNode(i){
  const ids=commitRunNodes();const id=ids[i];if(id==null)return;
  _commitSourceNode=(_commitSourceNode===id)?null:id;
  renderCommitNodePop();
  const btn=document.getElementById('commitNodeBtn');if(btn)btn.classList.toggle('on',!!_commitSourceNode);
}
function refreshEndCommit(){
  const ct=document.getElementById('commitText');const b=document.getElementById('endCommitGo');
  if(b)b.disabled=!(ct&&ct.value.trim()&&_commitDateVal);
}
function endCommit(){
  const text=document.getElementById('commitText').value.trim();
  if(!text||!_commitDateVal)return;
  if(window._addCommitment)window._addCommitment(text,_commitDateVal,_commitSourceNode);
  exitReflection();
  // teach "reflections compound" right after someone lands their first real commitment —
  // not before they've used the app at all. _maybeShowCompoundCard no-ops after night one.
  // it chains into the "make it a habit" install popup on dismiss so the two never stack;
  // if it's already been seen, show the habit popup straight away.
  let compoundWillShow=false;
  try{compoundWillShow=localStorage.getItem('rc_compound_seen')!=='1';}catch(e){}
  if(window._maybeShowCompoundCard)window._maybeShowCompoundCard();
  if(!compoundWillShow&&window._maybeShowHabitPopup)window._maybeShowHabitPopup();
}
function endToggleNotes(){
  const en=document.getElementById('endNotes');if(!en)return;
  const showing=en.style.display!=='none';
  en.style.display=showing?'none':'';
  if(!showing){const nt=document.getElementById('endNotesText');if(nt){nt.value=window._notes||'';setTimeout(()=>nt.focus(),50);}}
}
function endNotesInput(){if(window._saveNotes)window._saveNotes(document.getElementById('endNotesText').value);}
function finishReflection(){
  // "finish without committing" and "return" don't trigger the habit popup — it's
  // reserved for after a real commitment (endCommit) or the manual FAB button.
  exitReflection();
}
