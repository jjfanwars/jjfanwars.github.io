/* Hub dashboard (demo): refills, phones, activity, waitlist, settings. */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api;
var IC={bolt:'<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',cash:'<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/>',clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 list:'<path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/>',send:'<path d="M4 12l16-8-6 16-2.5-6.5z"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',ff:'<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/>',
 spark:'<path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',users:'<circle cx="9" cy="8.5" r="3"/><path d="M3 19c1-3.4 3.3-5.3 6-5.3s5 1.9 6 5.3M15.5 5.6a3 3 0 0 1 0 5.8M17 13.9c2 .6 3.4 2.4 4 5.1"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>'};
function svg(k){return '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}
function $(id){return document.getElementById(id)}
function ago(t){var s=Math.round((H.now()-t)/1000);if(s<60)return 'just now';var m=Math.round(s/60);if(m<60)return m+' min ago';var h=Math.round(m/60);if(h<24)return h+' h ago';return Math.round(h/24)+' d ago'}
function left(t){var s=Math.max(0,Math.round((t-H.now())/1000));return Math.floor(s/60)+':'+('0'+s%60).slice(-2)}
function wl(id){return api.state().waitlist.filter(function(w){return w.id===id})[0]}

function stats(){var S=api.state(),st=S.stats,open=S.offers.filter(function(o){return o.status==='open'}).length,
  avg=st.mins.length?Math.round(st.mins.reduce(function(a,b){return a+b},0)/st.mins.length):0,wln=S.waitlist.filter(function(w){return !w.booked}).length;
 $('admStats').innerHTML=[['bolt',st.filled,'Spots refilled'],['cash',F.money(st.value),'Income saved'],['clock',st.filled?avg+' min':'–','Avg. time to refill'],['users',wln,'On the waitlist'],['send',open,'Offers out now']]
  .map(function(x){return '<div class="adm-stat"><span class="adm-sl">'+svg(x[0])+x[2]+'</span><b>'+x[1]+'</b></div>'}).join('')}

function tryBox(){var S=api.state();
 var started=S.feed.some(function(f){return f.kind==='cancel'});
 $('admTry').innerHTML='<h2>'+(started?'Try it again':'Try it: cancel an appointment')+'</h2><p>Pick any appointment under <b>Coming up</b> and tap <b>Cancel</b>. Watch the texts land on the phones below, then tap a link to claim the spot. Or tap <b>Everyone taps at once</b> to see that only one person can win.</p>'+
  '<button type="button" class="btn btn-primary btn-sm" data-quick>'+svg('bolt')+'Cancel the next appointment</button>'}

function needs(){var S=api.state(),items=S.offers.filter(function(o){return o.status==='approval'||o.status==='queued'});
 var el=$('admNeeds');el.hidden=!items.length;if(!items.length)return;
 el.innerHTML='<div class="adm-h"><h2>Needs you</h2></div>'+items.map(function(o){var p=P[o.pid];
  return '<div class="adm-need"><img src="'+H.photo(o.pid)+'" alt="" width="44" height="44"><div><b>'+esc(p.first)+', '+esc(F.when(o.start))+'</b><span>'+(o.status==='approval'?'Spot opened. Send it to the waitlist?':'Quiet hours. Offers go out at '+S.settings.quietTo+'am.')+'</span></div>'+
   '<button type="button" class="btn btn-primary btn-sm" data-approve="'+o.id+'">'+svg('send')+'Send offers</button><button type="button" class="btn btn-outline btn-sm" data-dismiss="'+o.id+'">Leave it</button></div>'}).join('')}

var STATE_TXT={sent:'Texted',won:'Got it',lost:'Too late',expired:'No reply',late:'Too late'};
function offers(){var S=api.state(),list=S.offers.filter(function(o){return o.status!=='approval'&&o.status!=='queued'}).slice(0,6);
 $('admClock').textContent='Demo clock: '+F.day(H.now())+', '+F.time(new Date(H.now()));
 if(!list.length){$('admOffers').innerHTML='<p class="adm-empty">Nothing yet. When someone cancels, it shows up here.</p>';return}
 $('admOffers').innerHTML=list.map(function(o){var p=P[o.pid],open=o.status==='open';
  var badge=open?'<span class="adm-badge live">Offering · '+left(o.expires)+' left</span>':o.status==='filled'?'<span class="adm-badge ok">Refilled</span>':'<span class="adm-badge">Back online</span>';
  var who=o.sent.map(function(s){var w=wl(s.wid);return '<li class="st-'+s.state+'"><span>'+esc(w?w.name:'?')+'</span><em>'+STATE_TXT[s.state]+(o.round>1?' · round '+s.round:'')+'</em></li>'}).join('');
  return '<article class="adm-offer'+(open?' is-open':'')+'"><div class="adm-oh"><img src="'+H.photo(o.pid)+'" alt="" width="48" height="48"><div><b>'+esc(p.first)+', '+esc(F.when(o.start))+'</b><span>Opened '+ago(o.created)+(o.round?' · round '+o.round:'')+'</span></div>'+badge+'</div>'+
   (who?'<ul class="adm-who">'+who+'</ul>':'')+
   (open?'<div class="adm-oa"><button type="button" class="btn btn-primary btn-sm" data-race="'+o.id+'">'+svg('bolt')+'Everyone taps at once</button><button type="button" class="btn btn-outline btn-sm" data-ff="'+S.settings.expiry+'">'+svg('ff')+'Skip '+S.settings.expiry+' min (nobody replies)</button><button type="button" class="btn btn-outline btn-sm" data-dismiss="'+o.id+'">Stop offering</button></div>':'')+
   '</article>'}).join('')}

var focusOffer=null;
function phones(){var S=api.state(),o=S.offers.filter(function(x){return x.sent.length})[0];
 if(!o){$('admPhones').innerHTML='<p class="adm-empty">Phones light up when offers go out.</p>';return}
 var ids=o.sent.filter(function(s){return s.round===o.round}).map(function(s){return s.wid});
 $('admPhones').innerHTML=ids.map(function(wid){var w=wl(wid);if(!w)return '';
  var msgs=S.sms.filter(function(m){return m.to===w.phone}).slice(-5);
  return '<div class="phone"><div class="ph-notch"></div><div class="ph-top"><span class="ph-av">'+esc(w.name[0])+'</span><b>Surf Coast Family Hub</b><small>to '+esc(w.name)+'</small></div><div class="ph-msgs">'+
   msgs.map(function(m){var body=esc(m.body).replace(/sfch\.au\/c\/([a-z0-9]+)/i,function(_,t){return '<button type="button" class="ph-link" data-claim="'+t+'">sfch.au/c/'+t+'</button>'});
    return '<div class="ph-b '+m.dir+'">'+body+'<time>'+F.time(new Date(m.at))+'</time></div>'}).join('')+'</div>'+
   (o.status==='open'&&o.sent.some(function(s){return s.wid===wid&&s.state==='sent'&&s.round===o.round})?'<div class="ph-bar"><button type="button" data-yes="'+o.sent.filter(function(s){return s.wid===wid&&s.round===o.round})[0].tok+'">Reply YES</button></div>':'<div class="ph-bar ph-off">iMessage</div>')+
   '</div>'}).join('');
 [].forEach.call($('admPhones').querySelectorAll('.ph-msgs'),function(m){m.scrollTop=m.scrollHeight})}

function upcoming(){var list=api.upcoming(4).slice(0,40),days={};
 list.forEach(function(a){var k=F.day(a.start);(days[k]=days[k]||[]).push(a)});
 $('admUp').innerHTML=Object.keys(days).slice(0,3).map(function(k){return '<h3 class="adm-day">'+esc(k)+'</h3><ul class="adm-up">'+days[k].slice(0,8).map(function(a){var p=P[a.pid];
  return '<li><time>'+F.time(a.start)+'</time><img src="'+H.photo(a.pid)+'" alt="" width="30" height="30"><span><b>'+esc(a.name)+'</b> with '+esc(p.first)+(a.booking&&a.booking.source==='refill'?' <em class="adm-tag">refilled</em>':a.booking?' <em class="adm-tag">booked online</em>':'')+'</span><button type="button" class="adm-cx" data-cx="'+a.pid+'|'+a.start.toISOString()+'">Cancel</button></li>'}).join('')+'</ul>'}).join('')||'<p class="adm-empty">No appointments in the next few days.</p>'}

var ICONK={cancel:'x',offer:'send',filled:'check',booked:'check',wait:'users',move:'ff',none:'list',skip:'list',ask:'bolt',queue:'clock',clock:'clock'};
function feed(){var S=api.state();
 $('admFeed').innerHTML=S.feed.slice(0,18).map(function(f){return '<li class="fk-'+f.kind+'"><span class="adm-fi">'+svg(ICONK[f.kind]||'list')+'</span><p>'+esc(f.text)+'<time>'+ago(f.at)+'</time></p></li>'}).join('')||'<li class="adm-empty">Quiet so far.</li>'}

// ---------- waitlist: search, filter, person panel ----------
function daysSince(t){return Math.max(0,Math.round((H.now()-t)/864e5))}
function whoFor(w){return w.pids.length>2?'any of '+w.pids.length+' practitioners':w.pids.map(function(x){return P[x].first}).join(' or ')}
function whenFor(w){return w.days.map(function(x){return F.DAY[x]}).join(' ')+' · '+(w.times.length>1?'any time':w.times[0]==='am'?'mornings':'afternoons')}
function waitlist(){var S=api.state(),q=($('admWlQ').value||'').trim().toLowerCase(),pf=$('admWlP').value;
 var all=S.waitlist.filter(function(w){return !w.booked&&!w.removed}).sort(function(a,b){return a.since-b.since});
 var l=all.filter(function(w){return (!pf||w.pids.indexOf(pf)>=0)&&(!q||(w.name+' '+w.phone+' '+w.need+' '+(w.note||'')).toLowerCase().indexOf(q)>=0)});
 $('admWlN').textContent=all.length+' waiting';
 if(!l.length){$('admWl').innerHTML='<p class="adm-empty">'+(all.length?'Nobody matches that search.':'Nobody is waiting right now.')+'</p>';return}
 $('admWl').innerHTML='<ul class="adm-wl">'+l.map(function(w){var d=daysSince(w.since);
  return '<li><button type="button" class="adm-wlrow" data-person="'+w.id+'"><span class="adm-wa">'+esc(w.name[0])+'</span><div><b>'+esc(w.name)+(w.moveToken?' <em class="adm-tag">wants an earlier time</em>':w.mine?' <em class="adm-tag">joined online</em>':'')+(w.note?' <em class="adm-tag adm-tag-n">note</em>':'')+'</b><span>'+esc(w.need)+' · '+esc(whoFor(w))+'</span><span>'+whenFor(w)+'</span></div><em>'+(d?d+' d':'new')+'</em></button></li>'}).join('')+'</ul>'}
function fillPractFilter(){var sel=$('admWlP');if(sel.options.length>1)return;
 H.ORDER.filter(function(id){return P[id].live&&!P[id].leave}).forEach(function(id){var o=document.createElement('option');o.value=id;o.textContent=P[id].name;sel.appendChild(o)})}

var STATE_LONG={sent:'Texted, no reply yet',won:'Took the spot',lost:'Tapped too late',expired:'Didn’t reply in time',late:'Tapped too late'};
var openPerson=null;
function person(id){var S=api.state(),w=S.waitlist.filter(function(x){return x.id===id})[0];if(!w)return;openPerson=id;
 var offers=[];S.offers.forEach(function(o){o.sent.forEach(function(s){if(s.wid===w.id)offers.push({o:o,s:s})})});
 var texts=S.sms.filter(function(m){return m.to===w.phone}).slice(-12).reverse();
 var status=w.removed?'Removed':w.booked?'Booked from the waitlist':'Waiting';
 var tel=w.phone.replace(/\s/g,'');
 $('admPersonBody').innerHTML='<div class="adm-dwh"><div class="adm-ph"><span class="adm-wa adm-wa-lg">'+esc(w.name[0])+'</span><div><h2 id="admPersonH">'+esc(w.name)+'</h2><p>'+status+' · joined '+esc(F.day(w.since,1))+' ('+daysSince(w.since)+' days)</p></div></div><button type="button" class="adm-x" data-close aria-label="Close">'+svg('x')+'</button></div>'+
  '<div class="adm-pact"><a class="adm-ghost" href="tel:'+tel+'">Call '+esc(w.phone)+'</a><a class="adm-ghost" href="sms:'+tel+'">Text</a><button type="button" class="adm-ghost" data-ask-about="'+w.id+'">Ask Claude about '+esc(w.name.split(' ')[0])+'</button></div>'+
  '<dl class="adm-dl"><div><dt>Looking for</dt><dd>'+esc(w.need)+'</dd></div><div><dt>Happy to see</dt><dd>'+esc(w.pids.map(function(x){return P[x].name}).join(', '))+'</dd></div>'+
  '<div><dt>Days and times</dt><dd>'+whenFor(w)+'</dd></div><div><dt>Joined</dt><dd>'+(w.moveToken?'Already booked, wants an earlier time':w.mine?'Online':'Added by staff')+'</dd></div></dl>'+
  '<div class="adm-sec"><h3>Note</h3><textarea id="admNote" rows="3" maxlength="500" placeholder="Only staff see this. Keep it to admin details, not clinical notes.">'+esc(w.note||'')+'</textarea><p class="adm-saved" id="admNoteS" aria-live="polite"></p></div>'+
  '<div class="adm-sec"><h3>Offers</h3>'+(offers.length?'<ul class="adm-list">'+offers.map(function(x){return '<li><b>'+esc(P[x.o.pid].first)+', '+esc(F.when(x.o.start))+'</b><span>'+STATE_LONG[x.s.state]+' · round '+x.s.round+'</span></li>'}).join('')+'</ul>':'<p class="adm-muted">No spots offered yet.</p>')+'</div>'+
  '<div class="adm-sec"><h3>Texts</h3>'+(texts.length?'<ul class="adm-list adm-texts">'+texts.map(function(m){return '<li class="'+m.dir+'"><span>'+esc(m.body)+'</span><time>'+esc(F.when(new Date(m.at)))+(m.dir==='in'?' · reply':'')+'</time></li>'}).join('')+'</ul>':'<p class="adm-muted">No texts yet.</p>')+'</div>'+
  (w.removed||w.booked?'':'<div class="adm-sec adm-danger"><button type="button" class="adm-ghost adm-ghost-d" data-remove="'+w.id+'">Remove from waitlist</button></div>');
 var dlg=$('admPerson');if(!dlg.open)dlg.showModal();
 var note=$('admNote'),tm;note.addEventListener('input',function(){clearTimeout(tm);tm=setTimeout(function(){api.noteWaitlist(w.id,note.value);$('admNoteS').textContent='Saved'},500)})}

// ---------- records ----------
var recTab='bookings';
function recRows(){var S=api.state();
 if(recTab==='bookings')return {head:['When','With','Client','Service','Status','Booked'],rows:S.bookings.slice().sort(function(a,b){return new Date(b.created)-new Date(a.created)}).map(function(b){
  return [F.when(b.start),P[b.pid].first,b.name+(b.child?' (child: '+b.child+')':''),b.service||'',b.status==='cancelled'?'Cancelled'+(b.reason?' ('+b.reason+')':''):b.source==='refill'?'Booked (refill)':'Booked',F.when(new Date(b.created))]})};
 if(recTab==='offers')return {head:['Spot','Opened','Status','People texted','Filled by'],rows:S.offers.map(function(o){var w=o.winner&&S.waitlist.filter(function(x){return x.id===o.winner})[0];
  return [P[o.pid].first+', '+F.when(o.start),F.when(new Date(o.created)),{open:'Offering',filled:'Refilled',unfilled:'Back online',approval:'Waiting for you',queued:'Queued (quiet hours)'}[o.status]||o.status,String(o.sent.length),w?w.name:'']})};
 return {head:['Time','To','Message'],rows:S.sms.slice().reverse().map(function(m){return [F.when(new Date(m.at)),(m.dir==='in'?'From ':'')+(m.name||m.to),m.body]})}}
function records(){var r=recRows();
 [].forEach.call(document.querySelectorAll('[data-rec]'),function(b){b.setAttribute('aria-selected',b.dataset.rec===recTab)});
 $('admRecBody').innerHTML=r.rows.length?'<div class="adm-tbl"><table><thead><tr>'+r.head.map(function(x){return '<th scope="col">'+x+'</th>'}).join('')+'</tr></thead><tbody>'+
  r.rows.slice(0,50).map(function(row){return '<tr>'+row.map(function(c){return '<td>'+esc(c)+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>'+(r.rows.length>50?'<p class="adm-muted">Showing 50 of '+r.rows.length+'. Export for the lot.</p>':''):
  '<p class="adm-empty">'+{bookings:'No online bookings yet. Book a time on the booking page to see it here.',offers:'No spots offered yet. Cancel an appointment to start one.',texts:'No texts sent yet.'}[recTab]+'</p>'}

// ---------- CSV export ----------
function confirmExport(){return confirm('This file has clients’ personal and health details. Keep it on a secure work device, don’t email it unencrypted, and delete it when you’re done.')}
function csv(name,head,rows){var s=[head].concat(rows).map(function(r){return r.map(function(c){c=String(c==null?'':c);return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c}).join(',')}).join('\r\n');
 var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+s],{type:'text/csv'}));a.download=name+'-'+new Date(H.now()).toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove()}
function exportWaitlist(){var S=api.state();if(!confirmExport())return;
 csv('hub-waitlist',['Name','Phone','Status','Looking for','Practitioners','Days','Times','Joined','Days waiting','Source','Note'],S.waitlist.map(function(w){
  return [w.name,w.phone,w.removed?'Removed':w.booked?'Booked':'Waiting',w.need,w.pids.map(function(x){return P[x].name}).join('; '),w.days.map(function(x){return F.DAY[x]}).join(' '),w.times.length>1?'Any':w.times[0]==='am'?'Mornings':'Afternoons',new Date(w.since).toISOString().slice(0,10),daysSince(w.since),w.moveToken?'Wants earlier':w.mine?'Online':'Staff',w.note||'']}))}

// ---------- Ask Claude ----------
var ASK_URL=H.SITE+'api/hub/ask',CHAT=[],NAMES={};try{CHAT=JSON.parse(sessionStorage.getItem('scfh-ask')||'[]');NAMES=JSON.parse(sessionStorage.getItem('scfh-ask-n')||'{}')}catch(e){}
function unmask(s){return s.replace(/(\[C[a-z0-9]+\])(\.?)/g,function(_,k,dot){var n=NAMES[k]||'a client';return n+(dot&&n.slice(-1)!=='.'?dot:'')})}
var SUGGEST=['Who has been waiting longest, and for whom?','Which free times this fortnight match someone on the waitlist?','How booked is Hannah over the next two weeks?','Summarise today’s cancellations and refills.'];
function md(s){s=esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');var out=[],list=false;
 s.split('\n').forEach(function(line){var m=line.match(/^\s*[-•*]\s+(.*)/);if(m){if(!list){out.push('<ul>');list=true}out.push('<li>'+m[1]+'</li>');return}
  if(list){out.push('</ul>');list=false}if(line.trim())out.push('<p>'+line+'</p>')});if(list)out.push('</ul>');return out.join('')}
function chat(){var el=$('admChat');
 if(!CHAT.length){el.innerHTML='<div class="adm-hello"><span class="adm-spark">'+svg('spark')+'</span><p>Ask about waitlists, free times, cancellations, refills or texts. Claude reads the Hub’s current data, so answers are specific to today.</p><div class="adm-sugg">'+SUGGEST.map(function(q){return '<button type="button" data-suggest>'+esc(q)+'</button>'}).join('')+'</div></div>';return}
 el.innerHTML=CHAT.map(function(m){return '<div class="adm-msg '+m.role+'">'+(m.role==='user'?'<p>'+esc(m.content)+'</p>':md(unmask(m.content))||'<span class="adm-typing"><i></i><i></i><i></i></span>')+'</div>'}).join('')+
  (busy?'':'<button type="button" class="adm-clear" data-clear>New conversation</button>');
 el.scrollTop=el.scrollHeight}
var busy=false;
function ask(q){q=(q||'').trim();if(!q||busy)return;busy=true;
 var snap=api.snapshot();Object.assign(NAMES,snap.names);
 CHAT.push({role:'user',content:q,wire:snap.scrub(q)});var a={role:'assistant',content:''};CHAT.push(a);chat();
 var send=CHAT.slice(0,-1).slice(-12).map(function(m){return {role:m.role,content:m.wire||m.content}});
 fetch(ASK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:send,data:snap.data})}).then(function(r){
  if(!r.ok)return r.json().catch(function(){return {}}).then(function(j){throw new Error(j.error||'Couldn’t reach Claude. Try again.')});
  var rd=r.body.getReader(),dec=new TextDecoder();
  function pump(){return rd.read().then(function(x){if(x.done)return;a.content+=dec.decode(x.value,{stream:true});chat();return pump()})}
  return pump()}).catch(function(e){a.content=a.content||e.message||'Couldn’t reach Claude. Try again.'}).then(function(){busy=false;
  if(!a.content.trim())a.content='No answer came back. Try again.';try{sessionStorage.setItem('scfh-ask',JSON.stringify(CHAT.slice(-20)));sessionStorage.setItem('scfh-ask-n',JSON.stringify(NAMES))}catch(e){}chat();$('admAskQ').focus()})}
