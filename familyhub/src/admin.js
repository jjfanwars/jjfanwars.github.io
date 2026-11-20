/* Hub dashboard (demo): refills, phones, activity, waitlist, settings. */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api;
var IC={bolt:'<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',cash:'<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/>',clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 list:'<path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/>',send:'<path d="M4 12l16-8-6 16-2.5-6.5z"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',ff:'<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/>',
 users:'<circle cx="9" cy="8.5" r="3"/><path d="M3 19c1-3.4 3.3-5.3 6-5.3s5 1.9 6 5.3M15.5 5.6a3 3 0 0 1 0 5.8M17 13.9c2 .6 3.4 2.4 4 5.1"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>'};
function svg(k){return '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}
function $(id){return document.getElementById(id)}
function ago(t){var s=Math.round((H.now()-t)/1000);if(s<60)return 'just now';var m=Math.round(s/60);if(m<60)return m+' min ago';var h=Math.round(m/60);if(h<24)return h+' h ago';return Math.round(h/24)+' d ago'}
function left(t){var s=Math.max(0,Math.round((t-H.now())/1000));return Math.floor(s/60)+':'+('0'+s%60).slice(-2)}
function wl(id){return api.state().waitlist.filter(function(w){return w.id===id})[0]}

function stats(){var S=api.state(),st=S.stats,open=S.offers.filter(function(o){return o.status==='open'}).length,
  avg=st.mins.length?Math.round(st.mins.reduce(function(a,b){return a+b},0)/st.mins.length):0,wln=S.waitlist.filter(function(w){return !w.booked}).length;
 $('admStats').innerHTML=[['bolt',st.filled,'spots refilled'],['cash',F.money(st.value),'income saved'],['clock',st.filled?avg+' min':'–','average time to refill'],['users',wln,'on the waitlist'],['send',open,'offers out now']]
  .map(function(x){return '<div class="adm-stat"><span class="adm-si">'+svg(x[0])+'</span><b>'+x[1]+'</b><span>'+x[2]+'</span></div>'}).join('')}

function tryBox(){var S=api.state();
 var started=S.feed.some(function(f){return f.kind==='cancel'});
 $('admTry').innerHTML='<h2>'+(started?'Try it again':'Try it: cancel an appointment')+'</h2><p>Pick any appointment under <b>Coming up</b> and tap <b>Cancel</b>. Watch the texts land on the phones below, then tap a link to claim the spot. Or tap <b>Everyone taps at once</b> to see that only one person can win.</p>'+
  '<button type="button" class="btn btn-primary btn-sm" data-quick>'+svg('bolt')+'Cancel the next appointment for me</button>'}

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

function waitlist(){var S=api.state(),l=S.waitlist.filter(function(w){return !w.booked}).sort(function(a,b){return a.since-b.since});
 $('admWlN').textContent=l.length+' waiting';
 $('admWl').innerHTML='<ul class="adm-wl">'+l.map(function(w){var d=Math.max(0,Math.round((H.now()-w.since)/864e5));
  return '<li><span class="adm-wa">'+esc(w.name[0])+'</span><div><b>'+esc(w.name)+(w.moveToken?' <em class="adm-tag">wants an earlier time</em>':w.mine?' <em class="adm-tag">joined online</em>':'')+'</b><span>'+esc(w.need)+' · '+esc(w.pids.length>2?'any of '+w.pids.length+' practitioners':w.pids.map(function(x){return P[x].first}).join(' or '))+'</span><span>'+w.days.map(function(x){return F.DAY[x]}).join(' ')+' · '+(w.times.length>1?'any time':w.times[0]==='am'?'mornings':'afternoons')+'</span></div><em>'+(d?d+' d':'new')+'</em></li>'}).join('')+'</ul>'}

function settings(){var s=api.state().settings;
 function seg(k,opts){return '<div class="adm-seg" role="group">'+opts.map(function(o){return '<button type="button" data-set="'+k+'" data-v="'+o[0]+'" aria-pressed="'+(String(s[k])===String(o[0]))+'">'+o[1]+'</button>'}).join('')+'</div>'}
 $('admSet').innerHTML='<div class="adm-set"><label>When a spot opens</label>'+seg('mode',[['auto','Text the waitlist straight away'],['ask','Ask me first']])+'</div>'+
  '<div class="adm-set"><label>People per round</label>'+seg('batch',[[1,'1'],[2,'2'],[3,'3'],[5,'5']])+'</div>'+
  '<div class="adm-set"><label>Link lasts</label>'+seg('expiry',[[15,'15 min'],[30,'30 min'],[60,'1 hour']])+'</div>'+
  '<div class="adm-set"><label>Stop offering when it’s less than</label>'+seg('minNotice',[[1,'1 hour'],[2,'2 hours'],[4,'4 hours']])+'</div>'+
  '<div class="adm-set"><label>Quiet hours (no texts 8pm to 8am)</label>'+seg('quiet',[[true,'On'],[false,'Off']])+'</div>'}

function all(){stats();tryBox();needs();offers();phones();upcoming();feed();waitlist();settings()}
api.on(all);all();
setInterval(function(){stats();offers()},1000);

document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var d=b.dataset;
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
