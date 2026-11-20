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
var KEY='scfh-demo-v3', S;
var FIRST=['Sarah','Jess','Emma','Kate','Chloe','Mia','Tom','Ben','Lucy','Grace','Olivia','Hannah','Zoe','Ruby','Amy','Georgia','Lily','Sam','Ella','Nina'];
var LAST=['M.','T.','K.','R.','B.','L.','W.','H.','P.','S.','D.','C.'];
function defaults(){return {v:3,skew:0,bookings:[],freed:{},taken:{},waitlist:seedWaitlist(),offers:[],sms:[],feed:[],rem:{},referrals:seedReferrals(),pp:{},
 settings:{mode:'auto',batch:3,expiry:30,minNotice:2,quiet:true,quietFrom:20,quietTo:8,weekCap:3,
  remind:true,remindHrs:48,policyHrs:24,lateFee:'full',card:'new',fresh:true,freshDays:30,freshGrace:7,series:true,autoInvite:true,smsCost:0.1},
 stats:{filled:0,value:0,mins:[]}}}
function seedWaitlist(){var t=Date.now(),D=864e5;return [
 {id:'w1',name:'Sarah M.',phone:'0400 000 101',pids:['ellie','hannah','maddy','adi','melinda'],need:'Psychology',days:[1,2,3,4,5],times:['am','pm'],since:t-34*D,offers:[]},
 {id:'w2',name:'Jess T.',phone:'0400 000 102',pids:['hannah'],need:'Perinatal psychology',days:[2,4,5],times:['am'],since:t-21*D,offers:[]},
 {id:'w3',name:'Emma K.',phone:'0400 000 103',pids:['adi','melinda','ellie'],need:'Psychology',days:[1,2,4],times:['am','pm'],since:t-17*D,offers:[]},
 {id:'w4',name:'Chloe R.',phone:'0400 000 104',pids:['ellie','maddy'],need:'Psychology',days:[1,2,3,4,5],times:['pm'],since:t-12*D,offers:[]},
 {id:'w5',name:'Tom B.',phone:'0400 000 105',pids:['michelle-ferris'],need:'Couples therapy',len:60,days:[2,3,4],times:['am','pm'],since:t-9*D,offers:[]},
 {id:'w9',name:'Ben P.',phone:'0400 000 109',pids:['adi'],need:'Couple support, extended',len:90,days:[1,3,4],times:['am','pm'],since:t-15*D,offers:[]},
 {id:'w6',name:'Mia L.',phone:'0400 000 106',pids:['melinda','adi','hannah','ellie','maddy'],need:'Psychology',days:[1,2,3,4,5],times:['am','pm'],since:t-6*D,offers:[]},
 {id:'w7',name:'Grace W.',phone:'0400 000 107',pids:['laura'],need:'Pregnancy massage',len:60,days:[6],times:['am','pm'],since:t-4*D,offers:[]},
 {id:'w8',name:'Lucy H.',phone:'0400 000 108',pids:['adi','hannah','melinda','ellie','maddy'],need:'Psychology',days:[1,2,3,4,5],times:['am','pm'],since:t-2*D,offers:[]}]}
// Referrals that arrived by the online form, fax or email (made up). Reasons stay with staff and are never sent to Claude.
function seedReferrals(){var t=Date.now(),D=864e5;return [
 {id:'r1',tok:'olv7k2m9qa',at:t-1*D-5e6,source:'Online form',from:{name:'Dr Priya N.',practice:'Torquay Medical Centre',email:'reception@example.com.au'},client:{name:'Olivia S.',dob:'1993-04-12',phone:'0400 000 201',email:''},to:'team',plan:'yes',planIn:true,file:{name:'MHTP-Olivia-S.pdf',size:182000},reason:'Postnatal anxiety, baby 4 months.',status:'new'},
 {id:'r2',tok:'amy3d8p2xw',at:t-5*D,source:'Fax',from:{name:'Dr James K.',practice:'Surf Coast Family Practice'},client:{name:'Amy D.',phone:'0400 000 202',email:''},to:'hannah',plan:'yes',planIn:true,file:{name:'fax-2611.pdf',size:240000},reason:'Birth trauma after first birth.',status:'invited',invitedAt:t-5*D+3e6,pids:['hannah']},
 {id:'r3',tok:'geo5c4n7hz',at:t-9*D,source:'Email',from:{name:'Sam W. (midwife)',practice:'Barwon Health'},client:{name:'Georgia C.',phone:'0400 000 203',email:''},to:'ellie',plan:'no',planIn:false,file:null,reason:'Low mood in pregnancy.',status:'booked',invitedAt:t-9*D+2e6,bookedAt:t-7*D,pids:['ellie']}]}
function load(){try{S=JSON.parse(localStorage.getItem(KEY))}catch(e){S=null}if(!S||S.v!==3)S=defaults()}
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
function bookingById(id){return S.bookings.filter(function(x){return x.id===id})[0]}
function bookingAt(k){return S.taken[k]?bookingById(S.taken[k]):null}
function moveBooking(w){if(!w.moveToken)return null;var b=S.bookings.filter(function(x){return x.token===w.moveToken})[0];return b&&b.status==='booked'?b:null}
function prefs(pid){return Object.assign({refill:'auto',series:true},S.pp[pid]||{})}
// How long the freed gap is: up to the next appointment (or 90 min after the last slot of the day), capped at 2 hours.
// Matching on the gap, not on the cancelled appointment's length, means a 50-min waitlister can take a 60-min gap
// and a 90-min couples session only goes out when two slots in a row are free.
function gapLen(pid,start){var d=new Date(start),day=new Date(d);day.setHours(0,0,0,0);
 var sl=daySlots(pid,day),i=-1;sl.forEach(function(x,j){if(x.getTime()===d.getTime())i=j});
 if(i<0)return P[pid].len;
 for(var j=i+1;j<sl.length;j++){if(slotState(pid,sl[j])!=='free'||openOfferFor(pid,sl[j]))return Math.min(120,Math.round((sl[j]-d)/6e4))}
 return Math.min(120,Math.round((sl[sl.length-1]-d)/6e4)+90)}
function needLen(w){return w.len||50}
function candidates(o){var d=new Date(o.start),sent=o.sent.map(function(x){return x.wid});o.short=[];
 return S.waitlist.filter(function(w){if(w.booked||w.removed||w.paused||w.phone===o.exclude)return false;
   if(w.moveToken){var mb=moveBooking(w);if(!mb||new Date(mb.start)<=d)return false}   // only offer an earlier time than they already have
   var fits=w.pids.indexOf(o.pid)>=0&&w.days.indexOf(d.getDay())>=0&&w.times.indexOf(timeBand(d))>=0&&sent.indexOf(w.id)<0&&weekOffers(w)<S.settings.weekCap;
   if(fits&&needLen(w)>o.len){o.short.push(w.name+' (needs '+needLen(w)+' min)');return false}
   return fits})
  .sort(function(a,b){return a.since-b.since})}
