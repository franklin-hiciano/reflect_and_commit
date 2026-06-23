// Service worker: lets reminder notifications carry a real action button and reports
// back to the page when the user taps "Yes" (or the notification body) so we can confirm.
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil((async()=>{
    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of cs)c.postMessage({type:'notif-confirmed',action:e.action||'body'});
    if(cs[0]&&'focus'in cs[0]){try{await cs[0].focus();}catch(_){}}
  })());
});
