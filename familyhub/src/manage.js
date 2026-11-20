/* Manage booking: view, move or cancel (demo backend in hub-core.js). */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api,box=document.getElementById('mg');
var IC={cal:'<rect height="15" rx="2.5" width="17" x="3.5" y="5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',pin:'<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
 check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',back:'<path d="M15 6l-6 6 6 6"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',move:'<path d="M4 12h13M13 7l5 5-5 5"/>',
 phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',heart:'<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
 info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'};
function svg(k){return '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}
function tok(){var m=location.hash.match(/t=([a-z0-9]+)/i);return m&&m[1]}
function appt(b){var p=P[b.pid],t=new Date(b.start);
 return '<div class="bk-appt"><img src="'+H.photo(b.pid)+'" alt="" width="64" height="64"><div><b>'+esc(p.name)+'</b><span>'+svg('cal')+esc(F.day(t,1))+', '+F.time(t)+' ('+(b.len||p.len)+' min)</span><span>'+svg('pin')+(b.how==='online'?'Video or phone':'At the Hub, Jan Juc Village, Stuart Ave')+'</span>'+(b.service?'<span class="mg-svc">'+esc(b.service)+'</span>':'')+'</div></div>'}

function list(){api.myBookings().then(function(bs){
 bs=bs.filter(function(b){return b.status==='booked'}).sort(function(a,b){return new Date(a.start)-new Date(b.start)});
 if(!bs.length){box.innerHTML='<h2 class="fd-q">No bookings on this device</h2><p class="fd-sub">Use the link in your confirmation text, or call us on <a href="tel:0491184788">0491 184 788</a>.</p><a class="btn btn-primary" href="book.html">Book an appointment</a><p class="bk-demo">Demo: book a time on the booking page first, then come back here.</p>';return}
 box.innerHTML='<h2 class="fd-q">Your upcoming appointments</h2><ul class="mg-list">'+bs.map(function(b){return '<li><a class="mg-item" href="#t='+b.token+'">'+appt(b)+'</a></li>'}).join('')+'</ul>'})}

function show(b){
 if(!b){box.innerHTML='<h2 class="fd-q">We couldn’t find that booking</h2><p class="fd-sub">The link may be old. Call us on <a href="tel:0491184788">0491 184 788</a> and we’ll sort it out.</p>';return}
 if(b.status==='cancelled'){box.innerHTML='<h2 class="fd-q">This appointment was cancelled</h2>'+appt(b)+'<a class="btn btn-primary" href="book.html">Book a new time</a>';return}
 var late=new Date(b.start).getTime()-H.now()<24*36e5;
 box.innerHTML='<h2 class="fd-q" tabindex="-1">Hi '+esc(b.name.split(' ')[0])+', you’re booked in</h2>'+appt(b)+
  '<div class="mg-acts"><button type="button" class="btn btn-primary" data-move>'+svg('move')+'Move to another time</button><button type="button" class="btn btn-outline" data-cancel>'+svg('x')+'Cancel appointment</button></div>'+
  (late?'<p class="mg-warn">'+svg('info')+'This appointment is less than 24 hours away. Cancelling now may mean a late cancellation fee.</p>':'')+
  '<p class="bk-demo"><a href="manage.html">All my bookings</a></p>';
 box.querySelector('[data-move]').onclick=function(){move(b)};
 box.querySelector('[data-cancel]').onclick=function(){cancel(b,late)}}

function move(b){
 box.innerHTML='<button type="button" class="fd-back" data-b>'+svg('back')+'Back</button><h2 class="fd-q">Pick a new time with '+esc(P[b.pid].first)+'</h2><p class="fd-sub">Your current time is '+esc(F.when(b.start))+'. It’s only released once you confirm.</p><div class="fd-times" id="mgT"><div class="fd-skel"><span></span><span></span><span></span></div></div>';
 box.querySelector('[data-b]').onclick=function(){show(b)};
 api.slots([b.pid],28).then(function(r){var g=[],cur=null;(r[b.pid]||[]).forEach(function(d){var k=d.toDateString();if(!cur||cur.k!==k){cur={k:k,d:d,t:[]};g.push(cur)}cur.t.push(d)});
  var el=document.getElementById('mgT');
  if(!g.length){el.innerHTML='<p class="fd-none">No other times in the next four weeks. Keep your booking, or call us.</p>';return}
  el.innerHTML='<div class="fd-days">'+g.slice(0,8).map(function(day){return '<div class="fd-day"><span class="fd-dname">'+esc(F.day(day.d))+'</span><div class="fd-chips">'+day.t.map(function(t){return '<button type="button" class="fd-chip" data-t="'+t.toISOString()+'">'+F.time(t)+'</button>'}).join('')+'</div></div>'}).join('')+'</div>';
  el.onclick=function(e){var c=e.target.closest('[data-t]');if(!c)return;var t=c.dataset.t;
   box.innerHTML='<h2 class="fd-q">Move your appointment?</h2><div class="mg-from"><s>'+esc(F.when(b.start))+'</s> → <b>'+esc(F.day(t,1))+', '+F.time(t)+'</b></div>'+
    '<div class="mg-acts"><button type="button" class="btn btn-primary" data-yes>'+svg('check')+'Yes, move it</button><button type="button" class="btn btn-outline" data-no>Pick another time</button></div>';
   box.querySelector('[data-no]').onclick=function(){move(b)};
   box.querySelector('[data-yes]').onclick=function(){this.disabled=true;api.reschedule(b.token,t).then(function(r){
    if(!r.ok){box.insertAdjacentHTML('beforeend','<p class="bk-err">Someone just took that time. Pick another.</p>');setTimeout(function(){move(b)},1400);return}
    box.innerHTML='<div class="bk-done"><span class="bk-tick">'+svg('check')+'</span><h2 class="fd-q">Moved</h2><p>We’ve texted you the new time.</p></div>'+appt(r.booking)+'<p class="bk-demo"><a href="#t='+b.token+'">Back to my booking</a></p>'})}}})}

function cancel(b,late){
 var reason='';
 box.innerHTML='<button type="button" class="fd-back" data-b>'+svg('back')+'Back</button><h2 class="fd-q">Cancel your appointment?</h2>'+appt(b)+
  '<div class="fd-group"><h3>What’s happened? (optional)</h3><div class="fd-pills">'+['Unwell','Something came up','Feeling better','Booked by mistake','Other'].map(function(r){return '<button type="button" class="fd-pill" data-r="'+r+'" aria-pressed="false">'+r+'</button>'}).join('')+'</div></div>'+
  (late?'<p class="mg-warn">'+svg('info')+'This is less than 24 hours away, so a late cancellation fee may apply.</p>':'')+
  '<div class="mg-acts"><button type="button" class="btn btn-primary mg-danger" data-yes>'+svg('x')+'Yes, cancel it</button><button type="button" class="btn btn-outline" data-mv>Move it instead</button></div>';
 box.querySelector('[data-b]').onclick=function(){show(b)};
 box.querySelector('[data-mv]').onclick=function(){move(b)};
 box.onclick=function(e){var p=e.target.closest('[data-r]');if(!p)return;reason=p.dataset.r;[].forEach.call(box.querySelectorAll('[data-r]'),function(x){x.setAttribute('aria-pressed',x===p)})};
 box.querySelector('[data-yes]').onclick=function(){this.disabled=true;api.cancel(b.token,reason).then(function(){box.onclick=null;
  box.innerHTML='<div class="bk-done"><span class="bk-tick">'+svg('heart')+'</span><h2 class="fd-q">Cancelled. Thank you.</h2><p>Letting us know means someone on our waitlist can have your spot. We’ve just texted them.</p></div>'+
   '<div class="mg-acts"><a class="btn btn-primary" href="book.html">Book a new time</a></div><p class="bk-demo">Demo: the <a href="admin.html" target="_blank" rel="noopener">Hub dashboard</a> shows the offer going out.</p>'})}}

function route(){var t=tok();if(t)api.booking(t).then(show);else list()}
window.addEventListener('hashchange',route);route();
})();