function inQuiet(){if(!S.settings.quiet)return false;var h=new Date(now()).getHours(),f=S.settings.quietFrom,t=S.settings.quietTo;return f>t?(h>=f||h<t):(h>=f&&h<t)}
function slotFreed(pid,start,why,exclude,bid){
 var key=slotKey(pid,start),p=P[pid],pr=prefs(pid);
 if(new Date(start).getTime()-now()<S.settings.minNotice*36e5){feed('skip','Too close to fill: '+p.first+', '+fmtWhen(start)+'. Left as is.',{pid:pid});return}
 if(pr.refill==='off'){feed('skip',p.first+' fills her own cancellations, so '+fmtWhen(start)+' is back on the booking page.',{pid:pid});return}
 var o={id:uid(8),key:key,pid:pid,start:new Date(start).toISOString(),status:'open',round:0,sent:[],created:now(),why:why||'cancelled',exclude:exclude||'',bid:bid||'',len:gapLen(pid,start)};
 S.offers.unshift(o);
 if(S.settings.mode==='ask'||pr.refill==='ask'){o.status='approval';feed('ask','Spot opened: '+p.first+', '+fmtWhen(start)+'. Waiting for you to send offers.',{oid:o.id});return}
 if(inQuiet()){o.status='queued';feed('queue','Spot opened: '+p.first+', '+fmtWhen(start)+'. Quiet hours, so offers go out at '+S.settings.quietTo+'am.',{oid:o.id});return}
 sendRound(o)}
function sendRound(o){var p=P[o.pid],c=candidates(o).slice(0,S.settings.batch);
 if(o.short&&o.short.length&&o.round===0)feed('skip','Not offered '+p.first+', '+fmtWhen(o.start)+' to '+o.short.join(', ')+': the gap is '+o.len+' min.',{oid:o.id});
 if(!c.length){o.status='unfilled';feed('none','No one on the waitlist fits '+p.first+', '+fmtWhen(o.start)+'. It’s back on the online booking page.',{oid:o.id});return}
 o.status='open';o.round++;o.expires=now()+S.settings.expiry*6e4;
 c.forEach(function(w){var tok=uid(8);o.sent.push({wid:w.id,tok:tok,round:o.round,at:now(),state:'sent'});w.offers=(w.offers||[]).concat(now());
  sms(w.phone,w.name,'Hi '+w.name.split(' ')[0]+', it’s Surf Coast Family Hub. We’ve had a cancellation with '+p.first+' '+onDay(o.start)+' at '+fmtTime(o.start)+'. Want it? Tap to grab it: sfch.au/c/'+tok+' (first in gets it, link expires '+fmtTime(o.expires)+'). Reply STOP to opt out.','out',{oid:o.id,wid:w.id,tok:tok,kind:'offer'})});
 feed('offer','Offered '+p.first+', '+fmtWhen(o.start)+' ('+o.len+' min free) to '+c.map(function(w){return w.name}).join(', ')+(o.round>1?' (round '+o.round+')':'')+'.',{oid:o.id})}

// ---------- reminders: confirm, or "can't make it" ----------
// Every appointment in the next remindHrs gets one text (Halaxy's own reminders get switched off for these).
// "Can't make it" turns a likely no-show into a cancellation the waitlist can fill.
function fakePhone(pid,d){var h=Math.floor(hash('ph'+pid+new Date(d).toISOString())*1e6);return '0411 '+('00'+Math.floor(h/1000)).slice(-3)+' '+('00'+h%1000).slice(-3)}
function freeUntil(start){return new Date(new Date(start).getTime()-S.settings.policyHrs*36e5)}
function remindTick(){if(!S.settings.remind||inQuiet())return false;var n=0,lim=now()+S.settings.remindHrs*36e5,d0=new Date(now());d0.setHours(0,0,0,0);
 for(var i=0;i<4;i++){var day=new Date(d0);day.setDate(d0.getDate()+i);
  ORDER.forEach(function(pid){daySlots(pid,day).forEach(function(d){var t=d.getTime();if(t<now()+3*36e5||t>lim)return;
   var k=slotKey(pid,d);if(S.rem[k])return;var st=slotState(pid,d);if(st==='free')return;
   var b=st==='booked'?bookingAt(k):null;if(st==='booked'&&!b)return;
   var name=b?b.name:fakeClient(pid,d),phone=b?b.phone:fakePhone(pid,d),tok=uid(8),fu=freeUntil(d);
   var r={tok:tok,key:k,pid:pid,start:d.toISOString(),name:name,phone:phone,bid:b?b.id:'',at:now(),state:'sent'};
   // made-up Halaxy clients reply over the next few hours, like real people do
   if(!b){var h=hash('r'+k);if(h<0.74)r.auto=now()+(10+h*260)*6e4}
   S.rem[k]=r;n++;
   var where=b&&b.mode==='video'?' by video (link: sfch.au/v/'+b.token+')':b&&b.mode==='phone'?' by phone':' at the Hub';
   sms(phone,name,'Reminder: '+name.split(' ')[0]+', you’re seeing '+P[pid].first+' '+onDay(d)+' at '+fmtTime(d)+where+'. Tap to confirm: sfch.au/r/'+tok+' Can’t make it? Tap sfch.au/x/'+tok+(fu.getTime()>now()?' (free to cancel until '+fmtWhen(fu)+')':'')+' and we’ll offer your time to someone on the waitlist.','out',{kind:'remind',tok:tok,key:k})})})}
 if(n)feed('remind','Sent '+n+' reminder'+(n>1?'s':'')+' for appointments in the next '+S.settings.remindHrs+' hours.');
 var auto=false;for(var k in S.rem){var r=S.rem[k];if(r.auto&&r.state==='sent'&&now()>=r.auto){r.state='confirmed';r.repAt=r.auto;delete r.auto;sms(r.phone,r.name,'C','in',{kind:'remind',tok:r.tok});auto=true}}
 return n>0||auto}
function remByTok(tok){for(var k in S.rem)if(S.rem[k].tok===tok)return S.rem[k];return null}

