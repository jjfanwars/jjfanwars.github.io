/* Online referral form for health professionals (demo backend in hub-core.js). ?staff=1 logs a faxed or emailed referral. */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api,box=document.getElementById('rf'),staff=/[?&]staff=1/.test(location.search);
var IC={check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',file:'<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5M9 13h6M9 16.5h4"/>',send:'<path d="M4 12l16-8-6 16-2.5-6.5z"/>',lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'};
function svg(k){return '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}
var MINE={};try{MINE=JSON.parse(localStorage.getItem('scfh-referrer')||'{}')}catch(e){}
function f(id,label,type,o){o=o||{};return '<label class="bk-f'+(o.cls?' '+o.cls:'')+'"><span>'+label+(o.opt?' <i>(optional)</i>':'')+'</span>'+(type==='textarea'?'<textarea id="'+id+'" rows="4" maxlength="2000"'+(o.ph?' placeholder="'+o.ph+'"':'')+'></textarea>':
 '<input id="'+id+'" type="'+type+'" autocomplete="'+(o.ac||'off')+'" value="'+esc(o.v||'')+'"'+(o.ph?' placeholder="'+o.ph+'"':'')+(o.im?' inputmode="'+o.im+'"':'')+'>')+(o.hint?'<small>'+o.hint+'</small>':'')+'</label>'}
function pills(k,opts,cur){return '<div class="fd-pills" role="group">'+opts.map(function(o){return '<button type="button" class="fd-pill" data-'+k+'="'+o[0]+'" aria-pressed="'+(cur===o[0])+'">'+o[1]+'</button>'}).join('')+'</div>'}
var TO=['adi','hannah','melinda','ellie','maddy','michelle-ferris','meaghan'].filter(function(x){return P[x]&&!P[x].leave});
var V={kid:'no',plan:'',to:'team',src:'Fax',file:null};
function form(){
 box.innerHTML='<h2 class="fd-q" tabindex="-1">'+(staff?'Log a referral':'Referral details')+'</h2><p class="fd-sub">'+(staff?'For referrals that arrive by fax, email or phone. The client gets a booking link once a practitioner is chosen.':'Fields marked optional can be left blank. Everything else helps us contact your patient quickly.')+'</p>'+
 '<form class="rf-form" novalidate>'+
 (staff?'<fieldset class="bk-fs"><legend>How did it arrive?</legend>'+pills('src',[['Fax','Fax'],['Email','Email'],['Phone','Phone'],['Letter','Letter']],V.src)+'</fieldset>':'')+
 '<fieldset class="rf-sec"><legend>'+(staff?'Referrer':'About you')+'</legend><div class="bk-row">'+f('rfFrom','Your name','text',{ac:'name',v:MINE.name,ph:'Dr Jane Smith'})+f('rfPrac','Practice or service','text',{ac:'organization',v:MINE.practice})+'</div>'+
  '<div class="bk-row">'+f('rfEmail','Email for updates','email',{ac:'email',v:MINE.email,opt:staff})+f('rfProv','Provider number','text',{opt:1,v:MINE.provider})+'</div></fieldset>'+
 '<fieldset class="rf-sec"><legend>About your patient</legend><div class="bk-fs"><p class="rf-q">Is the referral for a child?</p>'+pills('kid',[['no','No'],['yes','Yes']],V.kid)+'</div>'+
  '<div class="bk-row">'+f('rfName',V.kid==='yes'?'Parent or carer’s name':'Patient’s full name','text')+(V.kid==='yes'?f('rfChild','Child’s first name','text'):f('rfDob','Date of birth','date',{opt:1}))+'</div>'+
  '<div class="bk-row">'+f('rfPhone',V.kid==='yes'?'Parent’s mobile':'Mobile','tel',{im:'tel',ph:'04xx xxx xxx',hint:'We text them a link to book.'})+f('rfPEmail','Email','email',{opt:1})+'</div></fieldset>'+
 '<fieldset class="rf-sec"><legend>Who to</legend><p class="rf-q">If your patient is happy for us to match them, choose the Psychology Team. Adi will contact them about the best fit.</p>'+
  '<div class="rf-to">'+[['team','Psychology Team','We’ll match them']].concat(TO.map(function(x){return [x,P[x].name,P[x].role]})).map(function(o){return '<button type="button" class="rf-opt" data-to="'+o[0]+'" aria-pressed="'+(V.to===o[0])+'">'+(o[0]==='team'?'<span class="rf-team">'+svg('send')+'</span>':'<img src="'+H.photo(o[0])+'" alt="" width="36" height="36">')+'<span><b>'+esc(o[1])+'</b><small>'+esc(o[2])+'</small></span></button>'}).join('')+'</div></fieldset>'+
 '<fieldset class="rf-sec"><legend>Medicare and documents</legend><p class="rf-q">Is there a Mental Health Treatment Plan?</p>'+pills('plan',[['yes','Yes, attached'],['later','Yes, to follow'],['no','No plan']],V.plan)+
  '<div class="bk-row rf-pd"'+(V.plan==='yes'||V.plan==='later'?'':' hidden')+'>'+f('rfPlanDate','Date of the plan','date',{opt:1})+'<span></span></div>'+
  '<label class="bk-file"><input type="file" id="rfFile" accept="application/pdf,image/*"><span>'+svg('file')+(V.file?esc(V.file.name):'Attach the referral letter or plan (PDF or photo)')+'</span></label></fieldset>'+
 '<fieldset class="rf-sec"><legend>Reason for referral</legend>'+f('rfWhy','What would you like help with?','textarea',{ph:'For example: perinatal anxiety, 4 months postpartum. Any risk information, current medication and other supports.',hint:'Only the treating practitioner and Hub intake staff see this. It isn’t used in texts or anywhere else.'})+'</fieldset>'+
 '<label class="bk-check"><input type="checkbox" id="rfOk"><span>'+(staff?'The referral includes the patient’s consent to be contacted.':'My patient agrees to this referral and to the Hub contacting them by text and phone. I’ve read the <a href="privacy.html" target="_blank" rel="noopener">privacy notice</a>.')+'</span></label>'+
 (staff?'':'<label class="bk-check"><input type="checkbox" id="rfMe"'+(MINE.name?' checked':'')+'><span>Remember my details on this device.</span></label>')+
 '<p class="bk-err" role="alert" hidden></p><button type="submit" class="btn btn-primary bk-submit">'+svg('send')+(staff?'Log referral':'Send referral')+'</button>'+
 '<p class="rf-sec-note">'+svg('lock')+'Sent over an encrypted connection and stored in Australia. Not for urgent referrals: if your patient is at risk, please call.</p></form>';
 var fm=box.querySelector('form');
 fm.addEventListener('click',function(e){var b=e.target.closest('button[type=button]');if(!b)return;var d=b.dataset;
  if(d.kid){keep();V.kid=d.kid;form();restore();return}
  if(d.plan){V.plan=d.plan;[].forEach.call(fm.querySelectorAll('[data-plan]'),function(x){x.setAttribute('aria-pressed',x===b)});fm.querySelector('.rf-pd').hidden=!(d.plan==='yes'||d.plan==='later');return}
  if(d.to){V.to=d.to;[].forEach.call(fm.querySelectorAll('[data-to]'),function(x){x.setAttribute('aria-pressed',x===b)});return}
  if(d.src){V.src=d.src;[].forEach.call(fm.querySelectorAll('[data-src]'),function(x){x.setAttribute('aria-pressed',x===b)});return}});
 fm.querySelector('#rfFile').addEventListener('change',function(){var x=this.files[0],lab=this.nextElementSibling;if(!x)return;if(x.size>15e6){lab.textContent='That file is over 15 MB. Try a smaller scan.';return}
  V.file={name:x.name,size:x.size,type:x.type};lab.innerHTML=svg('check')+esc(x.name)+' ('+Math.max(1,Math.round(x.size/1e3))+' KB)';if(!V.plan||V.plan==='later'){}});
 fm.addEventListener('submit',submit)}
var KEEP={};function keep(){[].forEach.call(box.querySelectorAll('input[id],textarea'),function(x){if(x.type!=='file'&&x.type!=='checkbox')KEEP[x.id]=x.value})}
function restore(){for(var k in KEEP){var x=document.getElementById(k);if(x)x.value=KEEP[k]}}
function val(id){var x=document.getElementById(id);return x?x.value.trim():''}
function submit(e){e.preventDefault();var fm=e.target,err=fm.querySelector('.bk-err'),ph=val('rfPhone');
 var bad=!val('rfFrom')?'Please add the referrer’s name.':!val('rfPrac')?'Please add the practice or service.':!staff&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val('rfEmail'))?'Please add an email so we can confirm the referral.':
  !val('rfName')?'Please add the patient’s name.':V.kid==='yes'&&!val('rfChild')?'Please add the child’s first name.':!/^(\+?61|0)4[\d ]{8,11}$/.test(ph.replace(/\s/g,''))?'Please add an Australian mobile so we can text a booking link.':
  !V.plan?'Please tell us about the Mental Health Treatment Plan.':V.plan==='yes'&&!V.file?'Please attach the plan, or choose “to follow”.':!fm.rfOk.checked?(staff?'Please confirm the patient agreed to be contacted.':'Please confirm your patient agrees to the referral.'):'';
 if(bad){err.textContent=bad;err.hidden=false;err.scrollIntoView({block:'nearest'});return}
 if(fm.rfMe){try{if(fm.rfMe.checked)localStorage.setItem('scfh-referrer',JSON.stringify({name:val('rfFrom'),practice:val('rfPrac'),email:val('rfEmail'),provider:val('rfProv')}));else localStorage.removeItem('scfh-referrer')}catch(x){}}
 var go=fm.querySelector('.bk-submit');go.disabled=true;go.innerHTML='<span class="bk-spin"></span>Sending…';
 api.refer({source:staff?V.src:'Online form',from:{name:val('rfFrom'),practice:val('rfPrac'),email:val('rfEmail'),provider:val('rfProv')},
  client:{name:val('rfName'),child:V.kid==='yes'?val('rfChild'):'',dob:val('rfDob'),phone:ph,email:val('rfPEmail')},to:V.to,plan:V.plan==='no'?'no':'yes',planDate:val('rfPlanDate'),file:V.file,reason:val('rfWhy')}).then(function(r){
  var ref=r.referral,named=V.to!=='team'&&P[V.to].live,sent=ref.status==='invited';
  box.innerHTML='<div class="bk-done"><span class="bk-tick">'+svg('check')+'</span><h2 class="fd-q" tabindex="-1">'+(staff?'Referral logged':'Referral sent. Thank you.')+'</h2><p>Reference <b>'+esc(ref.id.toUpperCase())+'</b>'+(staff?'':' · We’ll email '+esc(val('rfEmail')||'you')+' when your patient books.')+'</p></div>'+
   '<ol class="rf-next"><li><b>'+(sent?'Done:':'Next:')+'</b> '+(sent?'we’ve texted '+esc(val('rfName').split(' ')[0])+' a link to book with '+esc(P[V.to].first)+'.':V.to==='team'?'Adi reviews it within one business day and texts your patient a link to book with the best-matched psychologist.':'our team contacts your patient within one business day.')+'</li>'+
   '<li>When they book, the referral and plan go into their practitioner’s record.</li>'+(V.plan==='later'?'<li>Please send the Mental Health Treatment Plan before their first session, or they won’t get the Medicare rebate.</li>':'')+'</ol>'+
   '<div class="mg-acts"><button type="button" class="btn btn-primary" data-again>Send another referral</button><a class="btn btn-outline" href="referrals.html">Back to referrals</a></div>'+
   '<p class="bk-demo">Demo: open the <a href="admin.html" target="_blank" rel="noopener">Hub dashboard</a> to see it in the Referrals inbox.</p>';
  box.querySelector('[data-again]').onclick=function(){V={kid:'no',plan:'',to:'team',src:'Fax',file:null};KEEP={};form();box.scrollIntoView({block:'start'})};
  var q=box.querySelector('.fd-q');if(q)q.focus()})}
form();
})();
