/* Shared inbox: texts, emails, voicemail, missed calls and website enquiries, matched to clients.
   Claude drafts replies on request; staff check and send. Group and custom messages from "New message". */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api;
var IC={sms:'<path d="M4 5.5h16v10.5H10l-5 4v-4H4z"/>',email:'<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',voicemail:'<circle cx="7" cy="12" r="3.5"/><circle cx="17" cy="12" r="3.5"/><path d="M7 15.5h10"/>',
 call:'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',form:'<rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 9h6M9 12.5h6M9 16h4"/>',
 spark:'<path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.9z"/>',warn:'<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.5h.01"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
 x:'<path d="M6 6l12 12M18 6 6 18"/>',send:'<path d="M4 12l16-8-6 16-2.5-6.5z"/>',play:'<path d="M8 5.5v13l10-6.5z"/>',cal:'<rect height="15" rx="2.5" width="17" x="3.5" y="5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
 users:'<circle cx="9" cy="8.5" r="3"/><path d="M3 19c1-3.4 3.3-5.3 6-5.3s5 1.9 6 5.3M15.5 5.6a3 3 0 0 1 0 5.8M17 13.9c2 .6 3.4 2.4 4 5.1"/>',file:'<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
 back:'<path d="M15 6l-6 6 6 6"/>'};