// ---------- waitlist check-ins ----------
// After freshDays on the list, people get a "still keen?" text. No reply within freshGrace days pauses them, so offers
// stop going to people who've found help elsewhere. One tap puts them back.
function freshTick(){if(!S.settings.fresh||inQuiet())return false;var ch=false,D=864e5;
 S.waitlist.forEach(function(w){if(w.booked||w.removed||w.moveToken||w.paused)return;var fn=w.name.split(' ')[0];
  if(w.check){if(now()-w.check.at>S.settings.freshGrace*D){w.paused=now();feed('none','Paused '+w.name+' on the waitlist: no reply to the check-in after '+S.settings.freshGrace+' days.');ch=true}return}
  var days=Math.round((now()-(w.checked||w.since))/D);if(days<S.settings.freshDays)return;
  var tok=uid(8);w.check={tok:tok,at:now()};
  sms(w.phone,w.name,'Hi '+fn+', it’s Surf Coast Family Hub. You’ve been on our waitlist for '+Math.round((now()-w.since)/D)+' days. Still keen for a spot? Tap to keep your place: sfch.au/k/'+tok+' If we don’t hear back within a week, we’ll pause your place. Reply STOP to leave the list.','out',{wid:w.id,tok:tok,kind:'check'});
  feed('wait','Checked in with '+w.name+' (on the list '+Math.round((now()-w.since)/D)+' days).');ch=true});
 return ch}

function tick(){var changed=false;
 S.offers.forEach(function(o){
  if(o.status==='queued'&&!inQuiet()){sendRound(o);changed=true}
  if(o.status==='open'&&now()>o.expires){
   o.sent.forEach(function(s){if(s.state==='sent'&&s.round===o.round)s.state='expired'});
   if(new Date(o.start).getTime()-now()<S.settings.minNotice*36e5){o.status='unfilled';feed('none','Nobody claimed '+P[o.pid].first+', '+fmtWhen(o.start)+' in time. It’s back on the booking page.',{oid:o.id})}
   else sendRound(o);
   changed=true}});
 if(remindTick())changed=true;
 if(freshTick())changed=true;
 if(changed)save()}
setInterval(tick,5000);setTimeout(tick,400);

function claim(tok,via){
 var o=null,s=null;S.offers.forEach(function(x){x.sent.forEach(function(y){if(y.tok===tok){o=x;s=y}})});
 if(!o)return {ok:false,reason:'missing'};
 var w=S.waitlist.filter(function(x){return x.id===s.wid})[0],p=P[o.pid];
 if(via==='yes')sms(w.phone,w.name,'YES','in',{oid:o.id,wid:w.id});
 if(o.status!=='open'||s.state==='expired'){
  if(s.state!=='late'&&s.state!=='lost'){s.state='late';sms(w.phone,w.name,'Thanks '+w.name.split(' ')[0]+', that spot’s just been filled. You’re still on our list and we’ll text you next time one comes up.','out',{oid:o.id,wid:w.id,kind:'taken'})}
  save();return {ok:false,reason:'taken',offer:o}}
 // In the real system this is one database transaction plus Halaxy's fail-on-double-booking, so two taps can never both win.
 o.status='filled';o.winner=w.id;o.filledAt=now();s.state='won';w.booked=true;
 var mb=moveBooking(w),b,old;
 if(mb){old=mb.start;delete S.taken[slotKey(mb.pid,old)];delete S.rem[slotKey(mb.pid,old)];mb.start=new Date(o.start).toISOString();S.taken[slotKey(mb.pid,mb.start)]=mb.id;mb.moved=(mb.moved||0)+1;b=mb;
  sms(w.phone,w.name,'Done! We’ve moved you to '+onDay(o.start)+' at '+fmtTime(o.start)+' with '+p.first+' (was '+fmtWhen(old)+'). Manage your booking: sfch.au/m/'+b.token,'out',{oid:o.id,wid:w.id,kind:'confirm'})}
 else{b=makeBooking({pid:o.pid,start:o.start,name:w.name,phone:w.phone,email:'',source:'refill',service:w.need,len:Math.min(needLen(w),o.len),mode:'in'});
  sms(w.phone,w.name,'You’re booked '+onDay(o.start)+' at '+fmtTime(o.start)+' with '+p.first+' at 16 Princes Tce, Jan Juc. Need to change it? Manage your booking: sfch.au/m/'+b.token,'out',{oid:o.id,wid:w.id,kind:'confirm'})}
 o.sent.forEach(function(x){if(x!==s&&x.state==='sent'){x.state='lost';var ww=S.waitlist.filter(function(q){return q.id===x.wid})[0];
  sms(ww.phone,ww.name,'Thanks '+ww.name.split(' ')[0]+', that spot’s just been filled. You’re still on our list and we’ll text you next time one comes up.','out',{oid:o.id,wid:ww.id,kind:'taken'})}});
 var mins=Math.max(1,Math.round((now()-o.created)/6e4));
 S.stats.filled++;S.stats.value+=VALUE[o.pid]||200;S.stats.mins.push(mins);
 feed('filled','Filled: '+p.first+', '+fmtWhen(o.start)+' → '+w.name+(old?' (moved up from '+fmtWhen(old)+')':'')+' (round '+o.round+', '+mins+' min after it opened).',{oid:o.id,pid:o.pid});
 if(o.bid){var cb=bookingById(o.bid);if(cb&&cb.lateFee&&!cb.feeWaived){cb.feeWaived=true;feed('none','Late cancellation fee waived for '+cb.name+': the spot was refilled.')}}
 if(old)slotFreed(o.pid,old,'moved up',w.phone,mb.id);   // their old time now goes to the next person: a refill chain
 save();return {ok:true,offer:o,booking:b}}

// ---------- bookings ----------
function makeBooking(x){var b=Object.assign({id:uid(8),token:uid(12),status:'booked',created:now()},x);b.start=new Date(b.start).toISOString();
 S.bookings.push(b);S.taken[slotKey(b.pid,b.start)]=b.id;return b}
// The Halaxy appointment type a booking lands on, so clients never have to pick from Halaxy's list.
function serviceName(pid,need,plan,how,first){var p=P[pid],v=p.svc||{};
 if(v[need])return need==='acu'&&first==='no'?v.acu2:v[need];
 if(p.psych){if(how==='phone')return v.phone||v.tele;if(how==='online'||how==='video')return plan==='yes'&&pid==='maddy'?v.tele:v.tele||v.priv;return plan==='yes'?v.med:v.priv}
 return v.counsel||'Appointment'}
