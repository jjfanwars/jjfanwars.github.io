/* Hub report: last 7 days or 4 weeks, printable (demo data from hub-core.js). */
(function(){
var H=window.HUB,P=H.P,F=H.fmt,esc=F.esc,api=H.api,days=28,asTable=false;
function $(id){return document.getElementById(id)}
function pct(a,b){return b?Math.round(a/b*100):0}
function m(n){return '$'+Math.round(n).toLocaleString('en-AU')}
function draw(){var r=api.report(days),T=r.totals,MON=F.MON;
 function d(t){t=new Date(t);return t.getDate()+' '+MON[t.getMonth()]}
 $('rpRange').textContent=d(r.from)+' to '+d(r.to-864e5)+' · '+r.byPract.length+' practitioners booking through the hub';
 [].forEach.call(document.querySelectorAll('[data-days]'),function(b){b.setAttribute('aria-pressed',+b.dataset.days===days)});
 var cx=r.cancellations,remPct=pct(r.reminders.confirmed,r.reminders.sent);
 $('rpKpis').innerHTML=[
  ['Sessions booked',T.booked.toLocaleString('en-AU'),r.utilisation+'% of available time used'],
  ['Cancellations and no-shows',cx,T.late+' late · '+T.early+' with notice · '+T.noshow+' no-show'],
  ['Refilled from the waitlist',T.refilled,r.fillRate+'% of cancellations',1],
  ['Income recovered',m(T.recovered),m(T.lost)+' still lost',1],
  ['Time to refill',r.medianMins!=null?r.medianMins+' min':'–','median, from cancellation to booked'],
  ['Reminders confirmed',remPct+'%',r.reminders.cantMake+' said can’t make it in time to refill']
 ].map(function(k){return '<div class="rp-kpi'+(k[3]?' hi':'')+'"><span>'+k[0]+'</span><b>'+k[1]+'</b><small>'+k[2]+'</small></div>'}).join('');
 chart(r);insights(r);pract(r);side(r);var nw=new Date(H.now());$('rpNow').textContent=nw.getDate()+' '+F.MON[nw.getMonth()]+' '+nw.getFullYear()+', '+F.time(nw)}
// stacked weekly bars: refilled (teal) under lost (clay). Colours validated for colour-blind separation.
function chart(r){var el=$('rpChart'),W=r.weeks,max=Math.max.apply(null,W.map(function(w){return w.refilled+w.lost}).concat([1]));
 function wl(w){var a=new Date(w.from),b=new Date(w.from+6*864e5);return a.getDate()+' '+F.MON[a.getMonth()]+'–'+b.getDate()+' '+F.MON[b.getMonth()]}
 if(asTable){el.innerHTML='<div class="adm-tbl"><table><thead><tr><th scope="col">Week</th><th scope="col">Refilled</th><th scope="col">Not refilled</th><th scope="col">Fill rate</th></tr></thead><tbody>'+
  W.map(function(w){return '<tr><td>'+wl(w)+'</td><td>'+w.refilled+'</td><td>'+w.lost+'</td><td>'+pct(w.refilled,w.refilled+w.lost)+'%</td></tr>'}).join('')+'</tbody></table></div>';return}
 var step=max>12?5:2,ticks=[];for(var t=0;t<=max;t+=step)ticks.push(t);var top=ticks[ticks.length-1]<max?ticks[ticks.length-1]+step:ticks[ticks.length-1];if(ticks[ticks.length-1]<top)ticks.push(top);
 el.innerHTML='<div class="rp-legend"><span class="a">Refilled</span><span class="b">Not refilled</span></div><div class="rp-chart" role="img" aria-label="Cancellations per week, split into refilled and not refilled. Use Show as table for the numbers.">'+
  '<div class="rp-y">'+ticks.slice().reverse().map(function(t){return '<span style="bottom:'+(t/top*100)+'%">'+t+'</span>'}).join('')+'</div>'+
  '<div class="rp-plot">'+ticks.map(function(t){return '<i class="rp-gl" style="bottom:'+(t/top*100)+'%"></i>'}).join('')+
  W.map(function(w,i){return '<div class="rp-col" tabindex="0" data-i="'+i+'"><div class="rp-stack"><b class="b" style="height:'+(w.lost/top*100)+'%"></b><b class="a" style="height:'+(w.refilled/top*100)+'%"></b></div><span class="rp-x">'+new Date(w.from).getDate()+' '+F.MON[new Date(w.from).getMonth()]+'</span></div>'}).join('')+
  '<div class="rp-tip" role="status" hidden></div></div></div>';
 var tip=el.querySelector('.rp-tip');
 [].forEach.call(el.querySelectorAll('.rp-col'),function(c){function show(){var w=W[+c.dataset.i];tip.hidden=false;tip.innerHTML='<b>'+wl(w)+'</b><span class="a">Refilled <em>'+w.refilled+'</em></span><span class="b">Not refilled <em>'+w.lost+'</em></span><span>Fill rate <em>'+pct(w.refilled,w.refilled+w.lost)+'%</em></span>';
   tip.style.left=Math.min(c.offsetLeft+c.offsetWidth/2,c.parentNode.offsetWidth-90)+'px'}
  c.addEventListener('mouseenter',show);c.addEventListener('focus',show);c.addEventListener('mouseleave',function(){tip.hidden=true});c.addEventListener('blur',function(){tip.hidden=true})})}
function insights(r){var T=r.totals,out=[],rows=r.byPract.slice();
 var avg=T.booked?((T.recovered+T.lost)/Math.max(1,r.cancellations)):0,perMonth=30/r.days;
 out.push(['good','The waitlist refilled <b>'+r.fillRate+'%</b> of cancellations, bringing back <b>'+m(T.recovered)+'</b>. Each extra 10% filled would be about <b>'+m(r.cancellations*0.1*avg*perMonth)+'</b> a month.']);
 function used(x){return x.capacity?(x.booked-x.late-x.early-x.noshow+x.refilled)/x.capacity:1}
 var worst=rows.sort(function(a,b){return b.lost-a.lost})[0];if(worst&&worst.lost){var n=(r.waitlist.perPract.filter(function(x){return x.first===worst.first})[0]||{n:0}).n;
  out.push(['warn','Most unfilled time was with <b>'+esc(worst.name)+'</b> ('+m(worst.lost)+'). '+(n?n+(n>1?' people':' person')+' on the waitlist would see '+esc(worst.first)+'.':'Nobody on the waitlist is asking for '+esc(worst.first)+', so more online times or a broader waitlist would help.')])}
 var low=r.byPract.slice().sort(function(a,b){return used(a)-used(b)})[0];if(low&&low.capacity)out.push(['info','<b>'+esc(low.name)+'</b> had the most free time: '+Math.round(used(low)*100)+'% of their bookable times were used. Worth checking their online times are showing.']);
 if(T.noshow)out.push(['warn','<b>'+T.noshow+' no-show'+(T.noshow>1?'s':'')+'</b>. Reminders were confirmed '+pct(r.reminders.confirmed,r.reminders.sent)+'% of the time; calling anyone unconfirmed the afternoon before catches most of the rest.']);
 if(r.waitlist.longest[0])out.push(['info','<b>'+r.waitlist.active+'</b> people are waiting (median '+(r.waitlist.medianDays||0)+' days). Longest: '+esc(r.waitlist.longest[0].name)+', '+r.waitlist.longest[0].days+' days, for '+esc(r.waitlist.longest[0].need.toLowerCase())+'.']);
 if(r.referrals.waiting)out.push(['warn','<b>'+r.referrals.waiting+' referral'+(r.referrals.waiting>1?'s':'')+'</b> not booked yet'+(r.referrals.plansMissing?', and '+r.referrals.plansMissing+' Medicare plan'+(r.referrals.plansMissing>1?'s':'')+' still to come':'')+'.']);
 if(T.fees)out.push(['info','Late cancellations and no-shows not refilled come to <b>'+m(T.fees)+'</b> under the policy. Practitioners decide whether to charge.']);
 $('rpIns').innerHTML=out.map(function(o){return '<li class="'+o[0]+'">'+o[1]+'</li>'}).join('')}
var ROWS=[];
function pract(r){var wl={};r.waitlist.perPract.forEach(function(x){wl[x.first]=x.n});
 var head=['Practitioner','Booked','Utilisation','Cancelled','No-shows','Refilled','Recovered','Lost','Video','Booked online','Waitlist'];
 ROWS=r.byPract.map(function(x){return [x.name,x.booked,pct(x.booked-x.late-x.early-x.noshow+x.refilled,x.capacity)+'%',x.late+x.early+' ('+x.late+' late)',x.noshow,x.refilled,m(x.recovered),m(x.lost),pct(x.video,x.booked)+'%',pct(x.online,x.booked)+'%',wl[x.first]||0]});
 var T=r.totals;ROWS.push(['Total',T.booked,r.utilisation+'%',T.late+T.early+' ('+T.late+' late)',T.noshow,T.refilled,m(T.recovered),m(T.lost),pct(T.video,T.booked)+'%',pct(T.online,T.booked)+'%',r.waitlist.active]);
 $('rpPract').innerHTML='<table><thead><tr>'+head.map(function(h,i){return '<th scope="col"'+(i?' class="n"':'')+'>'+h+'</th>'}).join('')+'</tr></thead><tbody>'+ROWS.map(function(rw,j){return '<tr'+(j===ROWS.length-1?' class="tot"':'')+'>'+rw.map(function(c,i){return (i?'<td class="n">':'<th scope="row">')+esc(c)+(i?'</td>':'</th>')}).join('')+'</tr>'}).join('')+'</tbody></table>';
 ROWS.head=head}
function side(r){var w=r.waitlist,f=r.referrals,x=r.reminders;
 function dl(rows){return '<dl class="rp-dl">'+rows.map(function(k){return '<div><dt>'+k[0]+'</dt><dd>'+k[1]+'</dd></div>'}).join('')+'</dl>'}
 $('rpWl').innerHTML=dl([['Waiting now',w.active],['Paused (no reply to check-in)',w.paused],['Check-in sent, no reply yet',w.checking],['Median time waiting',(w.medianDays||0)+' days'],['Booked from the waitlist',w.booked]])+
  (w.longest.length?'<h3 class="adm-day">Waiting longest</h3><ol class="rp-ol">'+w.longest.map(function(l){return '<li><b>'+esc(l.name)+'</b> '+l.days+' days · '+esc(l.need)+'</li>'}).join('')+'</ol>':'');
 $('rpRef').innerHTML=dl([['Received',f.received],['Booked',f.booked],['Not booked yet',f.waiting],['Medicare plans still to come',f.plansMissing],['Median days, referral to booking',f.medianDays!=null?f.medianDays:'–']]);
 $('rpTxt').innerHTML=dl([['Reminders sent',x.sent],['Confirmed',x.confirmed+' ('+pct(x.confirmed,x.sent)+'%)'],['Can’t make it (freed early)',x.cantMake],['Texts sent, all kinds',r.texts.count],['Estimated SMS cost',m(r.texts.cost)]])+
  (r.series?'<p class="adm-muted">'+r.series+' regular (weekly or fortnightly) series booked online.</p>':'')}
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;
 if(b.dataset.days){days=+b.dataset.days;draw();return}
 if('table' in b.dataset){asTable=!asTable;b.setAttribute('aria-pressed',asTable);b.textContent=asTable?'Show as chart':'Show as table';chart(api.report(days));return}
 if('print' in b.dataset){window.print();return}
 if('csv' in b.dataset){var s=[ROWS.head].concat(ROWS).map(function(r){return r.map(function(c){c=String(c);return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c}).join(',')}).join('\r\n');
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+s],{type:'text/csv'}));a.download='hub-report-'+days+'d-'+new Date(H.now()).toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove()}});
api.on(draw);draw();
})();
