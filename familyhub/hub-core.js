/* Surf Coast Family Hub: shared data + DEMO booking backend.
   Everything here runs in the browser with fake data kept in localStorage, so the booking,
   manage and dashboard pages can be shown before any Halaxy connection exists.
   The public surface (HUB.api.*) mirrors the planned Worker API, so going live means
   swapping these functions for fetch('/api/...') calls backed by the Halaxy API. */
(function(){
'use strict';
var SITE=window.HUB_SITE||'https://familyhub.aiautomationvic.com/';
var HX='https://www.halaxy.com/book/', CLINIKO='https://dr-anna-morrow.au5.cliniko.com/bookings#service';

// ---------- practitioners ----------
// live: books through Halaxy, so the demo shows times. sched: real weekly pattern of online-bookable start
// times read from each practitioner's public Halaxy page on 20 Nov 2026 (day 0 = Sunday). openFrom: they were
// booked out until this date. svc: Halaxy appointment names, so the booking lands on the right service.
// The busy/free pattern after openFrom is made up for the demo.
var PSY_SVC={med:'Medicare - Face to Face Psychology Appointment',priv:'Private Psychology Appointment',tele:'Telehealth Psychology Appointment',phone:'Phone Psychology Appointment'};
var P={
 adi:{name:'Dr Adi Brown',first:'Adi',role:'Clinical Psychologist',url:HX+'psychologist/dr-adi-brown/256944/503631',psych:1,live:1,len:50,openFrom:'2027-01-04',
  sched:{1:['9:00','10:00','11:00','13:00','14:00','15:00'],3:['9:00','10:00','11:00','13:00','14:00','15:00'],4:['9:00','10:00','11:00','13:00','14:00']},
  svc:Object.assign({parenthood:'Preparing for Parenthood - Couple Support',eating:'Eating Disorder Psychological Treatment'},PSY_SVC),
  why:'Adults at every life stage, with extra training in perinatal and infant mental health, birth trauma and loss.'},
 hannah:{name:'Hannah Jensen',first:'Hannah',role:'Clinical Psychologist',url:HX+'widget/psychologist/hannah-jensen/680341/503631',psych:1,live:1,len:50,openFrom:'2027-02-02',
  sched:{2:['9:00','10:00','11:00','13:00','14:00'],4:['9:00','10:00','11:00','13:00','14:00'],5:['9:00','10:00','11:00','13:00']},
  svc:Object.assign({eating:'Eating Disorder Psychological Treatment'},PSY_SVC),
  why:'Perinatal psychology, infant mental health and trauma. Formerly Senior Clinical Psychologist at the Royal Women’s Hospital.'},
 melinda:{name:'Melinda Sullivan',first:'Melinda',role:'Clinical Psychologist',url:HX+'widget/psychologist/melinda-sullivan/1343231/503631',psych:1,live:1,len:50,
  sched:{3:['9:00','10:30','11:30','13:30','14:30','16:00'],4:['9:00','10:00','11:00','12:00','13:30','14:30']},svc:PSY_SVC,
  why:'Clinical and perinatal psychologist and family therapist, and a former midwife and maternal and child health nurse.'},
 ellie:{name:'Ellie James',first:'Ellie',role:'Psychologist',url:HX+'widget/psychologist/ellie-james/1026431/503631',psych:1,live:1,len:50,
  sched:{1:['9:00','10:30','12:00','13:30']},
  svc:{med:'Medicare - Face to Face Psychology Appointment',priv:'Private - Psychology Appointment',tele:'Telehealth - Psychology Appointment',phone:'Phone Psychology Appointment'},
  why:'Perinatal anxiety and depression, birth trauma and the transition to parenthood.'},
 maddy:{name:'Maddy Keegan',first:'Maddy',role:'Psychologist',url:HX+'psychologist/ms-madelaine-keegan/1807285/503631',psych:1,live:1,len:50,
  sched:{2:['9:00','10:00','11:00'],5:['9:00','10:00','11:00','13:00','14:00','15:00']},
  svc:{med:'Medicare Face to Face Psychology Appointment',priv:'Private Psychology Appointment',tele:'Medicare Telehealth Psychology Appointment',phone:'Medicare Phone Psychology Appointment'},
  why:'Trying to conceive and infertility (her PhD area), pregnancy, birth and parenthood.'},
 meaghan:{name:'Meaghan Cook',first:'Meaghan',role:'Child & Adolescent Therapist',contact:1,
  why:'Children (6 to 12) and teens through play, art and talk, parent coaching, and ADHD, autism and cognitive assessments.'},
 'michelle-ferris':{name:'Michelle Ferris',first:'Michelle',role:'Individual & Couples Counsellor',url:HX+'widget/social-worker/ms-michelle-ferris/331996/503631',live:1,len:50,
  sched:{2:['9:00','10:00','11:00','12:00'],3:['9:15','10:15','11:30','13:00','14:00','15:00','16:00'],4:['13:00','14:15','17:00','19:00']},
  svc:{counsel:'Psychotherapy',couples:'Couples Therapy'},lens:{couples:60},
  why:'20 years with individuals and couples, including becoming parents. Emotion Focused Couples Therapy and EMDR.'},
 'michelle-joseph':{name:'Michelle Joseph',first:'Michelle',role:'Mental Health Social Worker & Art Therapist',url:'https://www.artroomtherapy.com.au/refernow',ext:'her booking site',
  note:'Sessions are online until early 2027.',
  why:'Art therapy for children, adults, and parents with their child, plus NDIS supports. No artistic skill needed.'},
 jodie:{name:'Jodie Morzinek',first:'Jodie',role:'Counsellor',url:'https://www.yoursupportspace.com.au/',ext:'her website',
  why:'Gentle, relationship-based support. Previously at the Barwon Health Early Parenting Centre. Mostly online.'},
 laura:{name:'Laura Rees',first:'Laura',role:'Massage Therapist',url:HX+'widget/massage-therapist/ms-laura-rees/659711/503631',live:1,len:60,
  sched:{6:['9:00','10:15','11:30']},svc:{massage:'60 Min Massage'},
  why:'Remedial, relaxation, pregnancy, postpartum and teen massage. 15+ years’ experience, HICAPS on site.'},
 kate:{name:'Kate Heagney',first:'Kate',role:'Acupuncturist',url:HX+'widget/acupuncturist/kate-heagney/659721/503631',live:1,len:60,
  sched:{3:['9:00','10:00','11:00','12:00','13:00','14:00']},svc:{acu:'Initial acupuncture consultation',acu2:'Follow-up acupuncture consultation'},
  why:'Gentle Japanese acupuncture with a special interest in women’s health, including alongside fertility treatment and IVF, and in pregnancy.'},
 anna:{name:'Dr Anna Morrow',first:'Anna',role:'Osteopath',url:CLINIKO,
  why:'Almost 20 years’ experience, including pregnancy, postpartum, babies and children.'},
 melissa:{name:'Melissa Andrew',first:'Melissa',role:'Osteopath',url:CLINIKO,leave:1,/* on maternity leave: hidden everywhere until this flag is removed */
  why:'Holistic osteopathy that draws on her Pilates and yoga training.'}
};
var ORDER=['adi','melinda','hannah','ellie','maddy','michelle-ferris','kate','laura','anna','melissa','meaghan','michelle-joseph','jodie'];
function photo(pid){return SITE+'img/team/colour/'+pid+'.webp'}
// typical session value per practitioner, for "income recovered" on the dashboard
var VALUE={adi:245,hannah:245,melinda:235,ellie:170,maddy:200,'michelle-ferris':215,laura:120,kate:150};

// ---------- small helpers ----------
var DAY=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function pad(n){return (n<10?'0':'')+n}
function fmtTime(d){d=new Date(d);var h=d.getHours(),m=d.getMinutes();return (h%12||12)+(m?':'+pad(m):'')+(h<12?'am':'pm')}
function fmtDay(d,long){d=new Date(d);var t=new Date(now()),tm=new Date(t);tm.setDate(t.getDate()+1);
 if(sameDay(d,t))return 'Today';if(sameDay(d,tm))return 'Tomorrow';
 return (long?['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]:DAY[d.getDay()])+' '+d.getDate()+' '+MON[d.getMonth()]}
function onDay(d){var x=fmtDay(d,1);return x==='Today'||x==='Tomorrow'?x.toLowerCase():'on '+x}
function sameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
function fmtWhen(d){return fmtDay(d)+', '+fmtTime(d)}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function money(n){return '$'+(n%1?n.toFixed(2):n)}
function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0)/4294967296}
function uid(n){var a='abcdefghjkmnpqrstuvwxyz23456789',s='';for(var i=0;i<(n||10);i++)s+=a[Math.floor(Math.random()*a.length)];return s}
function slotKey(pid,start){return pid+'|'+new Date(start).toISOString()}

// ---------- demo store ----------
var KEY='scfh-demo-v2', S;
var FIRST=['Sarah','Jess','Emma','Kate','Chloe','Mia','Tom','Ben','Lucy','Grace','Olivia','Hannah','Zoe','Ruby','Amy','Georgia','Lily','Sam','Ella','Nina'];
var LAST=['M.','T.','K.','R.','B.','L.','W.','H.','P.','S.','D.','C.'];
function defaults(){return {v:2,skew:0,bookings:[],freed:{},taken:{},waitlist:seedWaitlist(),offers:[],sms:[],feed:[],
 settings:{mode:'auto',batch:3,expiry:30,minNotice:2,quiet:true,quietFrom:20,quietTo:8,weekCap:3},stats:{filled:0,value:0,mins:[]}}}
function seedWaitlist(){var t=Date.now(),D=864e5;return [
 {id:'w1',name:'Sarah M.',phone:'0400 000 101',pids:['ellie','hannah','maddy','adi','melinda'],need:'Psychology',days:[1,2,3,4,5],times:['am','pm'],since:t-26*D,offers:[]},
 {id:'w2',name:'Jess T.',phone:'0400 000 102',pids:['hannah'],need:'Perinatal psychology',days:[2,4,5],times:['am'],since:t-21*D,offers:[]},
 {id:'w3',name:'Emma K.',phone:'0400 000 103',pids:['adi','melinda','ellie'],need:'Psychology',days:[1,2,4],times:['am','pm'],since:t-17*D,offers:[]},
 {id:'w4',name:'Chloe R.',phone:'0400 000 104',pids:['ellie','maddy'],need:'Psychology',days:[1,2,3,4,5],times:['pm'],since:t-12*D,offers:[]},
 {id:'w5',name:'Tom B.',phone:'0400 000 105',pids:['michelle-ferris'],need:'Couples therapy',days:[2,3,4],times:['am','pm'],since:t-9*D,offers:[]},
 {id:'w6',name:'Mia L.',phone:'0400 000 106',pids:['melinda','adi','hannah','ellie','maddy'],need:'Psychology',days:[1,2,3,4,5],times:['am','pm'],since:t-6*D,offers:[]},
 {id:'w7',name:'Grace W.',phone:'0400 000 107',pids:['laura'],need:'Pregnancy massage',days:[6],times:['am','pm'],since:t-4*D,offers:[]},
 {id:'w8',name:'Lucy H.',phone:'0400 000 108',pids:['adi','hannah','melinda','ellie','maddy'],need:'Psychology',days:[1,2,3,4,5],times:['am','pm'],since:t-2*D,offers:[]}]}
function load(){try{S=JSON.parse(localStorage.getItem(KEY))}catch(e){S=null}if(!S||S.v!==2)S=defaults()}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}emit()}
var subs=[];function emit(){subs.forEach(function(f){try{f()}catch(e){console.error(e)}})}
window.addEventListener('storage',function(e){if(e.key===KEY){load();emit()}});
load();
function now(){return Date.now()+(S.skew||0)}

// ---------- availability ----------
// A slot is "taken" by a made-up client unless freed by a cancellation. Busy-ness is seeded so it's stable.
function baseTaken(pid,d){var o=P[pid].openFrom;if(o&&d<new Date(o+'T00:00:00'))return true;return hash(pid+d.toISOString())<0.6}
function fakeClient(pid,d){var h=hash('c'+pid+d.toISOString());return FIRST[Math.floor(h*FIRST.length)]+' '+LAST[Math.floor(hash('l'+pid+d)*LAST.length)]}
function slotState(pid,d){var k=slotKey(pid,d);
 if(S.taken[k])return 'booked';                 // booked through the hub (demo client or refilled)
 if(S.freed[k])return 'free';                   // a seeded client cancelled
 return baseTaken(pid,d)?'seeded':'free'}
function daySlots(pid,day){var p=P[pid],out=[];if(!p||!p.live||p.leave||!p.sched[day.getDay()])return out;
 p.sched[day.getDay()].forEach(function(t){var hm=t.split(':'),d=new Date(day);d.setHours(+hm[0],+hm[1],0,0);out.push(d)});return out}
function freeSlots(pid,from,days){var out=[],d0=new Date(from);d0.setHours(0,0,0,0);var cut=now()+3*36e5;
 for(var i=0;i<days;i++){var day=new Date(d0);day.setDate(d0.getDate()+i);
  daySlots(pid,day).forEach(function(d){if(d.getTime()>cut&&slotState(pid,d)==='free'&&!openOfferFor(pid,d))out.push(d)})}
 return out}
function openOfferFor(pid,d){var k=slotKey(pid,d);return S.offers.some(function(o){return o.key===k&&(o.status==='open'||o.status==='queued'||o.status==='approval')})}

// ---------- feed + sms ----------
function feed(kind,text,extra){S.feed.unshift(Object.assign({id:uid(6),at:now(),kind:kind,text:text},extra||{}));S.feed=S.feed.slice(0,80)}
function sms(to,name,body,dir,meta){S.sms.push(Object.assign({id:uid(6),to:to,name:name,body:body,dir:dir||'out',at:now()},meta||{}));S.sms=S.sms.slice(-200)}

// ---------- the refill engine ----------
function timeBand(d){return new Date(d).getHours()<12?'am':'pm'}
function weekOffers(w){var wk=now()-7*864e5;return (w.offers||[]).filter(function(t){return t>wk}).length}
function moveBooking(w){if(!w.moveToken)return null;var b=S.bookings.filter(function(x){return x.token===w.moveToken})[0];return b&&b.status==='booked'?b:null}
function candidates(o){var d=new Date(o.start),sent=o.sent.map(function(x){return x.wid});
 return S.waitlist.filter(function(w){if(w.booked||w.removed||w.phone===o.exclude)return false;
   if(w.moveToken){var mb=moveBooking(w);if(!mb||new Date(mb.start)<=d)return false}   // only offer an earlier time than they already have
   return w.pids.indexOf(o.pid)>=0&&w.days.indexOf(d.getDay())>=0&&w.times.indexOf(timeBand(d))>=0&&sent.indexOf(w.id)<0&&weekOffers(w)<S.settings.weekCap})
  .sort(function(a,b){return a.since-b.since})}
function inQuiet(){if(!S.settings.quiet)return false;var h=new Date(now()).getHours(),f=S.settings.quietFrom,t=S.settings.quietTo;return f>t?(h>=f||h<t):(h>=f&&h<t)}
function slotFreed(pid,start,why,exclude){
 var key=slotKey(pid,start),p=P[pid];
 if(new Date(start).getTime()-now()<S.settings.minNotice*36e5){feed('skip','Too close to fill: '+p.first+', '+fmtWhen(start)+'. Left as is.',{pid:pid});return}
 var o={id:uid(8),key:key,pid:pid,start:new Date(start).toISOString(),status:'open',round:0,sent:[],created:now(),why:why||'cancelled',exclude:exclude||''};
 S.offers.unshift(o);
 if(S.settings.mode==='ask'){o.status='approval';feed('ask','Spot opened: '+p.first+', '+fmtWhen(start)+'. Waiting for you to send offers.',{oid:o.id});return}
 if(inQuiet()){o.status='queued';feed('queue','Spot opened: '+p.first+', '+fmtWhen(start)+'. Quiet hours, so offers go out at '+S.settings.quietTo+'am.',{oid:o.id});return}
 sendRound(o)}
function sendRound(o){var p=P[o.pid],c=candidates(o).slice(0,S.settings.batch);
 if(!c.length){o.status='unfilled';feed('none','No one on the waitlist fits '+p.first+', '+fmtWhen(o.start)+'. It’s back on the online booking page.',{oid:o.id});return}
 o.status='open';o.round++;o.expires=now()+S.settings.expiry*6e4;
 c.forEach(function(w){var tok=uid(8);o.sent.push({wid:w.id,tok:tok,round:o.round,at:now(),state:'sent'});w.offers=(w.offers||[]).concat(now());
  sms(w.phone,w.name,'Hi '+w.name.split(' ')[0]+', it’s Surf Coast Family Hub. We’ve had a cancellation with '+p.first+' '+onDay(o.start)+' at '+fmtTime(o.start)+'. Want it? Tap to grab it: sfch.au/c/'+tok+' (first in gets it, link expires '+fmtTime(o.expires)+'). Reply STOP to opt out.','out',{oid:o.id,wid:w.id,tok:tok,kind:'offer'})});
 feed('offer','Offered '+p.first+', '+fmtWhen(o.start)+' to '+c.map(function(w){return w.name}).join(', ')+(o.round>1?' (round '+o.round+')':'')+'.',{oid:o.id})}
function tick(){var changed=false;
 S.offers.forEach(function(o){
  if(o.status==='queued'&&!inQuiet()){sendRound(o);changed=true}
  if(o.status==='open'&&now()>o.expires){
   o.sent.forEach(function(s){if(s.state==='sent'&&s.round===o.round)s.state='expired'});
   if(new Date(o.start).getTime()-now()<S.settings.minNotice*36e5){o.status='unfilled';feed('none','Nobody claimed '+P[o.pid].first+', '+fmtWhen(o.start)+' in time. It’s back on the booking page.',{oid:o.id})}
   else sendRound(o);
   changed=true}});
 if(changed)save()}
setInterval(tick,5000);

function claim(tok,via){
 var o=null,s=null;S.offers.forEach(function(x){x.sent.forEach(function(y){if(y.tok===tok){o=x;s=y}})});
 if(!o)return {ok:false,reason:'missing'};
 var w=S.waitlist.filter(function(x){return x.id===s.wid})[0],p=P[o.pid];
 if(via==='yes')sms(w.phone,w.name,'YES','in',{oid:o.id,wid:w.id});
 if(o.status!=='open'||s.state==='expired'){
  if(s.state!=='late'&&s.state!=='lost'){s.state='late';sms(w.phone,w.name,'Thanks '+w.name.split(' ')[0]+', that spot’s just been filled. You’re still on our list and we’ll text you next time one comes up.','out',{oid:o.id,wid:w.id,kind:'taken'})}
  save();return {ok:false,reason:'taken',offer:o}}
 // In the real system this is one database transaction plus a re-check with Halaxy, so two taps can never both win.
 o.status='filled';o.winner=w.id;o.filledAt=now();s.state='won';w.booked=true;
 var mb=moveBooking(w),b,old;
 if(mb){old=mb.start;delete S.taken[slotKey(mb.pid,old)];mb.start=new Date(o.start).toISOString();S.taken[slotKey(mb.pid,mb.start)]=mb.id;mb.moved=(mb.moved||0)+1;b=mb;
  sms(w.phone,w.name,'Done! We’ve moved you to '+onDay(o.start)+' at '+fmtTime(o.start)+' with '+p.first+' (was '+fmtWhen(old)+'). Manage your booking: sfch.au/m/'+b.token,'out',{oid:o.id,wid:w.id,kind:'confirm'})}
 else{b=makeBooking({pid:o.pid,start:o.start,name:w.name,phone:w.phone,email:'',source:'refill',service:w.need});
  sms(w.phone,w.name,'You’re booked '+onDay(o.start)+' at '+fmtTime(o.start)+' with '+p.first+' at 16 Princes Tce, Jan Juc. Need to change it? Manage your booking: sfch.au/m/'+b.token,'out',{oid:o.id,wid:w.id,kind:'confirm'})}
 o.sent.forEach(function(x){if(x!==s&&x.state==='sent'){x.state='lost';var ww=S.waitlist.filter(function(q){return q.id===x.wid})[0];
  sms(ww.phone,ww.name,'Thanks '+ww.name.split(' ')[0]+', that spot’s just been filled. You’re still on our list and we’ll text you next time one comes up.','out',{oid:o.id,wid:ww.id,kind:'taken'})}});
 var mins=Math.max(1,Math.round((now()-o.created)/6e4));
 S.stats.filled++;S.stats.value+=VALUE[o.pid]||200;S.stats.mins.push(mins);
 feed('filled','Filled: '+p.first+', '+fmtWhen(o.start)+' → '+w.name+(old?' (moved up from '+fmtWhen(old)+')':'')+' (round '+o.round+', '+mins+' min after it opened).',{oid:o.id,pid:o.pid});
 if(old)slotFreed(o.pid,old,'moved up',w.phone);   // their old time now goes to the next person: a refill chain
 save();return {ok:true,offer:o,booking:b}}

// ---------- bookings ----------
function makeBooking(x){var b=Object.assign({id:uid(8),token:uid(12),status:'booked',created:now()},x);b.start=new Date(b.start).toISOString();
 S.bookings.push(b);S.taken[slotKey(b.pid,b.start)]=b.id;return b}
// The Halaxy appointment type a booking lands on, so clients never have to pick from Halaxy's list.
function serviceName(pid,need,plan,how,first){var p=P[pid],v=p.svc||{};
 if(v[need])return need==='acu'&&first==='no'?v.acu2:v[need];
 if(p.psych){if(how==='online')return plan==='yes'&&pid==='maddy'?v.tele:v.tele||v.priv;return plan==='yes'?v.med:v.priv}
 return v.counsel||'Appointment'}
function lenOf(pid,need){var p=P[pid];return (p.lens||{})[need]||p.len}

var delay=function(v){return new Promise(function(r){setTimeout(function(){r(v)},180+Math.random()*220)})};
var api={
 // what the booking page needs
 slots:function(pids,days){var out={};pids.forEach(function(pid){out[pid]=freeSlots(pid,now(),days||84)});return delay(out)},
 book:function(d){var k=slotKey(d.pid,d.start);if(slotState(d.pid,new Date(d.start))!=='free'||openOfferFor(d.pid,new Date(d.start)))return delay({ok:false,reason:'taken'});
  var b=makeBooking({pid:d.pid,start:d.start,name:d.name,child:d.child||'',phone:d.phone,email:d.email,service:serviceName(d.pid,d.need,d.plan,d.how,d.firstVisit),need:d.need,len:lenOf(d.pid,d.need),plan:d.plan,how:d.how,first:d.firstVisit,source:'online'});
  feed('booked','New booking: '+P[d.pid].first+', '+fmtWhen(d.start)+' ('+d.name+', online).',{pid:d.pid});
  sms(d.phone,d.name,'Hi '+d.name.split(' ')[0]+', you’re booked with '+P[d.pid].first+' '+onDay(d.start)+' at '+fmtTime(d.start)+'. Manage or cancel: sfch.au/m/'+b.token,'out',{kind:'confirm'});
  save();return delay({ok:true,booking:b})},
 booking:function(tok){return delay(S.bookings.filter(function(b){return b.token===tok})[0]||null)},
 myBookings:function(){var mine=[];try{mine=JSON.parse(localStorage.getItem('scfh-demo-mine')||'[]')}catch(e){}
  return delay(S.bookings.filter(function(b){return mine.indexOf(b.token)>=0}))},
 remember:function(tok){try{var m=JSON.parse(localStorage.getItem('scfh-demo-mine')||'[]');if(m.indexOf(tok)<0)m.push(tok);localStorage.setItem('scfh-demo-mine',JSON.stringify(m))}catch(e){}},
 cancel:function(tok,reason){var b=S.bookings.filter(function(x){return x.token===tok})[0];if(!b||b.status!=='booked')return delay({ok:false});
  b.status='cancelled';b.reason=reason;b.cancelledAt=now();delete S.taken[slotKey(b.pid,b.start)];
  var late=new Date(b.start).getTime()-now()<24*36e5;
  feed('cancel','Cancelled: '+P[b.pid].first+', '+fmtWhen(b.start)+' ('+b.name+(reason?', '+reason:'')+')'+(late?'. Late cancellation, under 24 hours.':'.'),{pid:b.pid,late:late});
  slotFreed(b.pid,b.start,'cancelled',b.phone);save();return delay({ok:true,late:late})},
 reschedule:function(tok,start){var b=S.bookings.filter(function(x){return x.token===tok})[0];if(!b)return delay({ok:false});
  if(slotState(b.pid,new Date(start))!=='free')return delay({ok:false,reason:'taken'});
  var old=b.start;delete S.taken[slotKey(b.pid,old)];b.start=new Date(start).toISOString();S.taken[slotKey(b.pid,b.start)]=b.id;b.moved=(b.moved||0)+1;
  feed('move','Moved: '+b.name+' with '+P[b.pid].first+' from '+fmtWhen(old)+' to '+fmtWhen(start)+'.',{pid:b.pid});
  slotFreed(b.pid,old,'moved',b.phone);save();return delay({ok:true,booking:b})},
 joinWaitlist:function(d){var w={id:'w'+uid(6),name:d.name,phone:d.phone,pids:d.pids,need:d.need||'Appointment',days:d.days,times:d.times,since:now(),offers:[],mine:1,moveToken:d.moveToken||''};
  S.waitlist.push(w);feed('wait',d.name+' joined the waitlist for '+d.pids.map(function(x){return P[x].first}).join(', ')+'.');
  sms(d.phone,d.name,'Hi '+d.name.split(' ')[0]+', you’re on the Surf Coast Family Hub waitlist. We’ll text you if an earlier spot opens. Reply STOP to leave the list.','out',{kind:'wait',wid:w.id});
  save();return delay({ok:true,entry:w})},
 // what the dashboard needs
 state:function(){return S},
 upcoming:function(days){var out=[],d0=new Date(now());d0.setHours(0,0,0,0);
  for(var i=0;i<days;i++){var day=new Date(d0);day.setDate(d0.getDate()+i);
   ORDER.forEach(function(pid){daySlots(pid,day).forEach(function(d){if(d.getTime()<now())return;var st=slotState(pid,d);
    if(st==='seeded')out.push({pid:pid,start:d,name:fakeClient(pid,d),seeded:1});
    else if(st==='booked'){var b=S.bookings.filter(function(x){return x.id===S.taken[slotKey(pid,d)]})[0];if(b)out.push({pid:pid,start:d,name:b.name,booking:b})}})})}
  return out.sort(function(a,b){return a.start-b.start})},
 simulateCancel:function(pid,start){var k=slotKey(pid,start);
  if(S.taken[k]){var b=S.bookings.filter(function(x){return x.id===S.taken[k]})[0];return api.cancel(b.token,'Sick')}
  S.freed[k]=1;feed('cancel','Cancelled: '+P[pid].first+', '+fmtWhen(start)+' ('+fakeClient(pid,new Date(start))+', by text).',{pid:pid});
  slotFreed(pid,start,'cancelled');save();return delay({ok:true})},
 approve:function(oid){var o=S.offers.filter(function(x){return x.id===oid})[0];if(o&&(o.status==='approval'||o.status==='queued')){sendRound(o);save()}},
 dismiss:function(oid){var o=S.offers.filter(function(x){return x.id===oid})[0];if(o){o.status='unfilled';feed('none','Left '+P[o.pid].first+', '+fmtWhen(o.start)+' on the booking page instead.');save()}},
 claim:function(tok,via){return claim(tok,via)},
 race:function(oid){var o=S.offers.filter(function(x){return x.id===oid})[0];if(!o||o.status!=='open')return null;
  var live=o.sent.filter(function(s){return s.state==='sent'&&s.round===o.round}).map(function(s){return s.tok});
  live.sort(function(){return Math.random()-.5});var res=live.map(function(t){return claim(t,'tap')});return res},
 forward:function(mins){S.skew=(S.skew||0)+mins*6e4;feed('clock','Demo clock moved forward '+mins+' minutes.');save();tick()},
 settings:function(x){Object.assign(S.settings,x);save()},
 reset:function(){S=defaults();try{localStorage.removeItem('scfh-demo-mine')}catch(e){}save()},
 removeWaitlist:function(id){var w=S.waitlist.filter(function(x){return x.id===id})[0];if(!w||w.removed)return;w.removed=now();
  feed('none','Removed '+w.name+' from the waitlist.');save()},
 noteWaitlist:function(id,note){var w=S.waitlist.filter(function(x){return x.id===id})[0];if(w){w.note=String(note||'').slice(0,500);save()}},
 // Everything the dashboard knows, compact, for the "Ask Claude" panel. When live, the Worker builds this server-side.
 // Privacy: clients are swapped for stable tokens like [C1a2b] and phones, notes and children's names are left out,
 // so no client can be identified from what is sent. The dashboard swaps the tokens back to names on screen.
 snapshot:function(){var DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],names={},byName={};
  function loc(d){d=new Date(d);return DN[d.getDay()]+' '+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear()+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}
  function first(id){return P[id]?P[id].first:id}
  function tok(n){if(!n)return n;if(byName[n])return byName[n];var k='[C'+Math.floor(hash('client:'+n)*46656*36).toString(36)+']';names[k]=n;byName[n]=k;return k}
  var team=ORDER.map(function(id){var p=P[id];return {id:id,name:p.name,role:p.role,
    books:p.live?'through the hub':p.contact?'call the Hub':'own booking page',onLeave:!!p.leave,note:p.note||undefined,
    worksOn:p.sched?Object.keys(p.sched).map(function(d){return DN[d]+' '+p.sched[d].join(',')}).join('; '):undefined,
    bookedOutUntil:p.openFrom||undefined,sessionMins:p.len||undefined,fee:VALUE[id]||undefined}});
  var wl=S.waitlist.map(function(w){var offers=[];S.offers.forEach(function(o){o.sent.forEach(function(s){if(s.wid===w.id)offers.push({slot:first(o.pid)+' '+loc(o.start),result:s.state,round:s.round})})});
   return {client:tok(w.name),status:w.removed?'removed':w.booked?'booked from waitlist':'waiting',wants:w.need,practitioners:w.pids.map(first),
    days:w.days.map(function(d){return DN[d]}),times:w.times.length>1?'any':w.times[0]==='am'?'mornings':'afternoons',joined:loc(w.since),
    daysWaiting:Math.max(0,Math.round((now()-w.since)/864e5)),source:w.moveToken?'already booked, wants an earlier time':w.mine?'joined online':'added by staff',hasStaffNote:!!w.note||undefined,offersSent:offers}});
  var up=api.upcoming(21).map(function(a){return {when:loc(a.start),with:first(a.pid),client:tok(a.name),via:a.booking?(a.booking.source==='refill'?'refilled from waitlist':'booked online'):'Halaxy'}});
  var free={};ORDER.forEach(function(id){if(P[id].live&&!P[id].leave){var f=freeSlots(id,now(),42);free[first(id)]=f.slice(0,12).map(loc)}});
  var bk=S.bookings.map(function(b){return {client:tok(b.name),forChild:b.child?true:undefined,with:first(b.pid),when:loc(b.start),service:b.service,status:b.status,via:b.source,
    booked:loc(b.created),cancelReason:b.reason||undefined,cancelledAt:b.cancelledAt?loc(b.cancelledAt):undefined,moved:b.moved||undefined}});
  var of=S.offers.map(function(o){var w=o.winner&&S.waitlist.filter(function(x){return x.id===o.winner})[0];
   return {slot:first(o.pid)+' '+loc(o.start),opened:loc(o.created),status:o.status,round:o.round,peopleTexted:o.sent.length,filledBy:w?tok(w.name):undefined}});
  var known=Object.keys(byName).sort(function(a,b){return b.length-a.length});
  function scrub(s){known.forEach(function(n){s=s.split(n).join(byName[n])});return s.replace(/\b04\d{2} ?\d{3} ?\d{3}\b/g,'[phone]')}
  var data={now:loc(now()),timezone:'Australia/Melbourne',demo:true,team:team,stats:{spotsRefilled:S.stats.filled,incomeRecovered:S.stats.value,
    avgMinutesToRefill:S.stats.mins.length?Math.round(S.stats.mins.reduce(function(a,b){return a+b},0)/S.stats.mins.length):null},
   settings:S.settings,waitlist:wl,upcomingAppointments:up,freeTimes:free,onlineBookings:bk,refillOffers:of,
   activity:S.feed.slice(0,60).map(function(f){return loc(f.at)+' '+scrub(f.text)}),textsSent:S.sms.filter(function(m){return m.dir==='out'}).length};
  return {data:data,names:names,scrub:scrub}},
 on:function(f){subs.push(f)}
};
window.HUB={P:P,ORDER:ORDER,photo:photo,SITE:SITE,api:api,fmt:{time:fmtTime,day:fmtDay,when:fmtWhen,money:money,esc:esc,DAY:DAY,MON:MON},serviceName:serviceName,lenOf:lenOf,now:now,slotKey:slotKey};
})();
