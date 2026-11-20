/* Booking finder + live booking (demo backend in hub-core.js). */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,money=F.money,api=H.api;
var PHONE='0491 184 788', TEL='tel:0491184788';

// fee: [amount, minutes, medicare rebate (0 = none)] or a text note
var CLIN=[245,50,149.05], PSY_FEES={adi:CLIN,hannah:CLIN,melinda:[235,50,149.05],ellie:[170,50,101.55],maddy:[200,50,101.55],meaghan:[180,50,0]};
var NEED={
 talk:{t:'Someone to talk to',s:'Psychology for anxiety, low mood, stress, trauma or big changes',ico:'talk',plan:1,how:1,fee:PSY_FEES,wl:'Psychology'},
 conceive:{t:'Someone to talk to',s:'Fertility, IVF, pregnancy worries, anxiety or low mood',ico:'talk',plan:1,how:1,fee:PSY_FEES,wl:'Perinatal psychology'},
 counsel:{t:'Counselling',s:'Practical support for stress, burnout, parenting and life changes',ico:'leafy',plan:1,how:1,
  fee:{'michelle-ferris':[215,50,89.50],jodie:[120,60,0]},wl:'Counselling'},
 parenthood:{t:'Couple support for becoming parents',s:'Communication, new roles and staying connected',ico:'heart',how:1,wl:'Couple support',
  fee:{adi:'$245 for 50 minutes, or $365 for an extended 90-minute couples session. No Medicare rebate for couple sessions.'}},
 eating:{t:'Eating disorder treatment',s:'Psychological treatment, with or without an Eating Disorder Plan',ico:'leafy',how:1,wl:'Eating disorder treatment',
  fee:{adi:'$245 for 50 minutes. With an Eating Disorder Treatment and Management Plan from your GP, Medicare covers part of the cost.',hannah:'$245 for 50 minutes. With an Eating Disorder Treatment and Management Plan from your GP, Medicare covers part of the cost.'}},
 couples:{t:'Couples therapy',s:'Conflict, stress, intimacy, separation or feeling stuck',ico:'couple',how:1,
  fee:{'michelle-ferris':[245,60,0]},wl:'Couples therapy'},
 child:{t:'Therapy for my child or teen',s:'Play, art and talk-based therapy, plus parent coaching',ico:'star',plan:1,how:1,fee:PSY_FEES,wl:'Child psychology'},
 assess:{t:'An ADHD, autism or learning assessment',s:'A clear picture of strengths and challenges, with a written report',ico:'clip',
  fee:{meaghan:'Assessment fees depend on the type of assessment. Ask us for a quote.'}},
 art:{t:'Art therapy',s:'Creative therapy when words are hard. No art skills needed.',ico:'palette',plan:1,how:1,
  fee:{'michelle-joseph':[220,50,89.50]}},
 dyadic:{t:'Parent and child art therapy',s:'Strengthen your bond with your little one through art',ico:'palette',
  fee:{'michelle-joseph':[240,50,0]}},
 ndis:{t:'NDIS supports',s:'Counselling and capacity building, at home, online or in the community',ico:'puzzle',
  fee:{'michelle-joseph':'NDIS capacity building: $193.99 per hour, claimed from your plan.',jodie:'Claimed from your NDIS plan. Ask Jodie which category applies.'}},
 massage:{t:'Massage',s:'Remedial, relaxation, pregnancy and postpartum',ico:'hand',wl:'Massage',
  fee:{laura:'$65 for 30 minutes or $120 for 60 minutes. Health fund rebates, HICAPS on site.'}},
 acu:{t:'Acupuncture',s:'Gentle Japanese acupuncture',ico:'leaf',wl:'Acupuncture',
  fee:{kate:'$150 first visit (60 min), $110 follow-up (50 min). Concession $130 / $100. Check your health fund.'}},
 osteo:{t:'Osteopathy',s:'Hands-on care for all ages, from babies to adults',ico:'spine',
  fee:{anna:'$190 new patient (up to 1 hour), $140 return visit. Concession $170 / $130. Check your health fund.',melissa:'See our fees page or ask us.'}}
};
var WHO={
 preg:{t:'Pregnancy or trying to conceive',s:'Fertility, IVF, pregnancy and preparing for birth',ico:'heart',needs:[
  ['conceive',0,0,['maddy','ellie','hannah','melinda','adi']],
  ['parenthood',0,0,['adi']],
  ['acu','Acupuncture alongside fertility treatment or in pregnancy','Care alongside IVF, during pregnancy and before birth',['kate']],
  ['massage','Pregnancy massage','Nurturing, tailored care for mums-to-be',['laura']],
  ['osteo','Osteopathy in pregnancy','Back, hip or pelvic pain in pregnancy',['anna','melissa']]]},
 early:{t:'Birth and the early days',s:'Support for you, your baby and your relationship',ico:'moon',needs:[
  ['talk','Someone to talk to','Birth trauma, low mood, anxiety or adjusting to life with a baby',['hannah','ellie','melinda','adi','maddy']],
  ['counsel','Early parenting counselling','Sleep-deprived, overwhelmed or finding your feet',['jodie','michelle-ferris']],
  ['parenthood',0,0,['adi']],
  ['dyadic',0,0,['michelle-joseph']],
  ['massage','Postpartum massage','Rest and recovery after birth',['laura']],
  ['osteo','Osteopathy for you or your baby','After birth, and for babies',['anna','melissa']]]},
 child:{t:'My child or teen',s:'Therapy, assessments and support for young people',ico:'star',needs:[
  ['child',0,0,['melinda','meaghan']],
  ['assess',0,0,['meaghan']],
  ['art',0,'For kids who find it hard to put feelings into words',['michelle-joseph']],
  ['dyadic',0,0,['michelle-joseph']],
  ['ndis',0,0,['jodie','michelle-joseph']],
  ['osteo','Osteopathy for babies and children',0,['anna','melissa']]]},
 me:{t:'Me',s:'Support for adults at any stage of life',ico:'person',needs:[
  ['talk',0,0,['adi','hannah','melinda','ellie','maddy']],
  ['eating',0,0,['adi','hannah']],
  ['counsel',0,0,['michelle-ferris','jodie']],
  ['art',0,0,['michelle-joseph']],
  ['ndis',0,0,['jodie','michelle-joseph']],
  ['massage',0,0,['laura']],
  ['acu',0,'Women’s health, pregnancy and general health',['kate']],
  ['osteo',0,0,['anna','melissa']]]},
 couple:{t:'Us, as a couple',s:'Relationship support, including becoming parents',ico:'couple',needs:[
  ['couples',0,0,['michelle-ferris']],
  ['parenthood',0,0,['adi']]]},
 body:{t:'Body care',s:'Massage, acupuncture or osteopathy',ico:'leaf',hidden:1,needs:[
  ['massage',0,0,['laura']],
  ['acu',0,'Women’s health, pregnancy and general health',['kate']],
  ['osteo',0,0,['anna','melissa']]]}
};

