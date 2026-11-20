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
var KEY='scfh-demo-v5', S;
var FIRST=['Sarah','Jess','Emma','Kate','Chloe','Mia','Tom','Ben','Lucy','Grace','Olivia','Hannah','Zoe','Ruby','Amy','Georgia','Lily','Sam','Ella','Nina'];
var LAST=['M.','T.','K.','R.','B.','L.','W.','H.','P.','S.','D.','C.'];
function defaults(){return {v:5,pay:[],cards:{},inbox:[],mail:[],blocked:{},bcasts:[],skew:0,bookings:[],freed:{},taken:{},waitlist:seedWaitlist(),offers:[],sms:[],feed:[],rem:{},referrals:seedReferrals(),pp:{},
 settings:{mode:'auto',batch:3,expiry:30,minNotice:2,quiet:true,quietFrom:20,quietTo:8,weekCap:3,
  remind:true,remindHrs:48,policyHrs:24,lateFee:'full',card:'new',fresh:true,freshDays:30,freshGrace:7,series:true,autoInvite:true,smsCost:0.1,autoReply:'admin',safetyReply:true,afterHours:true,missedText:true,openFrom:9,openTo:17,intake:true,deposit:0,charge:'auto'},
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
function load(){try{S=JSON.parse(localStorage.getItem(KEY))}catch(e){S=null}if(!S||S.v!==5)S=defaults()}
// Keep the demo store well under the browser's ~5 MB storage limit, however long someone plays with it.
function trim(){if(S.offers.length>300)S.offers.length=300;if(S.inbox&&S.inbox.length>200)S.inbox.length=200;if(S.mail&&S.mail.length>200)S.mail=S.mail.slice(-200);
 if(S.bcasts&&S.bcasts.length>30)S.bcasts.length=30;(S.inbox||[]).forEach(function(th){if(th.msgs.length>100)th.msgs=th.msgs.slice(-100)});
 if(S.bookings.length>1500){var cut=now()-60*864e5;S.bookings=S.bookings.filter(function(b){return b.status==='booked'||new Date(b.start).getTime()>cut})}
 var w=S.waitlist.filter(function(x){return !x.removed&&!x.booked});if(S.waitlist.length>400)S.waitlist=w.concat(S.waitlist.filter(function(x){return x.removed||x.booked}).slice(-100))}
function save(){trim();try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){try{console.warn('Demo storage is full; resetting old history.');S.sms=S.sms.slice(-50);S.offers.length=Math.min(S.offers.length,50);localStorage.setItem(KEY,JSON.stringify(S))}catch(e2){}}emit()}
var subs=[];function emit(){subs.forEach(function(f){try{f()}catch(e){console.error(e)}})}
window.addEventListener('storage',function(e){if(e.key===KEY){load();emit()}});
load();
function now(){return Date.now()+(S.skew||0)}

// ---------- availability ----------
// A slot is "taken" by a made-up client unless freed by a cancellation. Busy-ness is seeded so it's stable.
function baseTaken(pid,d){var o=P[pid].openFrom;if(o&&d<new Date(o+'T00:00:00'))return true;return hash(pid+d.toISOString())<0.6}
function fakeClient(pid,d){var h=hash('c'+pid+d.toISOString());return FIRST[Math.floor(h*FIRST.length)]+' '+LAST[Math.floor(hash('l'+pid+d)*LAST.length)]}
function slotState(pid,d){var k=slotKey(pid,d);
 if(S.blocked&&S.blocked[k])return 'blocked';      // practitioner unavailable (sick day)
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
  sms(w.phone,w.name,'Hi '+w.name.split(' ')[0]+', it’s Surf Coast Family Hub. A time has come up with '+p.first+' '+onDay(o.start)+' at '+fmtTime(o.start)+'. If you’d like it, tap here to book: sfch.au/c/'+tok+' We’ve let a few people on the waitlist know, so it’s booked in the order people reply. The link works until '+fmtTime(o.expires)+'. No need to reply if it doesn’t suit. Reply STOP to leave the list.','out',{oid:o.id,wid:w.id,tok:tok,kind:'offer'})});
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
   sms(phone,name,'Reminder: '+name.split(' ')[0]+', you’re seeing '+P[pid].first+' '+onDay(d)+' at '+fmtTime(d)+where+'. Tap to confirm: sfch.au/r/'+tok+' Can’t make it? Tap sfch.au/x/'+tok+(fu.getTime()>now()?' (free to cancel until '+fmtWhen(fu)+')':'')+' and we’ll offer your time to someone on the waitlist.'+(b&&b.intake&&b.intake.status!=='done'?' Please also fill in your intake form: sfch.au/i/'+b.intake.tok:''),'out',{kind:'remind',tok:tok,key:k})})})}
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
  sms(w.phone,w.name,'Hi '+fn+', it’s Surf Coast Family Hub. You’ve been on our waitlist for '+Math.round((now()-w.since)/D)+' days. Still keen for a spot? Tap to keep your place: sfch.au/k/'+tok+' If we don’t hear back within a week, we’ll pause your place for now, and you can come back any time. Reply STOP to leave the list.','out',{wid:w.id,tok:tok,kind:'check'});
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
 if(billTick())changed=true;
 if(changed)save()}
setInterval(tick,5000);setTimeout(tick,400);