function svg(k){return '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}
function $(id){return document.getElementById(id)}
function ago(t){var s=Math.round((H.now()-t)/1000);if(s<60)return 'now';var m=Math.round(s/60);if(m<60)return m+'m';var h=Math.round(m/60);if(h<24)return h+'h';return Math.round(h/24)+'d'}
function when(t){return F.day(t)+', '+F.time(new Date(t))}
var CH={sms:'Text',email:'Email',voicemail:'Voicemail',call:'Missed call',form:'Website enquiry'};
var TAB='open',CUR=null,Q='';
var DRAFTS={};   // per-thread composer state survives re-renders
function threads(){return api.state().inbox.slice().sort(function(a,b){return (b.urgent&&b.status!=='done')-(a.urgent&&a.status!=='done')||b.updated-a.updated})}
function inTab(t){return TAB==='all'||(TAB==='urgent'?t.urgent&&t.status!=='done':t.status===TAB)}

function tabs(){var l=threads(),n=function(f){return l.filter(f).length};
 var T=[['open','Needs reply',n(function(t){return t.status==='open'})],['urgent','Urgent',n(function(t){return t.urgent&&t.status!=='done'})],['waiting','Waiting on client',n(function(t){return t.status==='waiting'})],['done','Done',0],['all','All',0]];
 $('ibTabs').innerHTML=T.map(function(x){return '<button type="button" role="tab" data-tab="'+x[0]+'" aria-selected="'+(TAB===x[0])+'"'+(x[0]==='urgent'&&x[2]?' class="u"':'')+'>'+x[1]+(x[2]?' <em>'+x[2]+'</em>':'')+'</button>'}).join('')}
function list(){var l=threads().filter(inTab).filter(function(t){if(!Q)return true;return (t.name+' '+t.phone+' '+t.email+' '+t.msgs.map(function(m){return m.text}).join(' ')).toLowerCase().indexOf(Q)>=0});
 $('ibList').innerHTML=l.map(function(t){var m=t.msgs[t.msgs.length-1],last=t.msgs.filter(function(x){return x.dir==='in'}).slice(-1)[0]||m;
  return '<li><button type="button" class="ib-row'+(t.id===CUR?' on':'')+(t.unread?' unread':'')+(t.urgent&&t.status!=='done'?' urg':'')+'" data-open="'+t.id+'"><span class="ib-ch">'+svg(last.channel)+'</span><div><b>'+esc(t.name)+'</b><span class="ib-pv">'+esc(last.channel==='call'?'Missed call, no message':(last.subject?last.subject+' · ':'')+(last.text||''))+'</span><span class="ib-meta"><i class="ib-topic t-'+t.intent+'">'+esc(t.label)+'</i>'+(t.status==='waiting'?'<i>Replied</i>':'')+(t.assigned?'<i>'+esc(t.assigned==='front'?'Front desk':(P[t.assigned]||{}).first||t.assigned)+'</i>':'')+'</span></div><time>'+ago(t.updated)+'</time></button></li>'}).join('')||
  '<li class="adm-empty">'+(TAB==='open'?'All caught up. Nothing needs a reply.':'Nothing here.')+'</li>'}

function matchChips(t){return (t.match||[]).map(function(m){
 if(m.kind==='booking')return '<a class="ib-chip ok" href="manage.html#t='+m.token+'" target="_blank" rel="noopener">'+svg('cal')+'Booked with '+esc(P[m.pid].first)+', '+esc(when(m.start))+(m.mode&&m.mode!=='in'?' ('+m.mode+')':'')+'</a>';
 if(m.kind==='appt')return '<span class="ib-chip ok">'+svg('cal')+esc(m.name)+' · '+esc(P[m.pid].first)+', '+esc(when(m.start))+' (Halaxy)</span>';
 if(m.kind==='waitlist')return '<span class="ib-chip">'+svg('users')+'On the waitlist: '+esc(m.need)+' with '+esc(m.pids.map(function(x){return P[x].first}).join(', '))+'</span>';
 if(m.kind==='referral')return '<span class="ib-chip">'+svg('file')+'Referral from '+esc(m.from)+' · '+esc({new:'not actioned',invited:'booking link sent',booked:'booked'}[m.status]||m.status)+'</span>';
 return ''}).join('')||'<span class="ib-chip new">New contact</span>'}
function bubble(m){var by=m.dir==='out'?(m.by==='auto'?'Automatic reply':m.by==='claude'?'Drafted by Claude, checked by staff':'Staff'):'';
 if(m.channel==='call'&&m.dir==='in')return '<div class="ib-sys">'+svg('call')+'Missed call · '+esc(when(m.at))+'</div>';
 if(m.channel==='call')return '<div class="ib-sys out">'+svg('call')+'Called back: '+esc(m.text)+' · '+esc(when(m.at))+'</div>';
 var vm=m.channel==='voicemail'?'<div class="ib-vm"><button type="button" class="ib-play" data-play title="Play (demo)">'+svg('play')+'</button><span class="ib-wave" aria-hidden="true"></span><b>0:'+('0'+m.dur).slice(-2)+'</b></div><small class="ib-tr">Transcript</small>':'';
 return '<div class="ib-msg '+m.dir+' c-'+m.channel+'"><div class="ib-mh">'+svg(m.channel)+'<span>'+CH[m.channel]+(by?' · '+by:'')+'</span><time>'+esc(when(m.at))+'</time></div>'+(m.subject?'<b class="ib-subj">'+esc(m.subject)+'</b>':'')+vm+'<p>'+esc(m.text).replace(/\n/g,'<br>')+'</p></div>'}

var TPL=[['','Templates…'],
 ['book','Book online','Hi {first}, thanks for getting in touch. You can see everyone’s next free times and book online here: [BOOK_LINK]. Or call us on 0491 184 788 and we’ll help you choose.'],
 ['callback','We’ll call you','Hi {first}, thanks for your message. We’ll give you a call today. If there’s a better time, just reply with it.'],
 ['move','Move a booking','Hi {first}, no problem. You can move it to any free time here: [MANAGE_LINK], or reply with a day and time that suits and we’ll sort it.'],
 ['cancel','Cancel (sick)','Sorry to hear that, {first}. Get well soon. You can cancel or move it here: [MANAGE_LINK]. Letting us know means someone on the waitlist can have the time.'],
 ['fees','Fees','Hi {first}, our fees and Medicare rebates for each practitioner are here: [FEES_LINK]. Happy to talk it through on 0491 184 788.'],
 ['plan','Send the plan','Hi {first}, could you ask your GP to email your Mental Health Treatment Plan to hello@surfcoastfamilyhub.com.au before your first session? You can also upload it from your booking page.'],
 ['waitlist','Waitlist updated','Thanks {first}, we’ve updated your waitlist details. We’ll text you as soon as a spot opens.']];
function first(t){var n=(t.name||'').split(' ')[0];return /^0|^\+|@/.test(n)?'there':n}
function links(t,s){var b=(t.match||[]).filter(function(m){return m.kind==='booking'})[0],r=(t.match||[]).filter(function(m){return m.kind==='referral'})[0],ref=r&&api.state().referrals.filter(function(x){return x.id===r.id})[0];
 return s.replace(/\[BOOK_LINK\]/g,ref&&ref.status==='invited'?'sfch.au/b/'+ref.tok:'sfch.au/book').replace(/\[MANAGE_LINK\]/g,b?'sfch.au/m/'+b.token:'sfch.au/book').replace(/\[FEES_LINK\]/g,'surfcoastfamilyhub.com.au/fees').replace(/\{first\}/g,first(t)).replace(/\[CLIENT\]/g,first(t))}

function view(){var t=CUR&&api.thread(CUR),el=$('ibMain');document.body.classList.toggle('ib-reading',!!t);
 if(!t){el.innerHTML='<div class="ib-none">'+svg('sms')+'<p>Pick a conversation.</p><small>Texts, emails, voicemails, missed calls and website enquiries all land here, matched to the client.</small></div>';return}
 if(t.unread){t.unread=false;api.setThread(t.id,{unread:false});return}
 var d=DRAFTS[t.id]||(DRAFTS[t.id]={channel:t.email&&!t.phone?'email':'sms',text:'',subject:'',by:'staff',meta:null}),hasB=(t.match||[]).some(function(m){return m.kind==='booking'||m.kind==='appt'});
 var staff=[['','Unassigned'],['front','Front desk'],['adi','Adi (director)']].concat(H.ORDER.filter(function(x){return P[x].live&&!P[x].leave&&x!=='adi'}).map(function(x){return [x,P[x].first]}));
 var tel=(t.phone||'').replace(/\s/g,'');
 el.innerHTML='<div class="ib-head"><button type="button" class="ib-backb" data-close-thread>'+svg('back')+'All messages</button><div class="ib-who"><span class="adm-wa adm-wa-lg">'+esc((t.name||'?')[0])+'</span><div><h1>'+esc(t.name)+'</h1><p>'+(t.name===t.phone||t.name===t.email?'Not in the Hub’s records yet':[t.phone,t.email].filter(Boolean).map(esc).join(' · '))+'</p></div></div>'+
  '<div class="ib-ctl"><label><span class="sr">Status</span><select data-status>'+[['open','Needs reply'],['waiting','Waiting on client'],['done','Done']].map(function(o){return '<option value="'+o[0]+'"'+(t.status===o[0]?' selected':'')+'>'+o[1]+'</option>'}).join('')+'</select></label>'+
  '<label><span class="sr">Assigned to</span><select data-assign>'+staff.map(function(o){return '<option value="'+o[0]+'"'+(t.assigned===o[0]?' selected':'')+'>'+o[1]+'</option>'}).join('')+'</select></label></div></div>'+
  '<div class="ib-chips"><i class="ib-topic t-'+t.intent+'">'+esc(t.label)+'</i>'+matchChips(t)+'</div>'+
  (t.urgent&&t.status!=='done'?'<div class="ib-urgent">'+svg('warn')+'<div><b>This may be a safety concern. Call '+esc(first(t)==='there'?'them':first(t))+' now.</b><span>An automatic reply with 000 and Lifeline went out straight away. Follow the safety steps in the SOP and tell their practitioner or Adi today. Claude won’t draft replies here.</span></div>'+(tel?'<a class="btn btn-primary btn-sm" href="tel:'+tel+'">'+svg('call')+'Call '+esc(t.phone)+'</a>':'')+'</div>':'')+
  '<div class="ib-thread">'+t.msgs.map(bubble).join('')+'</div>'+
  '<div class="ib-acts">'+(tel?'<a class="adm-ghost" href="tel:'+tel+'">'+svg('call')+'Call</a>':'')+'<button type="button" class="adm-ghost" data-logcall>Log a call</button>'+
   (hasB?'<button type="button" class="adm-ghost" data-cxappt>Cancel their appointment</button>':'')+
   (t.phone&&!t.urgent&&!(t.match||[]).some(function(m){return m.kind==='waitlist'})?'<button type="button" class="adm-ghost" data-addwl>Add to waitlist</button>':'')+'</div>'+
  '<details class="ib-note"'+(t.note?' open':'')+'><summary>Staff note</summary><textarea id="ibNote" rows="2" maxlength="500" placeholder="Admin details only, never clinical notes.">'+esc(t.note||'')+'</textarea></details>'+
  composer(t,d);
 var th=el.querySelector('.ib-thread');th.scrollTop=th.scrollHeight;
 var note=$('ibNote'),tm;note.addEventListener('input',function(){clearTimeout(tm);tm=setTimeout(function(){api.setThread(t.id,{note:note.value})},500)});
 bindComposer(t,d)}
function composer(t,d){var canS=!!t.phone,canE=!!t.email,urg=t.urgent&&t.status!=='done';
 return '<form class="ib-comp" id="ibComp"><div class="ib-ct"><div class="adm-seg" role="group" aria-label="Reply by">'+(canS?'<button type="button" data-ch="sms" aria-pressed="'+(d.channel==='sms')+'">'+svg('sms')+'Text</button>':'')+(canE?'<button type="button" data-ch="email" aria-pressed="'+(d.channel==='email')+'">'+svg('email')+'Email</button>':'')+'</div>'+
  '<label><span class="sr">Template</span><select data-tpl>'+TPL.map(function(x){return '<option value="'+x[0]+'">'+x[1]+'</option>'}).join('')+'</select></label>'+
  '<button type="button" class="adm-ghost ib-draft" data-draft'+(urg?' disabled title="Write this one yourself"':'')+'>'+svg('spark')+'Draft with Claude</button></div>'+
  (d.meta?'<div class="ib-dmeta">'+svg('spark')+'<div><b>'+esc(d.meta.summary||'')+'</b>'+(d.meta.staffNote?'<span>Check: '+esc(d.meta.staffNote)+'</span>':'')+(d.meta.urgent?'<span class="u">Claude thinks this may be urgent. Call them.</span>':'')+'</div></div>':'')+
  (d.channel==='email'?'<label class="ib-subjf"><span class="sr">Subject</span><input id="ibSubj" placeholder="Subject" value="'+esc(d.subject||('Re: '+(t.subject||'Your message to Surf Coast Family Hub')))+'"></label>':'')+
  '<label><span class="sr">Reply</span><textarea id="ibText" rows="'+(d.channel==='email'?7:3)+'" placeholder="'+(canS||canE?'Write a reply, pick a template, or ask Claude for a draft':'No mobile or email for this person. Call them instead.')+'">'+esc(d.text)+'</textarea></label>'+
  '<div class="ib-cf"><span id="ibCount"></span><p class="bk-err" role="alert" hidden></p><button type="submit" class="btn btn-outline btn-sm" data-done="0">Send</button><button type="submit" class="btn btn-primary btn-sm" data-done="1">'+svg('send')+'Send and mark done</button></div></form>'}
function bindComposer(t,d){var f=$('ibComp'),ta=$('ibText');
 function count(){var n=ta.value.length;$('ibCount').textContent=d.channel==='sms'?n+' characters · '+(n<=160?1:Math.ceil(n/153))+' text'+(n>160?'s':''):n?n+' characters':''}
 ta.addEventListener('input',function(){d.text=ta.value;if(d.by==='claude'&&!d.edited)d.edited=true;count()});count();
 var sj=$('ibSubj');if(sj)sj.addEventListener('input',function(){d.subject=sj.value});
 f.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
  if(b.dataset.ch){d.channel=b.dataset.ch;view();return}
  if('draft' in b.dataset){draft(t,d,b);return}});
 f.querySelector('[data-tpl]').addEventListener('change',function(){var x=TPL.filter(function(r){return r[0]===this.value},this)[0];if(x&&x[2]){d.text=links(t,x[2]);d.by='staff';d.meta=null;view()}});
 f.addEventListener('submit',function(e){e.preventDefault();var done=e.submitter&&e.submitter.dataset.done==='1',err=f.querySelector('.bk-err');
  var text=links(t,ta.value.trim());if(!text){err.textContent='Write a reply first.';err.hidden=false;return}
  delete DRAFTS[t.id];
  var r=api.reply(t.id,{channel:d.channel,text:text,subject:d.subject||(sj&&sj.value),by:d.by==='claude'?'claude':'staff',done:done});
  if(!r.ok){DRAFTS[t.id]=d;view();toast('Can’t send: '+r.reason+'.');return}
  toast(done?'Sent and marked done.':'Sent.')})}