var IC={
 person:'<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.4-4 4-6 7-6s5.6 2 7 6"/>',
 couple:'<circle cx="8.5" cy="8.5" r="2.8"/><circle cx="16" cy="8.5" r="2.8"/><path d="M3 19c1-3 3-5 5.5-5s4.5 2 5.5 5M14 14.3c.6-.2 1.3-.3 2-.3 2.5 0 4.2 2 5 5"/>',
 heart:'<path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z"/>',
 moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
 star:'<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
 talk:'<path d="M4 5.5h16v10.5H10l-5 4v-4H4z"/><path d="M8 10h8M8 13h5"/>',
 leafy:'<path d="M4 20c2-6 6-10 16-12-1 8-6 12-12 12H4z"/><path d="M4 20c4-4 7-6 10-7"/>',
 leaf:'<path d="M5 19C5 11 11 5 19 5c0 8-6 14-14 14z"/><path d="M5 19l7-7"/>',
 palette:'<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.5-1-2.6 0-.9.7-1.6 1.7-1.6H17a3.5 3.5 0 0 0 3.5-3.6C20.5 6.9 16.7 3.5 12 3.5z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8" r="1"/>',
 clip:'<rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 4.5h6V7H9zM9 11.5h6M9 15.5h4"/>',
 puzzle:'<path d="M10 4h4v2.5a1.5 1.5 0 0 0 3 0V4h3v6h-2.5a1.5 1.5 0 0 0 0 3H20v7H4V13h2.5a1.5 1.5 0 0 0 0-3H4V4h6z"/>',
 hand:'<path d="M7 12V6.5a1.5 1.5 0 0 1 3 0V11M10 10V5a1.5 1.5 0 0 1 3 0v6M13 10V6a1.5 1.5 0 0 1 3 0v6M16 11V8.5a1.5 1.5 0 0 1 3 0V14c0 4-3 7-7 7h-.5A6.5 6.5 0 0 1 6 18l-2.3-4a1.5 1.5 0 0 1 2.6-1.5L7 14"/>',
 spine:'<path d="M12 3v18"/><rect x="8.5" y="4.5" width="7" height="3" rx="1.2"/><rect x="8" y="9" width="8" height="3" rx="1.2"/><rect x="8" y="13.5" width="8" height="3" rx="1.2"/><rect x="8.5" y="18" width="7" height="2.5" rx="1.2"/>',
 arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
 back:'<path d="M15 6l-6 6 6 6"/>',
 cal:'<rect height="15" rx="2.5" width="17" x="3.5" y="5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
 phone:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
 mail:'<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
 bolt:'<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
 bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
 x:'<path d="M6 6l12 12M18 6 6 18"/>',
 check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
 clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
 pin:'<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
 video:'<rect x="3.5" y="6.5" width="12" height="11" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3"/>'
};
function svg(k,c){return '<svg class="'+(c||'')+'" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}

// ---------- state in the URL hash ----------
var S={};
function readHash(){var o={};location.hash.replace(/^#/,'').split('&').forEach(function(p){var kv=p.split('=');if(kv[0])o[kv[0]]=decodeURIComponent(kv[1]||'')});
 if(!WHO[o.who])o={};else if(o.need&&!findNeed(o.who,o.need))delete o.need;return o}
function writeHash(push){var h=['who','need','plan','how','r'].filter(function(k){return S[k]}).map(function(k){return k+'='+S[k]}).join('&');
 var url=location.href.split('#')[0]+(h?'#'+h:'');try{history[push?'pushState':'replaceState'](null,'',url)}catch(e){}}
function findNeed(who,k){var l=WHO[who].needs;for(var i=0;i<l.length;i++)if(l[i][0]===k)return l[i];return null}
function needsQs(){var n=NEED[S.need];return n&&(n.plan||n.how)}
function answered(){var n=NEED[S.need];return (!n.plan||S.plan)&&(!n.how||S.how)}
function stepOf(){if(!S.who)return 1;if(!S.need)return 2;if(needsQs()&&!(S.r&&answered()))return 3;return 4}

var box=document.getElementById('finder');
function go(o){if(!('r' in o))delete S.r;for(var k in o){if(o[k]==null)delete S[k];else S[k]=o[k]}writeHash(true);render(true)}

function head(step){
 var list=['who','need'].concat(S.need&&!needsQs()?[]:['qs']).concat(['res']);
 var cur=step===4?list.length:step;
 var dots=list.map(function(_,i){return '<span class="fd-dot '+(i+1<cur?'done':i+1===cur?'on':'')+'"></span>'}).join('');
 return '<div class="fd-top"><button type="button" class="fd-back" data-back'+(step===1?' hidden':'')+'>'+svg('back')+'Back</button>'+
  '<div class="fd-steps"><span>Step '+cur+' of '+list.length+'</span><span class="fd-bar" aria-hidden="true">'+dots+'</span></div></div>'}
function optBtn(attrs,ico,t,s,pressed){return '<li><button type="button" class="fd-opt" '+attrs+(pressed?' aria-pressed="true"':'')+'><span class="fd-ico">'+svg(ico)+'</span><span><b>'+esc(t)+'</b><small>'+esc(s)+'</small></span>'+svg('arrow','fd-arrow')+'</button></li>'}

function renderWho(){
 var h=head(1)+'<div class="fd-step"><h2 class="fd-q" tabindex="-1">Who is the appointment for?</h2><p class="fd-sub">Pick the one that fits best. You can change it later.</p><ul class="fd-opts">';
 for(var k in WHO){var w=WHO[k];if(!w.hidden)h+=optBtn('data-who="'+k+'"',w.ico,w.t,w.s,S.who===k)}
 return h+'</ul><p class="fd-shortcut">Just after a massage, acupuncture or osteopathy? <button type="button" data-who="body">Go straight to body care</button></p></div>'}
function renderNeed(){
 var w=WHO[S.who],q=S.who==='child'?'What would help your child most?':S.who==='couple'?'What are you looking for?':S.who==='body'?'Which kind of body care?':'What would help most?';
 var h=head(2)+'<div class="fd-step"><h2 class="fd-q" tabindex="-1">'+q+'</h2><p class="fd-sub">'+esc(w.t)+'</p><ul class="fd-opts">';
 w.needs.forEach(function(n){var d=NEED[n[0]];h+=optBtn('data-need="'+n[0]+'"',d.ico,n[1]||d.t,n[2]||d.s,S.need===n[0])});
 return h+'</ul></div>'}
function pills(key,opts,cur){return '<div class="fd-pills" role="group">'+opts.map(function(o){return '<button type="button" class="fd-pill" data-'+key+'="'+o[0]+'" aria-pressed="'+(cur===o[0])+'">'+esc(o[1])+'</button>'}).join('')+'</div>'}
function renderQs(){
 var n=NEED[S.need],kid=S.who==='child',h=head(3)+'<div class="fd-step"><h2 class="fd-q" tabindex="-1">'+(n.plan&&n.how?'Two quick questions':'One quick question')+'</h2><p class="fd-sub">So we book the right appointment type and show the right fees.</p>';
 if(n.plan)h+='<div class="fd-group"><h3>'+(kid?'Does your child have a Mental Health Treatment Plan?':'Do you have a Mental Health Treatment Plan?')+'</h3><p>A plan from '+(kid?'your child’s regular GP, paediatrician or psychiatrist':'your regular GP (or psychiatrist)')+' gives you a Medicare rebate for up to 10 sessions a year. Since November 2025 it usually needs to come from your regular GP.</p>'+
  pills('plan',[['yes','Yes'],['no','No'],['unsure','Not sure']],S.plan)+'</div>';
 if(n.how)h+='<div class="fd-group"><h3>How would you like to meet?</h3><p>Most sessions can be at the Hub in Jan Juc or by video or phone.</p>'+
  pills('how',[['in','At the Hub'],['online','Video or phone'],['any','Either is fine']],S.how)+'</div>';
 return h+'<button type="button" class="btn btn-primary fd-next" data-show'+(answered()?'':' disabled')+'>Show times'+svg('arrow')+'</button></div>'}

function feeOf(pid){var f=(NEED[S.need].fee||{})[pid];return f}
function priceTag(pid){var f=feeOf(pid);if(!Array.isArray(f))return '';
 return '<div class="fd-price"><b>'+money(f[0])+'</b><span>'+f[1]+' min session</span></div>'}
function feeLine(pid){
 var f=feeOf(pid);if(!f)return '';
 if(typeof f==='string')return '<p class="fd-cost">'+esc(f)+'</p>';
 if(!f[2])return '<p class="fd-cost">No Medicare rebate for this service.</p>';
 if(S.plan==='yes')return '<p class="fd-cost">You pay about <b>'+money(Math.round((f[0]-f[2])*100)/100)+'</b> after the '+money(f[2])+' Medicare rebate.</p>';
 return '<p class="fd-cost">With a Mental Health Treatment Plan, Medicare gives back about '+money(f[2])+'.</p>'}
function isLive(pid){var n=NEED[S.need];return P[pid].live&&!(n.contactOnly||{})[pid]}
function actions(pid){
 var p=P[pid],n=NEED[S.need],more='<a class="fd-more" href="'+H.SITE+'team.html#'+pid+'">About '+esc(p.first)+'</a>';
 if(p.contact||(n.contactOnly||{})[pid])
  return '<div class="fd-acts"><a class="btn btn-primary btn-sm" href="'+TEL+'">'+svg('phone')+'Call '+PHONE+'</a><a class="btn btn-outline btn-sm" href="'+H.SITE+'contact.html">'+svg('mail')+'Send an enquiry</a>'+more+'</div>';
 return '<div class="fd-acts"><a class="btn btn-primary btn-sm" href="'+p.url+'" target="_blank" rel="noopener">'+svg('cal')+'Book with '+p.first+(p.ext?' <span class="sr">on '+p.ext+'</span>':'')+'<span class="sr"> (opens in a new tab)</span></a>'+more+'</div>'}

var SLOTS={},SHOWN={};
function renderRes(){
 var w=WHO[S.who],nd=findNeed(S.who,S.need),n=NEED[S.need],ids=nd[3].filter(function(id){return !P[id].leave});
 function noReb(id){var f=feeOf(id);return Array.isArray(f)&&!f[2]?1:0}
 if(S.plan==='yes')ids.sort(function(a,b){return noReb(a)-noReb(b)});
 if(S.how==='online')ids.sort(function(a,b){return (b==='jodie')-(a==='jodie')});
 var tags=[w.t,nd[1]||n.t];
 if(S.plan)tags.push(S.plan==='yes'?'Has a Mental Health Treatment Plan':S.plan==='no'?'No plan':'Not sure about a plan');
 if(S.how)tags.push(S.how==='in'?'At the Hub':S.how==='online'?'Video or phone':'Either');
 var live=ids.filter(isLive);
 var h=head(4)+'<div class="fd-step"><h2 class="fd-q" tabindex="-1">'+(live.length?'Pick a time that suits':'Here’s who can help')+'</h2>'+
  '<p class="fd-summary">'+tags.map(esc).join('<span class="fd-sep" aria-hidden="true"> · </span>')+'</p>';
 if(live.length>1)h+='<div class="fd-soon" id="fdSoon" aria-live="polite"><span class="fd-soon-ico">'+svg('bolt')+'</span><div><b>Finding the soonest time…</b></div></div>';
 h+='<ul class="fd-results">';
 ids.forEach(function(pid){var p=P[pid];
  h+='<li><article class="fd-res" data-pid="'+pid+'"><img src="'+H.photo(pid)+'" alt="" width="88" height="88" loading="lazy"><div><h3>'+esc(p.name)+'</h3><p class="fd-role">'+esc(p.role)+'</p></div>'+priceTag(pid)+
   '<div class="fd-body"><p class="fd-why">'+esc(p.why)+'</p>'+(p.note?'<p class="fd-pnote">'+esc(p.note)+'</p>':'')+feeLine(pid)+
   (isLive(pid)?'<div class="fd-times" data-times="'+pid+'"><div class="fd-skel"><span></span><span></span><span></span><span></span></div></div>'+
     '<div class="fd-acts fd-acts-live"><button type="button" class="fd-linkbtn" data-wait="'+pid+'">'+svg('bell')+'Nothing suits? Get a text if something sooner opens</button><a class="fd-more" href="'+H.SITE+'team.html#'+pid+'">About '+esc(p.first)+'</a></div>'
    :actions(pid))+'</div></article></li>'});
 h+='</ul>';
 if(live.length>1)h+='<div class="fd-help fd-help-wait"><p><b>Happy with anyone?</b> Join the waitlist for everyone above and we’ll text you the moment an earlier spot opens.</p><button type="button" class="btn btn-outline btn-sm" data-wait="'+live.join(',')+'">'+svg('bell')+'Join the waitlist</button></div>';
 h+='<div class="fd-help"><p><b>Still not sure who to see?</b> Call us and we’ll help you choose. There’s no wrong door.</p><a class="btn btn-outline btn-sm" href="'+TEL+'">'+svg('phone')+'Call '+PHONE+'</a></div>'+
  '<p class="fd-note">Fees and rebates are a guide. See the <a href="'+H.SITE+'fees.html">fees page</a> or ask us.</p>'+
  '<p class="fd-restart"><button type="button" data-restart>Start again</button></p></div>';
 setTimeout(function(){loadTimes(live)},0);
 return h}

function loadTimes(pids){if(!pids.length)return;
 api.slots(pids,84).then(function(res){SLOTS=res;pids.forEach(function(pid){SHOWN[pid]=SHOWN[pid]||3;drawTimes(pid)});drawSoon(pids)})}
function groupDays(list){var g=[],cur=null;list.forEach(function(d){var k=d.toDateString();if(!cur||cur.k!==k){cur={k:k,d:d,t:[]};g.push(cur)}cur.t.push(d)});return g}
function drawTimes(pid){var el=box.querySelector('[data-times="'+pid+'"]');if(!el)return;
 var g=groupDays(SLOTS[pid]||[]),n=SHOWN[pid];
 if(!g.length){el.innerHTML='<p class="fd-none">'+esc(P[pid].first)+' is fully booked for the next three months. Join the waitlist below and we’ll text you if a spot opens.</p>';return}
 var far=g[0].d.getTime()-H.now()>14*864e5;
 var h=(far?'<p class="fd-none fd-far">'+svg('bell')+'<span><b>'+esc(P[pid].first)+' is booked out until '+esc(F.day(g[0].d,1))+'.</b> Join the waitlist below and we’ll text you if something opens sooner.</span></p>':'')+
  '<p class="fd-times-h">'+svg('clock')+(far?'First available':'Next available')+' with '+esc(P[pid].first)+'</p><div class="fd-days">';
 g.slice(0,n).forEach(function(day){h+='<div class="fd-day"><span class="fd-dname">'+esc(F.day(day.d))+'</span><div class="fd-chips">'+
  day.t.map(function(t){return '<button type="button" class="fd-chip" data-slot="'+pid+'|'+t.toISOString()+'">'+F.time(t)+'</button>'}).join('')+'</div></div>'});
 h+='</div>';if(g.length>n)h+='<button type="button" class="fd-linkbtn fd-moretimes" data-more="'+pid+'">More times</button>';
 el.innerHTML=h}
function drawSoon(pids){var el=document.getElementById('fdSoon');if(!el)return;var best=null;
 pids.forEach(function(pid){var s=(SLOTS[pid]||[])[0];if(s&&(!best||s<best.t))best={pid:pid,t:s}});
 if(!best){el.innerHTML='<span class="fd-soon-ico">'+svg('bell')+'</span><div><b>Everyone is booked up for now.</b><span>Join the waitlist below and we’ll text you when a spot opens.</span></div>';return}
 el.innerHTML='<span class="fd-soon-ico">'+svg('bolt')+'</span><div><b>Soonest: '+esc(F.day(best.t,1))+', '+F.time(best.t)+'</b><span>with '+esc(P[best.pid].name)+'</span></div><button type="button" class="btn btn-primary btn-sm" data-slot="'+best.pid+'|'+best.t.toISOString()+'">Book it</button>'}

function render(focus){
 var st=stepOf();
 box.innerHTML=st===1?renderWho():st===2?renderNeed():st===3?renderQs():renderRes();
 if(focus){var q=box.querySelector('.fd-q');var r=box.getBoundingClientRect();
  if(r.top<0||r.top>innerHeight*.6)box.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  if(q)q.focus({preventScroll:true})}}

box.addEventListener('click',function(e){
 var b=e.target.closest('button');if(!b)return;var d=b.dataset;
 if('back' in d){go(backState());return}
 if(d.who){go({who:d.who,need:null,plan:null,how:null});return}
 if(d.need){var n=NEED[d.need];go({need:d.need,plan:n.plan?S.plan:null,how:n.how?S.how:null});return}
 if(d.plan||d.how){var k=d.plan?'plan':'how';S[k]=d[k];writeHash(false);
  [].forEach.call(box.querySelectorAll('[data-'+k+']'),function(x){x.setAttribute('aria-pressed',x===b)});
  var nx=box.querySelector('[data-show]');if(nx)nx.disabled=!answered();return}
 if('show' in d){go({r:'1'});return}
 if('restart' in d){S={};writeHash(true);render(true);return}
 if(d.more){SHOWN[d.more]+=4;drawTimes(d.more);return}
 if(d.slot){var i=d.slot.indexOf('|');openBook(d.slot.slice(0,i),new Date(d.slot.slice(i+1)));return}
 if(d.wait){openWait(d.wait.split(','));return}
});
function backState(){var st=stepOf();if(st===4&&needsQs())return {r:null};if(st>=3)return {need:null};return {who:null}}
window.addEventListener('popstate',function(){S=readHash();render(true)});
// times change when someone else books or a spot is refilled (other tab = the dashboard)
api.on(function(){if(stepOf()===4&&!dlg.open){var live=[].map.call(box.querySelectorAll('[data-times]'),function(x){return x.dataset.times});if(live.length)api.slots(live,84).then(function(r){SLOTS=r;live.forEach(drawTimes);drawSoon(live)})}});

// ---------- booking + waitlist sheet ----------
var dlg=document.getElementById('bkSheet'),sheet=dlg.querySelector('.bk-in');
function closeSheet(){dlg.close()}
dlg.addEventListener('click',function(e){if(e.target===dlg||e.target.closest('[data-close]'))closeSheet()});
dlg.addEventListener('close',function(){document.documentElement.classList.remove('bk-lock')});
function showSheet(html){sheet.innerHTML=html;if(!dlg.open){dlg.showModal();document.documentElement.classList.add('bk-lock')}
 var f=sheet.querySelector('[autofocus]')||sheet.querySelector('h2');if(f)f.focus()}
function sheetHead(t){return '<div class="bk-head"><h2 tabindex="-1">'+t+'</h2><button type="button" class="bk-x" data-close aria-label="Close">'+svg('x')+'</button></div>'}
function apptLine(pid,t,len){var p=P[pid],on=S.how==='online';
 return '<div class="bk-appt"><img src="'+H.photo(pid)+'" alt="" width="64" height="64"><div><b>'+esc(p.name)+'</b><span>'+svg('cal')+esc(F.day(t,1))+', '+F.time(t)+' ('+(len||H.lenOf(pid,S.need))+' min)</span>'+
  '<span>'+svg(on?'video':'pin')+(on?'Video or phone (link sent by text)':'At the Hub, 16 Princes Tce, Jan Juc')+'</span></div></div>'}
function costNote(pid){var f=feeOf(pid);if(!Array.isArray(f))return typeof f==='string'?'<p class="bk-cost">'+esc(f)+'</p>':'';
 if(f[2]&&S.plan==='yes')return '<p class="bk-cost"><b>'+money(f[0])+'</b>, about <b>'+money(Math.round((f[0]-f[2])*100)/100)+'</b> after your Medicare rebate. Bring your Mental Health Treatment Plan, or ask your GP to send it to us.</p>';
 if(f[2]&&S.plan==='unsure')return '<p class="bk-cost"><b>'+money(f[0])+'</b> per session. We’ll book it as private for now. If you get a Mental Health Treatment Plan from your regular GP before your first session, tell us and we’ll switch it to Medicare (about '+money(f[2])+' back).</p>';
 return '<p class="bk-cost"><b>'+money(f[0])+'</b> per session'+(f[2]?'. Get a Mental Health Treatment Plan from your regular GP first and Medicare gives back about '+money(f[2])+'.':'.')+'</p>'}
var DRAFT={};try{DRAFT=JSON.parse(sessionStorage.getItem('scfh-draft')||'{}')}catch(e){}
function field(id,label,type,ac,extra){return '<label class="bk-f"><span>'+label+'</span><input id="'+id+'" name="'+id+'" type="'+type+'" autocomplete="'+ac+'" value="'+esc(DRAFT[id]||'')+'" '+(extra||'')+' required></label>'}

function openBook(pid,t){
 var p=P[pid];
 showSheet(sheetHead('Book with '+esc(p.first))+apptLine(pid,t)+
  '<p class="bk-svc">'+svg('check')+'<span>We’ll book it as <b id="bkSvc">'+esc(H.serviceName(pid,S.need,S.plan,S.how==='any'?'in':S.how,'yes'))+'</b>, so you don’t need to pick an appointment type.</span></p>'+costNote(pid)+
  '<form class="bk-form" novalidate>'+
   (S.who==='child'?'<div class="bk-row">'+field('bkName','Your name (parent or carer)','text','name','autofocus')+field('bkKid','Child’s first name','text','off')+'</div>':
    field('bkName',S.who==='couple'||S.need==='parenthood'?'Your name (we’ll ask for your partner’s at the session)':'Full name','text','name','autofocus'))+
   '<div class="bk-row">'+field('bkPhone','Mobile','tel','tel','inputmode="tel" placeholder="04xx xxx xxx"')+field('bkEmail','Email','email','email')+'</div>'+
   '<fieldset class="bk-fs"><legend>Is this your first visit to the Hub?</legend><div class="fd-pills"><button type="button" class="fd-pill" data-first="yes" aria-pressed="false">Yes, first time</button><button type="button" class="fd-pill" data-first="no" aria-pressed="false">I’ve been before</button></div></fieldset>'+
   '<label class="bk-check"><input type="checkbox" id="bkOk" required><span>I agree to the Hub’s <a href="privacy.html" target="_blank" rel="noopener">privacy notice</a>. My details go into '+esc(p.first)+'’s practice records so they can see me, and we’ll text and email me about this booking.</span></label>'+
   '<p class="bk-err" role="alert" hidden></p>'+
   '<button type="submit" class="btn btn-primary bk-submit">'+svg('check')+'Confirm booking</button>'+
   '<p class="bk-demo">Demo: no real booking is made.</p></form>');
 var form=sheet.querySelector('form'),first='';
 form.addEventListener('click',function(e){var b=e.target.closest('[data-first]');if(!b)return;first=b.dataset.first;[].forEach.call(form.querySelectorAll('[data-first]'),function(x){x.setAttribute('aria-pressed',x===b)});
  var sv=document.getElementById('bkSvc');if(sv)sv.textContent=H.serviceName(pid,S.need,S.plan,S.how==='any'?'in':S.how,first)});
 form.addEventListener('input',function(e){DRAFT[e.target.id]=e.target.value;try{sessionStorage.setItem('scfh-draft',JSON.stringify(DRAFT))}catch(x){}});
 form.addEventListener('submit',function(e){e.preventDefault();
  var name=form.bkName.value.trim(),phone=form.bkPhone.value.trim(),email=form.bkEmail.value.trim(),err=form.querySelector('.bk-err');
  var kid=form.bkKid?form.bkKid.value.trim():'';
  var bad=!name?'Please add your name.':form.bkKid&&!kid?'Please add your child’s first name.':!/^(\+?61|0)4[\d ]{8,11}$/.test(phone.replace(/\s/g,'').replace(/^\+61/,'0').replace(/^61/,'0'))?'Please add an Australian mobile number (04xx xxx xxx).':!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)?'Please check your email address.':!form.bkOk.checked?'Please tick the box to agree to the privacy notice.':'';
  if(bad){err.textContent=bad;err.hidden=false;return}
  var go=form.querySelector('.bk-submit');go.disabled=true;go.innerHTML='<span class="bk-spin"></span>Booking…';
  api.book({pid:pid,need:S.need,start:t.toISOString(),name:name,child:kid,phone:phone,email:email,plan:S.plan,how:S.how==='any'?'in':S.how,firstVisit:first}).then(function(r){
   if(!r.ok){err.textContent='Sorry, someone just grabbed that time. Pick another one below.';err.hidden=false;go.disabled=false;go.innerHTML=svg('check')+'Confirm booking';
    setTimeout(closeSheet,1600);return}
   api.remember(r.booking.token);done(r.booking)})});
}
function ics(b){var p=P[b.pid],s=new Date(b.start),e=new Date(s.getTime()+(b.len||p.len)*6e4);
 function z(d){return d.toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'')}
 return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Surf Coast Family Hub//Booking//EN\r\nBEGIN:VEVENT\r\nUID:'+b.id+'@surfcoastfamilyhub\r\nDTSTAMP:'+z(new Date())+'\r\nDTSTART:'+z(s)+'\r\nDTEND:'+z(e)+
  '\r\nSUMMARY:Appointment with '+p.name+'\r\nLOCATION:Surf Coast Family Hub\\, 16 Princes Tce\\, Jan Juc VIC 3228\r\nDESCRIPTION:Need to change it? Call 0491 184 788.\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'}
