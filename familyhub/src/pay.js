/* Payment link and receipt (demo payment provider in hub-core.js). */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api,box=document.getElementById('rf');
var IC={check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',card:'<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',print:'<path d="M7 9V3.5h10V9M7 17H4.5V10h15v7H17M7 14h10v6.5H7z"/>'};
function svg(k){return '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24">'+IC[k]+'</svg>'}
var KIND={deposit:'Deposit',session:'Session fee',late:'Short-notice cancellation fee',noshow:'Missed appointment fee',refund:'Refund',medicare:'Medicare rebate claim'};
function money(n){return '$'+Number(n).toFixed(2)}
function draw(){var id=(location.hash.match(/p=([a-z0-9]+)/i)||[])[1],r=id&&api.payment(id);
 if(!r){box.innerHTML='<h2 class="fd-q">We couldn’t find that payment</h2><p class="fd-sub">The link may be old. Call us on <a href="tel:0491184788">0491 184 788</a>.</p>';return}
 var x=r.pay,b=r.booking,p=P[x.pid],health=p.psych||x.pid==='michelle-ferris'||x.pid==='kate',when=b?F.day(b.start,1)+', '+F.time(new Date(b.start)):'';
 var open=x.status==='due'||x.status==='failed';
 document.getElementById('pyH').textContent=open?'Pay '+money(x.amount):x.kind==='refund'?'Refund receipt':'Receipt';
 if(open){
  box.innerHTML='<h2 class="fd-q" tabindex="-1">'+esc(KIND[x.kind])+' for '+esc(p.first)+'</h2><p class="fd-sub">'+esc(x.name)+(when?' · session on '+esc(when):'')+'</p>'+
   (x.status==='failed'?'<p class="mg-warn">The payment from your card on file didn’t go through, so it’s still open. You can pay below whenever suits.</p>':'')+
   '<dl class="py-dl"><div><dt>'+esc(KIND[x.kind])+'</dt><dd>'+money(x.amount)+'</dd></div><div class="tot"><dt>To pay</dt><dd>'+money(x.amount)+'</dd></div></dl>'+
   '<div class="mg-acts mg-gap"><button type="button" class="btn btn-primary" data-pay>'+svg('card')+'Pay '+money(x.amount)+'</button><a class="btn btn-outline" href="tel:0491184788">Call us instead</a></div>'+
   '<p class="rf-sec-note">'+svg('lock')+'Paid to '+esc(p.name)+' through our payment provider. The Hub never sees your card details. Demo: no card is asked for.</p>';
  box.querySelector('[data-pay]').onclick=function(){this.disabled=true;var res=api.payLink(x.id);if(res.ok)draw()};return}
 var mc=b&&api.payments().filter(function(y){return y.bid===x.bid&&y.kind==='medicare'})[0];
 box.innerHTML='<div class="py-head"><div><h2 class="fd-q" tabindex="-1">'+(x.kind==='refund'?'Refund':'Receipt')+'</h2><p class="fd-sub">No. '+esc(x.id.toUpperCase())+' · '+esc(F.day(x.paidAt||x.at,1))+'</p></div><button type="button" class="btn btn-outline btn-sm" data-print>'+svg('print')+'Print or save</button></div>'+
  (x.status==='refunded'?'<p class="mg-warn">This payment was refunded.</p>':'')+
  '<dl class="py-dl"><div><dt>Practitioner</dt><dd>'+esc(p.name)+'<br><small>'+esc(p.role)+', provider number and ABN shown on the live receipt</small></dd></div>'+
  '<div><dt>Practice</dt><dd>Surf Coast Family Hub<br><small>16 Princes Tce, Jan Juc VIC 3228</small></dd></div>'+
  '<div><dt>Client</dt><dd>'+esc(x.name)+(b&&b.child?'<br><small>For '+esc(b.child)+'</small>':'')+'</dd></div>'+
  (b?'<div><dt>Service</dt><dd>'+esc(b.service||'Appointment')+'<br><small>'+esc(when)+' · '+(b.len||p.len)+' min'+(b.mode&&b.mode!=='in'?' · '+b.mode:'')+'</small></dd></div>':'')+
  '<div><dt>'+esc(KIND[x.kind])+'</dt><dd>'+money(x.amount)+'</dd></div>'+
  '<div><dt>GST</dt><dd>'+(health?'GST-free health service':'Shown on the live receipt')+'</dd></div>'+
  '<div class="tot"><dt>'+(x.kind==='refund'?'Refunded':'Paid')+'</dt><dd>'+money(x.amount)+'</dd></div>'+
  '<div><dt>Paid by</dt><dd>'+(x.last4?'Card ending '+esc(x.last4):esc(x.via||'In person'))+'</dd></div>'+
  (mc?'<div><dt>Medicare rebate</dt><dd>'+money(mc.amount)+' claimed for you<br><small>Paid by Medicare into your bank account, usually within a day</small></dd></div>':'')+'</dl>'+
  (b?'<p class="bk-demo"><a href="manage.html#t='+b.token+'">Your booking</a></p>':'');
 box.querySelector('[data-print]').onclick=function(){window.print()}}
window.addEventListener('hashchange',draw);draw();
})();