function lenOf(pid,need){var p=P[pid];return (p.lens||{})[need]||p.len}
// Cancellation policy (set by the clinic in the dashboard). If the spot is refilled, the fee is waived.
function feeAmt(pid){return VALUE[pid]||200}
function lateFee(pid){var f=S.settings.lateFee,v=feeAmt(pid);return f==='full'?v:f==='half'?Math.round(v/2):0}
function policyText(pid){var s=S.settings,f=lateFee(pid);
 return 'Free to move or cancel up to '+s.policyHrs+' hours before. '+(f?'Later than that, or if you miss the session, '+(s.lateFee==='full'?'the full fee':'half the fee')+' ('+money(f)+') applies. If we fill your time from the waitlist, there’s no fee.':'If you can’t make it after that, please still tell us so someone on the waitlist can have the time.')}
function isLate(start){return new Date(start).getTime()-now()<S.settings.policyHrs*36e5}
function isFree(pid,d){return d.getTime()>now()+3*36e5&&slotState(pid,d)==='free'&&!openOfferFor(pid,d)}
function doCancel(b,reason){
 b.status='cancelled';b.reason=reason;b.cancelledAt=now();delete S.taken[slotKey(b.pid,b.start)];
 var late=isLate(b.start),fee=late?lateFee(b.pid):0;if(fee)b.lateFee=fee;
 var r=S.rem[slotKey(b.pid,b.start)];if(r&&r.state==='sent')r.state='cancelled';
 feed('cancel','Cancelled: '+P[b.pid].first+', '+fmtWhen(b.start)+' ('+b.name+(reason?', '+reason:'')+')'+(late?'. Late cancellation, under '+S.settings.policyHrs+' hours'+(fee?' ('+money(fee)+' fee unless refilled)':'')+'.':'.'),{pid:b.pid,late:late});
 slotFreed(b.pid,b.start,'cancelled',b.phone,b.id);return {late:late,fee:fee}}
// Recurring: the same weekday and time every 1 or 2 weeks. If that time is taken one week, offer the nearest free time that week.
function seriesPlan(pid,start,every,count){var out=[],used={},t0=new Date(start);
 for(var i=0;i<count;i++){var d=new Date(t0);d.setDate(t0.getDate()+i*every);
  if(i===0||isFree(pid,d)){out.push({want:d,start:d,ok:true});used[d.getTime()]=1;continue}
  var ws=new Date(d);ws.setHours(0,0,0,0);ws.setDate(ws.getDate()-((ws.getDay()+6)%7));
  var alt=freeSlots(pid,ws,7).filter(function(x){return !used[x.getTime()]}).sort(function(a,b){return Math.abs(a-d)-Math.abs(b-d)})[0]||null;
  if(alt)used[alt.getTime()]=1;out.push({want:d,start:alt,ok:false})}
 return out}
function makeReferralFromBooking(b,ref){
 var r={id:'r'+uid(6),tok:uid(10),at:now(),source:ref.how==='upload'?'Uploaded by client':'Client says GP will send',from:{name:ref.gp||'Their GP',practice:''},client:{name:b.name,phone:b.phone,email:b.email},to:b.pid,plan:'yes',
  planIn:ref.how==='upload',file:ref.file||null,reason:'',status:'booked',bookedAt:now(),bid:b.id,pids:[b.pid]};
 if(ref.how!=='bring')S.referrals.unshift(r);return r}
function invite(r,pids){r.pids=pids;r.status='invited';r.invitedAt=now();var fn=r.client.name.split(' ')[0];
 sms(r.client.phone,r.client.name,'Hi '+fn+', it’s Surf Coast Family Hub. '+r.from.name+' has referred you to us'+(pids.length===1?' to see '+P[pids[0]].first:'')+'. Book your first session online here: sfch.au/b/'+r.tok+' or call us on 0491 184 788. Reply STOP to opt out.','out',{kind:'invite',tok:r.tok,rid:r.id});
 feed('ref','Sent '+r.client.name+' a booking link for '+pids.map(function(x){return P[x].first}).join(', ')+'.')}

// ---------- sample history for the report ----------
// Four weeks of made-up past appointments, seeded so they're stable, so the report has something to show.
function history(days){var out=[],d0=new Date(now());d0.setHours(0,0,0,0);
 for(var i=days;i>=1;i--){var day=new Date(d0);day.setDate(d0.getDate()-i);
  ORDER.forEach(function(pid){var p=P[pid];if(!p.live||p.leave)return;
   daySlots(pid,day).forEach(function(d){var k=pid+d.toISOString();if(hash('h'+k)>0.84)return;var r=hash('o'+k);
    var a={pid:pid,start:d,value:feeAmt(pid),mode:p.psych&&hash('m'+k)<0.27?'video':'in',online:hash('s'+k)<0.34,confirmed:hash('c'+k)<0.81,outcome:'attended'};
    if(r<0.03)a.outcome='noshow';
    else if(r<0.09){a.outcome='late';a.refilled=hash('f'+k)<0.52;a.mins=4+Math.round(hash('t'+k)*50)}
    else if(r<0.17){a.outcome='early';a.refilled=hash('f'+k)<0.8;a.mins=12+Math.round(hash('t'+k)*200)}
    out.push(a)})})}
 return out}