function openAsk(q){var d=$('admAsk');if(!d.open)d.showModal();chat();var t=$('admAskQ');if(q){ask(q)}else t.focus()}
$('admAskF').addEventListener('submit',function(e){e.preventDefault();var t=$('admAskQ');ask(t.value);t.value='';t.style.height=''});
$('admAskQ').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('admAskF').requestSubmit()}});
$('admAskQ').addEventListener('input',function(){this.style.height='';this.style.height=Math.min(this.scrollHeight,160)+'px'});
[$('admAsk'),$('admPerson')].forEach(function(d){d.addEventListener('click',function(e){if(e.target===d||e.target.closest('[data-close]'))d.close()})});
$('admPerson').addEventListener('close',function(){openPerson=null});
$('admWlQ').addEventListener('input',waitlist);$('admWlP').addEventListener('change',waitlist);

function settings(){var s=api.state().settings;
 function seg(k,opts){return '<div class="adm-seg" role="group">'+opts.map(function(o){return '<button type="button" data-set="'+k+'" data-v="'+o[0]+'" aria-pressed="'+(String(s[k])===String(o[0]))+'">'+o[1]+'</button>'}).join('')+'</div>'}
 $('admSet').innerHTML='<div class="adm-set"><label>When a spot opens</label>'+seg('mode',[['auto','Text the waitlist straight away'],['ask','Ask me first']])+'</div>'+
  '<div class="adm-set"><label>People per round</label>'+seg('batch',[[1,'1'],[2,'2'],[3,'3'],[5,'5']])+'</div>'+
  '<div class="adm-set"><label>Link lasts</label>'+seg('expiry',[[15,'15 min'],[30,'30 min'],[60,'1 hour']])+'</div>'+
  '<div class="adm-set"><label>Stop offering when it’s less than</label>'+seg('minNotice',[[1,'1 hour'],[2,'2 hours'],[4,'4 hours']])+'</div>'+
  '<div class="adm-set"><label>Quiet hours (no texts 8pm to 8am)</label>'+seg('quiet',[[true,'On'],[false,'Off']])+'</div>'}