function done(b){var p=P[b.pid],t=new Date(b.start);
 var url=URL.createObjectURL(new Blob([ics(b)],{type:'text/calendar'}));
 showSheet(sheetHead('You’re booked')+'<div class="bk-done"><span class="bk-tick">'+svg('check')+'</span><p>We’ve sent a confirmation text to <b>'+esc(b.phone)+'</b>.</p></div>'+apptLine(b.pid,t,b.len)+'<p class="bk-svc">'+svg('check')+'<span>'+esc(b.service)+'</span></p>'+
  '<div class="bk-acts"><a class="btn btn-primary btn-sm" href="'+url+'" download="hub-appointment.ics">'+svg('cal')+'Add to calendar</a><a class="btn btn-outline btn-sm" href="manage.html#t='+b.token+'">Change or cancel</a></div>'+
  (b.how==='online'?'':'<p class="bk-dir">'+svg('pin')+'<span>16 Princes Tce, Jan Juc VIC 3228 (Jan Juc Village). <a href="https://www.google.com/maps/search/?api=1&amp;query=16+Princes+Terrace+Jan+Juc+VIC+3228" target="_blank" rel="noopener">Get directions</a></span></p>')+
  '<div class="bk-sooner"><h3>'+svg('bell')+'Want something sooner?</h3><p>We’ll text you if an earlier spot with '+esc(p.first)+' opens up. Tap to claim it, and we’ll move your booking.</p>'+
  '<button type="button" class="btn btn-outline btn-sm" data-sooner>Yes, text me</button></div>'+
  '<p class="bk-demo">Demo: open the <a href="admin.html" target="_blank" rel="noopener">Hub dashboard</a> to see this booking arrive.</p>');
 sheet.querySelector('[data-sooner]').addEventListener('click',function(){var btn=this;btn.disabled=true;
  api.joinWaitlist({name:b.name,phone:b.phone,pids:[b.pid],need:'Earlier time',days:[1,2,3,4,5,6],times:['am','pm'],moveToken:b.token}).then(function(){btn.outerHTML='<p class="bk-ok">'+svg('check')+'Done. We’ll text you if something earlier opens.</p>'})});
 render(false)}

