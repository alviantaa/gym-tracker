/* Gym Tracker service worker (optional): opens the app offline. Bump V when you upload new files. */
const V='gym-v9', FILES=['Index.html','app.js','dash.js','coach.js','manifest.json','icon-192.png','apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(FILES.map(f=>c.add(new Request(f,{cache:'reload'})).catch(()=>{})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET'||new URL(r.url).origin!==location.origin) return;
  e.respondWith(caches.open(V).then(c=>c.match(r,{ignoreSearch:true}).then(hit=>{
    const net=fetch(r).then(x=>{if(x.ok)c.put(r,x.clone());return x;}).catch(()=>hit);
    return hit||net;})));
});
