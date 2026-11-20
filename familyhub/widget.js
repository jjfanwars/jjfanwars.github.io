/* Surf Coast Family Hub booking button. Paste on any website:
   <script src="https://familyhub.aiautomationvic.com/widget.js" data-practitioner="hannah" data-label="Book with Hannah" async></script>
   It adds a button that opens that practitioner's live times in an overlay. Styles are sealed in a shadow root, so the host site's CSS can't break it. */
(function(){
var s=document.currentScript;if(!s)return;
var pid=s.getAttribute('data-practitioner')||'',label=s.getAttribute('data-label')||'Book online',base=s.src.replace(/widget\.js(\?.*)?$/,'');
var host=document.createElement('span');s.parentNode.insertBefore(host,s.nextSibling);
var root=host.attachShadow?host.attachShadow({mode:'open'}):host;
root.innerHTML='<style>:host{display:inline-block}button{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 22px;border:0;border-radius:999px;background:#3C6869;color:#fff;font:600 16px/1 "Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:3px 3px 0 #E2B867;transition:background-color .15s,transform .15s}button:hover{background:#2E4B4C}button:active{transform:translate(1px,1px)}button:focus-visible{outline:3px solid #9CC3C1;outline-offset:3px}svg{width:18px;height:18px}</style>'+
 '<button type="button"><svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><rect height="15" rx="2.5" width="17" x="3.5" y="5"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg><span></span></button>';
var btn=root.querySelector('button');btn.querySelector('span').textContent=label;
btn.addEventListener('click',function(){
 var ov=document.createElement('div');ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');ov.setAttribute('aria-label',label);
 ov.style.cssText='position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(40,34,30,.55)';
 var fr=document.createElement('iframe');fr.src=base+'book.html?embed=1#p='+encodeURIComponent(pid);fr.title=label+' (Surf Coast Family Hub)';
 fr.style.cssText='width:min(760px,100%);height:min(880px,100%);border:0;border-radius:16px;background:#FAF8F3;box-shadow:0 24px 60px rgba(0,0,0,.35)';
 var x=document.createElement('button');x.type='button';x.setAttribute('aria-label','Close');x.textContent='×';
 x.style.cssText='position:absolute;top:12px;right:12px;width:44px;height:44px;border:0;border-radius:50%;background:#fff;color:#3B322D;font:400 28px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.25)';
 var prev=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';
 function close(){ov.remove();document.removeEventListener('keydown',key);document.documentElement.style.overflow=prev;btn.focus()}
 function key(e){if(e.key==='Escape')close()}
 x.addEventListener('click',close);ov.addEventListener('click',function(e){if(e.target===ov)close()});document.addEventListener('keydown',key);
 ov.appendChild(fr);ov.appendChild(x);document.body.appendChild(ov);x.focus()});
})();