// ---------- Claude drafts ----------
// What's sent: the conversation with the client's name, numbers and emails taken out, plus public Hub facts
// (team, fees, next free times, policy). Never the waitlist, other clients, notes or referral reasons.
var FEES={adi:'$245, Medicare rebate $149.05 with a plan',hannah:'$245, rebate $149.05',melinda:'$235, rebate $149.05',ellie:'$170, rebate $101.55',maddy:'$200, rebate $101.55',
 'michelle-ferris':'counselling $215 (rebate $89.50); couples $245 for 60 min, no rebate',laura:'massage $65 for 30 min, $120 for 60 min, health fund rebates, HICAPS',kate:'acupuncture $150 first visit, $110 follow-up',
 anna:'osteopathy $190 new patient, $140 return',meaghan:'child and teen therapy $180, no Medicare rebate; assessments quoted',jodie:'$120 for 60 min; NDIS',
 'michelle-joseph':'art therapy $220 (rebate $89.50)'};
function hubFacts(t){var free={};H.ORDER.forEach(function(id){var p=P[id];if(p.live&&!p.leave)free[p.first]=[]});
 return api.slots(H.ORDER.filter(function(id){return P[id].live&&!P[id].leave}),42).then(function(sl){Object.keys(sl).forEach(function(id){free[P[id].first]=sl[id].slice(0,4).map(function(x){return F.day(x,1)+' '+F.time(x)})});
  var m=(t.match||[]).map(function(x){return x.kind==='booking'||x.kind==='appt'?'Has an appointment with '+P[x.pid].first+', '+when(x.start)+(x.mode&&x.mode!=='in'?' ('+x.mode+')':' (in person)')+(x.kind==='booking'?'. They can change it at [MANAGE_LINK].':'.'):
   x.kind==='waitlist'?'Is on the waitlist for '+x.need+' with '+x.pids.map(function(p){return P[p].first}).join(', ')+'.':x.kind==='referral'?'Was referred by a health professional'+(x.pids.length?' to '+x.pids.map(function(p){return P[p].first}).join(', '):'')+'; status: '+x.status+'.':''}).filter(Boolean);
  return {now:when(H.now()),openingHours:'Mon to Fri, 9am to 5pm. Phone 0491 184 788. Not a crisis service.',address:'16 Princes Tce, Jan Juc VIC 3228',
   team:H.ORDER.filter(function(id){return !P[id].leave}).map(function(id){var p=P[id];return {name:p.name,role:p.role,about:p.why,booking:p.live?'online through the Hub':p.contact?'call the Hub':'their own booking site',fees:FEES[id]||undefined,note:p.note||undefined,
    usualStartTimes:p.sched?Object.keys(p.sched).map(function(k){return F.DAY[k]+' '+p.sched[k].join(', ')}).join('; '):undefined,bookedOutUntil:p.openFrom||undefined}}),
   clientName:first(t)==='there'?'unknown, so greet them without a name':'known; write [CLIENT] for their first name',
   nextFreeTimes:free,medicare:'With a Mental Health Treatment Plan from their regular GP, clients get a rebate for up to 10 psychology sessions a year. Couples sessions have no rebate. Bulk billing is not listed, so do not offer it.',
   telehealth:'Most psychology and counselling can be by video or phone.',cancellationPolicy:api.policy('adi').text,thisClient:m.length?m:['No booking, waitlist place or referral found for this number.']}})}