function openWait(pids){
 pids=pids.filter(function(x){return P[x]&&!P[x].leave});
 var many=pids.length>1;
 showSheet(sheetHead('Get a text when a spot opens')+
  '<p class="bk-lead">When someone cancels, we text the waitlist. The first person to tap the link gets the spot. No fees, no obligation.</p>'+
  '<form class="bk-form" novalidate>'+field('wlName','Full name','text','name','autofocus')+field('wlPhone','Mobile','tel','tel','inputmode="tel" placeholder="04xx xxx xxx"')+
  (many?'<fieldset class="bk-fs"><legend>Who are you happy to see?</legend><div class="fd-pills">'+pids.map(function(pid){return '<button type="button" class="fd-pill" data-wp="'+pid+'" aria-pressed="true">'+esc(P[pid].first)+'</button>'}).join('')+'</div></fieldset>':'')+
  '<fieldset class="bk-fs"><legend>Which days work?</legend><div class="fd-pills">'+[1,2,3,4,5,6].map(function(d){return '<button type="button" class="fd-pill" data-wd="'+d+'" aria-pressed="'+(d<6)+'">'+F.DAY[d]+'</button>'}).join('')+'</div></fieldset>'+
  '<fieldset class="bk-fs"><legend>Which times?</legend><div class="fd-pills"><button type="button" class="fd-pill" data-wt="am" aria-pressed="true">Mornings</button><button type="button" class="fd-pill" data-wt="pm" aria-pressed="true">Afternoons</button></div></fieldset>'+
  '<label class="bk-check"><input type="checkbox" id="wlOk" required><span>Text me about spots that open up. We use these details only to offer you spots, and delete them when you leave the list. Reply STOP at any time. <a href="privacy.html" target="_blank" rel="noopener">Privacy notice</a></span></label>'+
  '<p class="bk-err" role="alert" hidden></p><button type="submit" class="btn btn-primary bk-submit">'+svg('bell')+'Join the waitlist</button><p class="bk-demo">Demo: no real texts are sent.</p></form>');
 var form=sheet.querySelector('form');
 form.addEventListener('click',function(e){var b=e.target.closest('.fd-pill');if(b)b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')!=='true')});
 form.addEventListener('submit',function(e){e.preventDefault();
  function on(a){return [].filter.call(form.querySelectorAll('[data-'+a+'][aria-pressed="true"]'),function(){return 1}).map(function(x){return x.dataset[a]})}
  var name=form.wlName.value.trim(),phone=form.wlPhone.value.trim(),err=form.querySelector('.bk-err');
  var who=many?on('wp'):pids,days=on('wd').map(Number),times=on('wt');
  var bad=!name?'Please add your name.':!/^(\+?61|0)4[\d ]{8,11}$/.test(phone.replace(/\s/g,''))?'Please add an Australian mobile number.':!who.length?'Pick at least one practitioner.':!days.length?'Pick at least one day.':!times.length?'Pick mornings, afternoons or both.':!form.wlOk.checked?'Please tick the box so we can text you.':'';
  if(bad){err.textContent=bad;err.hidden=false;return}
  api.joinWaitlist({name:name,phone:phone,pids:who,need:(NEED[S.need]||{}).wl,days:days,times:times}).then(function(){
   showSheet(sheetHead('You’re on the list')+'<div class="bk-done"><span class="bk-tick">'+svg('check')+'</span><p>We’ll text <b>'+esc(phone)+'</b> when a spot opens with '+esc(who.map(function(x){return P[x].first}).join(', '))+'. Be quick, first tap gets it.</p></div>'+
    '<p class="bk-demo">Demo: in the <a href="admin.html" target="_blank" rel="noopener">Hub dashboard</a>, cancel an appointment to watch the text arrive.</p>')})});
}

S=readHash();render(false);

// ---------- "choose someone yourself" grid ----------
var grid=document.getElementById('allGrid');
grid.innerHTML=H.ORDER.filter(function(id){return !P[id].leave}).map(function(pid){var p=P[pid],href=p.contact?H.SITE+'contact.html':p.url,ext=!p.contact;
 return '<li><a class="book-card card" data-person="'+pid+'" href="'+href+'"'+(ext?' target="_blank" rel="noopener"':'')+'><img alt="" class="bk-photo" height="300" loading="lazy" src="'+H.photo(pid)+'" width="300"/><span class="bk-name">'+esc(p.name)+'</span><span class="bk-role">'+esc(p.role)+'</span><span class="bk-go">'+(p.contact?'Contact us to book':'Book with '+esc(p.first))+' '+svg('arrow')+'</span>'+(ext?'<span class="sr"> (opens the booking page in a new tab)</span>':'')+'</a></li>'}).join('');
})();
