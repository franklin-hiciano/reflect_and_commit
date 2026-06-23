// ── Reflection engine: black screen, one card at a time, blink between cards ───────
let currentRun=null;     // { runId, steps:[{nodeId,answer,next}], complete }
let tnode=null;
let _runSaveTimer=null;
let multiSel=new Set();

function currentRunId(){return currentRun?currentRun.runId:null;}
function firstNode(){return Object.keys(parsedTree)[0]||null;}
function totalNodes(){return Object.keys(parsedTree).length;}

// ── reflect entry, gated by the linter (only surfaces errors when you try to run) ──
function attemptReflect(){
  const t=document.getElementById('src-ta');
  const src=t?t.value:(_activeSrc||'');
  const{nodes,nl}=parse(src);
  if(!Object.keys(nodes).length)return;            // nothing to run
  const all=lint(src,nodes,nl);
  const errs=all.filter(e=>e.sev==='err');
  if(errs.length){
    // reveal the red marks + bottom error list, and don't run
    window._lintShown=true;
    window._errLines=new Set(all.filter(e=>e.line!=null&&e.sev==='err').map(e=>e.line));
    if(typeof renderLinter==='function')renderLinter(all);
    if(typeof updateEditor==='function')updateEditor();
    return;
  }
  startReflection();
}

// ── start / exit ──
function startReflection(){
  currentRun={runId:'run_'+Date.now(),steps:[],complete:false};
  multiSel=new Set();
  tnode=firstNode();
  const sc=document.getElementById('reflectScreen');if(sc)sc.classList.add('on');
  renderCard();
}
function exitReflection(){
  const sc=document.getElementById('reflectScreen');if(sc)sc.classList.remove('on');
  currentRun=null;tnode=null;
}

// ── card render ──
function renderCard(){
  const node=parsedTree[tnode];
  document.getElementById('rcardEnd').style.display='none';
  document.getElementById('rcardMain').style.display='';
  const step=(currentRun?currentRun.steps.length:0)+1;
  const total=Math.max(step,totalNodes());
  const idx=document.getElementById('rcardIdx');if(idx)idx.textContent=step+' / '+total;
  const ty=document.getElementById('rcardType');if(ty)ty.textContent=(node&&node.type==='text')?'TEXT RESPONSE':'CHOICE';
  setProgress((step-1)/total);
  const prompt=document.getElementById('rcardPrompt');if(prompt)prompt.textContent=node?node.title:'';
  const rc=document.getElementById('rcardRecall');if(rc)rc.innerHTML=buildRecall(node);
  const input=document.getElementById('rcardInput'),choices=document.getElementById('rcardChoices'),next=document.getElementById('rNext');
  if(node&&node.type==='text'){
    input.style.display='';choices.style.display='none';choices.innerHTML='';next.style.display='';
    const ip=document.getElementById('rInput');if(ip){ip.value='';setTimeout(()=>ip.focus(),60);}
  }else if(node){
    input.style.display='none';choices.style.display='';next.style.display='none';
    choices.innerHTML=node.opts.map((o,i)=>'<button class="ropt" onclick="chooseSingle('+i+')">'+esc(o.l)+'</button>').join('');
  }
  const back=document.getElementById('rBack');if(back)back.style.display=(currentRun&&currentRun.steps.length>0)?'':'none';
}
function setProgress(frac){const p=document.getElementById('reflectProg');if(p)p.style.width=Math.max(0,Math.min(1,frac))*100+'%';}
function buildRecall(node){
  if(!node||!node.refs||!node.refs.length)return'';
  let html='';
  node.refs.forEach(ref=>{
    const past=getPastAnswers(ref.nodeId,ref.a,ref.b);
    html+='<div class="recall"><div class="recall-hd">↩ you, '+ref.a+'–'+ref.b+'d ago · '+esc(ref.nodeId)+'</div>';
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
  const ip=document.getElementById('rInput');const text=(ip?ip.value:'').trim();
  if(ip){ip.value='';ip.blur();}
  advance({type:'text',text},node.def);
}
function onCardKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitCard();}}
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
  setProgress(1);
  _commitDateVal='';
  const ct=document.getElementById('commitText');if(ct)ct.value='';
  const dl=document.getElementById('commitDateLabel');if(dl)dl.textContent='add a date';
  const cd=document.getElementById('commitDate');if(cd)cd.value='';
  const en=document.getElementById('endNotes');if(en)en.style.display='none';
  const nt=document.getElementById('endNotesText');if(nt)nt.value=window._notes||'';
  refreshEndCommit();
  setTimeout(()=>{const c=document.getElementById('commitText');if(c)c.focus();},80);
}
function refreshEndCommit(){
  const ct=document.getElementById('commitText');const b=document.getElementById('endCommitGo');
  if(b)b.disabled=!(ct&&ct.value.trim()&&_commitDateVal);
}
function endCommit(){
  const text=document.getElementById('commitText').value.trim();
  if(!text||!_commitDateVal)return;
  if(window._addCommitment)window._addCommitment(text,_commitDateVal);
  exitReflection();
}
function endToggleNotes(){
  const en=document.getElementById('endNotes');if(!en)return;
  const showing=en.style.display!=='none';
  en.style.display=showing?'none':'';
  if(!showing){const nt=document.getElementById('endNotesText');if(nt){nt.value=window._notes||'';setTimeout(()=>nt.focus(),50);}}
}
function endNotesInput(){if(window._saveNotes)window._saveNotes(document.getElementById('endNotesText').value);}
function finishReflection(){exitReflection();}
