// ── Daily reminder (notifications), banner + popover, init ─────────────────────────
// Flow: the banner asks you to turn on reminders. Tapping "turn on" requests browser
// permission and then fires a real notification with a "Yes" button. The banner stays
// up until you confirm by tapping that notification, or tap "don't ask again".
const _hasNotif=(typeof Notification!=='undefined');
let _notifTimer=null,_swReg=null;

function notifTime(){return localStorage.getItem('notif_time')||'20:00';}
function setNotifTime(t){if(t)localStorage.setItem('notif_time',t);}
function notifConfirmed(){return localStorage.getItem('notif_confirmed')==='1';}

// ── loud notifications (vibration + requireInteraction) ──
function loudEnabled(){return localStorage.getItem('notif_loud')==='1';}
function toggleLoudNotif(){
  const on=!loudEnabled();
  localStorage.setItem('notif_loud',on?'1':'0');
  const btn=document.getElementById('notiBannerLoud');
  if(btn){btn.classList.toggle('on',on);btn.title=on?'loud on (vibration + persistent)':'loud off';}
  // try to vibrate on toggle so they feel it
  if(on&&navigator.vibrate){navigator.vibrate([100,50,100]);}
}
function initLoudBtn(){
  const btn=document.getElementById('notiBannerLoud');
  if(!btn)return;
  const on=loudEnabled();
  btn.classList.toggle('on',on);
  btn.title=on?'loud on (vibration + persistent)':'loud (tap to enable vibration)';
}

function scheduleNotif(){
  if(!_hasNotif||Notification.permission!=='granted')return;
  const time=notifTime();clearTimeout(_notifTimer);
  const[h,m]=time.split(':').map(Number);const now=new Date(),target=new Date();target.setHours(h,m,0,0);
  if(target<=now)target.setDate(target.getDate()+1);
  _notifTimer=setTimeout(function fire(){showNotif('Reflect & Commit',{body:'Time to reflect on your day.'});_notifTimer=setTimeout(fire,86400000);},target-now);
}
function clearSchedule(){clearTimeout(_notifTimer);}

// register the service worker (needs a secure context — https or localhost, not file://)
async function initSW(){
  if(!('serviceWorker'in navigator)||!window.isSecureContext)return;
  try{_swReg=await navigator.serviceWorker.register('sw.js');}catch(e){_swReg=null;}
}
if('serviceWorker'in navigator){
  navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.type==='notif-confirmed')confirmReminders();});
}

// show a notification — via the service worker (so it can have a "Yes" button) when
// available, otherwise a plain clickable notification as a fallback.
async function showNotif(title,opts){
  if(!_hasNotif||Notification.permission!=='granted')return false;
  // loud mode: vibrate + requireInteraction
  if(loudEnabled()){
    opts={...opts,requireInteraction:true,vibrate:[200,100,200,100,200]};
    if(navigator.vibrate)navigator.vibrate([200,100,200,100,200]);
  }
  try{
    if(_swReg&&_swReg.showNotification){await _swReg.showNotification(title,opts);return true;}
  }catch(e){}
  try{const n=new Notification(title,opts);n.onclick=()=>{try{window.focus();}catch(_){}confirmReminders();n.close();};return true;}
  catch(e){return false;}
}

// fire the confirmation notification (also used as "test")
async function sendTestNotif(){
  if(!_hasNotif){refreshNotifUI();return;}
  let perm=Notification.permission;
  if(perm!=='granted'){try{perm=await Notification.requestPermission();}catch(e){perm='denied';}}
  if(perm!=='granted'){refreshNotifUI();return;}
  const ok=await showNotif('Reflect & Commit',{
    body:'Tap “Yes, keep them on” to finish — or tap this notification.',
    tag:'rc-confirm',requireInteraction:true,
    actions:[{action:'yes',title:'Yes, keep them on'}]
  });
  // surface a hint if the OS swallowed it (Focus mode, browser notifications off, file://)
  const np=document.getElementById('npStatus');
  if(np&&ok)np.textContent='sent — check your notifications, then tap it to confirm';
  refreshNotifUI();
}