function all(){stats();tryBox();needs();offers();phones();upcoming();feed();fillPractFilter();waitlist();records();settings();if(openPerson&&$('admPerson').open&&document.activeElement!==$('admNote'))person(openPerson)}
api.on(all);all();
setInterval(function(){stats();offers()},1000);

document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var d=b.dataset;
 if(d.person){person(d.person);return}
 if('askOpen' in d){openAsk();return}
 if(d.askAbout){var w=api.state().waitlist.filter(function(x){return x.id===d.askAbout})[0];$('admPerson').close();if(w)openAsk('Tell me about '+w.name+' on the waitlist: what they want, any offers so far, and any free times that match.');return}
 if('suggest' in d){ask(b.textContent);return}
 if('clear' in d){CHAT=[];NAMES={};try{sessionStorage.removeItem('scfh-ask');sessionStorage.removeItem('scfh-ask-n')}catch(x){}chat();$('admAskQ').focus();return}
 if(d.remove){if(confirm('Remove this person from the waitlist?')){api.removeWaitlist(d.remove);$('admPerson').close();toast('Removed from the waitlist.')}return}
 if(d.rec){recTab=d.rec;records();return}
 if(d.csv==='waitlist'){exportWaitlist();return}
 if(d.csv==='rec'){if(!confirmExport())return;var r=recRows();csv('hub-'+recTab,r.head,r.rows);return}
 if(d.cx){var i=d.cx.indexOf('|');b.disabled=true;b.textContent='Cancelling…';api.simulateCancel(d.cx.slice(0,i),new Date(d.cx.slice(i+1)));return}
 if('quick' in d){var pool=api.upcoming(14).filter(function(x){return x.seeded&&x.start.getTime()-H.now()>api.state().settings.minNotice*36e5+36e5&&H.P[x.pid].psych}).slice(0,14),a=pool[Math.floor(Math.random()*pool.length)];if(a){api.simulateCancel(a.pid,a.start);setTimeout(function(){$('admOffers').scrollIntoView({behavior:'smooth',block:'start'})},500)}return}
 if(d.race){var r=api.race(d.race);if(r){var win=r.filter(function(x){return x.ok})[0];toast(r.length+' people tapped within the same second. Only '+(win?wl(win.offer.winner).name:'one')+' got it.')}return}
 if(d.claim){var res=api.claim(d.claim,'tap');toast(res.ok?'Claimed. Booked in and confirmed by text.':'Too late, someone else got it.');return}
 if(d.yes){var res2=api.claim(d.yes,'yes');toast(res2.ok?'YES received. Booked in.':'Too late, someone else got it.');return}
 if(d.ff){api.forward(Number(d.ff)+1);return}
 if(d.approve){api.approve(d.approve);return}
 if(d.dismiss){api.dismiss(d.dismiss);return}
 if(d.set){var v=d.v;v=v==='true'?true:v==='false'?false:isNaN(v)?v:Number(v);var o={};o[d.set]=v;api.settings(o);return}
});
$('admReset').addEventListener('click',function(){if(confirm('Reset the demo? This clears demo bookings, offers and texts.'))api.reset()});
var tt;function toast(t){var el=$('admToast');if(!el){el=document.createElement('div');el.id='admToast';el.className='adm-toast';el.setAttribute('role','status');document.body.appendChild(el)}
 el.textContent=t;el.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){el.classList.remove('on')},3600)}
})();
