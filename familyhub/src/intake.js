/* Intake form for new clients (demo backend in hub-core.js). Saves as you go; submit signs the consent. */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api,box=document.getElementById('rf');
var IC={check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',card:'<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',cal:'<rect height="15" rx="2.5" width="17" x="3.5" y="5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'};
function svg(k){return '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}
var tok=(location.hash.match(/t=([a-z0-9]+)/i)||[])[1],it=tok&&api.intake(tok);
if(!it){box.innerHTML='<h2 class="fd-q">We couldn’t find that form</h2><p class="fd-sub">The link may be old. Call us on <a href="tel:0491184788">0491 184 788</a> and we’ll send a new one.</p><p class="bk-demo">Demo: book a first appointment on the <a href="book.html">booking page</a>, then use the intake link on the confirmation.</p>';return}
var b=it.booking,p=P[b.pid],kid=!!b.child,tele=b.mode==='video'||b.mode==='phone',D=Object.assign({},it.data),pol=api.policy(b.pid),medi=b.plan==='yes';
if(!D.name)D.name=b.name;if(!D.mobile)D.mobile=b.phone;if(!D.email)D.email=b.email||'';if(kid&&!D.childFirst)D.childFirst=b.child;
function f(id,label,type,o){o=o||{};var v=D[id]||'';return '<label class="bk-f'+(o.cls?' '+o.cls:'')+'"><span>'+label+(o.opt?' <i>(optional)</i>':'')+'</span>'+
 (type==='textarea'?'<textarea id="'+id+'" rows="'+(o.rows||4)+'" maxlength="'+(o.max||2000)+'"'+(o.ph?' placeholder="'+o.ph+'"':'')+'>'+esc(v)+'</textarea>':
  type==='select'?'<select id="'+id+'"><option value="">Choose…</option>'+o.opts.map(function(x){return '<option'+(v===x?' selected':'')+'>'+esc(x)+'</option>'}).join('')+'</select>':
  '<input id="'+id+'" type="'+type+'" value="'+esc(v)+'" autocomplete="'+(o.ac||'off')+'"'+(o.ph?' placeholder="'+o.ph+'"':'')+(o.im?' inputmode="'+o.im+'"':'')+(o.max?' maxlength="'+o.max+'"':'')+'>')+(o.hint?'<small>'+o.hint+'</small>':'')+'</label>'}
function pills(k,opts){return '<div class="fd-pills" role="group">'+opts.map(function(o){return '<button type="button" class="fd-pill" data-k="'+k+'" data-v="'+o[0]+'" aria-pressed="'+(D[k]===o[0])+'">'+o[1]+'</button>'}).join('')+'</div>'}
function ck(id,html){return '<label class="bk-check"><input type="checkbox" id="'+id+'"'+(D[id]?' checked':'')+'><span>'+html+'</span></label>'}
var SECS=['You','Emergency contact','GP','Medicare and payment','Before you come','Consent'];
function render(){var done=it.status==='done';
 box.innerHTML='<div class="ik-top"><div><h2 class="fd-q" tabindex="-1">'+(done?'Thanks, it’s all done':'Hi '+esc(b.name.split(' ')[0]))+'</h2><p class="fd-sub">'+(done?'You can still update anything below and submit again.':'For your first session with <b>'+esc(p.name)+'</b>, '+esc(F.day(b.start,1))+' at '+F.time(new Date(b.start))+'.')+'</p></div>'+
  '<p class="ik-save" id="ikSave" aria-live="polite">'+(it.status==='started'?'Your answers so far are saved.':'')+'</p></div>'+
  '<form class="rf-form" novalidate>'+
  sec(1,kid?'About your child and you':'About you',
   (kid?'<div class="bk-row">'+f('childName','Child’s full name','text')+f('childDob','Child’s date of birth','date')+'</div>'+
     '<div class="bk-row">'+f('name','Your full name (parent or carer)','text',{ac:'name'})+f('relation','Your relationship to them','select',{opts:['Mother','Father','Parent','Carer','Guardian','Other']})+'</div>'+
     '<div class="bk-fs"><p class="rf-q">Who has parental responsibility?</p>'+pills('custody',[['both','Both parents'],['me','Just me'],['orders','There are court orders']])+'<small class="ik-note" data-show="custody=orders"'+(D.custody==='orders'?'':' hidden')+'>Please bring a copy of the orders to the first session. Your practitioner needs to see them before working with your child.</small></div>'+
     f('school','School and year level','text',{opt:1}):
    '<div class="bk-row">'+f('name','Full name','text',{ac:'name'})+f('pref','Name you like to be called','text',{opt:1})+'</div>'+
    '<div class="bk-row">'+f('dob','Date of birth','date')+f('pronouns','Pronouns','text',{opt:1,ph:'For example she/her'})+'</div>')+
   f('addr','Home address','text',{ac:'street-address',ph:'Street, suburb, postcode'})+
   '<div class="bk-row">'+f('mobile','Mobile','tel',{ac:'tel',im:'tel'})+f('email','Email','email',{ac:'email'})+'</div>')+
  sec(2,'Emergency contact','<p class="rf-q">Someone we can call if we’re worried about your safety or can’t reach you. We’ll only contact them if we need to.</p>'+
   '<div class="bk-row">'+f('ecName','Their name','text')+f('ecRel','Relationship to you','text',{ph:'For example partner, mum, friend'})+'</div>'+f('ecPhone','Their phone','tel',{im:'tel',cls:'ik-half'}))+
  sec(3,'Your GP','<div class="bk-row">'+f('gpName','GP’s name','text',{opt:!medi})+f('gpPractice','Practice','text',{opt:!medi})+'</div>'+
   '<div class="bk-fs"><p class="rf-q">Can '+esc(p.first)+' send your GP short updates about your care?</p>'+pills('gpShare',[['yes','Yes'],['no','No'],['ask','Ask me first']])+'</div>'+
   (medi?'<p class="ik-note">Medicare needs a Mental Health Treatment Plan from your regular GP. '+(b.referral&&b.referral.planIn?'We already have yours.':'If we don’t have it yet, ask your GP to email it to hello@surfcoastfamilyhub.com.au.')+'</p>':''))+
  sec(4,'Medicare and payment',(medi?'<p class="rf-q">So we can claim your rebate straight after each session. It goes into your bank account, usually within a day.</p>'+
    '<div class="bk-row ik-medi">'+f('mcNum','Medicare card number','text',{im:'numeric',max:12,ph:'2123 45670'})+f('mcIrn','Number next to '+(kid?'your child’s':'your')+' name','text',{im:'numeric',max:1,ph:'1'})+f('mcExp','Expiry (MM/YY)','text',{im:'numeric',max:5,ph:'08/28'})+'</div>':
    '<p class="rf-q">You’ve booked without a Mental Health Treatment Plan, so there’s no Medicare rebate for now.</p>')+
   '<div class="bk-row">'+f('fund','Private health fund','text',{opt:1})+f('fundNo','Member number','text',{opt:1})+'</div>'+
   '<div class="ik-card" id="ikCard"></div>')+
  sec(5,'Before you come',f('why','Anything you’d like '+esc(p.first)+' to know before your first session?','textarea',{opt:1,rows:5,ph:'A few words is plenty. You don’t have to write anything; you can talk about it in the session.',hint:'Only '+esc(p.first)+' sees this.'})+
   f('heard','How did you hear about us?','select',{opt:1,opts:['My GP or another health professional','A friend or family member','Google','Instagram or Facebook','I’ve been before','Other']})+
   (tele?'<div class="bk-fs"><p class="rf-q">For '+(b.mode==='video'?'video':'phone')+' sessions</p>'+f('teleWhere','Where will you usually be during sessions?','text',{ph:'Suburb or town',hint:'If we’re ever worried about your safety during a session, this helps us get you help.'})+'</div>':''))+
  sec(6,'Consent','<details class="ik-info"><summary>Confidentiality and its limits</summary><p>What you share with '+esc(p.first)+' is private. It’s kept in their secure records and isn’t shared without your consent, except where the law requires or allows it: for example, if there’s a serious risk to your safety or someone else’s, if a child may be at risk of harm, or if records are subpoenaed by a court. '+esc(p.first)+' will talk with you first wherever possible.</p></details>'+
   '<details class="ik-info"><summary>Fees and cancellations</summary><p>'+esc(pol.text)+' Fees are charged to your card on file after each session'+(medi?', and your Medicare rebate is claimed for you':'')+'. You’ll get a receipt by text.</p></details>'+
   ck('cConf','I’ve read and understand the information about confidentiality and its limits.')+
   ck('cFees','I agree to the fees and cancellation policy.')+
   ck('cMsg','The Hub can contact me by text and email about appointments and payments.')+
   (tele?ck('cTele','I consent to sessions by '+(b.mode==='video'?'video':'phone')+', and I’ll be somewhere private and tell '+esc(p.first)+' where I am at the start of each session.'):'')+
   (kid?ck('cKid','I have the authority to consent to my child’s care, and I consent to '+esc(p.first)+' providing it.'):ck('cCare','I consent to '+esc(p.first)+' providing care to me.'))+
   '<div class="bk-row">'+f('sign','Type your full name to sign','text',{ac:'name'})+'<label class="bk-f"><span>Date</span><input type="text" value="'+esc(F.day(H.now(),1))+'" disabled></label></div>')+
  '<p class="bk-err" role="alert" hidden></p><button type="submit" class="btn btn-primary bk-submit">'+svg('check')+(done?'Update my form':'Submit my form')+'</button>'+
  '<p class="rf-sec-note">'+svg('lock')+'Sent securely and kept in your practitioner’s records in Australia. Only '+esc(p.first)+' and Hub staff who need it can see it. <a href="privacy.html" target="_blank" rel="noopener">Privacy notice</a></p></form>';
 cardBox();bind()}
function sec(n,title,body){return '<fieldset class="rf-sec"><legend><span class="ik-n">'+n+'</span>'+title+'</legend>'+body+'</fieldset>'}
function cardBox(){var el=document.getElementById('ikCard'),c=api.cardOf(b.phone)||D.card;
 el.innerHTML=c?'<p class="bk-ok">'+svg('card')+(c.brand||'Card')+' ending '+esc(c.last4)+' is on file for session fees.</p><button type="button" class="fd-linkbtn" data-card="4242">Use a different card</button>':
  '<p class="rf-q">Add a card for session fees. It’s charged after each session and you get a receipt by text. Card details go straight to the payment provider; the Hub never sees them.</p><button type="button" class="btn btn-outline btn-sm" data-card="4242">'+svg('card')+'Add a card</button><small class="ik-demo">Demo: adds a pretend card. Or <button type="button" class="fd-linkbtn" data-card="0002">add one that won’t go through</button> to see that path later.</small>'}
var tm;function save(){clearTimeout(tm);tm=setTimeout(function(){collect();api.saveIntake(tok,D,it.status==='done');if(it.status!=='done')it.status='started';var s=document.getElementById('ikSave');if(s)s.textContent='Saved. You can finish later from the same link.'},600)}
function collect(){[].forEach.call(box.querySelectorAll('input[id],textarea[id],select[id]'),function(x){if(x.disabled)return;D[x.id]=x.type==='checkbox'?x.checked:x.value.trim()})}
function bind(){var fm=box.querySelector('form');
 fm.addEventListener('input',save);fm.addEventListener('change',save);
 fm.addEventListener('click',function(e){var bt=e.target.closest('button[type=button]');if(!bt)return;
  if(bt.dataset.k){D[bt.dataset.k]=bt.dataset.v;[].forEach.call(fm.querySelectorAll('[data-k="'+bt.dataset.k+'"]'),function(x){x.setAttribute('aria-pressed',x===bt)});
   [].forEach.call(fm.querySelectorAll('[data-show]'),function(x){var kv=x.dataset.show.split('=');x.hidden=D[kv[0]]!==kv[1]});save();return}
  if(bt.dataset.card){D.card={last4:bt.dataset.card,brand:'Visa',exp:'08/28'};api.setCard(b.phone,D.card);cardBox();save()}});
 fm.addEventListener('submit',function(e){e.preventDefault();collect();var err=fm.querySelector('.bk-err');
  function need(id,msg){return !D[id]?msg:''}
  var bad=(kid?need('childName','Please add your child’s full name.')||need('childDob','Please add your child’s date of birth.')||need('custody','Please tell us who has parental responsibility.'):need('dob','Please add your date of birth.'))||
   need('name','Please add your full name.')||need('addr','Please add your home address.')||(!/^(\+?61|0)[2-478][\d ]{8,11}$/.test((D.mobile||'').replace(/\s/g,''))?'Please check your mobile number.':'')||
   need('ecName','Please add an emergency contact.')||(!/^(\+?61|0)[2-478][\d ]{8,11}$/.test((D.ecPhone||'').replace(/\s/g,''))?'Please add your emergency contact’s phone number.':'')||
   (medi?need('gpName','Please add your GP’s name.')||(D.mcNum&&!medicareOk(D.mcNum)?'That Medicare number doesn’t look right. Check the 10 digits on your card.':'')||(D.mcNum&&!/^[1-9]$/.test(D.mcIrn||'')?'Please add the number next to your name on the Medicare card.':''):'')||
   (tele?need('teleWhere','Please tell us where you’ll usually be during sessions.'):'')||
   (!D.cConf||!D.cFees||!D.cMsg||(tele&&!D.cTele)||(kid?!D.cKid:!D.cCare)?'Please tick each consent box.':'')||
   (!D.sign||D.sign.toLowerCase().replace(/\s+/g,' ')!==(D.name||'').toLowerCase().replace(/\s+/g,' ')?'Please type your full name exactly as above to sign.':'');
  if(bad){err.textContent=bad;err.hidden=false;err.scrollIntoView({block:'center'});return}
  D.signedAt=H.now();api.saveIntake(tok,D,true);it.status='done';
  box.innerHTML='<div class="bk-done"><span class="bk-tick">'+svg('check')+'</span><h2 class="fd-q" tabindex="-1">Thank you, you’re all set</h2><p>Your form is with '+esc(p.first)+'. See you '+esc(F.day(b.start,1).toLowerCase()==='today'?'today':'on '+F.day(b.start,1))+' at '+F.time(new Date(b.start))+'.</p></div>'+
   '<div class="mg-acts mg-gap"><a class="btn btn-primary" href="manage.html#t='+b.token+'">'+svg('cal')+'My booking</a><button type="button" class="btn btn-outline" data-again>Review my answers</button></div>';
  box.querySelector('[data-again]').onclick=render;box.querySelector('.fd-q').focus()})}
// Medicare card check digit: digit 9 = (d1*1 + d2*3 + d3*7 + d4*9 + d5*1 + d6*3 + d7*7 + d8*9) mod 10, first digit 2 to 6.
function medicareOk(s){s=String(s).replace(/\D/g,'');if(s.length<10||s.length>11||!/^[2-6]/.test(s))return false;var w=[1,3,7,9,1,3,7,9],sum=0;for(var i=0;i<8;i++)sum+=+s[i]*w[i];return sum%10===+s[8]}
render();
})();
