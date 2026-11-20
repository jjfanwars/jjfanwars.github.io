/* Contact page: the enquiry form goes into the Hub inbox instead of opening the visitor's email app.
   Demo: stored in this browser (hub-core.js). Live: POST to the Worker, which files it in the inbox. */
(function(){
var f=document.querySelector('form[data-enquiry]');if(!f||!window.HUB)return;
var st=f.querySelector('.form-status'),small=f.querySelector('p.small');
if(small)small.textContent='Your message goes straight to our front desk. We reply within one business day. Demo: messages stay in this browser.';
document.addEventListener('submit',function(e){if(e.target!==f)return;e.preventDefault();e.stopImmediatePropagation();
 var name=f.querySelector('[name=name]').value.trim(),c=f.querySelector('[name=contact]').value.trim(),msg=f.querySelector('[name=message]').value.trim();
 function say(t,bad){if(st){st.textContent=t;st.style.color=bad?'#9A3B26':''}}
 var email=/@/.test(c)?c:'',phone=!email&&/^(\+?61|0)[2-478][\d ]{8,11}$/.test(c.replace(/\s/g,''))?c:'';
 if(!name)return say('Please add your name.',1);if(!email&&!phone)return say('Please add a phone number or email so we can reply.',1);if(!msg)return say('Please add a short message.',1);
 window.HUB.api.inbound({channel:'form',name:name,email:email,phone:phone,text:msg});
 f.querySelectorAll('input,textarea').forEach(function(x){x.value=''});
 say('Thanks '+name.split(' ')[0]+', we’ve got your message and will be in touch within one business day. If it’s urgent, call 000 or Lifeline 13 11 14.');
},true);
})();