function median(a){if(!a.length)return null;a=a.slice().sort(function(x,y){return x-y});var m=Math.floor(a.length/2);return a.length%2?a[m]:Math.round((a[m-1]+a[m])/2)}
function report(days){days=days||28;var from=now()-days*864e5,h=history(days),by={},weeks=[],D=864e5,mins=[];
 ORDER.forEach(function(pid){var p=P[pid];if(!p.live||p.leave)return;var cap=0,d0=new Date(now());d0.setHours(0,0,0,0);
  for(var i=days;i>=1;i--){var day=new Date(d0);day.setDate(d0.getDate()-i);cap+=daySlots(pid,day).length}
  by[pid]={pid:pid,name:p.name,first:p.first,capacity:cap,booked:0,attended:0,late:0,early:0,noshow:0,refilled:0,recovered:0,lost:0,video:0,online:0,confirmed:0,fees:0}});
 for(var w=0;w<Math.ceil(days/7);w++)weeks.push({from:from+w*7*D,refilled:0,lost:0,cancelled:0});
 function wk(t){return weeks[Math.min(weeks.length-1,Math.max(0,Math.floor((t-from)/(7*D))))]}
 h.forEach(function(a){var x=by[a.pid];x.booked++;x[a.outcome]++;if(a.mode==='video')x.video++;if(a.online)x.online++;if(a.confirmed)x.confirmed++;
  if(a.outcome!=='attended'){var W=wk(a.start.getTime());W.cancelled++;if(a.refilled){x.refilled++;x.recovered+=a.value;mins.push(a.mins);W.refilled++}else{x.lost+=a.value;W.lost++;if(a.outcome!=='early')x.fees+=lateFee(a.pid)}}});
 // plus what has actually happened in this demo
 S.offers.forEach(function(o){if(o.created<from||!by[o.pid])return;var x=by[o.pid],W=wk(o.created);
  if(o.status==='filled'){x.refilled++;x.recovered+=feeAmt(o.pid);W.refilled++;W.cancelled++;mins.push(Math.max(1,Math.round((o.filledAt-o.created)/6e4)))}
  else if(o.status==='unfilled'){x.lost+=feeAmt(o.pid);W.lost++;W.cancelled++}});
 S.bookings.forEach(function(b){if(b.created<from||!by[b.pid])return;var x=by[b.pid];x.booked++;if(b.source==='online')x.online++;if(b.mode==='video')x.video++;if(b.status==='cancelled'){if(b.late)x.late++;else x.early++;if(b.lateFee&&!b.feeWaived)x.fees+=b.lateFee}});
 var rows=Object.keys(by).map(function(k){return by[k]}),T={};
 ['capacity','booked','attended','late','early','noshow','refilled','recovered','lost','video','online','confirmed','fees'].forEach(function(f){T[f]=rows.reduce(function(s,r){return s+r[f]},0)});
 var cancels=T.late+T.early+T.noshow,live=S.waitlist.filter(function(w){return !w.booked&&!w.removed});
 var rem=Object.keys(S.rem).map(function(k){return S.rem[k]});
 var refs=S.referrals.filter(function(r){return r.at>=from}),bookedRefs=refs.filter(function(r){return r.status==='booked'&&r.bookedAt});
 var texts=S.sms.filter(function(m){return m.dir==='out'&&m.at>=from}).length+T.booked+cancels*3;
 return {days:days,from:from,to:now(),sample:true,totals:T,cancellations:cancels,fillRate:cancels?Math.round(T.refilled/cancels*100):0,
  avgMins:mins.length?Math.round(mins.reduce(function(a,b){return a+b},0)/mins.length):null,medianMins:median(mins),
  utilisation:T.capacity?Math.round((T.booked-T.late-T.early-T.noshow+T.refilled)/T.capacity*100):0,
  byPract:rows,weeks:weeks,
  waitlist:{active:live.filter(function(w){return !w.paused}).length,paused:live.filter(function(w){return w.paused}).length,checking:live.filter(function(w){return w.check&&!w.paused}).length,
   medianDays:median(live.map(function(w){return Math.round((now()-w.since)/D)})),longest:live.slice().sort(function(a,b){return a.since-b.since}).slice(0,3).map(function(w){return {name:w.name,days:Math.round((now()-w.since)/D),need:w.need}}),
   booked:S.waitlist.filter(function(w){return w.booked}).length,perPract:rows.map(function(r){return {first:r.first,n:live.filter(function(w){return w.pids.indexOf(r.pid)>=0}).length}})},
  reminders:{sent:rem.length+T.booked,confirmed:rem.filter(function(r){return r.state==='confirmed'}).length+T.confirmed,cantMake:rem.filter(function(r){return r.state==='cancelled'}).length},
  referrals:{received:refs.length,booked:bookedRefs.length,waiting:refs.filter(function(r){return r.status==='new'||r.status==='invited'}).length,
   plansMissing:S.referrals.filter(function(r){return r.status!=='closed'&&!r.planIn&&r.plan==='yes'}).length,
   medianDays:median(bookedRefs.map(function(r){return Math.max(0,Math.round((r.bookedAt-r.at)/D))}))},
  series:(function(){var ids={};S.bookings.forEach(function(b){if(b.series)ids[b.series.id]=1});return Object.keys(ids).length})(),
  texts:{count:texts,cost:Math.round(texts*S.settings.smsCost*100)/100}}}

var delay=function(v){return new Promise(function(r){setTimeout(function(){r(v)},180+Math.random()*220)})};
function bookingSms(b){var p=P[b.pid],fn=b.name.split(' ')[0];
 var how=b.mode==='video'?' by video. Your link: sfch.au/v/'+b.token:b.mode==='phone'?'. '+p.first+' will call you on this number.':' at 16 Princes Tce, Jan Juc.';
 return 'Hi '+fn+', you’re booked with '+p.first+' '+onDay(b.start)+' at '+fmtTime(b.start)+how+' Manage or cancel: sfch.au/m/'+b.token}
function newBooking(d,start,extra){return makeBooking(Object.assign({pid:d.pid,start:start,name:d.name,child:d.child||'',phone:d.phone,email:d.email,
  service:serviceName(d.pid,d.need,d.plan,d.mode||d.how,d.firstVisit),need:d.need,len:lenOf(d.pid,d.need),plan:d.plan,how:d.mode==='in'?'in':'online',mode:d.mode||'in',first:d.firstVisit,
  source:d.ref?'referral':'online',card:d.card||null,policy:{hrs:S.settings.policyHrs,fee:lateFee(d.pid),agreed:now()}},extra||{}))}
function attachReferral(b,d){
 if(d.ref){var r=S.referrals.filter(function(x){return x.tok===d.ref})[0];if(r){r.status='booked';r.bookedAt=now();r.bid=b.id;b.referral={how:'referrer',rid:r.id,planIn:r.planIn,from:r.from.name};
   feed('ref','Referral booked: '+r.client.name+' with '+P[b.pid].first+', '+fmtWhen(b.start)+' (referred by '+r.from.name+').')}}
 else if(d.referral&&d.plan==='yes'){var rr=makeReferralFromBooking(b,d.referral);b.referral={how:d.referral.how,rid:rr.id,planIn:rr.planIn,file:d.referral.file||null,gp:d.referral.gp||''}}}