function claim(tok,via){
 var o=null,s=null;S.offers.forEach(function(x){x.sent.forEach(function(y){if(y.tok===tok){o=x;s=y}})});
 if(!o)return {ok:false,reason:'missing'};
 var w=S.waitlist.filter(function(x){return x.id===s.wid})[0],p=P[o.pid];
 if(s.state==='won')return {ok:true,already:true,offer:o,booking:S.bookings.filter(function(b){return b.phone===w.phone&&b.status==='booked'&&slotKey(b.pid,b.start)===o.key})[0]||null};   // tapped their link again
 if(via==='yes')sms(w.phone,w.name,'YES','in',{oid:o.id,wid:w.id});
 if(S.blocked[o.key]&&o.status==='open'){o.status='unfilled';feed('none','Withdrew the offer for '+p.first+', '+fmtWhen(o.start)+': '+p.first+' isn’t working that day.',{oid:o.id})}
 if(o.status!=='open'||s.state==='expired'){
  if(s.state!=='late'&&s.state!=='lost'){s.state='late';sms(w.phone,w.name,'Thanks '+w.name.split(' ')[0]+'. That time has now been filled, so there’s nothing you need to do. You’re still on our waitlist and we’ll text you when another time comes up.','out',{oid:o.id,wid:w.id,kind:'taken'})}
  save();return {ok:false,reason:'taken',offer:o}}
 // In the real system this is one database transaction plus Halaxy's fail-on-double-booking, so two taps can never both win.
 o.status='filled';o.winner=w.id;o.filledAt=now();s.state='won';w.booked=true;
 var mb=moveBooking(w),b,old;
 if(mb){old=mb.start;delete S.taken[slotKey(mb.pid,old)];delete S.rem[slotKey(mb.pid,old)];mb.start=new Date(o.start).toISOString();S.taken[slotKey(mb.pid,mb.start)]=mb.id;mb.moved=(mb.moved||0)+1;b=mb;
  sms(w.phone,w.name,'Done! We’ve moved you to '+onDay(o.start)+' at '+fmtTime(o.start)+' with '+p.first+' (was '+fmtWhen(old)+'). Manage your booking: sfch.au/m/'+b.token,'out',{oid:o.id,wid:w.id,kind:'confirm'})}
 else{b=makeBooking({pid:o.pid,start:o.start,name:w.name,phone:w.phone,email:'',source:'refill',service:w.need,len:Math.min(needLen(w),o.len),mode:'in'});
  if(S.settings.intake&&!S.bookings.some(function(x){return x!==b&&normPhone(x.phone)===normPhone(w.phone)}))startIntake(b);
  sms(w.phone,w.name,'You’re booked '+onDay(o.start)+' at '+fmtTime(o.start)+' with '+p.first+' at 16 Princes Tce, Jan Juc. Need to change it? Manage your booking: sfch.au/m/'+b.token,'out',{oid:o.id,wid:w.id,kind:'confirm'})}
 o.sent.forEach(function(x){if(x!==s&&x.state==='sent'){x.state='lost';var ww=S.waitlist.filter(function(q){return q.id===x.wid})[0];
  sms(ww.phone,ww.name,'Thanks '+ww.name.split(' ')[0]+'. That time has now been filled, so there’s nothing you need to do. You’re still on our waitlist and we’ll text you when another time comes up.','out',{oid:o.id,wid:ww.id,kind:'taken'})}});
 var mins=Math.max(1,Math.round((now()-o.created)/6e4));
 S.stats.filled++;S.stats.value+=VALUE[o.pid]||200;S.stats.mins.push(mins);
 feed('filled','Filled: '+p.first+', '+fmtWhen(o.start)+' → '+w.name+(old?' (moved up from '+fmtWhen(old)+')':'')+' (round '+o.round+', '+mins+' min after it opened).',{oid:o.id,pid:o.pid});
 if(o.bid){var cb=bookingById(o.bid);if(cb&&cb.lateFee&&!cb.feeWaived){cb.feeWaived=true;cb.waivedWhy='refilled';
  if(cb.feeCharged){cb.feeCharged=0;paysFor(cb.id).filter(function(x){return x.kind==='late'&&x.status==='paid'}).forEach(function(x){refundPay(x,'your time was refilled')})}
  paysFor(cb.id).filter(function(x){return x.kind==='late'&&(x.status==='due'||x.status==='failed')}).forEach(function(x){x.status='void'})
  feed('none','Late cancellation fee '+(cb.feeCharged===0?'refunded':'waived')+' for '+cb.name+': the spot was refilled.')}}
 if(old)slotFreed(o.pid,old,'moved up',w.phone,mb.id);   // their old time now goes to the next person: a refill chain
 save();return {ok:true,offer:o,booking:b}}

// ---------- bookings ----------
function makeBooking(x){var id=uid(8);while(S.bookings.some(function(y){return y.id===id}))id=uid(8);var b=Object.assign({id:id,token:uid(12),status:'booked',created:now()},x);b.start=new Date(b.start).toISOString();
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
 return 'You’re welcome to move or cancel up to '+s.policyHrs+' hours before, at no cost. '+(f?'With less notice, or if you can’t make it on the day, '+(s.lateFee==='full'?'the session fee':'half the session fee')+' ('+money(f)+') may be charged. If we can offer your time to someone else, there’s no fee, and we always understand that things come up.':'If something comes up after that, please still let us know so someone on the waitlist can have the time.')}
function isLate(start){return new Date(start).getTime()-now()<S.settings.policyHrs*36e5}
function isFree(pid,d){return d.getTime()>now()+3*36e5&&slotState(pid,d)==='free'&&!openOfferFor(pid,d)}
function doCancel(b,reason,noRefill){
 b.status='cancelled';b.reason=reason;b.cancelledAt=now();delete S.taken[slotKey(b.pid,b.start)];
 var late=isLate(b.start),fee=late&&!noRefill?lateFee(b.pid):0;if(fee)b.lateFee=fee;
 var r=S.rem[slotKey(b.pid,b.start)];if(r&&r.state==='sent')r.state='cancelled';
 // a deposit is refunded on an on-time cancellation, and counts towards the fee on a late one
 var dep=paysFor(b.id).filter(function(x){return x.kind==='deposit'&&x.status==='paid'})[0];
 if(dep&&(!late||noRefill))refundPay(dep,noRefill?'appointment cancelled by the Hub':'cancelled in time');
 feed('cancel','Cancelled: '+P[b.pid].first+', '+fmtWhen(b.start)+' ('+b.name+(reason?', '+reason:'')+')'+(late?'. Late cancellation, under '+S.settings.policyHrs+' hours'+(fee?' ('+money(fee)+' fee unless refilled)':'')+'.':'.'),{pid:b.pid,late:late});
 if(!noRefill)slotFreed(b.pid,b.start,'cancelled',b.phone,b.id);return {late:late,fee:noRefill?0:fee}}
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

