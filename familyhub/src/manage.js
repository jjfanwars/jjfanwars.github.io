/* Manage booking: view, join, move or cancel, upload a plan, regular sessions (demo backend in hub-core.js). */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api,box=document.getElementById('mg');
var IC={cal:'<rect height="15" rx="2.5" width="17" x="3.5" y="5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',pin:'<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
 check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',back:'<path d="M15 6l-6 6 6 6"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',move:'<path d="M4 12h13M13 7l5 5-5 5"/>',
 phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',heart:'<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
 info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',video:'<rect x="3.5" y="6.5" width="12" height="11" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3"/>',
 file:'<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M9 13h6M9 16.5h4"/>',bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
 repeat:'<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',shield:'<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/>'};
function svg(k){return '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}
function tok(){var m=location.hash.match(/t=([a-z0-9]+)/i);return m&&m[1]}
var MODE={in:['pin','At the Hub, 16 Princes Tce, Jan Juc'],video:['video','Video call'],phone:['phone','Phone call']};
function appt(b){var p=P[b.pid],t=new Date(b.start),m=MODE[b.mode||'in'];
 return '<div class="bk-appt"><img src="'+H.photo(b.pid)+'" alt="" width="64" height="64"><div><b>'+esc(p.name)+'</b><span>'+svg('cal')+esc(F.day(t,1))+', '+F.time(t)+' ('+(b.len||p.len)+' min)</span><span>'+svg(m[0])+m[1]+'</span>'+
  (b.series?'<span>'+svg('repeat')+'Session '+b.series.n+' of '+b.series.of+', '+(b.series.every===7?'weekly':'every 2 weeks')+'</span>':'')+(b.service?'<span class="mg-svc">'+esc(b.service)+'</span>':'')+'</div></div>'}
function hrsLeft(b){return (new Date(b.start).getTime()-H.now())/36e5}
function polOf(b){var pol=api.policy(b.pid);return {hrs:b.policy?b.policy.hrs:pol.hrs,fee:b.policy?b.policy.fee:pol.fee}}

// ---------- calendar (same as the booking page) ----------
function zt(d){return new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'')}
function where(b){return b.mode==='video'?'Video call: https://sfch.au/v/'+b.token:b.mode==='phone'?'Phone call to '+b.phone:'Surf Coast Family Hub, 16 Princes Tce, Jan Juc VIC 3228'}
function ics(bs){var out='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Surf Coast Family Hub//Booking//EN\r\n';
 bs.forEach(function(b){var s=new Date(b.start),e=new Date(s.getTime()+(b.len||P[b.pid].len)*6e4);
  out+='BEGIN:VEVENT\r\nUID:'+b.id+'@surfcoastfamilyhub\r\nDTSTAMP:'+zt(new Date())+'\r\nDTSTART:'+zt(s)+'\r\nDTEND:'+zt(e)+'\r\nSUMMARY:Appointment with '+P[b.pid].name+'\r\nLOCATION:'+where(b).replace(/,/g,'\\,')+'\r\nEND:VEVENT\r\n'});
 return out+'END:VCALENDAR\r\n'}
function gcal(b){var s=new Date(b.start),e=new Date(s.getTime()+(b.len||P[b.pid].len)*6e4);
 return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent('Appointment with '+P[b.pid].name)+'&dates='+zt(s)+'/'+zt(e)+'&location='+encodeURIComponent(where(b))}
function cal(bs){var url=URL.createObjectURL(new Blob([ics(bs)],{type:'text/calendar'}));
 return '<div class="bk-cal"><p>'+svg('cal')+'Add to your calendar</p><div class="bk-calb"><a class="btn btn-outline btn-sm" href="'+url+'" download="hub-appointment.ics">Apple / iPhone</a><a class="btn btn-outline btn-sm" href="'+gcal(bs[0])+'" target="_blank" rel="noopener">Google</a><a class="btn btn-outline btn-sm" href="'+url+'" download="hub-appointment.ics">Outlook</a><a class="btn btn-outline btn-sm" href="'+url+'" download="hub-appointment.ics">Other (.ics)</a></div></div>'}

function list(){api.myBookings().then(function(bs){
 bs=bs.filter(function(b){return b.status==='booked'&&!b.noShow&&new Date(b.start).getTime()>H.now()-36e5}).sort(function(a,b){return new Date(a.start)-new Date(b.start)});
 if(!bs.length){box.innerHTML='<h2 class="fd-q">No bookings on this device</h2><p class="fd-sub">Use the link in your confirmation text, or call us on <a href="tel:0491184788">0491 184 788</a>.</p><a class="btn btn-primary" href="book.html">Book an appointment</a><p class="bk-demo">Demo: book a time on the booking page first, then come back here.</p>';return}
 box.innerHTML='<h2 class="fd-q">Your upcoming appointments</h2><ul class="mg-list">'+bs.map(function(b){return '<li><a class="mg-item" href="#t='+b.token+'">'+appt(b)+'</a></li>'}).join('')+'</ul>'})}

