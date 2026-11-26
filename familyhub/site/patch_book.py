# Patches the worker's hub-book-online.html: Halaxy link-out until the API is live (no demo times unless ?demo),
# waitlist form, #pid&t=ISO and #pid&wl deep links, duplicate crisis line removed.
import sys
f=sys.argv[1]; h=open(f).read()
def rep(a,b,n=1):
    global h
    assert h.count(a)>=1, a[:80]
    h=h.replace(a,b,n)
crisis='<p class="fd-crisis">Need support right now?'
i=h.find(crisis); j=h.find(crisis,i+10)
if j>0: k=h.find('</p>',j)+4; h=h[:j]+h[k:]
rep("var HOW={clinic:'In person',video:'Video',phone:'Phone'};",
"""var HOW={clinic:'In person',video:'Video',phone:'Phone'};
var HXB='https://www.halaxy.com/book/',HXU={adi:'psychologist/dr-adi-brown/256944/503631',hannah:'widget/psychologist/hannah-jensen/680341/503631',melinda:'widget/psychologist/melinda-sullivan/1343231/503631',ellie:'widget/psychologist/ellie-james/1026431/503631',maddy:'psychologist/ms-madelaine-keegan/1807285/503631','michelle-ferris':'widget/social-worker/ms-michelle-ferris/331996/503631',laura:'widget/massage-therapist/ms-laura-rees/659711/503631',kate:'widget/acupuncturist/kate-heagney/659721/503631'};
var DEMO=/[?&]demo\\b/.test(location.search),WL=null;""")
rep("fetch('api/hx/times?pid='+encodeURIComponent(S.pid)+'&svc='+S.svc+'&from='+S.from+'&days=14')",
    "fetch('api/hx/times?pid='+encodeURIComponent(S.pid)+'&svc='+S.svc+'&from='+S.from+'&days=14'+(DEMO?'&demo=1':''))")
# drawTimes: not live -> Halaxy panel; always a waitlist offer
rep("function drawTimes(){var el=$('boWhen'),g=[],cur=null;",
"""function wlHtml(){var p=PR[S.pid];return '<div class="bo-wl" id="boWl">'+(WL?'<p class="bo-wl-ok">You’re on the waitlist for '+esc(p[0])+'. '+(WL.sms?'We’ll text you when a time that suits you opens up.':'Our team will be in touch when a time that suits you opens up.')+'</p>':
 '<button type="button" class="btn btn-outline btn-sm" data-wl aria-expanded="false" aria-controls="boWlF">Can’t find a time that suits? Join the waitlist</button>'+
 '<form id="boWlF" class="bo-wlf" hidden novalidate><p class="bo-wl-h">We’ll let you know when an earlier time with '+esc(p[0].replace(/^Dr /,''))+' opens up.</p>'+
 '<fieldset class="bo-wl-days"><legend>Days that work</legend>'+['Mon','Tue','Wed','Thu','Fri'].map(function(d,i){return '<label><input type="checkbox" name="d" value="'+(i+1)+'" checked> '+d+'</label>'}).join('')+'</fieldset>'+
 '<fieldset class="bo-wl-days"><legend>Time of day</legend><label><input type="radio" name="ap" value="any" checked> Any</label><label><input type="radio" name="ap" value="am"> Morning</label><label><input type="radio" name="ap" value="pm"> Afternoon</label></fieldset>'+
 '<div class="bo-form"><div class="bo-f w"><label for="wl1">Full name</label><input id="wl1" name="name" autocomplete="name" required></div><div class="bo-f"><label for="wl2">Mobile</label><input id="wl2" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="04xx xxx xxx" required></div><div class="bo-f"><label for="wl3">Email <small>(optional)</small></label><input id="wl3" name="email" type="email" autocomplete="email"></div>'+
 '<div class="bo-hp" aria-hidden="true"><label for="wl9">Website</label><input id="wl9" name="website" tabindex="-1" autocomplete="off"></div></div>'+
 '<label class="bo-wl-c"><input type="checkbox" name="consent" required> I’m happy for the Hub to keep these details for up to 90 days to offer me a time. See our <a href="privacy.html">privacy notice</a>.</label>'+
 '<p class="bo-err" id="wlErr" hidden></p><button class="btn btn-primary btn-sm" type="submit">Join the waitlist</button></form>')+'</div>'}
function drawTimes(){var el=$('boWhen'),g=[],cur=null;
 if(S.live===false&&!DEMO){var p=PR[S.pid];el.innerHTML='<div class="bo-hx"><p>See '+esc(p[0].replace(/^Dr /,''))+'’s free times and book on our Halaxy booking page. It opens in a new tab.</p><a class="btn btn-primary" href="'+HXB+HXU[S.pid]+'" target="_blank" rel="noopener">See times and book</a></div>'+wlHtml();return}""")
