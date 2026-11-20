/* SOP page: print, and highlight the section you're reading in the contents. */
(function(){
document.addEventListener('click',function(e){if(e.target.closest('[data-print]'))window.print()});
var links=[].slice.call(document.querySelectorAll('.sop-toc a'));
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){links.forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+en.target.id)})}})},{rootMargin:'-90px 0px -70% 0px'});
 [].forEach.call(document.querySelectorAll('.sop-doc section'),function(s){io.observe(s)})}
})();