function show(b){
 box.onclick=null;
 if(!b){box.innerHTML='<h2 class="fd-q">We couldn’t find that booking</h2><p class="fd-sub">The link may be old. Call us on <a href="tel:0491184788">0491 184 788</a> and we’ll sort it out.</p>';return}
 if(b.status==='cancelled'){box.innerHTML='<h2 class="fd-q">This appointment was cancelled</h2>'+appt(b)+(b.lateFee?'<p class="mg-warn">'+svg('info')+(b.feeWaived?(b.waivedWhy==='refilled'?'We filled your time from the waitlist, so there’s no late fee.':'The late fee has been waived.'):b.feeCharged?'A '+F.money(b.lateFee)+' cancellation fee applies under our policy, and you’ll get an invoice from us. If that’s hard for you right now, give us a call.':'As this was within '+(b.policy?b.policy.hrs:24)+' hours, a '+F.money(b.lateFee)+' cancellation fee may apply. If we can offer your time to someone else, there’s no fee.')+'</p>':'')+'<div class="mg-acts mg-gap"><a class="btn btn-primary" href="book.html">Book a new time</a></div>';return}
 if(new Date(b.start).getTime()+(b.len||P[b.pid].len)*6e4<H.now()){
  box.innerHTML='<h2 class="fd-q" tabindex="-1">'+(b.noShow?'We missed you at this session':'This session has finished')+'</h2>'+appt(b)+
   '<div class="mg-acts mg-gap"><a class="btn btn-primary" href="book.html#p='+b.pid+'">Book another session</a></div>';return}
 var pol=polOf(b),h=hrsLeft(b),late=h<pol.hrs,ser=api.seriesOf(b).filter(function(x){return x.status==='booked'}),ref=b.referral,onWl=api.onWaitlistFor(b.token);
 var freeBy=new Date(new Date(b.start).getTime()-pol.hrs*36e5);
 var join=b.mode==='video'?'<div class="mg-join"><div>'+svg('video')+'<p><b>Video session</b><span>'+(h<0.25?'Your practitioner is ready when you are.':'The room opens 10 minutes before. Use a quiet, private spot and headphones if you can.')+'</span></p></div><button type="button" class="btn btn-primary btn-sm" data-join>Join video call</button></div>':
  b.mode==='phone'?'<p class="mg-note">'+svg('phone')+esc(P[b.pid].first)+' will call you on <b>'+esc(b.phone)+'</b> at your appointment time.</p>':'';
 var plan=b.plan==='yes'?(ref&&ref.planIn?'<p class="mg-note">'+svg('file')+'Your Mental Health Treatment Plan is with us'+(ref.file?' ('+esc(ref.file.name)+')':'')+'.</p>':
  '<div class="mg-plan"><p>'+svg('file')+'<span><b>We don’t have your Mental Health Treatment Plan yet.</b> Medicare needs it before your first session. Upload a photo or PDF, or ask your GP to send it.</span></p><label class="bk-file"><input type="file" id="mgFile" accept="image/*,application/pdf"><span>'+svg('file')+'Upload my plan</span></label></div>'):'';
 box.innerHTML='<h2 class="fd-q" tabindex="-1">Hi '+esc(b.name.split(' ')[0])+', you’re booked in</h2>'+appt(b)+join+plan+
  '<div class="mg-acts"><button type="button" class="btn btn-primary" data-move>'+svg('move')+'Move to another time</button><button type="button" class="btn btn-outline" data-cancel>'+svg('x')+'Can’t make it</button></div>'+
  '<p class="mg-pol">'+svg('shield')+(late?'<span>This is within '+pol.hrs+' hours. '+(pol.fee?'If you need to cancel now, a '+F.money(pol.fee)+' fee may apply, but if we can offer your time to someone else there’s no fee.':'Please still tell us if you can’t come, so someone else can have the time.')+'</span>':
   '<span>Free to move or cancel until <b>'+esc(F.when(freeBy))+'</b>.</span>')+'</p>'+
  (ser.length>1?'<div class="mg-ser"><h3>'+svg('repeat')+'Your regular sessions</h3><ol>'+ser.map(function(x){return '<li'+(x.id===b.id?' class="on"':'')+'><a href="#t='+x.token+'"><span>'+x.series.n+'</span>'+esc(F.day(x.start,1))+', '+F.time(new Date(x.start))+'</a></li>'}).join('')+'</ol></div>':'')+
  cal(ser.length>1?ser:[b])+
  (onWl||b.series?'':'<div class="bk-sooner"><h3>'+svg('bell')+'Want something sooner?</h3><p>We’ll text you if an earlier time with '+esc(P[b.pid].first)+' opens. Tap to claim it and we’ll move this booking.</p><button type="button" class="btn btn-outline btn-sm" data-sooner>Yes, text me</button></div>')+
  '<p class="bk-demo"><a href="manage.html">All my bookings</a></p>';
 box.querySelector('[data-move]').onclick=function(){move(b)};
 box.querySelector('[data-cancel]').onclick=function(){cancel(b)};
 var j=box.querySelector('[data-join]');if(j)j.onclick=function(){j.outerHTML='<p class="mg-note">'+svg('video')+'Demo: in the live system this opens '+esc(P[b.pid].first)+'’s secure Halaxy telehealth room. No app needed.</p>'};
 var so=box.querySelector('[data-sooner]');if(so)so.onclick=function(){so.disabled=true;api.joinWaitlist({name:b.name,phone:b.phone,pids:[b.pid],need:'Earlier time',len:b.len,days:[1,2,3,4,5,6],times:['am','pm'],moveToken:b.token}).then(function(){so.outerHTML='<p class="bk-ok">'+svg('check')+'Done. We’ll text you if something earlier opens.</p>'})};
 var fi=document.getElementById('mgFile');if(fi)fi.onchange=function(){var f=fi.files[0];if(!f)return;if(f.size>10e6){fi.nextElementSibling.textContent='That file is over 10 MB. Try a photo instead.';return}
  api.attachPlan(b.token,{name:f.name,size:f.size,type:f.type}).then(function(){api.booking(b.token).then(show)})}}

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
    if(!r.ok){box.insertAdjacentHTML('beforeend','<p class="bk-err">That time has just been booked. Please choose another one.</p>');setTimeout(function(){move(b)},1400);return}
    box.innerHTML='<div class="bk-done"><span class="bk-tick">'+svg('check')+'</span><h2 class="fd-q">Moved</h2><p>We’ve texted you the new time.</p></div>'+appt(r.booking)+'<p class="bk-demo"><a href="#t='+b.token+'">Back to my booking</a></p>'})}}})}