rep("""  :'<p class="bo-none">No free times in the next '+(S.searched*2)+' weeks. Call us on <a href="tel:0491184788">0491 184 788</a> and we’ll put you on the waitlist.</p>';""",
    """  :'<p class="bo-none">No free times in the next '+(S.searched*2)+' weeks. Join the waitlist below, or call us on <a href="tel:0491184788">0491 184 788</a>.</p>';""")
rep(" el.innerHTML=h}\n$('boWhen').onclick=function(e){var b=e.target.closest('button');if(!b)return;",
""" el.innerHTML=h+wlHtml();if(S.want){var w=S.want;S.want=null;var c=el.querySelector('[data-t="'+w+'"]');if(c)c.click();else{var n=document.createElement('p');n.className='bo-none';n.textContent='Sorry, that time has just been taken. Here’s what’s free now.';el.prepend(n)}}if(S.openWl){S.openWl=0;var x=el.querySelector('[data-wl]');if(x)x.click()}}
$('boWhen').addEventListener('submit',function(e){if(e.target.id!=='boWlF')return;e.preventDefault();var f=e.target,er=$('wlErr'),nm=f.name.value.trim().split(/\\s+/),days=[].map.call(f.querySelectorAll('[name=d]:checked'),function(x){return +x.value});
 var bad=!/\\S+\\s+\\S+/.test(f.name.value.trim())?f.name:f.phone.value.replace(/\\D/g,'').length<9?f.phone:f.email.value&&!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(f.email.value.trim())?f.email:!days.length?f.querySelector('[name=d]'):!f.consent.checked?f.consent:null;
 if(bad){er.hidden=false;er.textContent=bad===f.name?'Please add your first and last name.':bad===f.phone?'Please check your mobile number.':bad===f.email?'Please check your email.':!days.length&&bad.name==='d'?'Pick at least one day.':'Please tick the box so we can keep your details.';bad.focus();return}
 var sb=f.querySelector('[type=submit]');sb.disabled=true;sb.textContent='Adding you…';
 fetch('api/hx/waitlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pid:S.pid,svc:S.svc,mode:S.mode,first:nm.slice(0,-1).join(' '),last:nm[nm.length-1],phone:f.phone.value.trim(),email:f.email.value.trim(),days:days,ampm:f.ap.value,consent:true,website:f.website.value})})
 .then(function(r){return r.json()}).then(function(j){if(j.ok){WL=j;var w=$('boWl');w.outerHTML=wlHtml();$('boWl').focus&&$('boWl').scrollIntoView({block:'nearest'});return}
  sb.disabled=false;sb.textContent='Join the waitlist';er.hidden=false;er.innerHTML=j.error==='limit'?'Too many tries today. Call us on <a href="tel:0491184788">0491 184 788</a>.':j.error==='check'?'Some details don’t look right. Check them and try again.':'That didn’t go through. Try again, or call us on <a href="tel:0491184788">0491 184 788</a>.'})
 .catch(function(){sb.disabled=false;sb.textContent='Join the waitlist';er.hidden=false;er.textContent='No connection. Try again.'})});
$('boWhen').onclick=function(e){var b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-wl')){var f=$('boWlF'),o=f.hidden;f.hidden=!o;b.setAttribute('aria-expanded',o);if(o)f.querySelector('#wl1').focus();return}""")
rep("function pickWho(id){S.pid=id;","function pickWho(id){if(S.pid!==id)WL=null;S.pid=id;")
rep("history.replaceState(null,'','#'+id);","history.replaceState(null,'',location.search+'#'+id);")
rep("var h=location.hash.slice(1);if(PR[h])pickWho(h);",
"""var hp=location.hash.slice(1).split('&'),h=decodeURIComponent(hp[0]||'');hp.slice(1).forEach(function(x){if(x.indexOf('t=')===0)S.want=decodeURIComponent(x.slice(2));if(x==='wl')S.openWl=1});if(PR[h])pickWho(h);""")
# reload() resets S.start; keep S.want through it (set before pickWho). fine.
css="""
.bo-hx{background:var(--h-mist);border-radius:14px;padding:16px 18px;margin:0 0 14px}.bo-hx p{margin:0 0 12px}
.bo-wl{margin-top:16px;padding-top:14px;border-top:1px solid var(--h-line)}.bo-wl:focus{outline:none}
.bo-wlf{margin-top:14px}.bo-wl-h{margin:0 0 10px;font-weight:600}
.bo-wl-days{border:0;padding:0;margin:0 0 12px;display:flex;flex-wrap:wrap;gap:6px 14px}.bo-wl-days legend{font-weight:600;font-size:.92em;margin-bottom:6px;padding:0}
.bo-wl-days label,.bo-wl-c{display:inline-flex;gap:6px;align-items:center;min-height:32px}.bo-wl-c{display:flex;align-items:flex-start;margin:10px 0 12px;font-size:.95em}.bo-wl-c input{margin-top:4px}
.bo-wl-ok{background:var(--h-mist);border-radius:12px;padding:12px 14px;margin:0}
"""
i=h.find('</style>',h.find('.bo{--h-card'))
h=h[:i]+css+h[i:]
open(f,'w').write(h)
print('ok')