// the user tapped the notification → reminders are confirmed working
function confirmReminders(){
  localStorage.setItem('notif_confirmed','1');
  localStorage.setItem('notif_enabled','1');
  scheduleNotif();
  refreshNotifUI();
}

// ── top banner ──
function bannerVisible(){
  if(!_hasNotif)return false;
  if(localStorage.getItem('notif_dismiss')==='1')return false;
  return !notifConfirmed();
}
function checkNotiBanner(){
  const banner=document.getElementById('notiBanner');if(!banner)return;
  const show=bannerVisible();
  banner.classList.toggle('show',show);
  document.body.classList.toggle('has-banner',show);
  if(show)updateNotiBanner();
}
function updateNotiBanner(){
  const status=document.getElementById('notiBannerStatus');
  const btn=document.getElementById('notiBannerBtn');
  const time=document.getElementById('notiBannerTime');
  if(time)time.value=notifTime();
  const perm=_hasNotif?Notification.permission:'unsupported';
  let msg='Get a daily nudge to reflect.',label='turn on';
  if(!_hasNotif)msg='Notifications aren’t supported in this browser.';
  else if(!window.isSecureContext)msg='Open this app via http://localhost or https to enable reminders.';
  else if(perm==='denied'){msg='Reminders are blocked — allow notifications in your browser, then tap test.';label='retry';}
  else if(perm==='granted')msg='Tap the notification we send you to confirm reminders work.';
  if(status)status.textContent=msg;
  if(btn){btn.textContent=label;btn.onclick=sendTestNotif;}
}
function dismissNotiBanner(){
  localStorage.setItem('notif_dismiss','1');
  const banner=document.getElementById('notiBanner');if(banner)banner.classList.remove('show');
  document.body.classList.remove('has-banner');
}

// ── reminder popover (by the profile pic) ──
function toggleNotifPop(e){
  if(e)e.stopPropagation();
  const pop=document.getElementById('notifPop');if(!pop)return;
  if(pop.classList.toggle('on'))renderNotifPop();
}
function closeNotifPop(){const pop=document.getElementById('notifPop');if(pop)pop.classList.remove('on');}
function renderNotifPop(){
  const time=document.getElementById('npTime'),status=document.getElementById('npStatus'),toggle=document.getElementById('npToggle');
  if(time)time.value=notifTime();
  if(!_hasNotif){if(status)status.textContent='notifications aren’t available here.';if(toggle)toggle.style.display='none';return;}
  const perm=Notification.permission,on=notifConfirmed();
  if(status)status.textContent=perm==='denied'?'blocked in your browser settings'
    :(on?'on — you’ll be reminded daily':(perm==='granted'?'tap the notification to confirm':'off'));
  if(toggle){toggle.textContent=on?'disable':'enable';toggle.classList.toggle('on',on);}
}
async function npToggleEnable(){
  if(!_hasNotif)return;
  if(notifConfirmed()){
    localStorage.setItem('notif_confirmed','0');localStorage.setItem('notif_enabled','0');clearSchedule();refreshNotifUI();
  }else{
    await sendTestNotif();
  }
}
function onNotifTimeChange(){
  const t=document.getElementById('npTime');setNotifTime(t?t.value:notifTime());
  if(notifConfirmed())scheduleNotif();
  refreshNotifUI();
}

function refreshNotifUI(){renderNotifPop();checkNotiBanner();}

// ── init ──
(function init(){
  initSW();
  initLoudBtn();
  if(typeof bindEditorEvents==='function')bindEditorEvents();
  if(typeof bindHolds==='function')bindHolds();
  if(typeof setPane==='function')setPane(0);
  if(typeof renderRun==='function')renderRun();
  checkNotiBanner();
  if(_hasNotif&&Notification.permission==='granted'&&notifConfirmed())scheduleNotif();
  // close the reminder popover on outside click
  document.addEventListener('click',e=>{
    const pop=document.getElementById('notifPop');if(!pop||!pop.classList.contains('on'))return;
    if(e.target.closest('#notifPop')||e.target.closest('#notifIconBtn'))return;
    pop.classList.remove('on');
  });
  let rz=null;
  window.addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>{if(typeof renderEditCanvas==='function')renderEditCanvas();if(typeof refreshRunCanvas==='function')refreshRunCanvas();},200);});
})();