function cancel(b){
 var reason='',pol=polOf(b),late=hrsLeft(b)<pol.hrs,rest=api.seriesOf(b).filter(function(x){return x.status==='booked'&&new Date(x.start)>=new Date(b.start)}),all=false;
 box.innerHTML='<button type="button" class="fd-back" data-b>'+svg('back')+'Back</button><h2 class="fd-q">Can’t make it?</h2><p class="fd-sub">No worries. Letting us know means someone on the waitlist can have your time.</p>'+appt(b)+
  (rest.length>1?'<div class="fd-group"><h3>Which sessions?</h3><div class="fd-pills"><button type="button" class="fd-pill" data-all="0" aria-pressed="true">Just this one</button><button type="button" class="fd-pill" data-all="1" aria-pressed="false">This and the '+(rest.length-1)+' after it</button></div></div>':'')+
  '<div class="fd-group"><h3>What’s happened? (optional)</h3><div class="fd-pills">'+['Unwell','Something came up','Feeling better','Booked by mistake','Other'].map(function(r){return '<button type="button" class="fd-pill" data-r="'+r+'" aria-pressed="false">'+r+'</button>'}).join('')+'</div></div>'+
  (late?'<p class="mg-warn">'+svg('info')+(pol.fee?'This is within '+pol.hrs+' hours, so a '+F.money(pol.fee)+' fee may apply. If we can offer your time to someone else, there’s no fee. We understand things come up.':'This is within '+pol.hrs+' hours. Thanks for letting us know.')+'</p>':'')+
  '<div class="mg-acts mg-gap"><button type="button" class="btn btn-primary mg-danger" data-yes>'+svg('x')+'Cancel it</button><button type="button" class="btn btn-outline" data-mv>Move it instead</button></div>';
 box.querySelector('[data-b]').onclick=function(){show(b)};
 box.querySelector('[data-mv]').onclick=function(){move(b)};
 box.onclick=function(e){var p=e.target.closest('[data-r]'),a=e.target.closest('[data-all]');
  if(p){reason=p.dataset.r;[].forEach.call(box.querySelectorAll('[data-r]'),function(x){x.setAttribute('aria-pressed',x===p)})}
  if(a){all=a.dataset.all==='1';[].forEach.call(box.querySelectorAll('[data-all]'),function(x){x.setAttribute('aria-pressed',x===a)})}};
 box.querySelector('[data-yes]').onclick=function(){this.disabled=true;(all?api.cancelSeries(b.token,reason):api.cancel(b.token,reason)).then(function(r){box.onclick=null;
  box.innerHTML='<div class="bk-done"><span class="bk-tick">'+svg('heart')+'</span><h2 class="fd-q">'+(all?'Cancelled '+r.n+' sessions.':'Cancelled.')+' Thank you.</h2><p>Letting us know means someone on our waitlist can have your time. We’ve just texted them.</p></div>'+
   (r.fee?'<p class="mg-warn">'+svg('info')+'As this was within '+pol.hrs+' hours, a '+F.money(r.fee)+' fee may apply. If we can offer your time to someone else, there’s no fee. We’ll let you know either way.</p>':'')+
   '<div class="mg-acts mg-gap"><a class="btn btn-primary" href="book.html">Book a new time</a></div><p class="bk-demo">Demo: the <a href="admin.html" target="_blank" rel="noopener">Hub dashboard</a> shows the offer going out.</p>'})}}

function route(){var t=tok();if(t)api.booking(t).then(show);else list()}
window.addEventListener('hashchange',route);route();
})();
