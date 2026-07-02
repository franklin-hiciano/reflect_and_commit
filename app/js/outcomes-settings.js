// ── Daily reminder (notifications), banner + popover, init ─────────────────────────
// Flow: the banner asks you to turn on reminders. Tapping "turn on" requests browser
// permission and then fires a real notification with a "Yes" button. The banner stays
// up until you confirm by tapping that notification, or tap "don't ask again".
const _hasNotif=(typeof Notification!=='undefined');
let _notifTimer=null,_swReg=null;

function notifTime(){return localStorage.getItem('notif_time')||'20:00';}
function setNotifTime(t){if(t)localStorage.setItem('notif_time',t);}
function notifConfirmed(){return localStorage.getItem('notif_confirmed')==='1';}

// ── reflect-window open time — split out from notif_time: notif_time is when the
// daily reminder fires, open_time is when the reflect window itself unlocks (read
// by run-engine.js's reflectWindowRange). Falls back to notifTime() until someone
// explicitly sets it apart via the bell, so nothing changes for existing users.
function openTime(){return localStorage.getItem('open_time')||notifTime();}
function setOpenTime(t){if(t)localStorage.setItem('open_time',t);}

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

// fire the confirmation notification (also used as “test”). As soon as permission is
// granted we confirm immediately — no waiting on the user to tap the OS notification —
// so pressing "turn on" retries/confirms instantly instead of hanging on a second step.
async function sendTestNotif(){
  if(!_hasNotif){refreshNotifUI();return;}
  let perm=Notification.permission;
  if(perm!=='granted'){try{perm=await Notification.requestPermission();}catch(e){perm='denied';}}
  if(perm!=='granted'){refreshNotifUI();return;}
  showNotif('Reflect & Commit',{
    body:'Notifications are on.',
    tag:'rc-confirm'
  });
  localStorage.setItem('notif_test_sent','1');
  confirmReminders();
}

// the user tapped the notification → reminders are confirmed working
function confirmReminders(){
  localStorage.setItem('notif_confirmed','1');
  localStorage.setItem('notif_enabled','1');
  scheduleNotif();
  showBannerPhase2();
}

function showBannerPhase2(){
  const status=document.getElementById('notiBannerStatus');
  const btn=document.getElementById('notiBannerBtn');
  const loud=document.getElementById('notiBannerLoud');
  const dismiss=document.getElementById('notiBannerDismiss');
  const time=document.getElementById('notiBannerTime');
  const done=document.getElementById('notiBannerDone');
  if(status)status.textContent='All set! What time each day?';
  if(btn)btn.style.display='none';
  if(loud)loud.style.display='none';
  if(dismiss)dismiss.style.display='none';
  if(time){time.style.display='';time.value=notifTime();}
  if(done)done.style.display='';
}

function onBannerTimeChange(){
  const t=document.getElementById('notiBannerTime');
  if(t)setNotifTime(t.value);
}

function onBannerDone(){
  const t=document.getElementById('notiBannerTime');
  if(t)setNotifTime(t.value);
  scheduleNotif();
  dismissNotiBanner();
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
  if(!status||!btn)return;
  const perm=_hasNotif?Notification.permission:'unsupported';
  const testSent=localStorage.getItem('notif_test_sent')==='1';
  let msg='Get a daily reminder to reflect.', label='turn on';
  if(!_hasNotif){msg="Notifications aren't supported in this browser.";}
  else if(!window.isSecureContext){msg='Open via http://localhost or https to enable reminders.';}
  else if(perm==='denied'){msg='Reminders are blocked — allow notifications in your browser settings.';label='retry';}
  else if(testSent&&perm==='granted'){msg='Tap the notification to confirm.';label='send again';}
  status.textContent=msg;
  btn.textContent=label;
  btn.onclick=sendTestNotif;
}
function dismissNotiBanner(){
  localStorage.setItem('notif_dismiss','1');
  const banner=document.getElementById('notiBanner');if(banner)banner.classList.remove('show');
  document.body.classList.remove('has-banner');
}

function refreshNotifUI(){checkNotiBanner();}

// ── notif bell popover — the one place both times get set together. Anchored
// under the bell normally; also reused (via .first-run + the backdrop) as the
// screen shown the very first time the app is opened, see onboarding.js. ───────
window._toggleNotifSettings=function(e){
  if(e)e.stopPropagation();
  const pop=document.getElementById('notifPop');
  if(!pop)return;
  if(pop.classList.contains('open')){
    window._closeNotifSettings();
    return;
  }
  const nt=document.getElementById('notifPopNotifyTime');if(nt)nt.value=notifTime();
  const ot=document.getElementById('notifPopOpenTime');if(ot)ot.value=openTime();
  pop.classList.add('open');
  setTimeout(()=>{document.addEventListener('click',_onNotifPopOutsideClick,{once:true});},0);
};
function _onNotifPopOutsideClick(e){
  const pop=document.getElementById('notifPop');
  if(!pop||pop.classList.contains('first-run'))return; // first-run only closes via "done"
  const wrap=document.querySelector('.notif-bell-wrap');
  if(wrap&&wrap.contains(e.target))return;
  pop.classList.remove('open');
}
window._onNotifPopChange=function(){
  const nt=document.getElementById('notifPopNotifyTime');
  const ot=document.getElementById('notifPopOpenTime');
  if(nt&&nt.value)setNotifTime(nt.value);
  if(ot&&ot.value)setOpenTime(ot.value);
  if(_hasNotif&&Notification.permission==='granted')scheduleNotif();
  if(typeof refreshReflectAvailability==='function')refreshReflectAvailability();
};
window._closeNotifSettings=function(){
  window._onNotifPopChange();
  const pop=document.getElementById('notifPop');
  if(!pop)return;
  const wasFirstRun=pop.classList.contains('first-run');
  pop.classList.remove('open','first-run');
  const intro=document.getElementById('notifPopIntro');if(intro)intro.style.display='none';
  const backdrop=document.getElementById('notifBackdrop');if(backdrop)backdrop.classList.remove('on');
  if(wasFirstRun){
    try{localStorage.setItem('rc_notif_settings_seen','1');}catch(e){}
    window._maybeShowIntroVideo&&window._maybeShowIntroVideo();
  }
};

// ── init ──
(function init(){
  initSW();
  initLoudBtn();
  if(typeof bindEditorEvents==='function')bindEditorEvents();
  if(typeof bindHolds==='function')bindHolds();
  checkNotiBanner();
  if(_hasNotif&&Notification.permission==='granted'&&notifConfirmed())scheduleNotif();
})();
