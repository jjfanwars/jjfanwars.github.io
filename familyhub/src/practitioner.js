/* Practitioner view: one practitioner's own week, refills, waitlist, referrals, preferences and booking button. */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api;
function $(id){return document.getElementById(id)}
function m(n){return '$'+Math.round(n).toLocaleString('en-AU')}
function pct(a,b){return b?Math.round(a/b*100):0}
var LIVE=H.ORDER.filter(function(id){return P[id].live&&!P[id].leave});
var who=(location.hash.match(/p=([\w-]+)/)||[])[1];if(LIVE.indexOf(who)<0)who=LIVE[0];
$('pvWho').innerHTML=LIVE.map(function(id){return '<option value="'+id+'"'+(id===who?' selected':'')+'>'+esc(P[id].name)+'</option>'}).join('');
$('pvWho').onchange=function(){who=this.value;try{history.replaceState(null,'','#p='+who)}catch(e){}lastW='';draw()};
var lastW='';
function draw(){var p=P[who],S=api.state(),r=api.report(28),me=r.byPract.filter(function(x){return x.pid===who})[0]||{};
 $('pvHead').innerHTML='<img src="'+H.photo(who)+'" alt="" width="64" height="64"><div><h1>Hi '+esc(p.first)+'</h1><p>'+esc(p.role)+' · your last 4 weeks and the week ahead</p></div>';
 var wl=S.waitlist.filter(function(w){return !w.booked&&!w.removed&&w.pids.indexOf(who)>=0});
 var cx=(me.late||0)+(me.early||0)+(me.noshow||0);
 $('pvKpis').innerHTML=[['Sessions',me.booked||0,pct((me.booked||0)-cx+(me.refilled||0),me.capacity)+'% of your times used'],['Cancellations',cx,(me.late||0)+' late · '+(me.noshow||0)+' no-show'],
  ['Refilled for you',me.refilled||0,pct(me.refilled,cx)+'% of your cancellations',1],['Back in your pocket',m(me.recovered||0),'from refilled sessions',1],['Video sessions',pct(me.video,me.booked)+'%','of your sessions'],['Waiting for you',wl.filter(function(w){return !w.paused}).length,'people on the waitlist']]
  .map(function(k){return '<div class="rp-kpi'+(k[3]?' hi':'')+'"><span>'+k[0]+'</span><b>'+k[1]+'</b><small>'+k[2]+'</small></div>'}).join('');
 var up=api.upcoming(7).filter(function(a){return a.pid===who}),days={};up.forEach(function(a){var k=F.day(a.start);(days[k]=days[k]||[]).push(a)});
 $('pvUp').innerHTML=Object.keys(days).map(function(k){return '<h3 class="adm-day">'+esc(k)+'</h3><ul class="adm-up">'+days[k].map(function(a){var b=a.booking,rm=a.rem;
  return '<li><time>'+F.time(a.start)+'</time><span><b>'+esc(a.name)+'</b>'+(b&&b.source==='refill'?' <em class="adm-tag">refilled</em>':b&&b.source==='referral'?' <em class="adm-tag">new referral</em>':b?' <em class="adm-tag">booked online</em>':'')+
   (b&&b.mode==='video'?' <em class="adm-tag adm-tag-g">video</em>':b&&b.mode==='phone'?' <em class="adm-tag adm-tag-g">phone</em>':'')+(b&&b.series?' <em class="adm-tag adm-tag-g">'+b.series.n+'/'+b.series.of+'</em>':'')+
   (b&&b.plan==='yes'&&!(b.referral&&b.referral.planIn)?' <em class="adm-tag adm-tag-n">no plan yet</em>':'')+(rm?(rm.state==='confirmed'?' <em class="adm-rs ok">Confirmed</em>':' <em class="adm-rs">Reminded</em>'):'')+
   (b&&b.intake?(b.intake.status==='done'?' <button type="button" class="adm-link" data-ik="'+b.id+'">Read intake</button>':' <em class="adm-tag adm-tag-n">intake not done</em>'):'')+'</span></li>'}).join('')+'</ul>'}).join('')||'<p class="adm-empty">Nothing booked in the next 7 days.</p>';
 var PK={deposit:'Deposit',session:'Session',late:'Late cancellation fee',noshow:'Missed session fee',refund:'Refund',medicare:'Medicare claim'};
 var mine=S.pay.filter(function(x){return x.pid===who}),month=H.now()-28*864e5,fees=api.feesToDecide(who);
 var paid=mine.filter(function(x){return x.at>=month&&x.status==='paid'&&x.kind!=='refund'}).reduce(function(s,x){return s+x.amount},0)-mine.filter(function(x){return x.at>=month&&x.kind==='refund'}).reduce(function(s,x){return s+x.amount},0);
 $('pvPay').innerHTML='<dl class="rp-dl"><div><dt>Paid to you, last 4 weeks</dt><dd>'+m(paid)+'</dd></div><div><dt>Outstanding</dt><dd>'+m(mine.filter(function(x){return x.status==='due'||x.status==='failed'}).reduce(function(s,x){return s+x.amount},0))+'</dd></div><div><dt>Medicare claims lodged</dt><dd>'+mine.filter(function(x){return x.kind==='medicare'&&x.at>=month}).length+'</dd></div></dl>'+
  (fees.length?'<h3 class="adm-day">Fees for you to decide</h3><ul class="adm-up">'+fees.map(function(b){return '<li><span><b>'+esc(b.name)+'</b>, '+esc(F.when(b.start))+' · '+(b.noShow?'no-show':'late cancel')+'</span><b class="adm-amt">'+m(b.noShow?b.noShowFee:b.lateFee)+'</b><button type="button" class="adm-cx adm-cx-ok" data-fee="'+b.id+'">Charge</button><button type="button" class="adm-cx" data-waive="'+b.id+'">Waive</button></li>'}).join('')+'</ul>':'')+
  (mine.length?'<h3 class="adm-day">Recent</h3><ul class="adm-up">'+mine.slice(0,4).map(function(x){return '<li><span><b>'+esc(x.name)+'</b> · '+PK[x.kind]+({failed:' (declined)',due:' (due)',refunded:' (refunded)',void:' (cancelled)'}[x.status]||'')+'</span><b class="adm-amt">'+(x.kind==='refund'?'−':'')+m(x.amount)+'</b></li>'}).join('')+'</ul>':'');
 var newc=S.bookings.filter(function(b){return b.pid===who&&b.status==='booked'&&b.intake&&new Date(b.start).getTime()>H.now()}).sort(function(x,y){return new Date(x.start)-new Date(y.start)});
 if(newc.length)$('pvUp').insertAdjacentHTML('beforeend','<h3 class="adm-day">New clients coming up</h3><ul class="adm-up">'+newc.map(function(b){return '<li><time>'+esc(F.day(b.start))+'</time><span><b>'+esc(b.name)+'</b> '+F.time(new Date(b.start))+(b.intake.status==='done'?' <button type="button" class="adm-link" data-ik="'+b.id+'">Read intake</button>':' <em class="adm-tag adm-tag-n">intake '+(b.intake.status==='started'?'half done':'not done')+'</em>')+'</span></li>'}).join('')+'</ul>');
 var recent=S.bookings.filter(function(b){var s=new Date(b.start).getTime();return b.pid===who&&b.status==='booked'&&s<H.now()&&s>H.now()-4*864e5}).sort(function(x,y){return new Date(y.start)-new Date(x.start)});
 if(recent.length)$('pvUp').insertAdjacentHTML('beforeend','<h3 class="adm-day">Recent sessions</h3><ul class="adm-up">'+recent.map(function(b){var ps=S.pay.filter(function(x){return x.bid===b.id&&x.kind==='session'})[0];
  return '<li><time>'+esc(F.day(b.start))+'</time><span><b>'+esc(b.name)+'</b> '+F.time(new Date(b.start))+(b.noShow?' <em class="adm-tag adm-tag-p">no-show</em>':ps?' <em class="adm-tag adm-tag-g">'+({paid:'paid',due:'payment due',failed:'card declined',refunded:'refunded'}[ps.status]||ps.status)+'</em>':'')+'</span>'+(b.noShow?'':'<button type="button" class="adm-cx" data-noshow="'+b.id+'">Mark no-show</button>')+'</li>'}).join('')+'</ul>');
 var refs=S.referrals.filter(function(x){return x.status!=='closed'&&(x.to===who||(x.pids||[]).indexOf(who)>=0)});
 $('pvRef').innerHTML=refs.length?'<ul class="adm-refs">'+refs.map(function(x){return '<li><div class="adm-refrow" style="cursor:default"><span class="adm-wa">'+esc(x.client.name[0])+'</span><div><b>'+esc(x.client.name)+'</b><span>From '+esc(x.from.name)+(x.from.practice?', '+esc(x.from.practice):'')+'</span><span>'+({new:'New',invited:'Booking link sent',booked:'Booked'}[x.status]||x.status)+(x.plan==='yes'?' · plan '+(x.planIn?'received':'to come'):'')+'</span></div></div></li>'}).join('')+'</ul>':'<p class="adm-empty">No open referrals to you.</p>';
 $('pvWlN').textContent=wl.length+' waiting';
 $('pvWl').innerHTML=wl.length?'<ul class="adm-wl">'+wl.map(function(w){var d=Math.round((H.now()-w.since)/864e5);return '<li><span class="adm-wa">'+esc(w.name[0])+'</span><div><b>'+esc(w.name)+(w.paused?' <em class="adm-tag adm-tag-p">paused</em>':'')+'</b><span>'+esc(w.need)+' · '+w.days.map(function(x){return F.DAY[x]}).join(' ')+'</span></div><em>'+d+' d</em></li>'}).join('')+'</ul>':'<p class="adm-empty">Nobody is waiting for you right now.</p>';
 var pr=api.prefs(who),pol=api.policy(who);
 function seg(k,opts,cur){return '<div class="adm-seg" role="group">'+opts.map(function(o){return '<button type="button" data-pref="'+k+'" data-v="'+o[0]+'" aria-pressed="'+(String(cur)===String(o[0]))+'">'+o[1]+'</button>'}).join('')+'</div>'}
 $('pvSet').innerHTML='<div class="adm-set"><label>When one of your clients cancels</label>'+seg('refill',[['auto','Offer it to the waitlist'],['ask','Ask Adi first'],['off','I’ll fill it myself']],pr.refill)+'<p>The waitlist only ever gets times you’ve made bookable online.</p></div>'+
  '<div class="adm-set"><label>Let clients book a regular weekly or fortnightly time online</label>'+seg('series',[[true,'Yes'],[false,'No']],pr.series)+'</div>'+
  '<div class="adm-set"><label>Cancellation policy (set by the Hub)</label><p style="margin:0;font-size:14px;color:var(--ink)">'+esc(pol.text)+'</p></div>'+
  '<p class="adm-muted">Working hours, session types and fees come from your Halaxy, so change them there.</p>';
 if(lastW!==who){lastW=who;var url=H.SITE+'widget.js',code='<script src="'+url+'" data-practitioner="'+who+'" data-label="Book with '+p.first+'" async></'+'script>';
  $('pvCode').textContent=code;var link=H.SITE+'book.html#p='+who;$('pvLink').href=link;$('pvLink').textContent=link.replace(/^https?:\/\//,'');
  var holder=$('pvBtn');holder.innerHTML='';var s=document.createElement('script');s.src=(H.SITE||'')+'widget.js';s.setAttribute('data-practitioner',who);s.setAttribute('data-label','Book with '+p.first);s.async=true;holder.appendChild(s)}}
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
 if(b.dataset.ik){intake(b.dataset.ik);return}
 if(b.dataset.noshow){if(confirm('Mark this client as a no-show? Any session fee charged is refunded and the policy fee goes to Fees to decide.'))api.markNoShow(b.dataset.noshow);return}
 if(b.dataset.fee){api.chargeFee(b.dataset.fee);return}
 if(b.dataset.waive){var why=prompt('Reason for waiving','Unwell');if(why!==null)api.waiveFee(b.dataset.waive,why);return}
 if(b.closest('#pvIk')&&'close' in b.dataset){$('pvIk').close();return}
 if(b.dataset.pref){var v=b.dataset.v;v=v==='true'?true:v==='false'?false:v;var o={};o[b.dataset.pref]=v;api.prefs(who,o);return}
 if('copy' in b.dataset){var t=$('pvCode').textContent;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent='Copied'},function(){var r=document.createRange();r.selectNodeContents($('pvCode'));var s=getSelection();s.removeAllRanges();s.addRange(r);b.textContent='Press Ctrl+C'});setTimeout(function(){b.textContent='Copy'},2000)}});