var api={
 // what the booking page needs
 slots:function(pids,days){var out={};pids.forEach(function(pid){out[pid]=freeSlots(pid,now(),days||84)});return delay(out)},
 book:function(d){if(!isFree(d.pid,new Date(d.start)))return delay({ok:false,reason:'taken'});
  var b=newBooking(d,d.start);attachReferral(b,d);
  feed('booked','New booking: '+P[d.pid].first+', '+fmtWhen(d.start)+' ('+d.name+', '+(d.ref?'from a referral link':'online')+(b.mode!=='in'?', '+b.mode:'')+').',{pid:d.pid});
  sms(d.phone,d.name,bookingSms(b),'out',{kind:'confirm'});
  save();return delay({ok:true,booking:b})},
 seriesPlan:function(pid,start,every,count){return delay(seriesPlan(pid,start,every,count))},
 bookSeries:function(d,starts){starts=starts.map(function(x){return new Date(x)});
  if(starts.some(function(x){return !isFree(d.pid,x)}))return delay({ok:false,reason:'taken'});
  var sid=uid(8),every=d.every,bs=starts.map(function(x,i){return newBooking(d,x,{series:{id:sid,n:i+1,of:starts.length,every:every}})});
  attachReferral(bs[0],d);bs.forEach(function(b){if(bs[0].referral)b.referral=bs[0].referral});
  feed('booked','New '+(every===7?'weekly':'fortnightly')+' series: '+P[d.pid].first+', '+starts.length+' sessions from '+fmtWhen(starts[0])+' ('+d.name+', online).',{pid:d.pid});
  sms(d.phone,d.name,'Hi '+d.name.split(' ')[0]+', you’re booked with '+P[d.pid].first+' for '+starts.length+' sessions: '+starts.map(function(x){return DAY[x.getDay()]+' '+x.getDate()+' '+MON[x.getMonth()]+' '+fmtTime(x)}).join(', ')+'. Manage or cancel: sfch.au/m/'+bs[0].token,'out',{kind:'confirm'});
  save();return delay({ok:true,bookings:bs})},
 booking:function(tok){return delay(S.bookings.filter(function(b){return b.token===tok})[0]||null)},
 seriesOf:function(b){return b&&b.series?S.bookings.filter(function(x){return x.series&&x.series.id===b.series.id}).sort(function(a,c){return new Date(a.start)-new Date(c.start)}):[]},
 myBookings:function(){var mine=[];try{mine=JSON.parse(localStorage.getItem('scfh-demo-mine')||'[]')}catch(e){}
  return delay(S.bookings.filter(function(b){return mine.indexOf(b.token)>=0||(b.series&&S.bookings.some(function(x){return x.series&&x.series.id===b.series.id&&mine.indexOf(x.token)>=0}))}))},
 remember:function(tok){try{var m=JSON.parse(localStorage.getItem('scfh-demo-mine')||'[]');if(m.indexOf(tok)<0)m.push(tok);localStorage.setItem('scfh-demo-mine',JSON.stringify(m))}catch(e){}},
 cancel:function(tok,reason){var b=S.bookings.filter(function(x){return x.token===tok})[0];if(!b||b.status!=='booked')return delay({ok:false});
  var r=doCancel(b,reason);save();return delay({ok:true,late:r.late,fee:r.fee})},
 cancelSeries:function(tok,reason){var b=S.bookings.filter(function(x){return x.token===tok})[0];if(!b||!b.series)return delay({ok:false});
  var n=0;api.seriesOf(b).forEach(function(x){if(x.status==='booked'&&new Date(x.start)>=new Date(b.start)){doCancel(x,reason);n++}});save();return delay({ok:true,n:n})},
 reschedule:function(tok,start){var b=S.bookings.filter(function(x){return x.token===tok})[0];if(!b)return delay({ok:false});
  if(!isFree(b.pid,new Date(start)))return delay({ok:false,reason:'taken'});
  var old=b.start;delete S.taken[slotKey(b.pid,old)];delete S.rem[slotKey(b.pid,old)];b.start=new Date(start).toISOString();S.taken[slotKey(b.pid,b.start)]=b.id;b.moved=(b.moved||0)+1;
  feed('move','Moved: '+b.name+' with '+P[b.pid].first+' from '+fmtWhen(old)+' to '+fmtWhen(start)+'.',{pid:b.pid});
  sms(b.phone,b.name,'Done, '+b.name.split(' ')[0]+'. You’re now seeing '+P[b.pid].first+' '+onDay(start)+' at '+fmtTime(start)+'. Manage: sfch.au/m/'+b.token,'out',{kind:'confirm'});
  slotFreed(b.pid,old,'moved',b.phone);save();return delay({ok:true,booking:b})},
 attachPlan:function(tok,file){var b=S.bookings.filter(function(x){return x.token===tok})[0];if(!b)return delay({ok:false});
  var r=b.referral&&S.referrals.filter(function(x){return x.id===b.referral.rid})[0];
  if(!r){r=makeReferralFromBooking(b,{how:'upload',file:file});S.referrals.indexOf(r)<0&&S.referrals.unshift(r)}
  r.planIn=true;r.file=file;b.referral=Object.assign(b.referral||{},{how:'upload',rid:r.id,planIn:true,file:file});
  api.seriesOf(b).forEach(function(x){x.referral=b.referral});
  feed('ref',b.name+' uploaded their Mental Health Treatment Plan ('+file.name+').');save();return delay({ok:true})},
 joinWaitlist:function(d){var w={id:'w'+uid(6),name:d.name,phone:d.phone,pids:d.pids,need:d.need||'Appointment',len:d.len||50,days:d.days,times:d.times,since:now(),offers:[],mine:1,moveToken:d.moveToken||''};
  S.waitlist.push(w);feed('wait',d.name+' joined the waitlist for '+d.pids.map(function(x){return P[x].first}).join(', ')+'.');
  sms(d.phone,d.name,'Hi '+d.name.split(' ')[0]+', you’re on the Surf Coast Family Hub waitlist. We’ll text you if an earlier spot opens. Reply STOP to leave the list.','out',{kind:'wait',wid:w.id});
  save();return delay({ok:true,entry:w})},
 onWaitlistFor:function(tok){return S.waitlist.some(function(w){return w.moveToken===tok&&!w.booked&&!w.removed})},
 // reminders and waitlist check-ins (the links in the texts)
 confirmAppt:function(tok){var r=remByTok(tok);if(!r||r.state!=='sent')return {ok:false};r.state='confirmed';r.repAt=now();
  sms(r.phone,r.name,'Confirmed (tapped the link)','in',{kind:'remind',tok:tok});sms(r.phone,r.name,'Thanks '+r.name.split(' ')[0]+', see you '+onDay(r.start)+' at '+fmtTime(r.start)+'.','out',{kind:'remind'});
  feed('confirm',r.name+' confirmed '+P[r.pid].first+', '+fmtWhen(r.start)+'.',{pid:r.pid});save();return {ok:true}},
 cantMake:function(tok){var r=remByTok(tok);if(!r||r.state==='cancelled')return {ok:false};var res={late:false,fee:0};
  sms(r.phone,r.name,'Can’t make it (tapped the link)','in',{kind:'remind',tok:tok});
  if(r.bid){var b=bookingById(r.bid);if(b&&b.status==='booked')res=doCancel(b,'Can’t make it (reminder)')}
  else{S.freed[r.key]=1;res.late=isLate(r.start);feed('cancel','Can’t make it: '+r.name+' with '+P[r.pid].first+', '+fmtWhen(r.start)+' (tapped the reminder).',{pid:r.pid});slotFreed(r.pid,r.start,'cancelled',r.phone)}
  r.state='cancelled';r.repAt=now();
  sms(r.phone,r.name,'Thanks for letting us know, '+r.name.split(' ')[0]+'. You’re cancelled'+(res.fee?'. As it’s inside '+S.settings.policyHrs+' hours, the '+money(res.fee)+' late fee applies unless we fill your time.':', at no cost.')+' Book again any time: sfch.au/book','out',{kind:'remind'});
  save();return {ok:true,late:res.late,fee:res.fee}},
 keep:function(tok){var w=S.waitlist.filter(function(x){return x.check&&x.check.tok===tok})[0];if(!w)return {ok:false};
  w.checked=now();w.check=null;w.paused=0;sms(w.phone,w.name,'Still keen (tapped the link)','in',{wid:w.id});
  sms(w.phone,w.name,'Great, '+w.name.split(' ')[0]+', you’re still on the list. We’ll text you when a spot opens.','out',{wid:w.id,kind:'check'});
  feed('wait',w.name+' is still keen and stays on the waitlist.');save();return {ok:true}},
 unpause:function(id){var w=S.waitlist.filter(function(x){return x.id===id})[0];if(w){w.paused=0;w.check=null;w.checked=now();feed('wait','Put '+w.name+' back on the active waitlist.');save()}},
 // referrals
 refer:function(d){var r={id:'r'+uid(6),tok:uid(10),at:now(),source:d.source||'Online form',from:d.from,client:d.client,to:d.to,plan:d.plan,planDate:d.planDate||'',planIn:!!d.file,
   file:d.file||null,reason:String(d.reason||'').slice(0,2000),status:'new'};
  S.referrals.unshift(r);
  feed('ref','New referral from '+d.from.name+(d.from.practice?' ('+d.from.practice+')':'')+' for '+d.client.name+' to '+(d.to==='team'?'the Psychology Team':P[d.to].first)+'.');
  if(d.to!=='team'&&P[d.to]&&P[d.to].live&&S.settings.autoInvite)invite(r,[d.to]);
  save();return delay({ok:true,referral:r})},
 referral:function(tok){return S.referrals.filter(function(r){return r.tok===tok})[0]||null},
 inviteReferral:function(id,pids){var r=S.referrals.filter(function(x){return x.id===id})[0];if(r&&pids.length){invite(r,pids);save()}},
 updateReferral:function(id,patch){var r=S.referrals.filter(function(x){return x.id===id})[0];if(!r)return;Object.assign(r,patch);
  if(patch.planIn)feed('ref','Marked '+r.client.name+'’s plan as received.');if(patch.status==='closed')feed('ref','Closed the referral for '+r.client.name+'.');save()},
 // practitioner preferences (practitioner view)
 prefs:function(pid,patch){if(patch){S.pp[pid]=Object.assign(prefs(pid),patch);feed('none',P[pid].first+' updated their booking preferences.');save()}return prefs(pid)},
 policy:function(pid){return {hrs:S.settings.policyHrs,fee:lateFee(pid),text:policyText(pid),card:S.settings.card,series:S.settings.series&&prefs(pid).series}},
 gap:gapLen,
 report:report,
 // what the dashboard needs
 state:function(){return S},
 upcoming:function(days){var out=[],d0=new Date(now());d0.setHours(0,0,0,0);
  for(var i=0;i<days;i++){var day=new Date(d0);day.setDate(d0.getDate()+i);
   ORDER.forEach(function(pid){daySlots(pid,day).forEach(function(d){if(d.getTime()<now())return;var st=slotState(pid,d),k=slotKey(pid,d);
    if(st==='seeded')out.push({pid:pid,start:d,name:fakeClient(pid,d),seeded:1,rem:S.rem[k]});
    else if(st==='booked'){var b=bookingAt(k);if(b)out.push({pid:pid,start:d,name:b.name,booking:b,rem:S.rem[k]})}})})}
  return out.sort(function(a,b){return a.start-b.start})},
 simulateCancel:function(pid,start){var k=slotKey(pid,start);
  if(S.taken[k]){var b=bookingAt(k);return api.cancel(b.token,'Sick')}
  S.freed[k]=1;var r=S.rem[k];if(r&&r.state==='sent')r.state='cancelled';
  feed('cancel','Cancelled: '+P[pid].first+', '+fmtWhen(start)+' ('+fakeClient(pid,new Date(start))+', by text).',{pid:pid});
  slotFreed(pid,start,'cancelled');save();return delay({ok:true})},
 approve:function(oid){var o=S.offers.filter(function(x){return x.id===oid})[0];if(o&&(o.status==='approval'||o.status==='queued')){sendRound(o);save()}},
 dismiss:function(oid){var o=S.offers.filter(function(x){return x.id===oid})[0];if(o){o.status='unfilled';feed('none','Left '+P[o.pid].first+', '+fmtWhen(o.start)+' on the booking page instead.');save()}},
 claim:function(tok,via){return claim(tok,via)},
 race:function(oid){var o=S.offers.filter(function(x){return x.id===oid})[0];if(!o||o.status!=='open')return null;
  var live=o.sent.filter(function(s){return s.state==='sent'&&s.round===o.round}).map(function(s){return s.tok});
  live.sort(function(){return Math.random()-.5});var res=live.map(function(t){return claim(t,'tap')});return res},
 forward:function(mins){S.skew=(S.skew||0)+mins*6e4;feed('clock','Demo clock moved forward '+(mins>=120?Math.round(mins/60)+' hours':mins+' minutes')+'.');save();tick()},
 settings:function(x){Object.assign(S.settings,x);save();tick()},
 reset:function(){S=defaults();try{localStorage.removeItem('scfh-demo-mine')}catch(e){}save();tick()},
 removeWaitlist:function(id){var w=S.waitlist.filter(function(x){return x.id===id})[0];if(!w||w.removed)return;w.removed=now();
  feed('none','Removed '+w.name+' from the waitlist.');save()},
 noteWaitlist:function(id,note){var w=S.waitlist.filter(function(x){return x.id===id})[0];if(w){w.note=String(note||'').slice(0,500);save()}},
 // Everything the dashboard knows, compact, for the "Ask Claude" panel. When live, the Worker builds this server-side.
 // Privacy: clients are swapped for stable tokens like [C1a2b]; phones, emails, notes, dates of birth, referral reasons,
 // file names and children's names are left out, so no client can be identified from what is sent.
 snapshot:function(){var DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],names={},byName={};
  function loc(d){d=new Date(d);return DN[d.getDay()]+' '+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear()+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}
  function first(id){return P[id]?P[id].first:id}
  function tok(n){if(!n)return n;if(byName[n])return byName[n];var k='[C'+Math.floor(hash('client:'+n)*46656*36).toString(36)+']';names[k]=n;byName[n]=k;return k}
  var team=ORDER.map(function(id){var p=P[id];return {id:id,name:p.name,role:p.role,
    books:p.live?'through the hub':p.contact?'call the Hub':'own booking page',onLeave:!!p.leave,note:p.note||undefined,
    worksOn:p.sched?Object.keys(p.sched).map(function(d){return DN[d]+' '+p.sched[d].join(',')}).join('; '):undefined,
    bookedOutUntil:p.openFrom||undefined,sessionMins:p.len||undefined,fee:VALUE[id]||undefined,refillMode:p.live?prefs(id).refill:undefined}});
  var wl=S.waitlist.map(function(w){var offers=[];S.offers.forEach(function(o){o.sent.forEach(function(s){if(s.wid===w.id)offers.push({slot:first(o.pid)+' '+loc(o.start),result:s.state,round:s.round})})});
   return {client:tok(w.name),status:w.removed?'removed':w.booked?'booked from waitlist':w.paused?'paused (no reply to check-in)':w.check?'check-in sent, no reply yet':'waiting',wants:w.need,needsMinutes:needLen(w),practitioners:w.pids.map(first),
    days:w.days.map(function(d){return DN[d]}),times:w.times.length>1?'any':w.times[0]==='am'?'mornings':'afternoons',joined:loc(w.since),
    daysWaiting:Math.max(0,Math.round((now()-w.since)/864e5)),source:w.moveToken?'already booked, wants an earlier time':w.mine?'joined online':'added by staff',hasStaffNote:!!w.note||undefined,offersSent:offers}});
  var up=api.upcoming(21).map(function(a){return {when:loc(a.start),with:first(a.pid),client:tok(a.name),via:a.booking?(a.booking.source==='refill'?'refilled from waitlist':a.booking.source==='referral'?'booked from a referral link':'booked online'):'Halaxy',
    mode:a.booking?a.booking.mode:undefined,series:a.booking&&a.booking.series?a.booking.series.n+' of '+a.booking.series.of:undefined,reminder:a.rem?a.rem.state:undefined}});
  var free={};ORDER.forEach(function(id){if(P[id].live&&!P[id].leave){var f=freeSlots(id,now(),42);free[first(id)]=f.slice(0,12).map(loc)}});
  var bk=S.bookings.map(function(b){return {client:tok(b.name),forChild:b.child?true:undefined,with:first(b.pid),when:loc(b.start),service:b.service,mode:b.mode,status:b.status,via:b.source,
    booked:loc(b.created),series:b.series?b.series.n+' of '+b.series.of+(b.series.every===7?' weekly':' fortnightly'):undefined,planReceived:b.referral?!!b.referral.planIn:undefined,
    cancelReason:b.reason||undefined,cancelledAt:b.cancelledAt?loc(b.cancelledAt):undefined,lateFee:b.lateFee?(b.feeWaived?'waived (refilled)':b.lateFee):undefined,moved:b.moved||undefined}});
  var of=S.offers.map(function(o){var w=o.winner&&S.waitlist.filter(function(x){return x.id===o.winner})[0];
   return {slot:first(o.pid)+' '+loc(o.start),gapMinutes:o.len,opened:loc(o.created),status:o.status,round:o.round,peopleTexted:o.sent.length,filledBy:w?tok(w.name):undefined}});
  var refs=S.referrals.map(function(r){return {client:tok(r.client.name),received:loc(r.at),via:r.source,referrerPractice:r.from.practice||undefined,to:r.to==='team'?'Psychology Team':first(r.to),
    status:r.status,linkSentFor:r.pids?r.pids.map(first):undefined,linkSent:r.invitedAt?loc(r.invitedAt):undefined,booked:r.bookedAt?loc(r.bookedAt):undefined,medicarePlan:r.plan==='yes'?(r.planIn?'received':'not received yet'):'none'}});
  var rem=Object.keys(S.rem).map(function(k){var r=S.rem[k];return {appt:first(r.pid)+' '+loc(r.start),client:tok(r.name),state:r.state}});
  var known=Object.keys(byName).sort(function(a,b){return b.length-a.length});
  function scrub(s){known.forEach(function(n){s=s.split(n).join(byName[n])});return s.replace(/\b04\d{2} ?\d{3} ?\d{3}\b/g,'[phone]').replace(/\b[\w.-]+\.(pdf|jpe?g|png|heic)\b/gi,'[file]')}
  var rp=report(28);
  var data={now:loc(now()),timezone:'Australia/Melbourne',demo:true,team:team,stats:{spotsRefilled:S.stats.filled,incomeRecovered:S.stats.value,
    avgMinutesToRefill:S.stats.mins.length?Math.round(S.stats.mins.reduce(function(a,b){return a+b},0)/S.stats.mins.length):null},
   settings:S.settings,cancellationPolicy:policyText('adi'),waitlist:wl,upcomingAppointments:up,freeTimes:free,onlineBookings:bk,refillOffers:of,referrals:refs,reminders:rem,
   last4Weeks:{note:'includes made-up sample history',appointments:rp.totals.booked,cancellations:rp.cancellations,refilled:rp.totals.refilled,fillRatePct:rp.fillRate,recovered:rp.totals.recovered,lost:rp.totals.lost,noShows:rp.totals.noshow,
    utilisationPct:rp.utilisation,reminders:{sent:rp.reminders.sent,confirmed:rp.reminders.confirmed,cantMakeIt:rp.reminders.cantMake},texts:rp.texts,lateFeesAllowedUnderPolicy:rp.totals.fees,referrals:rp.referrals,
    waitlistNow:{active:rp.waitlist.active,paused:rp.waitlist.paused,medianDaysWaiting:rp.waitlist.medianDays},byPractitioner:rp.byPract.map(function(r){return {who:r.first,booked:r.booked,lateCancels:r.late,earlyCancels:r.early,noShows:r.noshow,refilled:r.refilled,recovered:r.recovered,video:r.video}})},
   activity:S.feed.slice(0,60).map(function(f){return loc(f.at)+' '+scrub(f.text)}),textsSent:S.sms.filter(function(m){return m.dir==='out'}).length};
  return {data:data,names:names,scrub:scrub}},
 on:function(f){subs.push(f)}
};
window.HUB={P:P,ORDER:ORDER,photo:photo,SITE:SITE,api:api,fmt:{time:fmtTime,day:fmtDay,when:fmtWhen,money:money,esc:esc,DAY:DAY,MON:MON},serviceName:serviceName,lenOf:lenOf,now:now,slotKey:slotKey,VALUE:VALUE};
})();