// ---------- intake forms ----------
// New clients get a link to an online intake form (details, emergency contact, GP, Medicare, consent). When live, the
// answers go straight into the practitioner's Halaxy patient record and the signed consent is filed there.
function needsIntake(b){return b.first==='yes'||b.source==='referral'||b.source==='refill'&&!b.first}
function startIntake(b){if(b.intake)return;b.intake={tok:uid(10),status:'sent',sentAt:now()};
 sms(b.phone,b.name,'Before your first session with '+P[b.pid].first+', please fill in your intake form (about 5 minutes): sfch.au/i/'+b.intake.tok,'out',{kind:'intake'})}
function intakeByTok(tok){return S.bookings.filter(function(b){return b.intake&&b.intake.tok===tok})[0]||null}

// ---------- payments ----------
// Money goes to each practitioner's own merchant account (they're separate businesses); the hub just runs it.
// Demo: a pretend payment provider. Cards ending 0002 don't go through, so that path can be shown.
var REBATE={adi:149.05,hannah:149.05,melinda:149.05,ellie:101.55,maddy:101.55,'michelle-ferris':89.50};
function rebateFor(b){return b.plan==='yes'&&b.mode!=='couples'?REBATE[b.pid]||0:0}
function cardFor(phone){return S.cards[normPhone(phone)]||null}
function paysFor(bid){return S.pay.filter(function(x){return x.bid===bid})}
function paidFor(bid,kind){return paysFor(bid).filter(function(x){return x.status==='paid'&&(!kind||x.kind===kind)}).reduce(function(s,x){return s+x.amount},0)}
var PAYK={deposit:'Deposit',session:'Session fee',late:'Short-notice cancellation fee',noshow:'Missed appointment fee',refund:'Refund',medicare:'Medicare rebate claim'};
function payLog(b,kind,amount,status,extra){var x=Object.assign({id:'p'+uid(9),bid:b.id,pid:b.pid,name:b.name,phone:b.phone,kind:kind,amount:Math.round(amount*100)/100,status:status,at:now(),last4:(cardFor(b.phone)||{}).last4||''},extra||{});
 S.pay.unshift(x);if(S.pay.length>400)S.pay.length=400;return x}
function charge(b,kind,amount,why){if(!(amount>0))return null;var c=cardFor(b.phone),fn=b.name.split(' ')[0],p=P[b.pid];
 if(!c){var due=payLog(b,kind,amount,'due');sms(b.phone,b.name,'Hi '+fn+', your '+PAYK[kind].toLowerCase()+' of '+money(due.amount)+' for '+p.first+' ('+fmtDay(b.start,1)+') is ready to pay whenever suits: sfch.au/p/'+due.id,'out',{kind:'pay'});
  feed('pay',PAYK[kind]+' of '+money(due.amount)+' for '+b.name+' is due. Payment link sent.');return due}
 if(c.last4==='0002'){var f=payLog(b,kind,amount,'failed',{why:'Payment didn’t go through'});sms(b.phone,b.name,'Hi '+fn+', the payment of '+money(f.amount)+' for your session with '+p.first+' didn’t go through. These things happen. When it suits, you can pay here: sfch.au/p/'+f.id+' or give us a call on 0491 184 788.','out',{kind:'pay'});
  feed('payfail','Payment didn’t go through: '+money(f.amount)+' from '+b.name+' ('+PAYK[kind].toLowerCase()+'). Payment link sent.');return f}
 var x=payLog(b,kind,amount,'paid',{why:why||''});
 sms(b.phone,b.name,'Paid: '+money(x.amount)+' '+PAYK[kind].toLowerCase()+' to '+p.name+(why?' ('+why+')':'')+', card ending '+c.last4+'. Receipt: sfch.au/p/'+x.id,'out',{kind:'pay'});
 feed('pay','Charged '+b.name+' '+money(x.amount)+' ('+PAYK[kind].toLowerCase()+') to '+p.first+'’s account.');return x}
function claimMedicare(b){var r=rebateFor(b);if(!r||paysFor(b.id).some(function(x){return x.kind==='medicare'}))return;
 payLog(b,'medicare',r,'claimed',{why:'Paid by Medicare into the client’s bank account'})}
// After a session ends: charge the card on file (or send a payment link), less any deposit, and lodge the Medicare claim.
function billTick(){var ch=false;
 S.bookings.forEach(function(b){if(b.status!=='booked'||b.billed||b.noShow)return;var end=new Date(b.start).getTime()+(b.len||P[b.pid].len)*6e4;if(now()<end)return;
  b.billed=now();b.attended=true;ch=true;if(S.settings.charge==='manual')return;
  var owe=feeAmt(b.pid)-paidFor(b.id,'deposit');charge(b,'session',owe);if(paysFor(b.id).some(function(x){return x.kind==='session'&&x.status==='paid'}))claimMedicare(b)});
 return ch}
function seedPay(){var t=now(),H=36e5;
 function past(pid,h,name,phone,plan,card){var d=new Date(t-h*H);d.setMinutes(0,0,0);var b=makeBooking({pid:pid,start:d.toISOString(),name:name,phone:phone,email:'',service:'Medicare - Face to Face Psychology Appointment',plan:plan,mode:'in',source:'online',first:'no',len:50});
  delete S.taken[slotKey(pid,b.start)];if(card)S.cards[normPhone(phone)]={last4:card,brand:'Visa',exp:'08/28'};return b}
 var a=past('hannah',26,'Olivia K.','0400 000 401','yes','4242');a.billed=t-25*H;a.attended=true;
 var x=payLog(a,'session',245,'paid');x.at=t-25*H;var m=payLog(a,'medicare',149.05,'claimed',{why:'Paid by Medicare into the client’s bank account'});m.at=t-25*H;
 var b=past('ellie',75,'Tara N.','0400 000 402','no','0002');b.billed=t-74*H;b.attended=true;var f=payLog(b,'session',170,'failed',{why:'Payment didn’t go through'});f.at=t-74*H;
 var c=past('maddy',20,'Lena F.','0400 000 403','yes','4242');c.status='cancelled';c.reason='Something came up';c.cancelledAt=t-27*H;c.late=true;c.lateFee=200;
 var d=past('adi',50,'Chris M.','0400 000 404','yes','4242');d.noShow=true;d.billed=t-49*H;d.noShowFee=245}