// Read-only view of a client's intake form. Only the treating practitioner sees the "before you come" answer.
function dob(s){var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?(+m[3])+' '+F.MON[+m[2]-1]+' '+m[1]:s}
function intake(bid){var b=api.state().bookings.filter(function(x){return x.id===bid})[0];if(!b||!b.intake)return;var d=b.intake.data||{};
 function row(l,v){return v?'<div><dt>'+l+'</dt><dd>'+esc(v)+'</dd></div>':''}
 $('pvIkBody').innerHTML='<div class="adm-dwh"><div><h2 id="pvIkH">'+esc(d.childName||d.name||b.name)+'</h2><p>Intake form · signed '+(d.signedAt?esc(F.when(new Date(d.signedAt))):'not yet')+'</p></div><button type="button" class="adm-x" data-close aria-label="Close"><svg aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>'+
  '<dl class="adm-dl">'+row('Preferred name',d.pref)+row('Date of birth',dob(d.childDob||d.dob))+row('Pronouns',d.pronouns)+row('Parent or carer',d.childName?d.name+(d.relation?' ('+d.relation+')':''):'')+
  row('Parental responsibility',{both:'Both parents',me:'Just them',orders:'Court orders (copy needed)'}[d.custody])+row('School',d.school)+row('Address',d.addr)+row('Mobile',d.mobile)+row('Email',d.email)+
  row('Emergency contact',[d.ecName,d.ecRel,d.ecPhone].filter(Boolean).join(', '))+row('GP',[d.gpName,d.gpPractice].filter(Boolean).join(', '))+row('Updates to GP',{yes:'Yes',no:'No',ask:'Ask first'}[d.gpShare])+
  row('Medicare',d.mcNum?'Card ending '+String(d.mcNum).replace(/\D/g,'').slice(-4)+', number '+String(d.mcIrn||'')+(d.mcExp?', expires '+d.mcExp:''):'')+row('Health fund',[d.fund,d.fundNo].filter(Boolean).join(' '))+row('Telehealth location',d.teleWhere)+row('Heard about us',d.heard)+'</dl>'+
  (d.why?'<div class="adm-sec"><h3>Before the first session</h3><p class="adm-reason">'+esc(d.why)+'</p><p class="adm-muted">Only you can see this. It’s never sent to Claude or in texts.</p></div>':'')+
  '<p class="adm-muted">Consents: confidentiality '+(d.cConf?'✓':'✗')+' · fees and cancellations '+(d.cFees?'✓':'✗')+' · texts and email '+(d.cMsg?'✓':'✗')+(d.cTele!=null?' · telehealth '+(d.cTele?'✓':'✗'):'')+' · care '+(d.cCare||d.cKid?'✓':'✗')+'. Signed as “'+esc(d.sign||'')+'”.</p>';
 var dl=$('pvIk');if(!dl.open)dl.showModal()}
$('pvIk').addEventListener('click',function(e){if(e.target===$('pvIk')||e.target.closest('[data-close]'))$('pvIk').close()});
api.on(draw);draw();
})();