function scrubText(s,t){var n=(t.name||'').trim(),f=n.split(' ')[0];
 if(n&&!/^0|^\+|@/.test(n)){s=s.split(n).join('[CLIENT]');if(f.length>2)s=s.replace(new RegExp('\\b'+f.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','g'),'[CLIENT]')}
 return s.replace(/\b0[2-478](?:[ -]?\d){8}\b/g,'[phone]').replace(/\+61[\d ]{9,12}/g,'[phone]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,'[email]')}
function draft(t,d,btn){btn.disabled=true;btn.innerHTML='<span class="ib-spin"></span>Drafting…';
 hubFacts(t).then(function(hub){
  var convo=t.msgs.filter(function(m){return m.text}).map(function(m){return {from:m.dir==='in'?'client':'hub',channel:m.channel,at:when(m.at),text:scrubText((m.subject?'Subject: '+m.subject+'\n':'')+m.text,t)}});
  return fetch(H.SITE+'api/hub/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channel:d.channel,conversation:convo,hub:hub})})})
 .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Couldn’t get a draft.');return j})})
 .then(function(j){d.text=links(t,j.reply||'');d.by='claude';d.edited=false;d.meta={summary:j.topic?j.topic+': '+j.summary:j.summary,staffNote:j.staffNote,urgent:j.urgent};
  if(j.urgent&&!t.urgent)api.setThread(t.id,{urgent:true});view();var ta=$('ibText');if(ta)ta.focus()})
 .catch(function(e){btn.disabled=false;btn.innerHTML=svg('spark')+'Draft with Claude';toast(e.message||'Couldn’t get a draft.')})}

// ---------- new and group messages ----------
var GTPL=[['custom','Write my own',''],
 ['sick','Practitioner unwell (cancel their day)','Hi {first}, it’s Surf Coast Family Hub. Sorry, {practitioner} is unwell {day}, so your {time} session is cancelled at no cost. Pick a new time here: {link} or reply and we’ll help.'],
 ['late','Practitioner running late','Hi {first}, {practitioner} is running about 20 minutes behind today. Sorry for the wait. No need to reply.'],
 ['closure','Hub closed or moved','Hi {first}, a heads-up from Surf Coast Family Hub: {practitioner} will see you by video {day} at {time} instead of at the Hub. We’ll text the link. Reply if that doesn’t work.'],
 ['wl','Waitlist news','Hi {first}, good news from Surf Coast Family Hub: we’ve opened more times. See them and book here: {link}. Reply STOP to leave the waitlist.']];
var G={kind:'day',pid:'',date:'',tpl:'custom',text:'',cancel:false,name:'',phone:'',email:''};
function newMsg(){var dates=[];for(var i=0;i<14;i++){var d=new Date(H.now());d.setHours(0,0,0,0);d.setDate(d.getDate()+i);if(d.getDay()>0)dates.push(d)}
 if(!G.date)G.date=dates[0].toISOString();if(!G.pid)G.pid='hannah';
 var live=H.ORDER.filter(function(id){return P[id].live&&!P[id].leave});
 var g=G.kind==='person'?{kind:'person',name:G.name,phone:G.phone,email:G.email}:{kind:G.kind,pid:G.kind==='week'?'':G.pid,date:G.date};
 var rec=G.kind==='person'?[]:api.groupList(g);
 $('ibNewBody').innerHTML='<div class="adm-dwh"><div><h2 id="ibNewH">New message</h2><p>To one person, or everyone affected by a change</p></div><button type="button" class="adm-x" data-x aria-label="Close">'+svg('x')+'</button></div>'+
  '<form class="ib-nf" id="ibNF"><fieldset><legend>Send to</legend><div class="adm-seg" role="group">'+[['day','Clients on a day'],['week','Everyone booked this week'],['waitlist','The waitlist'],['person','One person']].map(function(o){return '<button type="button" data-gk="'+o[0]+'" aria-pressed="'+(G.kind===o[0])+'">'+o[1]+'</button>'}).join('')+'</div>'+
  (G.kind==='day'?'<div class="ib-row2"><label>Practitioner<select data-g="pid">'+live.map(function(id){return '<option value="'+id+'"'+(G.pid===id?' selected':'')+'>'+esc(P[id].name)+'</option>'}).join('')+'</select></label><label>Day<select data-g="date">'+dates.map(function(d){return '<option value="'+d.toISOString()+'"'+(G.date===d.toISOString()?' selected':'')+'>'+esc(F.day(d,1))+'</option>'}).join('')+'</select></label></div>':'')+
  (G.kind==='waitlist'?'<div class="ib-row2"><label>For<select data-g="pid"><option value="">Everyone on the waitlist</option>'+live.map(function(id){return '<option value="'+id+'"'+(G.pid===id?' selected':'')+'>Waiting for '+esc(P[id].first)+'</option>'}).join('')+'</select></label></div>':'')+
  (G.kind==='person'?'<div class="ib-row2"><label>Name<input data-g="name" value="'+esc(G.name)+'"></label><label>Mobile<input data-g="phone" inputmode="tel" placeholder="04xx xxx xxx" value="'+esc(G.phone)+'"></label></div>':'')+
  (G.kind!=='person'?'<p class="ib-rec">'+svg('users')+'<span><b>'+rec.length+' '+(rec.length===1?'person':'people')+'</b>'+(rec.length?': '+esc(rec.slice(0,5).map(function(r){return r.name+(r.start?' ('+F.time(r.start)+')':'')}).join(', '))+(rec.length>5?' and '+(rec.length-5)+' more':''):'')+'</span></p>':'')+'</fieldset>'+
  '<label class="ib-full">Message<select data-gtpl>'+GTPL.filter(function(x){return G.kind==='waitlist'?x[0]!=='sick'&&x[0]!=='late'&&x[0]!=='closure':x[0]!=='wl'}).map(function(x){return '<option value="'+x[0]+'"'+(G.tpl===x[0]?' selected':'')+'>'+x[1]+'</option>'}).join('')+'</select></label>'+
  '<label class="ib-full"><span class="sr">Text</span><textarea data-g="text" rows="5" placeholder="Type your message. {first}, {practitioner}, {day}, {time} and {link} fill in for each person.">'+esc(G.text)+'</textarea></label>'+
  (rec[0]&&G.text?'<div class="ib-prev"><small>Preview for '+esc(rec[0].name)+'</small><p>'+esc(G.text.replace(/\{first\}/g,rec[0].name.split(' ')[0]).replace(/\{practitioner\}/g,rec[0].pid?P[rec[0].pid].first:'your practitioner').replace(/\{time\}/g,rec[0].start?F.time(rec[0].start):'').replace(/\{day\}/g,rec[0].start?(F.day(rec[0].start,1)==='Today'?'today':'on '+F.day(rec[0].start,1)):'').replace(/\{link\}/g,'sfch.au/book'))+'</p></div>':'')+
  (G.kind==='day'?'<label class="bk-check"><input type="checkbox" data-g="cancel"'+(G.cancel?' checked':'')+'><span>Also cancel these appointments and block '+esc(P[G.pid].first)+'’s times that day. They won’t be offered to the waitlist.</span></label>':'')+
  '<p class="ib-legal">Service messages only (changes to bookings, closures, waitlist news). Promotions and newsletters need people’s consent first and an unsubscribe.</p>'+
  '<p class="bk-err" role="alert" hidden></p><div class="ib-cf"><button type="submit" class="btn btn-primary">'+svg('send')+'Send'+(G.kind==='person'?'':' to '+rec.length)+'</button></div></form>'}
function openNew(){var dl=$('ibNew');newMsg();if(!dl.open)dl.showModal()}
$('ibNew').addEventListener('click',function(e){var b=e.target.closest('button');if(e.target===$('ibNew')||(b&&'x' in b.dataset)){$('ibNew').close();return}
 if(b&&b.dataset.gk){G.kind=b.dataset.gk;if(G.kind==='waitlist'){G.pid='';if(G.tpl!=='custom'&&G.tpl!=='wl'){G.tpl='custom';G.text=''}}else if(G.tpl==='wl'){G.tpl='custom';G.text=''}if(G.kind!=='waitlist'&&!G.pid)G.pid='hannah';newMsg()}});
$('ibNew').addEventListener('change',function(e){var x=e.target;if(x.dataset.gtpl!=null){G.tpl=x.value;var tp=GTPL.filter(function(r){return r[0]===x.value})[0];G.text=tp?tp[2]:'';if(G.tpl==='sick')G.cancel=true;newMsg();return}
 if(x.dataset.g){G[x.dataset.g]=x.type==='checkbox'?x.checked:x.value;if(x.dataset.g!=='text'&&x.dataset.g!=='name'&&x.dataset.g!=='phone')newMsg()}});
$('ibNew').addEventListener('input',function(e){var x=e.target;if(x.dataset.g==='text'||x.dataset.g==='name'||x.dataset.g==='phone')G[x.dataset.g]=x.value});
$('ibNew').addEventListener('submit',function(e){e.preventDefault();var err=$('ibNF').querySelector('.bk-err');
 if(!G.text.trim()){err.textContent='Write a message first.';err.hidden=false;return}
 if(G.kind==='person'){if(!/^(\+?61|0)4[\d ]{8,11}$/.test(G.phone.replace(/\s/g,''))){err.textContent='Add an Australian mobile.';err.hidden=false;return}
  var th=api.inbound({channel:'sms',phone:G.phone,name:G.name,text:''});th.msgs.pop();api.reply(th.id,{channel:'sms',text:G.text.replace(/\{first\}/g,(G.name||'there').split(' ')[0]),by:'staff'});
  $('ibNew').close();CUR=th.id;TAB='waiting';G.text='';all();toast('Sent.');return}
 var g={kind:G.kind,pid:G.kind==='week'?'':G.pid,date:G.date},n=api.groupList(g).length;if(!n){err.textContent='Nobody to send to.';err.hidden=false;return}
 if(G.cancel&&G.kind==='day'&&!confirm('Cancel '+n+' appointment'+(n>1?'s':'')+' and block '+P[G.pid].first+'’s day?'))return;
 var label=(GTPL.filter(function(r){return r[0]===G.tpl})[0]||[0,'Message'])[1].replace(/ \(.*\)$/,'');
 var r=api.bulk(g,G.text,{label:label,cancel:G.kind==='day'&&G.cancel});$('ibNew').close();G.text='';G.tpl='custom';G.cancel=false;
 toast('Sent to '+r.sent+(r.sent===1?' person':' people')+(r.cancelled?'. Cancelled '+r.cancelled+' appointment'+(r.cancelled>1?'s':'')+'.':'.'))});

// ---------- events ----------
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b||b.closest('#ibNew')||b.closest('#ibComp'))return;var d=b.dataset;
 if(d.tab){TAB=d.tab;all();return}
 if(d.open){CUR=d.open;try{history.replaceState(null,'','#t='+CUR)}catch(x){}all();return}
 if('closeThread' in d){CUR=null;try{history.replaceState(null,'',location.pathname)}catch(x){}all();return}
 if('new' in d){openNew();return}
 if('play' in d){toast('Demo: in the live system this plays the recording.');return}
 if('logcall' in d){var n=prompt('What happened on the call? (admin details only)','Called back, booked in');if(n!==null){api.logCall(CUR,n);toast('Call logged, marked done.')}return}
 if('cxappt' in d){var t=api.thread(CUR),m=(t.match||[]).filter(function(x){return x.kind==='booking'||x.kind==='appt'})[0];if(!m||!confirm('Cancel '+t.name+'’s appointment with '+P[m.pid].first+', '+when(m.start)+'? The time goes to the waitlist.'))return;
  if(m.kind==='booking')api.cancel(m.token,'Cancelled by staff (message)');else api.simulateCancel(m.pid,new Date(m.start));setTimeout(function(){api.rematch(CUR);toast('Cancelled. Offering the time to the waitlist.')},450);return}
 if('addwl' in d){var t2=api.thread(CUR);window.open('book.html','_blank');toast('Opened the booking page: add '+first(t2)+' to the waitlist from there.');return}});
$('ibMain').addEventListener('change',function(e){var x=e.target;if(x.dataset.status!=null)api.setThread(CUR,{status:x.value,urgent:x.value==='done'?false:api.thread(CUR).urgent});if(x.dataset.assign!=null){api.setThread(CUR,{assigned:x.value});toast(x.value?'Assigned.':'Unassigned.')}});
$('ibQ').addEventListener('input',function(){Q=this.value.trim().toLowerCase();list()});
$('ibSim').addEventListener('change',function(){var k=this.value;this.value='';if(!k)return;var th=api.simulate(k);if(th){CUR=th.id;TAB=th.urgent?'urgent':th.status==='done'?'done':'open';all();toast(th.urgent?'Urgent message: safety reply sent automatically.':'New '+(CH[th.msgs[th.msgs.length-1].channel]||'message').toLowerCase()+' from '+th.name+'.')}});
var tt;function toast(t){var el=$('admToast');if(!el){el=document.createElement('div');el.id='admToast';el.className='adm-toast';el.setAttribute('role','status');document.body.appendChild(el)}el.textContent=t;el.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){el.classList.remove('on')},3600)}
function all(){tabs();list();var a=document.activeElement;if(a&&(a.id==='ibText'||a.id==='ibNote'||a.id==='ibSubj'))return;view()}
var h=location.hash.match(/t=(t\w+)/);if(h&&api.thread(h[1]))CUR=h[1];
api.on(all);all();setInterval(function(){list()},30000);
})();