// ---------- inbox: texts, emails, calls, voicemail and website enquiries in one place ----------
// When live: SMS replies arrive from the SMS provider's webhook, emails from an inbound-email address, calls and
// voicemail (with transcripts) from the phone provider, and the website form posts here. Everything is matched to the
// client's booking, waitlist place or referral. Claude can draft replies; a person approves them before they're sent.
var RISK=/\b(suicid\w*|kill(ing)? (my|him|her)self|end (it all|my life)|don['’]?t want to (be here|live|wake up)|not (feeling )?safe|(don['’]?t|do not) feel safe|can['’]?t cope any ?more|unsafe at home|hurt(ing)? (myself|my baby|the baby|someone)|self[- ]?harm\w*|overdos\w*|can['’]?t (go on|keep going)|no point (in )?(living|going on)|harm (my|the) baby|scared he['’]?ll|he hit me)\b/i;
var INTENTS=[
 ['late',/\b(running|be|am|i['’]?m)\s+(about\s+)?(\d+\s*(min|mins|minutes)\s+)?late\b|stuck in traffic|on (my|our) way/i,'Running late'],
 ['cancel',/\bcancel|can['’]?t (make|come|attend|do)|won['’]?t (be able|make)|\b(sick|unwell|ill)\b/i,'Cancel'],
 ['move',/\b(move|reschedul\w*|change (my|the) (time|appointment|booking)|different (time|day)|later in the week|another (time|day))\b/i,'Reschedule'],
 ['waitlist',/\bwait ?list|where (am i|i['’]?m at)\b/i,'Waitlist'],
 ['fees',/\b(cost|fees?|price|how much|bulk ?bill\w*|rebate|health fund|private health)\b/i,'Fees and rebates'],
 ['referral',/\breferr\w*|treatment plan|\bmhtp\b/i,'Referral or plan'],
 ['new',/\b(new client|looking for|who (should|would you)|recommend|first (appointment|session)|start seeing|available|availability|do you (do|offer|have|see)|appointments? (in|for)|for my (son|daughter|child|kid|baby|teen)|year old)\b/i,'New enquiry'],
 ['callback',/\bcall (me )?back|give me a (call|ring)|ring me\b/i,'Call back'],
 ['confirm',/^\s*(c|yes|yep|confirm(ed)?|see you( then)?|thanks?|thank you)\W*$/i,'Confirmation']];
function classify(text){text=String(text||'');if(RISK.test(text))return {intent:'risk',label:'Safety concern',urgent:true};
 for(var i=0;i<INTENTS.length;i++)if(INTENTS[i][1].test(text))return {intent:INTENTS[i][0],label:INTENTS[i][2]};return {intent:'other',label:'General'}}
function normPhone(p){return String(p||'').replace(/\s/g,'').replace(/^\+61/,'0')}
// Who is this? Checks bookings, the waitlist, referrals and (demo) Halaxy clients in the next week.
function matchContact(phone,email){var ph=normPhone(phone),em=String(email||'').toLowerCase(),out=[];
 if(ph){S.bookings.forEach(function(b){if(b.status==='booked'&&normPhone(b.phone)===ph&&new Date(b.start).getTime()>now())out.push({kind:'booking',id:b.id,token:b.token,name:b.name,pid:b.pid,start:b.start,mode:b.mode})});
  S.waitlist.forEach(function(w){if(!w.booked&&!w.removed&&normPhone(w.phone)===ph)out.push({kind:'waitlist',id:w.id,name:w.name,pids:w.pids,need:w.need})});
  S.referrals.forEach(function(r){if(r.status!=='closed'&&normPhone(r.client.phone)===ph)out.push({kind:'referral',id:r.id,name:r.client.name,status:r.status,pids:r.pids||[],from:r.from.name})});
  if(!out.some(function(x){return x.kind==='booking'})){var d0=new Date(now());d0.setHours(0,0,0,0);
   for(var i=0;i<8&&!out.some(function(x){return x.kind==='appt'});i++){var day=new Date(d0);day.setDate(d0.getDate()+i);
    ORDER.forEach(function(pid){daySlots(pid,day).forEach(function(d){if(d.getTime()>now()-36e5&&slotState(pid,d)==='seeded'&&normPhone(fakePhone(pid,d))===ph)out.push({kind:'appt',key:slotKey(pid,d),name:fakeClient(pid,d),pid:pid,start:d.toISOString(),mode:'in'})})})}}}
 if(em)S.bookings.forEach(function(b){if(b.status==='booked'&&String(b.email).toLowerCase()===em&&new Date(b.start).getTime()>now()&&!out.some(function(x){return x.id===b.id}))out.push({kind:'booking',id:b.id,token:b.token,name:b.name,pid:b.pid,start:b.start,mode:b.mode})});
 return out}
function openHours(t){var d=new Date(t),h=d.getHours(),w=d.getDay();return w>0&&w<6&&h>=S.settings.openFrom&&h<S.settings.openTo}
function threadOut(th,channel,text,by,subject){
 var to=channel==='email'?th.email:th.phone;if(!to)return false;
 if(channel==='email')S.mail.push({id:uid(6),to:to,name:th.name,subject:subject||'Re: '+(th.subject||'Your message'),body:text,at:now(),tid:th.id});
 else sms(th.phone,th.name,text,'out',{kind:'inbox',tid:th.id});
 th.msgs.push({id:uid(6),dir:'out',channel:channel,text:text,subject:channel==='email'?(subject||'Re: '+(th.subject||'Your message')):'',by:by||'staff',at:now()});
 th.updated=now();return true}
function inbound(d){
 var at=d.at||now(),ph=d.phone?normPhone(d.phone):'',em=(d.email||'').toLowerCase();
 var th=S.inbox.filter(function(x){return x.status!=='done'&&((ph&&normPhone(x.phone)===ph)||(em&&String(x.email).toLowerCase()===em))})[0];
 var c=classify((d.subject||'')+' '+(d.text||''));
 if(!th){th={id:'t'+uid(7),created:at,name:d.name||'',phone:d.phone||'',email:d.email||'',subject:d.subject||'',msgs:[],status:'open',unread:true,urgent:false,intent:c.intent,label:c.label,assigned:'',note:''};S.inbox.unshift(th)}
 th.match=matchContact(th.phone,th.email);if(!th.name&&th.match[0])th.name=th.match[0].name;if(!th.name)th.name=th.phone||th.email||'Unknown';
 th.msgs.push({id:uid(6),dir:'in',channel:d.channel,text:d.text||'',subject:d.subject||'',dur:d.dur||0,at:at});
 th.updated=at;th.unread=true;if(th.status==='done'||th.status==='waiting')th.status='open';
 if(c.intent!=='other'&&!(c.intent==='confirm'&&th.intent!=='other'))th.intent=c.intent,th.label=c.label;
 var fn=(th.name||'').split(' ')[0],m=th.match.filter(function(x){return x.kind==='booking'||x.kind==='appt'})[0],chan=d.channel==='email'||(d.channel==='form'&&!th.phone)?'email':'sms';
 var src={sms:'Text',email:'Email',voicemail:'Voicemail',call:'Missed call',form:'Website enquiry'}[d.channel];
 if(c.urgent){th.urgent=true;
  feed('urgent','Urgent: '+src.toLowerCase()+' from '+th.name+' may be a safety concern. Call them now.',{tid:th.id});
  if(S.settings.safetyReply&&(th.phone||th.email))threadOut(th,th.phone?'sms':'email','Thank you for reaching out'+(fn&&!/^0/.test(fn)?', '+fn:'')+'. We’re glad you did. Someone from our team will call you as soon as they can. Our messages aren’t checked around the clock, so if you’re in danger or might hurt yourself, please call 000 now. You can talk to someone any time on Lifeline 13 11 14, or PANDA 1300 726 306 (weekdays and some evenings).','auto');
  return th}
 feed('inbox',src+' from '+th.name+(th.match.length?'':' (new contact)')+': '+c.label.toLowerCase()+'.',{tid:th.id});
 var auto=S.settings.autoReply==='admin';
 if(d.channel==='call'&&S.settings.missedText&&th.phone){threadOut(th,'sms','Hi, it’s Surf Coast Family Hub. Sorry we missed your call. We’ll call you back '+(openHours(at)?'today':'next business day')+', or reply here if a text is easier.','auto');th.intent='callback';th.label='Call back'}
 else if(auto&&c.intent==='late'&&m&&sameDay(new Date(m.start),new Date(at))){threadOut(th,'sms','Thanks '+fn+', no problem. We’ve let '+P[m.pid].first+' know you’re on your way.','auto');th.status='done';th.unread=false;
  feed('none','Told '+P[m.pid].first+': '+th.name+' is running late for '+fmtTime(m.start)+'.')}
 else if(auto&&c.intent==='confirm'&&th.msgs.length>1){th.status='done';th.unread=false}
 else if(S.settings.afterHours&&!openHours(at)&&(th.phone||th.email))threadOut(th,chan,'Thanks for your message. The front desk is closed right now; we’ll reply on the next business day (Mon to Fri, '+S.settings.openFrom+'am to '+(S.settings.openTo-12)+'pm). If it’s an emergency, call 000, or Lifeline on 13 11 14.','auto');
 return th}
function seedInbox(){var t=now(),M=6e4;
 inbound({channel:'call',phone:'0400 000 302',at:t-22*M});
 inbound({channel:'voicemail',phone:'0400 000 202',dur:34,at:t-55*M,text:'Hi, it’s Amy. Dr James referred me to Hannah and I got a text with a link, but I’d rather talk to someone first about whether it’s the right fit for me. Could someone call me back on this number? Thanks.'});
 inbound({channel:'form',name:'Nina P.',phone:'0400 000 301',at:t-80*M,text:'Looking for someone for my 8 year old who has been really anxious about school. Who would you recommend and how soon could we get in?'});
 inbound({channel:'email',name:'Rachel T.',email:'rachel.t@example.com',subject:'Fees question',at:t-140*M,text:'Hi there, do you bulk bill for psychology? How much would a session with Ellie be if I have a mental health plan from my GP? Thanks, Rachel'});
 inbound({channel:'sms',phone:'0400 000 102',at:t-190*M,text:'Hi, just checking where I’m at on the waitlist for Hannah? I can now do mornings any weekday, not just Tue Thu Fri.'});
 S.inbox.forEach(function(x){x.unread=x.id===S.inbox[0].id||x.id===S.inbox[1].id});S.feed=S.feed.filter(function(f){return f.kind!=='inbox'})}
var SAMPLES={
 late:function(a){return {channel:'sms',phone:a.phone,text:'Running about 10 min late sorry! Stuck behind a tractor on the Great Ocean Rd'}},
 move:function(a){return {channel:'sms',phone:a.phone,text:'Hi, is there any chance I could move my appointment to later in the week? Work has thrown something at me.'}},
 cancel:function(a){return {channel:'sms',phone:a.phone,text:'So sorry, my little one has gastro so I can’t make it to my appointment. Can we reschedule?'}},
 email:function(){return {channel:'email',name:'Priya R.',email:'priya.r@example.com',subject:'Appointments for postnatal support',text:'Hello, my baby is 3 months old and I’ve been struggling a bit. My GP suggested I see someone. Do you have anything available in the next couple of weeks, ideally online? Thank you, Priya'}},
 voicemail:function(){return {channel:'voicemail',phone:'0400 000 303',dur:27,text:'Hi, my name’s Dan, I’m calling about couples counselling for me and my partner. Could someone give me a call back when you get a chance? Thanks, bye.'}},
 call:function(){return {channel:'call',phone:'0400 000 304'}},
 form:function(){return {channel:'form',name:'Tess W.',email:'tess.w@example.com',text:'Do you do pregnancy massage on weekends? I’m 30 weeks.'}},
 risk:function(){return {channel:'sms',phone:'0400 000 305',text:'I’m not coping at all and I don’t feel safe tonight. I don’t know who else to message.'}}};
function apptPick(){var l=api.upcoming(2).filter(function(a){return a.start.getTime()>now()+36e5});var a=l[Math.floor(Math.random()*Math.min(6,l.length))];
 if(!a)return {phone:'0400 000 399'};return {phone:a.booking?a.booking.phone:fakePhone(a.pid,a.start)}}
// recipients for a custom or group message
function groupList(g){var out=[];
 if(g.kind==='day'||g.kind==='week'){var d0=new Date(g.kind==='day'?g.date:now());d0.setHours(0,0,0,0);var n=g.kind==='day'?1:7;
  for(var i=0;i<n;i++){var day=new Date(d0);day.setDate(d0.getDate()+i);
   ORDER.forEach(function(pid){if(g.pid&&pid!==g.pid)return;daySlots(pid,day).forEach(function(d){if(d.getTime()<now())return;var st=slotState(pid,d),k=slotKey(pid,d);
    if(st==='seeded')out.push({name:fakeClient(pid,d),phone:fakePhone(pid,d),pid:pid,start:d,key:k});
    else if(st==='booked'){var b=bookingAt(k);if(b)out.push({name:b.name,phone:b.phone,pid:pid,start:d,key:k,bid:b.id,token:b.token})}})})}}
 else if(g.kind==='waitlist')S.waitlist.forEach(function(w){if(!w.booked&&!w.removed&&(!g.pid||w.pids.indexOf(g.pid)>=0))out.push({name:w.name,phone:w.phone,wid:w.id})});
 else if(g.kind==='person')out.push({name:g.name,phone:g.phone,email:g.email});
 return out}
function fill(text,r){return text.replace(/\{first\}/g,(r.name||'there').split(' ')[0]).replace(/\{practitioner\}/g,r.pid?P[r.pid].first:'your practitioner').replace(/\{time\}/g,r.start?fmtTime(r.start):'')
 .replace(/\{day\}/g,r.start?onDay(r.start):'').replace(/\{link\}/g,r.token?'sfch.au/m/'+r.token:'sfch.au/book')}

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
  texts:{count:texts,cost:Math.round(texts*S.settings.smsCost*100)/100},
  money:(function(){var l=S.pay.filter(function(x){return x.at>=from}),sum=function(f){return Math.round(l.filter(f).reduce(function(s,x){return s+x.amount},0)*100)/100};
   return {collected:sum(function(x){return (x.status==='paid'||x.status==='refunded')&&x.kind!=='refund'&&x.kind!=='medicare'}),refunded:sum(function(x){return x.kind==='refund'}),
    outstanding:sum(function(x){return x.status==='due'||x.status==='failed'}),outstandingCount:l.filter(function(x){return x.status==='due'||x.status==='failed'}).length,
    medicare:sum(function(x){return x.kind==='medicare'}),feesCharged:sum(function(x){return (x.kind==='late'||x.kind==='noshow')&&(x.status==='paid'||x.status==='refunded')}),
    feesToDecide:api.feesToDecide().length,feesWaived:S.bookings.filter(function(b){return b.feeWaived}).length}})()}}

var delay=function(v){return new Promise(function(r){setTimeout(function(){r(v)},180+Math.random()*220)})};
function bookingSms(b){var p=P[b.pid],fn=b.name.split(' ')[0];
 var how=b.mode==='video'?' by video. Your link: sfch.au/v/'+b.token:b.mode==='phone'?'. '+p.first+' will call you on this number.':' at 16 Princes Tce, Jan Juc.';
 return 'Hi '+fn+', you’re booked with '+p.first+' '+onDay(b.start)+' at '+fmtTime(b.start)+how+' Manage or cancel: sfch.au/m/'+b.token}
function refundPay(x,why){if(!x||x.status!=='paid'||x.kind==='refund'||x.kind==='medicare')return null;var b=bookingById(x.bid)||{id:x.bid,pid:x.pid,name:x.name,phone:x.phone};
 x.status='refunded';var r=payLog(b,'refund',x.amount,'paid',{of:x.id,why:why||''});
 sms(x.phone,x.name,'Refunded: '+money(x.amount)+' ('+PAYK[x.kind].toLowerCase()+(why?', '+why:'')+') to your card ending '+(x.last4||'on file')+'. It can take 3 to 5 business days to show.','out',{kind:'pay'});
 feed('pay','Refunded '+x.name+' '+money(x.amount)+' ('+PAYK[x.kind].toLowerCase()+').');return r}
function afterBook(bs,d){var b=bs[0];
 if(d.card&&d.card.last4)S.cards[normPhone(d.phone)]={last4:d.card.last4,brand:d.card.brand||'Visa',exp:d.card.exp||'08/28'};
 var dep=S.settings.deposit,newc=b.first==='yes'||b.source==='referral';
 if(dep&&newc){var amt=dep==='full'?feeAmt(b.pid):+dep;if(cardFor(b.phone))charge(b,'deposit',Math.min(amt,feeAmt(b.pid)),'held against your first session')}
 if(S.settings.intake&&needsIntake(b))startIntake(b)}
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
  sms(d.phone,d.name,bookingSms(b),'out',{kind:'confirm'});afterBook([b],d);
  save();return delay({ok:true,booking:b})},
 seriesPlan:function(pid,start,every,count){return delay(seriesPlan(pid,start,every,count))},
 bookSeries:function(d,starts){starts=starts.map(function(x){return new Date(x)});
  if(starts.some(function(x){return !isFree(d.pid,x)}))return delay({ok:false,reason:'taken'});
  var sid=uid(8),every=d.every,bs=starts.map(function(x,i){return newBooking(d,x,{series:{id:sid,n:i+1,of:starts.length,every:every}})});
  attachReferral(bs[0],d);bs.forEach(function(b){if(bs[0].referral)b.referral=bs[0].referral});
  feed('booked','New '+(every===7?'weekly':'fortnightly')+' series: '+P[d.pid].first+', '+starts.length+' sessions from '+fmtWhen(starts[0])+' ('+d.name+', online).',{pid:d.pid});
  sms(d.phone,d.name,'Hi '+d.name.split(' ')[0]+', you’re booked with '+P[d.pid].first+' for '+starts.length+' sessions: '+starts.map(function(x){return DAY[x.getDay()]+' '+x.getDate()+' '+MON[x.getMonth()]+' '+fmtTime(x)}).join(', ')+'. Manage or cancel: sfch.au/m/'+bs[0].token,'out',{kind:'confirm'});afterBook(bs,d);
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
 reschedule:function(tok,start){var b=S.bookings.filter(function(x){return x.token===tok})[0];if(!b||b.status!=='booked')return delay({ok:false});
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
  sms(r.phone,r.name,'Thanks for letting us know, '+r.name.split(' ')[0]+'. You’re cancelled'+(res.fee?'. As it’s within '+S.settings.policyHrs+' hours, a '+money(res.fee)+' cancellation fee may apply, but if we can offer your time to someone else there’s no fee.':', at no cost.')+' Book again any time: sfch.au/book','out',{kind:'remind'});
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
 policy:function(pid){var dep=S.settings.deposit;return {hrs:S.settings.policyHrs,fee:lateFee(pid),text:policyText(pid),card:S.settings.card,series:S.settings.series&&prefs(pid).series,deposit:dep?(dep==='full'?feeAmt(pid):+dep):0,charge:S.settings.charge}},
 gap:gapLen,
 // intake forms
 intake:function(tok){var b=intakeByTok(tok);return b?{booking:b,practitioner:P[b.pid].name,data:b.intake.data||{},status:b.intake.status}:null},
 saveIntake:function(tok,data,done){var b=intakeByTok(tok);if(!b)return {ok:false};b.intake.data=data;b.intake.status=done?'done':'started';b.intake.saved=now();
  if(done){b.intake.doneAt=now();feed('intake',b.name+' completed their intake form for '+P[b.pid].first+'.',{pid:b.pid});
   if(data.card&&data.card.last4)S.cards[normPhone(b.phone)]=data.card}
  save();return {ok:true}},
 resendIntake:function(bid){var b=bookingById(bid);if(!b)return;if(!b.intake)startIntake(b);else sms(b.phone,b.name,'Reminder: please fill in your intake form before your session with '+P[b.pid].first+': sfch.au/i/'+b.intake.tok,'out',{kind:'intake'});
  feed('intake','Sent '+b.name+' their intake form link.');save()},
 // payments
 payments:function(){return S.pay},
 payment:function(id){var x=S.pay.filter(function(p){return p.id===id})[0];return x?{pay:x,booking:bookingById(x.bid)||null}:null},
 cardOf:function(phone){return cardFor(phone)},
 setCard:function(phone,card){S.cards[normPhone(phone)]=card;save()},
 payLink:function(id){var x=S.pay.filter(function(p){return p.id===id})[0];if(!x||(x.status!=='due'&&x.status!=='failed'))return {ok:false};
  x.status='paid';x.paidAt=now();x.last4='4242';x.via='payment link';var b=bookingById(x.bid);
  sms(x.phone,x.name,'Paid: '+money(x.amount)+', thank you. Receipt: sfch.au/p/'+x.id,'out',{kind:'pay'});feed('pay',x.name+' paid '+money(x.amount)+' by payment link.');
  if(b&&x.kind==='session')claimMedicare(b);save();return {ok:true}},
 markPaid:function(id,how){var x=S.pay.filter(function(p){return p.id===id})[0];if(!x||(x.status!=='due'&&x.status!=='failed'))return;x.status='paid';x.paidAt=now();x.via=how||'in person';x.last4='';
  var b=bookingById(x.bid);if(b&&x.kind==='session')claimMedicare(b);feed('pay','Marked '+money(x.amount)+' from '+x.name+' as paid '+(how||'in person')+'.');save()},
 resendPay:function(id){var x=S.pay.filter(function(p){return p.id===id})[0];if(!x)return;sms(x.phone,x.name,'Hi '+x.name.split(' ')[0]+', just a gentle reminder about the '+money(x.amount)+' for your session with '+P[x.pid].first+'. You can pay here whenever suits: sfch.au/p/'+x.id+' If anything’s making it hard, give us a call and we’ll work it out.','out',{kind:'pay'});feed('pay','Resent the payment link to '+x.name+'.');save()},
 refund:function(id,why){var x=S.pay.filter(function(p){return p.id===id})[0];var r=refundPay(x,why);save();return r},
 feesToDecide:function(pid){return S.bookings.filter(function(b){return (b.lateFee&&b.status==='cancelled'||b.noShow&&b.noShowFee)&&!b.feeWaived&&!b.feeCharged&&(!pid||b.pid===pid)})},
 chargeFee:function(bid){var b=bookingById(bid);if(!b||b.feeCharged||b.feeWaived)return null;var fee=b.noShow?b.noShowFee:b.lateFee,dep=paidFor(b.id,'deposit');b.feeCharged=now();
  var x=charge(b,b.noShow?'noshow':'late',fee-dep,'under the cancellation policy');save();return x},
 waiveFee:function(bid,why){var b=bookingById(bid);if(!b||b.feeCharged)return;b.feeWaived=true;b.waivedWhy=why||'waived';var dep=paysFor(b.id).filter(function(x){return x.kind==='deposit'&&x.status==='paid'})[0];if(dep)refundPay(dep,'fee waived');
  feed('none','Waived the '+(b.noShow?'missed session':'late cancellation')+' fee for '+b.name+(why?' ('+why+')':'')+'.');save()},
 markNoShow:function(bid){var b=bookingById(bid);if(!b||b.noShow)return;b.noShow=true;b.noShowFee=lateFee(b.pid);b.billed=b.billed||now();
  var s=paysFor(b.id).filter(function(x){return x.kind==='session'&&x.status==='paid'})[0];if(s)refundPay(s,'session not attended');
  feed('none','Marked '+b.name+' as a no-show with '+P[b.pid].first+', '+fmtWhen(b.start)+'.'+(b.noShowFee?' Fee to decide.':''));save()},
 // inbox
 inbound:function(d){var th=inbound(d);save();return th},
 simulate:function(kind){var f=SAMPLES[kind];if(!f)return null;var d=f(apptPick());var th=inbound(d);save();return th},
 thread:function(id){return S.inbox.filter(function(x){return x.id===id})[0]||null},
 reply:function(id,d){var th=api.thread(id);if(!th||!d.text)return {ok:false};var ok=threadOut(th,d.channel,d.text,d.by,d.subject);if(!ok)return {ok:false,reason:'no '+(d.channel==='email'?'email':'mobile')};
  th.status=d.done?'done':'waiting';th.unread=false;feed('inbox','Replied to '+th.name+' by '+(d.channel==='email'?'email':'text')+(d.by==='claude'?' (Claude draft, checked by staff)':'')+'.',{tid:id});save();return {ok:true}},
 logCall:function(id,note){var th=api.thread(id);if(!th)return;th.msgs.push({id:uid(6),dir:'out',channel:'call',text:note||'Called back',by:'staff',at:now()});th.status='done';th.unread=false;th.urgent=false;
  feed('inbox','Called '+th.name+(note?': '+note:'')+'.',{tid:id});save()},
 setThread:function(id,patch){var th=api.thread(id);if(!th)return;Object.assign(th,patch);if(patch.status==='done')th.unread=false;save()},
 rematch:function(id){var th=api.thread(id);if(th){th.match=matchContact(th.phone,th.email);save()}},
 groupList:groupList,
 bulk:function(g,text,opts){opts=opts||{};var list=groupList(g),n=0,cx=0;
  list.forEach(function(r){var body=fill(text,r);if(r.phone){sms(r.phone,r.name,body,'out',{kind:'bulk'});n++}else if(r.email){S.mail.push({id:uid(6),to:r.email,name:r.name,subject:opts.subject||'A message from Surf Coast Family Hub',body:body,at:now()});n++}
   if(opts.cancel&&r.start){S.blocked[r.key]=1;if(r.bid){var b=bookingById(r.bid);if(b&&b.status==='booked')doCancel(b,'Practitioner unavailable',true)}var rr=S.rem[r.key];if(rr)rr.state='cancelled';cx++}});
  if(opts.cancel&&g.kind==='day'&&g.pid)daySlots(g.pid,new Date(g.date)).forEach(function(d){if(d.getTime()>now())S.blocked[slotKey(g.pid,d)]=1});
  if(opts.cancel)S.offers.forEach(function(o){if(S.blocked[o.key]&&['open','queued','approval'].indexOf(o.status)>=0){o.status='unfilled';o.withdrawn=true}});
  S.bcasts.unshift({id:uid(6),at:now(),label:opts.label||'Message',count:n,text:text,cancelled:cx});
  feed('send','Sent “'+(opts.label||'message')+'” to '+n+' '+(n===1?'person':'people')+(cx?', and cancelled '+cx+' appointment'+(cx>1?'s':'')+' (not offered to the waitlist)':'')+'.');save();return {ok:true,sent:n,cancelled:cx}},
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
 reset:function(){S=defaults();seedInbox();seedPay();S.inboxSeeded=1;try{localStorage.removeItem('scfh-demo-mine')}catch(e){}save();tick()},
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
   settings:S.settings,cancellationPolicy:policyText('adi'),waitlist:wl,upcomingAppointments:up,intakeForms:S.bookings.filter(function(b){return b.intake&&b.status==='booked'}).map(function(b){return {client:tok(b.name),with:first(b.pid),appt:loc(b.start),status:b.intake.status}}),freeTimes:free,onlineBookings:bk,refillOffers:of,referrals:refs,reminders:rem,
   last4Weeks:{note:'includes made-up sample history',appointments:rp.totals.booked,cancellations:rp.cancellations,refilled:rp.totals.refilled,fillRatePct:rp.fillRate,recovered:rp.totals.recovered,lost:rp.totals.lost,noShows:rp.totals.noshow,
    utilisationPct:rp.utilisation,reminders:{sent:rp.reminders.sent,confirmed:rp.reminders.confirmed,cantMakeIt:rp.reminders.cantMake},texts:rp.texts,lateFeesAllowedUnderPolicy:rp.totals.fees,referrals:rp.referrals,
    waitlistNow:{active:rp.waitlist.active,paused:rp.waitlist.paused,medianDaysWaiting:rp.waitlist.medianDays},byPractitioner:rp.byPract.map(function(r){return {who:r.first,booked:r.booked,lateCancels:r.late,earlyCancels:r.early,noShows:r.noshow,refilled:r.refilled,recovered:r.recovered,video:r.video}})},
   payments:(function(){var m=report(28).money;return {last4Weeks:m,note:'amounts only; no card details'}})(),
   inbox:{note:'counts only; message text is never included here',open:S.inbox.filter(function(x){return x.status==='open'}).length,urgent:S.inbox.filter(function(x){return x.urgent&&x.status!=='done'}).length,
    waitingOnClient:S.inbox.filter(function(x){return x.status==='waiting'}).length,threads:S.inbox.slice(0,30).map(function(x){return {from:tok(x.name),channel:x.msgs[x.msgs.length-1].channel,topic:x.label,status:x.status,urgent:x.urgent||undefined,received:loc(x.updated),messages:x.msgs.length}})},
   groupMessages:S.bcasts.slice(0,10).map(function(b){return {sent:loc(b.at),what:b.label,people:b.count,appointmentsCancelled:b.cancelled||undefined}}),
   activity:S.feed.slice(0,60).map(function(f){return loc(f.at)+' '+scrub(f.text)}),textsSent:S.sms.filter(function(m){return m.dir==='out'}).length};
  return {data:data,names:names,scrub:scrub}},
 on:function(f){subs.push(f)}
};
if(!S.inboxSeeded){seedInbox();seedPay();S.inboxSeeded=1;try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
window.HUB={P:P,ORDER:ORDER,photo:photo,SITE:SITE,api:api,fmt:{time:fmtTime,day:fmtDay,when:fmtWhen,money:money,esc:esc,DAY:DAY,MON:MON},serviceName:serviceName,lenOf:lenOf,now:now,slotKey:slotKey,VALUE:VALUE};
})();
