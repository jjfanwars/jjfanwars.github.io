// UNDERGROWTH: DOM HUD, minimap, compass, menus and damage feedback.
// Owns everything inside #hud and #menu. Reads sibling modules defensively and
// listens on the shared event bus; never writes game state.

import { WORLD, clamp, lerp, smoothstep, noise2D, rand, events as sharedEvents } from './util.js';

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const EMPTY_DASH = [];

const ITEMS = ['rifle', 'shovel', 'satchel', 'grenade', 'trap'];
const ITEM_NAME = { rifle: 'Type 56', shovel: 'Shovel', satchel: 'Satchel charge', grenade: 'Stick grenade', trap: 'Punji pit' };
const DIG_SIZES = ['small', 'large', 'tunnel'];
const ALERT_LABEL = ['Quiet', 'Suspicious', 'Combat'];
const STANCES = ['stand', 'crouch', 'prone'];
// tunnels.digTarget() refusal reasons -> short status tags (reasons not listed show nothing)
const DIG_REFUSAL = {
  water: 'Water', blocked: 'Blocked', edge: 'Blocked', firebase: 'Firebase', deep: 'Too deep', limit: 'Too much dug',
};

const ICONS = {
  rifle: '<path d="M1 5.6l6.2-.6H19l1-1h11v1.7h-8.4l-.7 1.1h-2.6l-.5 1.3c1.3 1.3 1.9 3 1.7 4.8l-2.3-.3c.2-1.4-.3-2.7-1.4-3.7l-.1-.8h-3.3l-1.2 2.2H9.1l.8-2.2H7.6L2.1 11.6H1z"/>',
  shovel: '<path d="M2 6.6h3v-1h1.1v1h12.7v2.8H6.1v1H5v-1H2z"/><path d="M19.2 5.3c3-.9 6.1-.9 9.4.4 1.5.6 1.5 3.4 0 4-3.3 1.3-6.4 1.3-9.4.4z"/>',
  satchel: '<path d="M7 5.4h18a2 2 0 0 1 2 2v5.4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7.4a2 2 0 0 1 2-2z"/><path d="M11 5.4V2.6h10v2.8h-1.5V4H12.5v1.4z"/><path d="M27 9.2c1.6 0 2.6.9 3.4 2.4" fill="none" stroke="currentColor" stroke-width="1"/>',
  grenade: '<path d="M3.2 7h15v2.2h-15z"/><path d="M18 4.4h7.4a2.2 2.2 0 0 1 2.2 2.2v3a2.2 2.2 0 0 1-2.2 2.2H18z"/><path d="M1.4 7.4h1.6v1.4H1.4z"/>',
  trap: '<path d="M5 14l2.4-8.6L9.8 14zM11 14l2.5-10.8L16 14zM17 14l2.4-7.8L21.8 14zM23 14l2.5-9.6L28 14z"/><path d="M3 14h26v1.3H3z"/>',
};

const STANCE_SVG = {
  stand: '<circle cx="10" cy="3.2" r="2"/><path d="M10 5.6v6.2M10 7.4l-3 3.2M10 7.4l3 3.2M10 11.8l-2.4 6.2M10 11.8l2.4 6.2"/>',
  crouch: '<circle cx="11" cy="6.6" r="2"/><path d="M10.4 8.8l-2.6 4.6M9.4 10.4l3.6 2M7.8 13.4l4.4 1.2-1.4 3.6M7.8 13.4l-1.6 4.4"/>',
  prone: '<circle cx="3.6" cy="12.6" r="2"/><path d="M5.8 13.6h9.4M15.2 13.6l3.6 1.6M15.2 13.6l3.4-.6M7.2 13.6l1.6 2.6"/>',
};

const EYE_SVG = `
<svg class="ug-eye" viewBox="0 0 32 20" aria-hidden="true">
  <g class="ug-eye-open">
    <path d="M2 10 Q16 -1.5 30 10 Q16 21.5 2 10 Z" fill="rgba(0,0,0,.25)" stroke="currentColor" stroke-width="1.4"/>
    <circle class="ug-iris" cx="16" cy="10" r="4.2" fill="currentColor"/>
    <circle cx="17.3" cy="8.7" r="1.1" fill="rgba(0,0,0,.55)"/>
  </g>
  <g class="ug-eye-shut" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
    <path d="M3 9 Q16 17.5 29 9"/>
    <path d="M8 12.6l-1.4 2.4M16 14.2v2.7M24 12.6l1.4 2.4"/>
  </g>
</svg>`;

const CSS = `
#hud,#menu{--paper:#d7d1bc;--paper2:rgba(215,209,188,.68);--paper3:rgba(215,209,188,.4);--line:rgba(215,209,188,.13);
--olive:#8e9362;--ochre:#bb9b5c;--blood:#a8452f;--alarm:#c9714a;
--sans:system-ui,-apple-system,"Segoe UI",Ubuntu,Cantarell,"Noto Sans",sans-serif;
--mono:ui-monospace,"SF Mono","DejaVu Sans Mono","Liberation Mono",Menlo,Consolas,monospace;
--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Noto Serif","DejaVu Serif",serif;}
#hud{position:fixed;inset:0;z-index:10;pointer-events:none;overflow:hidden;color:var(--paper);font:12px/1.35 var(--sans);
user-select:none;-webkit-user-select:none;text-shadow:0 1px 2px rgba(0,0,0,.6);}
#hud *,#menu *{box-sizing:border-box}
.ug-layer{position:absolute;inset:0;opacity:1;transition:opacity .45s ease}
#hud[data-state="menu"] .ug-layer,#hud[data-state="end"] .ug-layer{opacity:0}
#hud.ug-dead .ug-layer{opacity:0;transition:opacity 1.6s ease}
.ug-panel{background:linear-gradient(180deg,rgba(18,20,15,.6),rgba(11,13,9,.5));border:1px solid var(--line);border-radius:2px;
box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 6px 18px rgba(0,0,0,.22)}
.ug-lbl{font:600 9.5px/1 var(--sans);letter-spacing:.2em;text-transform:uppercase;color:var(--paper3)}
.ug-mono{font-family:var(--mono)}

.ug-obj{position:absolute;left:22px;top:20px;max-width:min(390px,38vw);padding:8px 13px 9px 12px;border-left:2px solid var(--olive);
transition:opacity .4s ease,transform .4s ease}
.ug-obj.ug-hide{opacity:0;transform:translateX(-6px)}
.ug-obj-text{margin-top:6px;font-size:13px;letter-spacing:.01em;color:var(--paper);transition:color .4s}
.ug-obj.ug-done{border-left-color:var(--ochre)}
.ug-obj.ug-done .ug-obj-text{color:var(--paper3);text-decoration:line-through;text-decoration-color:rgba(187,155,92,.75)}
.ug-obj.ug-new{animation:ugObjIn .9s ease}
@keyframes ugObjIn{0%{opacity:0;transform:translateX(-10px)}35%{opacity:1}60%{border-left-color:var(--paper)}100%{opacity:1;transform:none}}

.ug-compass{position:absolute;top:10px;left:50%;width:400px;margin-left:-200px;height:60px}
.ug-compass canvas{display:block;width:400px;height:42px;
-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 20%,#000 80%,transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 20%,#000 80%,transparent 100%)}
.ug-heading{position:absolute;top:43px;left:0;right:0;text-align:center;font:500 10.5px/1 var(--mono);color:var(--paper2);letter-spacing:.08em}

.ug-alert{position:absolute;right:22px;top:18px;display:flex;align-items:center;gap:11px;padding:7px 12px 8px 10px;color:var(--paper3);transition:color .4s}
.ug-eye{width:32px;height:20px;display:block;overflow:visible}
.ug-eye-open{transform-origin:16px 10px;transform:scaleY(0);opacity:0;transition:transform .35s ease,opacity .35s}
.ug-eye-shut{transition:opacity .3s}
.ug-alert[data-level="1"]{color:var(--ochre)}
.ug-alert[data-level="1"] .ug-eye-open{transform:scaleY(.55);opacity:1}
.ug-alert[data-level="1"] .ug-eye-shut,.ug-alert[data-level="2"] .ug-eye-shut{opacity:0}
.ug-alert[data-level="2"]{color:var(--alarm)}
.ug-alert[data-level="2"] .ug-eye-open{transform:scaleY(1);opacity:1}
.ug-alert[data-level="2"] .ug-eye{animation:ugPulse 1.1s ease-in-out infinite}
@keyframes ugPulse{50%{opacity:.55}}
.ug-alert-lbl{font:600 9.5px/1 var(--sans);letter-spacing:.2em;text-transform:uppercase;color:currentColor}
.ug-vis{width:72px;height:3px;margin-top:6px;background:rgba(215,209,188,.1);overflow:hidden;border-radius:1px}
.ug-vis i{display:block;height:100%;background:currentColor;transform-origin:0 50%;transform:scaleX(0);opacity:.85}

.ug-map{position:absolute;left:22px;bottom:22px;width:300px;height:300px;border-radius:50%;transform:scale(.56);transform-origin:0 100%;
transition:transform .22s ease;box-shadow:0 0 0 1px rgba(215,209,188,.18),0 10px 28px rgba(0,0,0,.5);background:#0c0f0b}
.ug-map canvas{display:block;width:300px;height:300px;border-radius:50%}
.ug-mapbig .ug-map{transform:scale(1)}

.ug-vitals{position:absolute;left:204px;bottom:22px;width:206px;padding:9px 11px 10px;transition:transform .22s ease}
.ug-mapbig .ug-vitals{transform:translateX(134px)}
.ug-row{display:flex;align-items:center;gap:8px}
.ug-row+.ug-row{margin-top:7px}
.ug-bar{position:relative;flex:1;height:6px;background:rgba(215,209,188,.08);overflow:hidden;border-radius:1px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}
.ug-bar i{position:absolute;inset:0;transform-origin:0 50%}
.ug-hp-ghost{background:rgba(215,209,188,.34)}
.ug-hp-fill{background:linear-gradient(90deg,#7f3224,#ad513a)}
.ug-vitals.ug-low .ug-hp-fill{animation:ugPulse .9s ease-in-out infinite}
.ug-st{height:3px}
.ug-st-fill{background:linear-gradient(90deg,#8e7a49,#bb9f63)}
.ug-exh .ug-st-fill{background:#7d4a36}
.ug-strow{transition:opacity .6s ease}
.ug-num{font:600 12px/1 var(--mono);min-width:24px;text-align:right;color:var(--paper)}
.ug-stance{width:18px;height:18px;flex:none;fill:none;stroke:var(--paper2);stroke-width:1.5;stroke-linecap:round}
.ug-stance circle{fill:var(--paper2);stroke:none}
.ug-tag{margin-left:auto;font:600 9px/1 var(--sans);letter-spacing:.18em;text-transform:uppercase;color:var(--ochre);opacity:0;transition:opacity .3s}
.ug-tag.on{opacity:.9}

.ug-wpn{position:absolute;right:22px;bottom:22px;min-width:228px;padding:10px 12px 10px;text-align:right}
.ug-wtop{display:flex;justify-content:flex-end;align-items:baseline;gap:10px}
.ug-wstate{font:600 9px/1 var(--sans);letter-spacing:.2em;text-transform:uppercase;color:var(--ochre);opacity:0;transition:opacity .2s}
.ug-wstate.on{opacity:1}
.ug-ammo{margin-top:6px;font:600 30px/1 var(--mono);letter-spacing:-.02em;color:var(--paper);white-space:nowrap}
.ug-ammo .ug-sep{color:var(--paper3);font-size:17px;margin:0 3px}
.ug-ammo .ug-res{font-size:16px;color:var(--paper2)}
.ug-ammo.ug-lowammo .ug-mag{color:var(--alarm)}
.ug-ammo.ug-noammo .ug-mag{color:var(--blood)}
.ug-sizes{margin-top:8px;display:flex;justify-content:flex-end;gap:4px}
.ug-sizes span{font:600 9px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;padding:4px 6px;border:1px solid var(--line);color:var(--paper3);transition:all .15s}
.ug-sizes span.on{color:#14170f;background:var(--paper2);border-color:transparent;text-shadow:none}
.ug-rl{height:2px;margin-top:7px;background:rgba(215,209,188,.08);overflow:hidden;opacity:0;transition:opacity .15s}
.ug-rl.on{opacity:1}
.ug-rl i{display:block;height:100%;background:var(--ochre);transform-origin:0 50%;transform:scaleX(0)}
.ug-slots{display:flex;gap:4px;justify-content:flex-end;margin-top:9px}
.ug-slot{position:relative;width:40px;height:30px;border:1px solid var(--line);background:rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;
color:var(--paper2);opacity:.5;transition:opacity .15s,border-color .15s,background .15s}
.ug-slot.on{opacity:1;border-color:rgba(215,209,188,.5);background:rgba(215,209,188,.07);color:var(--paper)}
.ug-slot.ug-empty{opacity:.22}
.ug-slot.on.ug-empty{opacity:.6}
.ug-slot b{position:absolute;left:3px;top:2px;font:600 8px/1 var(--mono);color:var(--paper3)}
.ug-slot em{position:absolute;right:3px;bottom:2px;font:600 9px/1 var(--mono);font-style:normal;color:var(--paper)}
.ug-slot svg{width:26px;height:13px;fill:currentColor}

.ug-xh{position:absolute;left:50%;top:50%;width:0;height:0;transition:opacity .1s}
.ug-xh i{position:absolute;background:rgba(228,223,204,.9);box-shadow:0 0 0 .5px rgba(0,0,0,.55)}
.ug-xh .t,.ug-xh .b{width:2px;height:7px;left:-1px}
.ug-xh .t{top:-7px}.ug-xh .b{top:0}
.ug-xh .l,.ug-xh .r{height:2px;width:7px;top:-1px}
.ug-xh .l{left:-7px}.ug-xh .r{left:0}
.ug-xh .d{width:2px;height:2px;left:-1px;top:-1px;border-radius:50%}
.ug-xh.ug-dotonly .t,.ug-xh.ug-dotonly .b,.ug-xh.ug-dotonly .l,.ug-xh.ug-dotonly .r{opacity:0}
.ug-hm{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0}
.ug-hm i{position:absolute;left:-1px;top:-11px;width:2px;height:7px;background:#e4dfcc;box-shadow:0 0 0 .5px rgba(0,0,0,.6);transform-origin:1px 11px}
.ug-hm.ug-head i{background:var(--ochre)}
.ug-hm.ug-kill i{background:#c4503a;height:9px;top:-13px;transform-origin:1px 13px}

.ug-ring{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;opacity:0;transition:opacity .15s}
.ug-ring svg{width:64px;height:64px;transform:rotate(-90deg);overflow:visible}
.ug-ring circle{fill:none;stroke-width:2.5}
.ug-ring .trk{stroke:rgba(215,209,188,.14)}
.ug-ring .pr{stroke:var(--ochre);stroke-linecap:round;filter:drop-shadow(0 0 2px rgba(0,0,0,.7))}
.ug-ring.ug-plant .pr{stroke:var(--alarm)}

.ug-use{position:absolute;left:50%;top:calc(50% + 46px);transform:translateX(-50%);display:flex;align-items:center;gap:7px;opacity:0;transition:opacity .15s;white-space:nowrap}
.ug-key{font:700 11px/1 var(--mono);padding:3px 5px;border:1px solid rgba(215,209,188,.55);border-radius:2px;background:rgba(0,0,0,.4);color:var(--paper)}
.ug-use span:last-child{font:600 10px/1 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--paper2)}
.ug-use.ug-no .ug-key{display:none}
.ug-use.ug-no span:last-child{color:var(--alarm);opacity:.85}

.ug-toasts{position:absolute;left:50%;top:19vh;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:5px}
.ug-toast{padding:5px 13px 6px;font-size:12px;letter-spacing:.04em;color:var(--paper);background:rgba(12,14,10,.58);border:1px solid var(--line);
border-radius:2px;opacity:0;transform:translateY(-5px);transition:opacity .25s ease,transform .25s ease;white-space:nowrap}
.ug-toast.in{opacity:1;transform:none}

.ug-fx{position:absolute;inset:0;pointer-events:none}
.ug-shade{background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 55%,rgba(0,0,0,.55) 100%);opacity:.35}
.ug-vig{background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 46%,rgba(92,10,5,.5) 76%,rgba(52,0,0,.92) 100%);opacity:0}
.ug-flash{background:radial-gradient(ellipse at 50% 50%,rgba(150,28,14,.05) 30%,rgba(150,28,14,.45) 100%);opacity:0}
.ug-dmgs{position:absolute;left:50%;top:50%;width:0;height:0}
.ug-dmg{position:absolute;left:-160px;top:-160px;width:320px;height:320px;border-radius:50%;border:6px solid transparent;
border-top-color:rgba(180,46,28,.95);opacity:0;filter:blur(.7px)}
.ug-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}

#menu{position:fixed;inset:0;z-index:20;pointer-events:none;color:var(--paper);font:13px/1.4 var(--sans);user-select:none;-webkit-user-select:none}
.ug-scr{position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .7s ease,visibility 0s linear .7s}
.ug-scr.show{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .7s ease}
.ug-title{background:#090c0a;overflow:hidden}
.ug-bg{position:absolute;inset:0;overflow:hidden;animation:ugBreath 46s ease-in-out infinite alternate}
@keyframes ugBreath{from{transform:scale(1)}to{transform:scale(1.045)}}
.ug-bg canvas{position:absolute;left:-3%;top:-3%;width:106%;height:106%;will-change:transform}
.ug-mist{position:absolute;left:-50%;width:200%;pointer-events:none;will-change:transform}
.ug-mist.a{top:52%;height:22%;background:radial-gradient(ellipse 30% 50% at 25% 50%,rgba(150,140,104,.2),transparent 70%),radial-gradient(ellipse 26% 42% at 70% 55%,rgba(150,140,104,.16),transparent 70%);animation:ugMist 70s linear infinite alternate}
.ug-mist.b{top:70%;height:26%;background:radial-gradient(ellipse 34% 50% at 40% 50%,rgba(120,118,92,.2),transparent 70%),radial-gradient(ellipse 22% 40% at 85% 45%,rgba(120,118,92,.15),transparent 70%);animation:ugMist 54s linear infinite alternate-reverse}
@keyframes ugMist{from{transform:translateX(-6%)}to{transform:translateX(6%)}}
.ug-heli{position:absolute;top:24%;left:0;width:150px;height:56px;opacity:.55;animation:ugHeli 84s linear infinite;animation-delay:-22s}
.ug-heli canvas{position:absolute;inset:0;width:150px;height:56px}
.ug-rotor{position:absolute;left:24px;top:6px;width:92px;height:1.6px;background:rgba(14,18,13,.9);transform-origin:50% 50%;animation:ugRotor .09s linear infinite}
@keyframes ugRotor{0%{transform:scaleX(1)}50%{transform:scaleX(.25)}100%{transform:scaleX(1)}}
@keyframes ugHeli{0%{transform:translate(-20vw,0) scale(.62)}50%{transform:translate(48vw,-1.5vh) scale(.62)}100%{transform:translate(118vw,1vh) scale(.62)}}
.ug-fly{position:absolute;width:3px;height:3px;border-radius:50%;background:rgba(222,232,150,.95);box-shadow:0 0 6px 2px rgba(200,220,110,.35);opacity:0;animation:ugFly 7s ease-in-out infinite}
@keyframes ugFly{0%,100%{opacity:0;transform:translate(0,0)}20%{opacity:.85}45%{opacity:.1}60%{opacity:.7;transform:translate(18px,-12px)}80%{opacity:0;transform:translate(30px,-4px)}}
.ug-grain{position:absolute;inset:-50%;opacity:.07;pointer-events:none;animation:ugGrain 1.2s steps(6) infinite}
@keyframes ugGrain{0%{transform:translate(0,0)}20%{transform:translate(-3%,2%)}40%{transform:translate(2%,-4%)}60%{transform:translate(-4%,-2%)}80%{transform:translate(3%,3%)}100%{transform:translate(0,0)}}
.ug-tshade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,7,5,.72) 0%,rgba(5,7,5,.3) 38%,rgba(5,7,5,0) 60%),linear-gradient(0deg,rgba(4,5,4,.6),rgba(4,5,4,0) 30%)}
.ug-tblock{position:absolute;left:max(28px,9vw);top:50%;transform:translateY(-46%)}
.ug-tname{font:800 clamp(38px,6.6vw,92px)/.95 var(--sans);letter-spacing:.3em;margin-right:-.3em;color:#dbd5c1;text-shadow:0 2px 40px rgba(0,0,0,.65)}
.ug-tsub{margin-top:16px;font:italic 400 clamp(16px,1.6vw,22px)/1.2 var(--serif);color:rgba(219,213,193,.74);letter-spacing:.03em}
.ug-rule{width:66px;height:1px;background:rgba(219,213,193,.35);margin:30px 0 28px}
.ug-btn{appearance:none;-webkit-appearance:none;cursor:pointer;background:rgba(14,17,12,.55);color:var(--paper);border:1px solid rgba(219,213,193,.42);
padding:12px 34px 12px 38px;font:600 12px/1 var(--sans);letter-spacing:.36em;text-transform:uppercase;border-radius:1px;
transition:background .2s,color .2s,border-color .2s,transform .2s}
.ug-btn:hover{background:rgba(219,213,193,.92);color:#10130e;border-color:transparent}
.ug-btn:active{transform:translateY(1px)}
.ug-btn:focus-visible{outline:1px solid var(--ochre);outline-offset:4px}
.ug-stamp{position:absolute;right:28px;bottom:22px;font:10.5px/1.6 var(--mono);letter-spacing:.14em;color:rgba(219,213,193,.32);text-align:right}
.ug-veil{background:rgba(5,7,5,.55);-webkit-backdrop-filter:blur(3px) saturate(.7);backdrop-filter:blur(3px) saturate(.7)}
.ug-end.ug-lost{background:radial-gradient(ellipse at 50% 50%,rgba(40,6,4,.55),rgba(8,2,2,.88))}
.ug-end.ug-won{background:radial-gradient(ellipse at 50% 50%,rgba(14,20,12,.5),rgba(4,6,4,.86))}
.ug-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(380px,calc(100vw - 32px));padding:26px 30px 26px;
background:linear-gradient(180deg,rgba(20,22,17,.92),rgba(13,15,11,.92));border:1px solid var(--line);border-radius:2px;
box-shadow:0 20px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.03)}
.ug-card .ug-lbl{display:block}
.ug-card h2{margin:10px 0 0;font:700 22px/1.15 var(--sans);letter-spacing:.16em;text-transform:uppercase;color:var(--paper)}
.ug-end.ug-lost .ug-card h2{color:#c9765e}
.ug-reason{margin-top:8px;font:italic 15px/1.35 var(--serif);color:var(--paper2);min-height:1em}
.ug-pobj{margin-top:10px;font-size:13px;color:var(--paper2)}
.ug-stats{margin:20px 0 24px;padding:0}
.ug-stats div{display:flex;align-items:baseline;gap:10px;padding:7px 0;border-bottom:1px dashed rgba(215,209,188,.13)}
.ug-stats dt{font-size:12px;letter-spacing:.06em;color:var(--paper2)}
.ug-stats dd{margin:0 0 0 auto;font:600 14px/1 var(--mono);color:var(--paper)}
.ug-card .ug-btn{margin-top:4px}
.ug-pause .ug-card{width:min(320px,calc(100vw - 32px))}
.ug-pause .ug-card h2{letter-spacing:.34em;font-size:15px;margin:0}
.ug-pause .ug-btn{margin-top:22px}
@media (max-width:720px){
.ug-compass{transform:scale(.8);transform-origin:50% 0}
.ug-obj{max-width:calc(100vw - 150px)}
.ug-vitals{left:22px;bottom:200px}
.ug-mapbig .ug-vitals{transform:none;opacity:0}
}
`;

function truthy(v) { return v === true || v === 1 || v === '1' || v === 'true' || v === 'yes'; }

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// Cached style writes: skip the DOM when nothing changed.
function setOp(e, v) {
  v = Math.round(v * 100) / 100;
  if (e._op !== v) { e._op = v; e.style.opacity = v; }
}
function setScaleX(e, v) {
  v = Math.round(clamp(v, 0, 1) * 1000) / 1000;
  if (e._sx !== v) { e._sx = v; e.style.transform = 'scaleX(' + v + ')'; }
}
function setText(e, s) {
  if (e._tx !== s) { e._tx = s; e.textContent = s; }
}
function setClass(e, cls, on) {
  on = !!on;
  const k = '_c_' + cls;
  if (e[k] !== on) { e[k] = on; e.classList.toggle(cls, on); }
}

function wrap180(d) { d %= 360; if (d > 180) d -= 360; else if (d < -180) d += 360; return d; }
function norm360(d) { d %= 360; return d < 0 ? d + 360 : d; }

function pad3(n) { n = Math.round(n) % 360; return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  if (sec > 36000) sec /= 1000;            // given in ms
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = m < 10 ? '0' + m : '' + m, ss = s < 10 ? '0' + s : '' + s;
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
}

// Pull a position-like object out of whatever shape an enemy has.
function posOf(o) {
  if (!o) return null;
  const p = o.position || o.pos || o.root?.position || o.group?.position || o.object?.position || o.mesh?.position || o.model?.position;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return p;
  if (Number.isFinite(o.x) && Number.isFinite(o.z)) return o;
  return null;
}
function isDeadEnemy(e) {
  return !e || e.alive === false || e.dead === true || e.state === 'dead' || e.removed === true ||
    (Number.isFinite(e.health) && e.health <= 0) || (Number.isFinite(e.hp) && e.hp <= 0);
}
function ptOf(o) {
  return o && Number.isFinite(o.x) && Number.isFinite(o.z) ? o : null;
}

// ---------------------------------------------------------------------------
// Menu backdrop painting: layered jungle silhouettes at dusk
// ---------------------------------------------------------------------------

function quadPt(t, x0, y0, cx, cy, x1, y1, out) {
  const u = 1 - t;
  out[0] = u * u * x0 + 2 * u * t * cx + t * t * x1;
  out[1] = u * u * y0 + 2 * u * t * cy + t * t * y1;
  out[2] = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
  out[3] = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
  return out;
}

// One palm frond: arched spine with paired leaflets, all into the current path.
function frondPath(g, x, y, ang, len, droop, leaf, s, rnd, density = 0.045) {
  const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len + droop * len;
  const cx = x + Math.cos(ang) * len * 0.55, cy = y + Math.sin(ang) * len * 0.55 - len * 0.14;
  const q = [0, 0, 0, 0];
  // spine (thin quad)
  g.moveTo(x, y - 1.2 * s);
  g.quadraticCurveTo(cx, cy - 0.8 * s, ex, ey);
  g.quadraticCurveTo(cx, cy + 0.8 * s, x, y + 1.2 * s);
  g.closePath();
  for (let t = 0.07; t < 0.99; t += density) {
    quadPt(t, x, y, cx, cy, ex, ey, q);
    const tl = Math.hypot(q[2], q[3]) || 1;
    const tx = q[2] / tl, ty = q[3] / tl;
    const L = leaf * Math.pow(Math.sin(Math.PI * clamp(t * 0.92 + 0.06, 0, 1)), 0.7) * (0.75 + 0.35 * rnd());
    for (let side = -1; side <= 1; side += 2) {
      const a = Math.atan2(ty, tx) + side * (1.05 + rnd() * 0.25);
      let dx = Math.cos(a), dy = Math.sin(a);
      dy += 0.55; // leaflets hang
      const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
      const lx = q[0] + dx * L, ly = q[1] + dy * L;
      const nx = -dy * L * 0.09, ny = dx * L * 0.09;
      const mx = (q[0] + lx) * 0.5, my = (q[1] + ly) * 0.5;
      g.moveTo(q[0], q[1]);
      g.quadraticCurveTo(mx + nx, my + ny, lx, ly);
      g.quadraticCurveTo(mx - nx * 0.4, my - ny * 0.4, q[0], q[1]);
    }
  }
}

function palmPath(g, bx, by, topX, topY, s, rnd, scale = 1) {
  // tapered curved trunk
  const cx = lerp(bx, topX, 0.5) + (topX - bx) * 0.6 + (rnd() - 0.5) * 30 * s;
  const cy = lerp(by, topY, 0.55);
  const q = [0, 0, 0, 0];
  const N = 18, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    quadPt(t, bx, by, cx, cy, topX, topY, q);
    const tl = Math.hypot(q[2], q[3]) || 1;
    const w = lerp(7.5, 3.2, t) * s * scale * (1 + 0.08 * Math.sin(t * 60));
    L.push(q[0] - (q[3] / tl) * w, q[1] + (q[2] / tl) * w);
    R.push(q[0] + (q[3] / tl) * w, q[1] - (q[2] / tl) * w);
  }
  g.moveTo(L[0], L[1]);
  for (let i = 2; i < L.length; i += 2) g.lineTo(L[i], L[i + 1]);
  for (let i = R.length - 2; i >= 0; i -= 2) g.lineTo(R[i], R[i + 1]);
  g.closePath();
  // crown
  const n = 11 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI + (i / (n - 1)) * Math.PI + (rnd() - 0.5) * 0.35;
    const up = Math.sin(-a); // 1 when pointing up
    const len = (70 + rnd() * 45) * s * scale * (0.75 + 0.35 * (1 - up));
    frondPath(g, topX, topY, a + Math.PI * 0.0, len, 0.25 + (1 - up) * 0.55 + rnd() * 0.15, 15 * s * scale, s, rnd);
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * (0.15 + rnd() * 0.7);
    frondPath(g, topX, topY, a, (50 + rnd() * 25) * s * scale, 0.5, 11 * s * scale, s, rnd);
  }
  // coconuts
  for (let i = 0; i < 4; i++) {
    const nx = topX + (rnd() - 0.5) * 10 * s * scale, ny = topY + (5 + rnd() * 3) * s * scale, nr = 3.6 * s * scale;
    g.moveTo(nx + nr, ny);
    g.arc(nx, ny, nr, 0, TAU);
  }
}

function crownPath(g, x, y, w, h, rnd) {
  const n = 9 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const px = x + (rnd() - 0.5) * w;
    const py = y + (rnd() - 0.6) * h * 0.8 - Math.cos(((px - x) / w) * Math.PI) * h * 0.25;
    const rx = w * (0.16 + rnd() * 0.16), ry = h * (0.3 + rnd() * 0.25);
    g.moveTo(px + rx, py);
    g.ellipse(px, py, rx, ry, 0, 0, TAU);
  }
}

function bananaPath(g, bx, by, s, rnd, scale) {
  // pseudo-stem
  g.moveTo(bx - 6 * s * scale, by);
  g.lineTo(bx - 4 * s * scale, by - 120 * s * scale);
  g.lineTo(bx + 4 * s * scale, by - 120 * s * scale);
  g.lineTo(bx + 6 * s * scale, by);
  g.closePath();
  const tx = bx, ty = by - 118 * s * scale;
  const q = [0, 0, 0, 0];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * (0.12 + (i / (n - 1)) * 0.76) + (rnd() - 0.5) * 0.2;
    const len = (110 + rnd() * 60) * s * scale;
    const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len + len * (0.45 + rnd() * 0.3);
    const cx = tx + Math.cos(a) * len * 0.6, cy = ty + Math.sin(a) * len * 0.6 - len * 0.12;
    const W = (24 + rnd() * 10) * s * scale;
    // blade in strips with tears
    let prevT = 0.04;
    while (prevT < 0.97) {
      const step = 0.06 + rnd() * 0.14;
      const t1 = Math.min(0.98, prevT + step);
      for (let side = -1; side <= 1; side += 2) {
        quadPt(prevT, tx, ty, cx, cy, ex, ey, q);
        const ax = q[0], ay = q[1];
        let tl = Math.hypot(q[2], q[3]) || 1;
        const w0 = W * Math.sin(Math.PI * prevT) * side;
        const ax2 = ax - (q[3] / tl) * w0, ay2 = ay + (q[2] / tl) * w0 + Math.abs(w0) * 0.25;
        quadPt(t1, tx, ty, cx, cy, ex, ey, q);
        const bx2 = q[0], by2 = q[1];
        tl = Math.hypot(q[2], q[3]) || 1;
        const w1 = W * Math.sin(Math.PI * t1) * side;
        const bx3 = bx2 - (q[3] / tl) * w1 * 0.95, by3 = by2 + (q[2] / tl) * w1 * 0.95 + Math.abs(w1) * 0.25;
        g.moveTo(ax, ay); g.lineTo(ax2, ay2); g.lineTo(bx3, by3); g.lineTo(bx2, by2); g.closePath();
      }
      prevT = t1 + 0.008 + rnd() * 0.012;
    }
  }
}

function bambooPaths(g, bx, by, h, s, rnd) {
  for (let i = 0; i < 11; i++) {
    const x0 = bx + (rnd() - 0.5) * 60 * s;
    const lean = (rnd() - 0.35) * 160 * s;
    const top = by - h * (0.75 + rnd() * 0.35);
    const w = (2.2 + rnd() * 2.2) * s;
    const cx = x0 + lean * 0.3, cy = lerp(by, top, 0.5);
    const ex = x0 + lean, ey = top;
    const q = [0, 0, 0, 0];
    g.moveTo(x0 - w, by);
    g.quadraticCurveTo(cx - w * 0.8, cy, ex - w * 0.4, ey);
    g.lineTo(ex + w * 0.4, ey);
    g.quadraticCurveTo(cx + w * 0.8, cy, x0 + w, by);
    g.closePath();
    // nodes + leaf sprays
    for (let t = 0.12; t < 1; t += 0.09 + rnd() * 0.05) {
      quadPt(t, x0, by, cx, cy, ex, ey, q);
      g.moveTo(q[0] - w * 1.5, q[1]);
      g.rect(q[0] - w * 1.5, q[1] - 0.8 * s, w * 3, 1.6 * s);
      if (t > 0.45 && rnd() < 0.7) {
        const k = 3 + Math.floor(rnd() * 4);
        for (let j = 0; j < k; j++) {
          const a = (rnd() < 0.5 ? Math.PI : 0) + (rnd() - 0.5) * 1.3 + 0.35;
          const L = (16 + rnd() * 18) * s;
          const lx = q[0] + Math.cos(a) * L, ly = q[1] + Math.sin(a) * L * 0.6 + L * 0.35;
          const nx = -Math.sin(a) * L * 0.1, ny = Math.cos(a) * L * 0.1;
          const mx = (q[0] + lx) / 2, my = (q[1] + ly) / 2;
          g.moveTo(q[0], q[1]);
          g.quadraticCurveTo(mx + nx, my + ny, lx, ly);
          g.quadraticCurveTo(mx - nx, my - ny, q[0], q[1]);
        }
      }
    }
  }
}

function grassPath(g, x0, x1, by, hMin, hMax, s, rnd, density) {
  for (let x = x0; x < x1; x += density * s * (0.4 + rnd())) {
    const h = (hMin + rnd() * (hMax - hMin)) * s;
    const bend = (rnd() - 0.5) * h * 0.7;
    const w = (1.5 + rnd() * 2.2) * s;
    g.moveTo(x - w, by + 2);
    g.quadraticCurveTo(x + bend * 0.35, by - h * 0.6, x + bend, by - h);
    g.quadraticCurveTo(x + bend * 0.35 + w * 0.5, by - h * 0.6, x + w, by + 2);
    g.closePath();
  }
}

function paintBackdrop(layers, W, H) {
  const s = H / 900;
  const rnd = rand(1968);
  // ---- sky ----
  {
    const g = layers[0];
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#080b0a');
    sky.addColorStop(0.3, '#121916');
    sky.addColorStop(0.52, '#2b2f22');
    sky.addColorStop(0.64, '#5b4b2f');
    sky.addColorStop(0.72, '#46392a');
    sky.addColorStop(0.85, '#1c1d16');
    sky.addColorStop(1, '#0c0e0b');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const sx = W * 0.7, sy = H * 0.62;
    let rg = g.createRadialGradient(sx, sy, 0, sx, sy, H * 0.62);
    rg.addColorStop(0, 'rgba(226,160,86,.36)');
    rg.addColorStop(0.25, 'rgba(190,120,64,.16)');
    rg.addColorStop(1, 'rgba(190,120,64,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
    rg = g.createRadialGradient(sx, sy, 0, sx, sy, 30 * s);
    rg.addColorStop(0, 'rgba(250,214,160,.75)');
    rg.addColorStop(0.5, 'rgba(240,190,120,.35)');
    rg.addColorStop(1, 'rgba(240,190,120,0)');
    g.fillStyle = rg; g.fillRect(sx - 40 * s, sy - 40 * s, 80 * s, 80 * s);
    // haze streaks
    g.globalAlpha = 1;
    for (let i = 0; i < 9; i++) {
      const y = H * (0.44 + rnd() * 0.22);
      const x = W * rnd();
      const w = W * (0.2 + rnd() * 0.4), h = (3 + rnd() * 7) * s;
      const lg = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      lg.addColorStop(0, 'rgba(210,170,120,0)');
      lg.addColorStop(0.5, 'rgba(210,170,120,' + (0.03 + rnd() * 0.04).toFixed(3) + ')');
      lg.addColorStop(1, 'rgba(210,170,120,0)');
      g.fillStyle = lg;
      g.fillRect(x - w / 2, y, w, h);
    }
  }
  // ---- far ridge ----
  {
    const g = layers[1];
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 4; x += 3) {
      const base = H * (0.6 + 0.04 * noise2D(x / (260 * s), 3.1) + 0.016 * noise2D(x / (70 * s), 7.7));
      const bump = Math.abs(noise2D(x / (9 * s), 1.3)) * 5 * s + Math.abs(noise2D(x / (23 * s), 5.3)) * 6 * s;
      g.lineTo(x, base - bump);
    }
    g.lineTo(W, H); g.closePath();
    const lg = g.createLinearGradient(0, H * 0.54, 0, H * 0.78);
    lg.addColorStop(0, '#31352a');
    lg.addColorStop(1, '#4b4632');
    g.fillStyle = lg; g.fill();
    // second, closer hazy ridge
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 4; x += 3) {
      const base = H * (0.665 + 0.035 * noise2D(x / (200 * s), 11.1) + 0.012 * noise2D(x / (50 * s), 2.2));
      const bump = Math.abs(noise2D(x / (7 * s), 9.3)) * 7 * s + Math.abs(noise2D(x / (17 * s), 4.1)) * 9 * s;
      g.lineTo(x, base - bump);
    }
    g.lineTo(W, H); g.closePath();
    g.fillStyle = '#262a21'; g.fill();
  }
  // ---- mid tree line ----
  {
    const g = layers[2];
    const col = '#141a13';
    g.fillStyle = col;
    g.beginPath();
    const baseY = (x) => H * (0.735 + 0.02 * noise2D(x / (300 * s), 21.7));
    for (let x = -40 * s; x < W + 40 * s; x += (18 + rnd() * 16) * s) {
      const r = (20 + rnd() * 30) * s;
      const y = baseY(x) - r * 0.5 - rnd() * 46 * s;
      g.moveTo(x + r, y);
      g.ellipse(x, y, r, r * (0.7 + rnd() * 0.25), 0, 0, TAU);
    }
    g.rect(0, H * 0.72, W, H * 0.3);
    // emergent trees
    const nT = Math.max(3, Math.round(W / (380 * s)));
    for (let i = 0; i < nT; i++) {
      const x = W * (0.08 + (i + rnd() * 0.6) / nT * 0.9);
      if (Math.abs(x - W * 0.7) < 80 * s) continue;
      const top = H * (0.33 + rnd() * 0.14);
      const by = baseY(x);
      const tw = (3 + rnd() * 2.5) * s;
      g.moveTo(x - tw * 2.6, by);
      g.quadraticCurveTo(x - tw, lerp(by, top, 0.4), x - tw * 0.7, top);
      g.lineTo(x + tw * 0.7, top);
      g.quadraticCurveTo(x + tw, lerp(by, top, 0.4), x + tw * 2.6, by);
      g.closePath();
      // a few limbs
      for (let k = 0; k < 3; k++) {
        const ly = lerp(top, by, 0.04 + k * 0.05);
        const dir = rnd() < 0.5 ? -1 : 1;
        const lx = x + dir * (30 + rnd() * 40) * s;
        g.moveTo(x, ly + 2 * s); g.lineTo(lx, ly - (14 + rnd() * 12) * s); g.lineTo(x, ly - 2 * s); g.closePath();
      }
      crownPath(g, x, top - 8 * s, (120 + rnd() * 90) * s, (52 + rnd() * 26) * s, rnd);
    }
    g.fill();
    // palms in the mid line
    g.beginPath();
    const nP = Math.max(4, Math.round(W / (260 * s)));
    for (let i = 0; i < nP; i++) {
      const x = W * ((i + 0.2 + rnd() * 0.6) / nP);
      const by = baseY(x) - 10 * s;
      const h = (150 + rnd() * 110) * s;
      palmPath(g, x, by, x + (rnd() - 0.5) * 90 * s, by - h, s, rnd, 0.55 + rnd() * 0.2);
    }
    g.fill();
    // mist sitting in front of the mid layer
    const lg = g.createLinearGradient(0, H * 0.68, 0, H * 0.86);
    lg.addColorStop(0, 'rgba(96,92,70,0)');
    lg.addColorStop(0.6, 'rgba(96,92,70,.28)');
    lg.addColorStop(1, 'rgba(60,60,46,.12)');
    g.fillStyle = lg;
    g.fillRect(0, H * 0.68, W, H * 0.32);
  }
  // ---- near layer ----
  {
    const g = layers[3];
    g.fillStyle = '#0b0f0a';
    g.beginPath();
    for (let x = -30 * s; x < W + 30 * s; x += (22 + rnd() * 22) * s) {
      const r = (26 + rnd() * 34) * s;
      const y = H * (0.87 + 0.025 * noise2D(x / (160 * s), 33.3)) - rnd() * 22 * s;
      g.moveTo(x + r, y);
      g.ellipse(x, y, r, r * 0.7, 0, 0, TAU);
    }
    g.rect(0, H * 0.88, W, H * 0.14);
    palmPath(g, W * 0.035, H * 1.02, W * 0.09, H * 0.2, s, rnd, 1.25);
    palmPath(g, W * 0.95, H * 1.02, W * 0.885, H * 0.28, s, rnd, 1.15);
    palmPath(g, W * 0.55, H * 0.98, W * 0.6, H * 0.5, s, rnd, 0.85);
    bananaPath(g, W * 0.24, H * 0.95, s, rnd, 1.05);
    bananaPath(g, W * 0.82, H * 0.97, s, rnd, 0.9);
    bambooPaths(g, W * 0.72, H * 0.98, H * 0.55, s, rnd);
    g.fill();
  }
  // ---- foreground frame ----
  {
    const g = layers[4];
    g.fillStyle = '#050705';
    g.beginPath();
    grassPath(g, -10, W + 10, H * 1.0, 40, 150, s, rnd, 7);
    // overhanging fronds top-left and top-right
    frondPath(g, -30 * s, -20 * s, 0.55, 420 * s, 0.35, 34 * s, s, rnd, 0.035);
    frondPath(g, -40 * s, 60 * s, 0.25, 330 * s, 0.4, 28 * s, s, rnd, 0.038);
    frondPath(g, W + 30 * s, -30 * s, Math.PI - 0.5, 380 * s, 0.3, 30 * s, s, rnd, 0.036);
    // hanging vines
    for (let i = 0; i < 4; i++) {
      const x = W * (0.12 + rnd() * 0.3) + (i > 1 ? W * 0.45 : 0);
      const len = H * (0.12 + rnd() * 0.22);
      g.moveTo(x - 1 * s, 0);
      g.quadraticCurveTo(x + (rnd() - 0.5) * 30 * s, len * 0.6, x + (rnd() - 0.5) * 12 * s, len);
      g.lineTo(x + 1.4 * s, len);
      g.quadraticCurveTo(x + 2 * s, len * 0.5, x + 1 * s, 0);
      g.closePath();
      for (let k = 0; k < 6; k++) {
        const ly = len * (0.2 + k * 0.14), lx = x + (rnd() - 0.5) * 6 * s;
        const r = (5 + rnd() * 6) * s;
        g.moveTo(lx + r, ly);
        g.ellipse(lx + (k % 2 ? r : -r) * 0.6, ly, r, r * 0.45, (k % 2 ? 0.6 : -0.6), 0, TAU);
      }
    }
    g.fill();
  }
}

function paintHeli(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(14,18,13,.92)';
  g.beginPath();
  // cabin
  g.moveTo(36, 22);
  g.quadraticCurveTo(40, 12, 62, 12);
  g.lineTo(86, 12);
  g.quadraticCurveTo(96, 13, 98, 22);
  g.lineTo(98, 32);
  g.lineTo(44, 33);
  g.quadraticCurveTo(34, 31, 36, 22);
  g.closePath();
  // tail boom
  g.moveTo(96, 16); g.lineTo(140, 18); g.lineTo(140, 21); g.lineTo(96, 26); g.closePath();
  // tail fin + rotor
  g.moveTo(136, 18); g.lineTo(142, 7); g.lineTo(145, 8); g.lineTo(141, 21); g.closePath();
  g.rect(141.5, 4, 1.4, 14);
  // mast
  g.rect(66, 6, 4, 7);
  // skids
  g.rect(42, 40, 56, 2);
  g.rect(52, 32, 2, 8); g.rect(84, 32, 2, 8);
  g.fill();
}

function makeGrainURL() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const img = g.createImageData(128, 128);
    const r = rand(77);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (r() * 255) | 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) { return ''; }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export function createHud(ctx = {}) {
  const ev = ctx.events || sharedEvents;
  const doc = document;

  let hudRoot = doc.getElementById('hud');
  if (!hudRoot) { hudRoot = el('div', null, doc.body); hudRoot.id = 'hud'; }
  let menuRoot = doc.getElementById('menu');
  if (!menuRoot) { menuRoot = el('div', null, doc.body); menuRoot.id = 'menu'; }

  // A previous instance (restart that recreates modules) cleans up after itself.
  try { hudRoot.__ugHud?.dispose?.(); } catch (e) { /* ignore */ }

  let style = doc.getElementById('ug-hud-style');
  if (!style) { style = el('style', null, doc.head); style.id = 'ug-hud-style'; }
  style.textContent = CSS;

  hudRoot.textContent = '';
  menuRoot.textContent = '';

  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const dbg = ctx.debug;
  const debugMode = !!dbg && (dbg === true || truthy(dbg.debug) || truthy(dbg.enabled));

  // ======================= in-game layer =======================
  const fxShade = el('div', 'ug-fx ug-shade', hudRoot);
  const fxVig = el('div', 'ug-fx ug-vig', hudRoot);
  const fxFlash = el('div', 'ug-fx ug-flash', hudRoot);
  const layer = el('div', 'ug-layer', hudRoot);

  // damage direction arcs
  const dmgWrap = el('div', 'ug-dmgs', layer);
  const dmgPool = [];
  for (let i = 0; i < 6; i++) {
    dmgPool.push({ el: el('div', 'ug-dmg', dmgWrap), t: 0, life: 1, x: 0, z: 0, has: false, str: 1, deg: 999 });
  }

  // objective
  const objBox = el('div', 'ug-obj ug-panel ug-hide', layer);
  el('div', 'ug-lbl', objBox, 'Objective');
  const objText = el('div', 'ug-obj-text', objBox, '');

  // compass
  const compass = el('div', 'ug-compass', layer);
  const compCanvas = el('canvas', null, compass);
  const compG = compCanvas.getContext('2d');
  const compHeading = el('div', 'ug-heading', compass, '000°');
  const COMP_W = 400, COMP_H = 42;

  // alert
  const alertBox = el('div', 'ug-alert ug-panel', layer);
  alertBox.dataset.level = '0';
  alertBox.insertAdjacentHTML('beforeend', EYE_SVG);
  const alertTxt = el('div', null, alertBox);
  const alertLbl = el('div', 'ug-alert-lbl', alertTxt, ALERT_LABEL[0]);
  const visBar = el('div', 'ug-vis', alertTxt);
  const visFill = el('i', null, visBar);

  // minimap
  const mapBox = el('div', 'ug-map', layer);
  const mapCanvas = el('canvas', null, mapBox);
  const mapG = mapCanvas.getContext('2d');
  const MAP_CSS = 300;

  // vitals
  const vit = el('div', 'ug-vitals ug-panel', layer);
  const hpRow = el('div', 'ug-row', vit);
  const stanceSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  stanceSvg.setAttribute('class', 'ug-stance');
  stanceSvg.setAttribute('viewBox', '0 0 20 20');
  stanceSvg.innerHTML = STANCE_SVG.stand;
  hpRow.appendChild(stanceSvg);
  const hpBar = el('div', 'ug-bar', hpRow);
  const hpGhost = el('i', 'ug-hp-ghost', hpBar);
  const hpFill = el('i', 'ug-hp-fill', hpBar);
  const hpNum = el('div', 'ug-num', hpRow, '100');
  const stRow = el('div', 'ug-row ug-strow', vit);
  el('span', null, stRow).style.cssText = 'width:18px;flex:none';
  const stBar = el('div', 'ug-bar ug-st', stRow);
  const stFill = el('i', 'ug-st-fill', stBar);
  const locTag = el('div', 'ug-tag', stRow, 'Tunnel');
  locTag.style.minWidth = '24px';

  // weapon panel
  const wpn = el('div', 'ug-wpn ug-panel', layer);
  const wTop = el('div', 'ug-wtop', wpn);
  const wState = el('span', 'ug-wstate', wTop, 'Reload');
  const wName = el('span', 'ug-lbl', wTop, ITEM_NAME.rifle);
  const ammo = el('div', 'ug-ammo', wpn);
  const ammoMag = el('span', 'ug-mag', ammo, '30');
  const ammoSep = el('span', 'ug-sep', ammo, '/');
  const ammoRes = el('span', 'ug-res', ammo, '120');
  const sizes = el('div', 'ug-sizes', wpn);
  const sizeEls = DIG_SIZES.map((n) => el('span', null, sizes, n));
  sizes.style.display = 'none';
  const rl = el('div', 'ug-rl', wpn);
  const rlFill = el('i', null, rl);
  const slotsBox = el('div', 'ug-slots', wpn);
  const slots = {};
  ITEMS.forEach((id, i) => {
    const s = el('div', 'ug-slot', slotsBox);
    el('b', null, s, String(i + 1));
    s.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 32 16" aria-hidden="true">' + ICONS[id] + '</svg>');
    const cnt = el('em', null, s, '');
    slots[id] = { el: s, cnt };
  });

  // crosshair, hitmarker, ring, use glyph, toasts
  const xh = el('div', 'ug-xh', layer);
  const xhT = el('i', 't', xh), xhB = el('i', 'b', xh), xhL = el('i', 'l', xh), xhR = el('i', 'r', xh);
  el('i', 'd', xh);
  const hm = el('div', 'ug-hm', layer);
  for (let i = 0; i < 4; i++) { const l = el('i', null, hm); l.style.transform = 'rotate(' + (45 + i * 90) + 'deg)'; }
  const ring = el('div', 'ug-ring', layer);
  const RING_R = 26, RING_C = TAU * RING_R;
  ring.innerHTML = '<svg viewBox="0 0 64 64"><circle class="trk" cx="32" cy="32" r="' + RING_R + '"/><circle class="pr" cx="32" cy="32" r="' + RING_R +
    '" stroke-dasharray="' + RING_C.toFixed(2) + '" stroke-dashoffset="' + RING_C.toFixed(2) + '"/></svg>';
  const ringPr = ring.querySelector('.pr');
  const useBox = el('div', 'ug-use', layer);
  const useKey = el('span', 'ug-key', useBox, '[F]');
  const useLbl = el('span', null, useBox, 'Descend');
  const toastBox = el('div', 'ug-toasts', layer);

  const fadeEl = el('div', 'ug-fade', hudRoot);

  // ======================= menu screens =======================
  const scrTitle = el('div', 'ug-scr ug-title', menuRoot);
  const bg = el('div', 'ug-bg', scrTitle);
  const bgCanvases = [];
  const mistA = el('div', 'ug-mist a');
  const mistB = el('div', 'ug-mist b');
  for (let i = 0; i < 5; i++) {
    const c = el('canvas', null, bg);
    bgCanvases.push(c);
    if (i === 0) {
      const heli = el('div', 'ug-heli', bg);
      const hc = el('canvas', null, heli);
      hc.width = 150; hc.height = 56;
      paintHeli(hc.getContext('2d'), 150, 56);
      el('div', 'ug-rotor', heli);
    }
    if (i === 1) bg.appendChild(mistA);
    if (i === 2) bg.appendChild(mistB);
  }
  {
    const fr = rand(4242);
    for (let i = 0; i < 16; i++) {
      const f = el('i', 'ug-fly', bg);
      f.style.left = (8 + fr() * 84).toFixed(1) + '%';
      f.style.top = (62 + fr() * 30).toFixed(1) + '%';
      f.style.animationDelay = (-fr() * 7).toFixed(2) + 's';
      f.style.animationDuration = (5 + fr() * 5).toFixed(2) + 's';
    }
  }
  const grainURL = makeGrainURL();
  const grain = el('div', 'ug-grain', scrTitle);
  if (grainURL) grain.style.backgroundImage = 'url(' + grainURL + ')';
  el('div', 'ug-tshade', scrTitle);
  const tblock = el('div', 'ug-tblock', scrTitle);
  el('div', 'ug-tname', tblock, 'UNDERGROWTH');
  el('div', 'ug-tsub', tblock, 'Củ Chi, 1968');
  el('div', 'ug-rule', tblock);
  const deployBtn = el('button', 'ug-btn', tblock, 'Deploy');
  deployBtn.type = 'button';
  el('div', 'ug-stamp', scrTitle, '10°58′N 106°29′E');

  const scrPause = el('div', 'ug-scr ug-veil ug-pause', menuRoot);
  const pCard = el('div', 'ug-card', scrPause);
  el('h2', null, pCard, 'Paused');
  const pObj = el('div', 'ug-pobj', pCard, '');
  const resumeBtn = el('button', 'ug-btn', pCard, 'Resume');
  resumeBtn.type = 'button';

  const scrEnd = el('div', 'ug-scr ug-veil ug-end', menuRoot);
  const eCard = el('div', 'ug-card', scrEnd);
  el('span', 'ug-lbl', eCard, 'After-action');
  const eTitle = el('h2', null, eCard, 'Mission complete');
  const eReason = el('div', 'ug-reason', eCard, '');
  const eStats = el('dl', 'ug-stats', eCard);
  const statEls = {};
  for (const [k, label] of [['kills', 'Kills'], ['headshots', 'Headshots'], ['cells', 'Tunnel cells dug'], ['time', 'Time in the field']]) {
    const row = el('div', null, eStats);
    el('dt', null, row, label);
    statEls[k] = { row, dd: el('dd', null, row, '0') };
  }
  const againBtn = el('button', 'ug-btn', eCard, 'Again');
  againBtn.type = 'button';

  // ======================= state =======================
  let state = 'playing';
  let paused = false;
  let lockedOnce = false;
  let unlockT = 0;
  let pauseTimer = 0;
  let endTimer = 0;
  let pendingEnd = null;
  let disposed = false;
  let time = 0;
  let sessionStart = performance.now();

  let objectiveTextStr = '';
  let objectiveDone = false;
  let objTarget = 'firebase';
  let dumpDestroyed = false;

  let alertLevel = 0;
  let visT = 0, visVal = 0, visShown = 0;
  let ownKills = 0, ownHead = 0, ownDug = 0;

  let hpShown = 100, hpGhostV = 100, ghostHold = 0;
  let stFullT = 0;
  let lastStance = 'stand';
  let deadShown = false;

  let curItem = '';
  let shotKick = 0, spread = 10;
  let adsAmt = 0;
  let hmT = 0, hmLife = 0.22, hmKind = '';
  let flashT = 0;
  let ringT = 0, ringAge = 9, ringKind = '', ringDoneT = 0;

  let hatchT = 0, nearHatchCached = null;
  let refuseT = 0, refuseTag = '';
  const digDir = { x: 0, y: 0, z: -1 };

  // ======================= fade =======================
  function setFadeImmediate(a) {
    fadeEl.style.transition = 'none';
    setOp(fadeEl, clamp(a, 0, 1));
  }
  function fade(toBlack, ms) {
    if (typeof toBlack === 'number') { setFadeImmediate(toBlack); return Promise.resolve(); }
    const dur = Number.isFinite(ms) ? Math.max(0, ms) : 400;
    const target = toBlack ? 1 : 0;
    fadeEl.style.transition = 'opacity ' + dur + 'ms ' + (toBlack ? 'ease-in' : 'ease-out');
    // force the transition to start from the current value
    void fadeEl.offsetWidth;
    fadeEl._op = target;
    fadeEl.style.opacity = target;
    return new Promise((res) => setTimeout(res, dur));
  }

  // ======================= toasts =======================
  const toasts = [];
  let lastToastText = '', lastToastTime = -10;
  function toast(text, ms = 2600) {
    if (text == null) return;
    text = String(text).trim();
    if (!text) return;
    if (text === lastToastText && time - lastToastTime < 1.2) return;
    lastToastText = text; lastToastTime = time;
    while (toasts.length >= 4) {
      const old = toasts.shift();
      clearTimeout(old.timer); old.el.remove();
    }
    const t = el('div', 'ug-toast', toastBox, text);
    const rec = { el: t, timer: 0 };
    toasts.push(rec);
    requestAnimationFrame(() => t.classList.add('in'));
    rec.timer = setTimeout(() => {
      t.classList.remove('in');
      rec.timer = setTimeout(() => {
        t.remove();
        const i = toasts.indexOf(rec);
        if (i >= 0) toasts.splice(i, 1);
      }, 320);
    }, ms);
  }
  function clearToasts() {
    for (const r of toasts) { clearTimeout(r.timer); r.el.remove(); }
    toasts.length = 0;
  }

  // ======================= objective =======================
  function setObjective(text, done) {
    const txt = text == null ? objectiveTextStr : String(text);
    const changed = txt !== objectiveTextStr;
    objectiveTextStr = txt;
    objectiveDone = !!done;
    objText.textContent = txt;
    pObj.textContent = txt;
    setClass(objBox, 'ug-hide', !txt);
    objBox.classList.toggle('ug-done', objectiveDone);
    if (changed && txt) {
      objBox.classList.remove('ug-new');
      void objBox.offsetWidth;
      objBox.classList.add('ug-new');
    }
    const l = txt.toLowerCase();
    if (/dump|charge|ammo/.test(l)) objTarget = 'dump';
    else if (/return|escape|get back|withdraw/.test(l)) objTarget = 'hatch';
    else if (/firebase|tunnel/.test(l)) objTarget = 'firebase';
    compDirty = true;
  }

  // ======================= hitmarker / damage =======================
  function hitmarker(opts) {
    const kill = !!(opts && (opts.kill || opts.killed));
    const head = !!(opts && (opts.headshot || opts.head || opts.part === 'head'));
    const kind = kill ? 'kill' : head ? 'head' : 'hit';
    if (hmT > 0 && hmKind === 'kill' && kind !== 'kill') return;
    hmKind = kind;
    hmLife = kill ? 0.42 : 0.22;
    hmT = hmLife;
    setClass(hm, 'ug-head', kind === 'head');
    setClass(hm, 'ug-kill', kind === 'kill');
  }

  function damageIndicator(d) {
    const amt = Number.isFinite(d?.damage) ? d.damage : 20;
    flashT = Math.min(0.5, 0.18 + amt / 120);
    const fp = d?.fromPos;
    if (!fp || !Number.isFinite(fp.x) || !Number.isFinite(fp.z)) return;
    let best = dmgPool[0];
    for (const s of dmgPool) {
      if (s.t <= 0) { best = s; break; }
      if (s.t < best.t) best = s;
    }
    best.x = fp.x; best.z = fp.z; best.has = true;
    best.life = 1.0 + clamp(amt / 40, 0, 1);
    best.t = best.life;
    best.str = clamp(0.55 + amt / 50, 0.55, 1);
  }

  // ======================= event handlers =======================
  const handlers = {
    objective: (d) => { if (d) setObjective(d.text, d.done); },
    message: (d) => { if (d && d.text) toast(d.text, d.ms); },
    alert: (d) => { if (d && Number.isFinite(d.level)) alertLevel = clamp(d.level | 0, 0, 2); },
    playerHit: (d) => damageIndicator(d),
    enemyKilled: (d) => {
      ownKills++;
      if (d?.headshot) ownHead++;
      // weapons.js marks its own kills through 'hitMarker'; only fall back to this without it
      if (!ctx.weapons && (!d || d.by === undefined || d.by === 'player' || d.byPlayer)) hitmarker({ kill: true, headshot: d?.headshot });
    },
    enemyHit: (d) => { if (!d || d.by === undefined || d.by === 'player') hitmarker(d); },
    hitmarker: (d) => hitmarker(d || {}),
    hitMarker: (d) => hitmarker(d || {}),
    shot: (d) => { if (d && d.by === 'player') shotKick = Math.min(16, shotKick + (d.weapon === 'rifle' || !d.weapon ? 3.4 : 2)); },
    digProgress: (d) => progressIn(d, 'dig'),
    plantProgress: (d) => progressIn(d, 'plant'),
    actionProgress: (d) => progressIn(d, d?.kind || 'dig'),
    tunnelDug: () => { ownDug++; cellsDirty = true; },
    hatchCreated: () => { cellsDirty = true; },
    chamberDug: () => { cellsDirty = true; },
    dumpDestroyed: () => { dumpDestroyed = true; },
    fade: (d) => { if (d && Number.isFinite(d.t)) setFadeImmediate(d.t); },
    gameOver: (d) => {
      pendingEnd = { won: !!d?.won, reason: d?.reason || '' };
      endTimer = d?.won ? 2.5 : 4.0;   // fallback if main never calls showEnd
    },
  };
  function progressIn(d, kind) {
    if (!d) return;
    const t = Number.isFinite(d.t) ? d.t : Number.isFinite(d.progress) ? d.progress : null;
    if (t == null) return;
    ringT = clamp(t, 0, 1);
    ringAge = 0;
    if (ringKind !== kind) { ringKind = kind; setClass(ring, 'ug-plant', kind === 'plant'); }
    if (ringT >= 1) ringDoneT = 0.25;
  }
  for (const k in handlers) ev.on?.(k, handlers[k]);

  // ======================= pointer lock / pause =======================
  function isLocked() {
    return !!doc.pointerLockElement || !!ctx.input?.locked;
  }
  function requestLock() {
    const c = ctx.renderer?.domElement || doc.querySelector('canvas');
    try {
      const p = c?.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* ignore */ }
  }
  function playerAlive() {
    const p = ctx.player;
    return !p || p.alive !== false;
  }
  function onLockChange() {
    if (disposed) return;
    if (isLocked()) {
      lockedOnce = true;
      unlockT = 0;
      if (paused) hidePause();
      return;
    }
    if (state === 'playing' && lockedOnce && playerAlive() && !pendingEnd) {
      clearTimeout(pauseTimer);
      pauseTimer = setTimeout(() => {
        if (!disposed && state === 'playing' && !isLocked() && playerAlive() && !pendingEnd) showPause();
      }, 120);
    }
  }
  doc.addEventListener('pointerlockchange', onLockChange);

  function showScreen(scr, on) {
    scr.classList.toggle('show', !!on);
  }

  function showPause() {
    if (state !== 'playing') return;
    paused = true;
    pObj.textContent = objectiveTextStr;
    showScreen(scrPause, true);
    setTimeout(() => { try { resumeBtn.focus({ preventScroll: true }); } catch (e) { /* */ } }, 30);
  }
  function hidePause() {
    paused = false;
    showScreen(scrPause, false);
  }

  resumeBtn.addEventListener('click', () => {
    if (ctx.onResume) { try { ctx.onResume(); } catch (e) { console.error(e); } }
    else requestLock();
  });

  deployBtn.addEventListener('click', () => {
    if (ctx.onDeploy) {
      try { ctx.onDeploy(); } catch (e) { console.error(e); }
      // safety net: if the game is clearly running but the menu was never dismissed
      setTimeout(() => { if (!disposed && state === 'menu' && isLocked()) hideMenu(); }, 1500);
    } else {
      try { ctx.audio?.unlock?.(); } catch (e) { /* */ }
      requestLock();
      hideMenu();
    }
  });
  againBtn.addEventListener('click', () => {
    if (ctx.onRestart) { try { ctx.onRestart(); } catch (e) { console.error(e); } }
    else { try { location.reload(); } catch (e) { /* */ } }
  });

  // ======================= menu backdrop =======================
  let bgDirty = true, bgW = 0, bgH = 0, resizeTimer = 0;
  let parTX = 0, parTY = 0, parX = 0, parY = 0, parRAF = 0;
  const PAR = [0, 5, 11, 19, 30];

  function repaintBackdrop() {
    const r = Math.min(1.5, window.devicePixelRatio || 1);
    const W = Math.max(320, Math.round(window.innerWidth * 1.06 * r));
    const H = Math.max(240, Math.round(window.innerHeight * 1.06 * r));
    if (!bgDirty && W === bgW && H === bgH) return;
    bgW = W; bgH = H; bgDirty = false;
    const gs = bgCanvases.map((c) => {
      c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.clearRect(0, 0, W, H);
      return g;
    });
    try { paintBackdrop(gs, W, H); } catch (e) { console.error('[hud] backdrop', e); }
  }
  function parallaxLoop() {
    parRAF = 0;
    if (state !== 'menu' || disposed) return;
    parX += (parTX - parX) * 0.06;
    parY += (parTY - parY) * 0.06;
    for (let i = 1; i < bgCanvases.length; i++) {
      bgCanvases[i].style.transform = 'translate3d(' + (parX * PAR[i]).toFixed(2) + 'px,' + (parY * PAR[i] * 0.5).toFixed(2) + 'px,0)';
    }
    mistA.style.marginLeft = (parX * 8).toFixed(1) + 'px';
    mistB.style.marginLeft = (parX * 15).toFixed(1) + 'px';
    if (Math.abs(parTX - parX) > 0.002 || Math.abs(parTY - parY) > 0.002) parRAF = requestAnimationFrame(parallaxLoop);
  }
  function onMenuMove(e) {
    if (state !== 'menu') return;
    parTX = -((e.clientX / Math.max(1, window.innerWidth)) - 0.5) * 2;
    parTY = -((e.clientY / Math.max(1, window.innerHeight)) - 0.5) * 2;
    if (!parRAF) parRAF = requestAnimationFrame(parallaxLoop);
  }
  scrTitle.addEventListener('mousemove', onMenuMove);
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state === 'menu') repaintBackdrop(); else bgDirty = true;
      sizeCanvases();
    }, 150);
  }
  window.addEventListener('resize', onResize);

  // ======================= screens API =======================
  function resetRun() {
    clearToasts();
    for (const s of dmgPool) { s.t = 0; setOp(s.el, 0); }
    hmT = 0; flashT = 0; ringT = 0; ringAge = 9; ringDoneT = 0;
    shotKick = 0; deadShown = false;
    hudRoot.classList.remove('ug-dead');
    pendingEnd = null; endTimer = 0;
    ownKills = 0; ownHead = 0; ownDug = 0;
    dumpDestroyed = false;
    hpShown = hpGhostV = 100;
    sessionStart = performance.now();
    cellsDirty = true;
  }

  function showMenu() {
    const from = state;
    state = 'menu';
    hudRoot.dataset.state = 'menu';
    hidePause();
    showScreen(scrEnd, false);
    if (from === 'end') resetRun();
    repaintBackdrop();
    scrTitle.style.display = '';
    showScreen(scrTitle, true);
    try { if (doc.pointerLockElement) doc.exitPointerLock?.(); } catch (e) { /* */ }
    setTimeout(() => { try { if (state === 'menu') deployBtn.focus({ preventScroll: true }); } catch (e) { /* */ } }, 60);
  }

  function hideMenu() {
    const from = state;
    state = 'playing';
    hudRoot.dataset.state = 'playing';
    showScreen(scrTitle, false);
    showScreen(scrEnd, false);
    hidePause();
    if (from === 'end' || from === 'menu') {
      if (from === 'end') resetRun();
      sessionStart = performance.now();
      lockedOnce = isLocked();
    }
    setTimeout(() => { if (state !== 'menu') scrTitle.style.display = 'none'; }, 800);
    try { deployBtn.blur(); } catch (e) { /* */ }
  }

  function showEnd(won, reason) {
    state = 'end';
    hudRoot.dataset.state = 'end';
    pendingEnd = null; endTimer = 0;
    hidePause();
    showScreen(scrTitle, false);
    scrEnd.classList.toggle('ug-won', !!won);
    scrEnd.classList.toggle('ug-lost', !won);
    eTitle.textContent = won ? 'Mission complete' : 'Killed in action';
    eReason.textContent = reason ? String(reason) : '';
    eReason.style.display = reason ? '' : 'none';
    const st = ctx.stats || {};
    const kills = Number.isFinite(st.kills) ? st.kills : ownKills;
    const heads = Number.isFinite(st.headshots) ? st.headshots : ownHead;
    let cells = Number.isFinite(st.cellsDug) ? st.cellsDug : ownDug;
    const t = Number.isFinite(st.time) ? st.time : (performance.now() - sessionStart) / 1000;
    statEls.kills.dd.textContent = String(kills | 0);
    statEls.headshots.dd.textContent = String(heads | 0);
    statEls.headshots.row.style.display = heads > 0 ? '' : 'none';
    statEls.cells.dd.textContent = String(Math.round(cells));
    statEls.time.dd.textContent = fmtTime(t);
    showScreen(scrEnd, true);
    try { if (doc.pointerLockElement) doc.exitPointerLock?.(); } catch (e) { /* */ }
    setTimeout(() => { try { if (state === 'end') againBtn.focus({ preventScroll: true }); } catch (e) { /* */ } }, 400);
  }

  // ======================= canvases sizing =======================
  function sizeCanvases() {
    const r = dpr();
    const cw = Math.round(COMP_W * r), ch = Math.round(COMP_H * r);
    if (compCanvas.width !== cw || compCanvas.height !== ch) { compCanvas.width = cw; compCanvas.height = ch; compDirty = true; }
    const mw = Math.round(MAP_CSS * r);
    if (mapCanvas.width !== mw || mapCanvas.height !== mw) { mapCanvas.width = mapCanvas.height = mw; mapGrads = null; }
  }

  // ======================= compass =======================
  let compDirty = true, compBearing = -999, compObjB = -999, compObjD = -1, compCampB = -999;
  const compMarks = { objB: 0, objD: 0, hasObj: false, campB: 0, hasCamp: false };

  function drawCompass(bearing) {
    const r = compCanvas.width / COMP_W;
    const g = compG;
    g.setTransform(r, 0, 0, r, 0, 0);
    g.clearRect(0, 0, COMP_W, COMP_H);
    const half = COMP_W / 2, ppd = 2.2, span = half / ppd;
    const start = Math.floor((bearing - span) / 5) * 5;
    // ticks
    g.beginPath();
    for (let d = start; d <= bearing + span; d += 5) {
      const x = Math.round(half + (d - bearing) * ppd) + 0.5;
      const dn = norm360(d);
      const len = dn % 45 === 0 ? 8 : dn % 15 === 0 ? 5 : 2.5;
      g.moveTo(x, 25); g.lineTo(x, 25 - len);
    }
    g.strokeStyle = 'rgba(215,209,188,.55)';
    g.lineWidth = 1;
    g.stroke();
    // baseline
    g.fillStyle = 'rgba(215,209,188,.12)';
    g.fillRect(0, 25, COMP_W, 1);
    // labels
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    for (let d = Math.ceil((bearing - span) / 15) * 15; d <= bearing + span; d += 15) {
      const x = half + (d - bearing) * ppd;
      const dn = norm360(d);
      if (dn % 45 === 0) {
        const lbl = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][dn / 45];
        g.font = '600 11px system-ui,-apple-system,"Segoe UI",Ubuntu,sans-serif';
        g.fillStyle = dn === 0 ? '#c9a965' : 'rgba(225,219,198,.92)';
        g.fillText(lbl, x, 13);
      } else {
        g.font = '500 8.5px ui-monospace,"DejaVu Sans Mono",monospace';
        g.fillStyle = 'rgba(215,209,188,.42)';
        g.fillText(pad3(dn), x, 12);
      }
    }
    // centre caret
    g.fillStyle = '#d7d1bc';
    g.beginPath();
    g.moveTo(half - 4, 27.5); g.lineTo(half + 4, 27.5); g.lineTo(half, 23); g.closePath();
    g.fill();
    // markers
    if (compMarks.hasCamp) {
      const dd = wrap180(compMarks.campB - bearing);
      if (Math.abs(dd) < span) {
        const x = half + dd * ppd;
        g.fillStyle = 'rgba(142,147,98,.95)';
        g.beginPath(); g.moveTo(x - 4, 36); g.lineTo(x + 4, 36); g.lineTo(x, 30); g.closePath(); g.fill();
      }
    }
    if (compMarks.hasObj) {
      const dd = wrap180(compMarks.objB - bearing);
      const inView = Math.abs(dd) < span - 4;
      const x = inView ? half + dd * ppd : (dd < 0 ? 64 : COMP_W - 64);
      g.fillStyle = '#c9a965';
      g.strokeStyle = 'rgba(0,0,0,.6)';
      g.lineWidth = 1;
      g.beginPath();
      if (inView) {
        g.moveTo(x, 29); g.lineTo(x + 4, 33); g.lineTo(x, 37); g.lineTo(x - 4, 33); g.closePath();
      } else {
        const s = dd < 0 ? -1 : 1;
        g.moveTo(x + s * 5, 33); g.lineTo(x - s * 2, 29); g.lineTo(x - s * 2, 37); g.closePath();
      }
      g.fill(); g.stroke();
      if (inView && compMarks.objD > 0) {
        g.font = '500 8.5px ui-monospace,"DejaVu Sans Mono",monospace';
        g.fillStyle = 'rgba(215,209,188,.7)';
        g.textAlign = 'left';
        g.fillText(compMarks.objD + ' m', x + 7, 36.5);
      }
    }
  }

  // ======================= minimap =======================
  const MW = 512;                 // base map resolution (1 px = 1 m)
  const baseCanvas = doc.createElement('canvas');
  baseCanvas.width = baseCanvas.height = MW;
  const baseG = baseCanvas.getContext('2d');
  let baseReady = false, buildPhase = 0, buildRow = 0, buildTimer = 0;
  let heightGrid = null, baseImg = null, waterLvl = NaN;

  function buildSlice() {
    buildTimer = 0;
    if (disposed || baseReady) return;
    const w = ctx.world;
    if (!w || typeof w.heightAt !== 'function') { buildTimer = setTimeout(buildSlice, 700); return; }
    if (!heightGrid) {
      heightGrid = new Float32Array(MW * MW);
      baseImg = baseG.createImageData(MW, MW);
      waterLvl = Number.isFinite(w.waterLevel) ? w.waterLevel : NaN;
    }
    const t0 = performance.now();
    const rowStart = buildRow;
    const startPhase = buildPhase;
    try {
      while (performance.now() - t0 < 6) {
        if (buildPhase === 0) {
          const z = -WORLD.half + buildRow + 0.5;
          const o = buildRow * MW;
          for (let i = 0; i < MW; i++) {
            const h = w.heightAt(-WORLD.half + i + 0.5, z);
            heightGrid[o + i] = Number.isFinite(h) ? h : 0;
          }
          if (++buildRow >= MW) { buildPhase = 1; buildRow = 0; break; }
        } else {
          colourRow(w, buildRow);
          if (++buildRow >= MW) { buildPhase = 2; break; }
        }
      }
    } catch (e) {
      console.error('[hud] minimap build', e);
      buildPhase = 2;
    }
    if (startPhase === 1) {
      const end = buildPhase === 2 ? MW : buildRow;
      baseG.putImageData(baseImg, 0, 0, 0, rowStart, MW, Math.max(1, end - rowStart));
    }
    if (buildPhase === 2) {
      // field grid over the finished map
      baseG.fillStyle = 'rgba(10,12,8,.22)';
      for (let k = 0; k <= MW; k += 64) { baseG.fillRect(k, 0, 1, MW); baseG.fillRect(0, k, MW, 1); }
      baseReady = true;
      heightGrid = null;
      return;
    }
    buildTimer = setTimeout(buildSlice, 4);
  }

  const mapNoise = rand(31);
  function colourRow(w, j) {
    const H = heightGrid, D = baseImg.data;
    const z = -WORLD.half + j + 0.5;
    const jm = Math.max(0, j - 1) * MW, jp = Math.min(MW - 1, j + 1) * MW, jo = j * MW;
    const fb = WORLD.firebase;
    const hasWater = typeof w.isWater === 'function';
    const hasCover = typeof w.coverAt === 'function';
    const lim = WORLD.playable;
    for (let i = 0; i < MW; i++) {
      const x = -WORLD.half + i + 0.5;
      const h = H[jo + i];
      const hx = H[jo + Math.min(MW - 1, i + 1)] - H[jo + Math.max(0, i - 1)];
      const hz = H[jp + i] - H[jm + i];
      let water = hasWater ? !!w.isWater(x, z) : (Number.isFinite(waterLvl) && h < waterLvl);
      let r, g, b;
      if (water) {
        const depth = Number.isFinite(waterLvl) ? clamp((waterLvl - h) / 3, 0, 1) : 0.4;
        r = lerp(58, 30, depth); g = lerp(74, 46, depth); b = lerp(70, 52, depth);
      } else {
        const c = hasCover ? clamp(+w.coverAt(x, z) || 0, 0, 1) : 0.6;
        r = lerp(92, 30, c); g = lerp(88, 45, c); b = lerp(58, 27, c);
        // laterite at the firebase
        const dfb = Math.hypot(x - fb.x, z - fb.z);
        const f = 1 - smoothstep(fb.radius - 2, fb.radius + 12, dfb);
        if (f > 0) { r = lerp(r, 118, f); g = lerp(g, 74, f); b = lerp(b, 50, f); }
        // mud banks just above the waterline
        if (Number.isFinite(waterLvl)) {
          const bank = 1 - smoothstep(0, 1.2, h - waterLvl);
          if (bank > 0) { r = lerp(r, 84, bank * 0.6); g = lerp(g, 74, bank * 0.6); b = lerp(b, 52, bank * 0.6); }
        }
        // hillshade (light from the north-west)
        const nl = Math.sqrt(hx * hx + 4 + hz * hz);
        const shade = clamp(((hx + hz + 3) / (nl * 2.0616)) / 0.7276, 0.55, 1.45);
        r *= shade; g *= shade; b *= shade;
      }
      const n = (mapNoise() - 0.5) * 7;
      let m = 1;
      if (Math.abs(x) > lim || Math.abs(z) > lim) m = 0.55;
      const k = (jo + i) * 4;
      D[k] = clamp((r + n) * m, 0, 255);
      D[k + 1] = clamp((g + n) * m, 0, 255);
      D[k + 2] = clamp((b + n * 0.8) * m, 0, 255);
      D[k + 3] = 255;
    }
  }
  buildTimer = setTimeout(buildSlice, 50);

  // dug cells cache
  let cellXZ = new Float32Array(512);
  let cellDeep = new Uint8Array(256);
  let cellN = 0, cellSize = WORLD.cell, cellsDirty = true, cellCheckT = 0, cellMap = null;
  function calibrateCells(t) {
    if (cellMap) return cellMap;
    let ox = WORLD.cell * 0.5 - WORLD.half, oz = ox, sx = WORLD.cell, sz = WORLD.cell;
    try {
      if (typeof t.cellCenter === 'function') {
        const a = t.cellCenter(0, 0), b = t.cellCenter(1, 1);
        if (a && b && Number.isFinite(a.x) && Number.isFinite(b.x) && Math.abs(b.x - a.x) > 0.01) {
          ox = a.x; oz = a.z; sx = b.x - a.x; sz = b.z - a.z;
        }
      } else if (typeof t.cellOf === 'function') {
        const c = t.cellOf(0.001, 0.001);
        if (c && Number.isFinite(c.cx)) {
          ox = (0 - c.cx) * WORLD.cell + WORLD.cell * 0.5; oz = (0 - c.cz) * WORLD.cell + WORLD.cell * 0.5;
        }
      }
    } catch (e) { /* defaults */ }
    cellSize = Math.abs(sx) || WORLD.cell;
    cellMap = { ox, oz, sx, sz };
    return cellMap;
  }
  function refreshCells() {
    cellsDirty = false;
    const t = ctx.tunnels;
    if (!t || typeof t.dugCells !== 'function') { cellN = 0; return; }
    let it;
    try { it = t.dugCells(); } catch (e) { return; }
    if (!it || typeof it[Symbol.iterator] !== 'function') return;
    const m = calibrateCells(t);
    let n = 0;
    try {
      for (const c of it) {
        if (!c || !Number.isFinite(c.cx) || !Number.isFinite(c.cz)) continue;
        if (n * 2 + 2 > cellXZ.length) {
          const nb = new Float32Array(cellXZ.length * 2);
          nb.set(cellXZ); cellXZ = nb;
          const nd = new Uint8Array(cellDeep.length * 2);
          nd.set(cellDeep); cellDeep = nd;
        }
        cellXZ[n * 2] = m.ox + c.cx * m.sx;
        cellXZ[n * 2 + 1] = m.oz + c.cz * m.sz;
        cellDeep[n] = c.deep === false ? 0 : 1;
        n++;
      }
    } catch (e) { /* partial */ }
    cellN = n;
  }

  let mapRange = 110;
  let mapGrads = null;
  function makeMapGrads(g, R) {
    const lens = g.createRadialGradient(R, R, R * 0.7, R, R, R);
    lens.addColorStop(0, 'rgba(0,0,0,0)');
    lens.addColorStop(1, 'rgba(0,0,0,.55)');
    const cone = g.createRadialGradient(R, R, 0, R, R, R * 0.62);
    cone.addColorStop(0, 'rgba(215,209,188,.22)');
    cone.addColorStop(1, 'rgba(215,209,188,0)');
    return { lens, cone, R };
  }

  function drawMap(dt, px, pz, yaw, underground, big) {
    const r = mapCanvas.width / MAP_CSS;
    const g = mapG;
    const R = MAP_CSS / 2;
    const target = underground ? (big ? 120 : 48) : (big ? 230 : 105);
    mapRange += (target - mapRange) * Math.min(1, dt * 5);
    const sc = R / mapRange;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);

    g.setTransform(r, 0, 0, r, 0, 0);
    if (!mapGrads) mapGrads = makeMapGrads(g, R);
    g.clearRect(0, 0, MAP_CSS, MAP_CSS);
    g.save();
    g.beginPath(); g.arc(R, R, R, 0, TAU); g.clip();
    g.fillStyle = '#0d100c';
    g.fillRect(0, 0, MAP_CSS, MAP_CSS);

    // ---- world-space layer ----
    g.save();
    g.translate(R, R);
    g.rotate(yaw);
    g.scale(sc, sc);
    g.translate(-px, -pz);
    if (baseReady) {
      g.globalAlpha = underground ? 0.34 : 0.95;
      g.imageSmoothingEnabled = true;
      g.drawImage(baseCanvas, -WORLD.half, -WORLD.half, WORLD.size, WORLD.size);
      g.globalAlpha = 1;
    }
    const lw = 1 / sc;
    // firebase perimeter
    const fb = WORLD.firebase;
    g.beginPath();
    g.arc(fb.x, fb.z, fb.radius, 0, TAU);
    g.setLineDash([5 * lw, 3.5 * lw]);
    g.lineWidth = 1.3 * lw;
    g.strokeStyle = 'rgba(201,113,74,.7)';
    g.stroke();
    g.setLineDash(EMPTY_DASH);

    // dug tunnels
    const tun = ctx.tunnels;
    const showT = underground || big;
    const view2 = (mapRange * 1.5) * (mapRange * 1.5);
    if (cellN > 0) {
      const rr = cellSize * 0.72;
      for (let pass = 0; pass < 2; pass++) {
        g.beginPath();
        for (let i = 0; i < cellN; i++) {
          if (cellDeep[i] !== pass) continue;
          const x = cellXZ[i * 2], z = cellXZ[i * 2 + 1];
          const dx = x - px, dz = z - pz;
          if (dx * dx + dz * dz > view2) continue;
          g.moveTo(x + rr, z);
          g.arc(x, z, rr, 0, TAU);
        }
        g.fillStyle = pass ? (showT ? 'rgba(196,158,92,.78)' : 'rgba(196,158,92,.3)') : (showT ? 'rgba(150,112,72,.5)' : 'rgba(150,112,72,.22)');
        g.fill();
      }
    }
    // smooth segment/chamber shapes if the tunnel module exposes them
    if (tun) {
      const segs = tun.segments, chs = tun.chambers;
      if (Array.isArray(segs) && segs.length) {
        g.beginPath();
        for (let i = 0; i < segs.length; i++) {
          const sgm = segs[i];
          if (!sgm) continue;
          const a = ptOf(sgm.a || sgm.start || sgm.p0 || sgm.from);
          const b = ptOf(sgm.head || sgm.cur || sgm.b || sgm.end || sgm.p1 || sgm.to);
          if (!a || !b) continue;
          g.moveTo(a.x, a.z); g.lineTo(b.x, b.z);
        }
        g.lineCap = 'round';
        g.lineWidth = Math.max(1.0, 2.2 * lw);
        g.strokeStyle = showT ? 'rgba(226,196,136,.9)' : 'rgba(226,196,136,.35)';
        g.stroke();
      }
      if (Array.isArray(chs) && chs.length) {
        g.beginPath();
        for (let i = 0; i < chs.length; i++) {
          const c = chs[i];
          if (!c) continue;
          const p = ptOf(c.center || c.pos || c.position || c.c || c);
          if (!p) continue;
          let rx = c.rx ?? c.radiusX ?? (c.size && c.size.x / 2) ?? c.radius ?? c.r ?? 2.5;
          let rz = c.rz ?? c.radiusZ ?? (c.size && (c.size.z ?? c.size.y) / 2) ?? c.radius ?? c.r ?? rx;
          if (!Number.isFinite(rx)) rx = 2.5;
          if (!Number.isFinite(rz)) rz = rx;
          g.moveTo(p.x + rx, p.z);
          g.ellipse(p.x, p.z, rx, rz, c.rot || c.angle || 0, 0, TAU);
        }
        g.fillStyle = showT ? 'rgba(214,180,112,.75)' : 'rgba(214,180,112,.3)';
        g.fill();
      }
      // traps
      const traps = tun.traps;
      if (Array.isArray(traps) && traps.length) {
        g.beginPath();
        const s = Math.max(0.9, 2.6 * lw);
        for (let i = 0; i < traps.length; i++) {
          const t = traps[i];
          if (!t || t.armed === false || !Number.isFinite(t.x)) continue;
          g.moveTo(t.x - s, t.z - s); g.lineTo(t.x + s, t.z + s);
          g.moveTo(t.x + s, t.z - s); g.lineTo(t.x - s, t.z + s);
        }
        g.lineWidth = 1.3 * lw;
        g.strokeStyle = 'rgba(201,169,101,.85)';
        g.stroke();
      }
      // hatches
      const hatches = tun.hatches;
      if (Array.isArray(hatches) && hatches.length) {
        const s = Math.max(1.0, 3.2 * lw);
        g.lineWidth = 1.2 * lw;
        for (let pass = 0; pass < 2; pass++) {
          g.beginPath();
          for (let i = 0; i < hatches.length; i++) {
            const h = hatches[i];
            if (!h || !Number.isFinite(h.x) || !!h.discovered !== (pass === 1)) continue;
            g.rect(h.x - s, h.z - s, s * 2, s * 2);
          }
          g.fillStyle = pass ? 'rgba(168,69,47,.95)' : 'rgba(232,214,168,.95)';
          g.strokeStyle = 'rgba(10,10,8,.85)';
          g.fill(); g.stroke();
        }
      }
    }
    g.restore();

    // ---- screen-space icons ----
    const toS = (wx, wz, out) => {
      const dx = (wx - px) * sc, dz = (wz - pz) * sc;
      out[0] = R + dx * cy - dz * sy;
      out[1] = R + dx * sy + dz * cy;
      return out;
    };
    const tmp = mapTmp;
    // camp
    toS(WORLD.playerStart.x, WORLD.playerStart.z, tmp);
    edgeClamp(tmp, R, 10);
    g.fillStyle = 'rgba(142,147,98,.95)';
    g.strokeStyle = 'rgba(0,0,0,.7)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(tmp[0], tmp[1] - 5); g.lineTo(tmp[0] + 5, tmp[1] + 3.5); g.lineTo(tmp[0] - 5, tmp[1] + 3.5); g.closePath();
    g.fill(); g.stroke();
    // raid targets still standing
    const rts = ctx.raid?.targets;
    if (Array.isArray(rts) && ctx.mission?.marker) {
      for (let i = 0; i < rts.length; i++) {
        const t = rts[i];
        if (t.done) continue;
        toS(t.x, t.z, tmp);
        if (edgeClamp(tmp, R, 10)) continue;
        g.fillStyle = t === ctx.mission.marker ? '#e4c98a' : '#c9714a';
        g.fillRect(tmp[0] - 2, tmp[1] - 2, 4, 4);
      }
    }
    // firebase / dump
    const dumpObj = objTarget === 'dump' && !dumpDestroyed;
    const tx = dumpObj ? WORLD.ammoDump.x : fb.x, tz = dumpObj ? WORLD.ammoDump.z : fb.z;
    toS(tx, tz, tmp);
    const clamped = edgeClamp(tmp, R, 10);
    g.beginPath();
    if (dumpObj && !clamped) {
      g.moveTo(tmp[0], tmp[1] - 5.5); g.lineTo(tmp[0] + 5.5, tmp[1]); g.lineTo(tmp[0], tmp[1] + 5.5); g.lineTo(tmp[0] - 5.5, tmp[1]); g.closePath();
    } else {
      g.rect(tmp[0] - 4.5, tmp[1] - 4.5, 9, 9);
    }
    g.fillStyle = dumpDestroyed ? 'rgba(90,80,70,.95)' : '#c9714a';
    g.fill(); g.stroke();

    // helicopter
    const heli = ctx.enemies?.helicopter || ctx.enemies?.heli;
    const hp = heli && heli.active !== false && heli.visible !== false ? posOf(heli) : null;
    if (hp) {
      toS(hp.x, hp.z, tmp);
      edgeClamp(tmp, R, 8);
      g.beginPath();
      g.moveTo(tmp[0] - 6, tmp[1]); g.lineTo(tmp[0] + 6, tmp[1]);
      g.moveTo(tmp[0], tmp[1] - 6); g.lineTo(tmp[0], tmp[1] + 6);
      g.lineWidth = 2; g.strokeStyle = 'rgba(201,113,74,.95)'; g.stroke();
    }

    // enemies
    const list = ctx.enemies?.list;
    if (Array.isArray(list) && list.length) {
      const lvl = currentAlert();
      const near2 = 25 * 25;
      g.beginPath();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (isDeadEnemy(e)) continue;
        const p = posOf(e);
        if (!p) continue;
        const dx = p.x - px, dz = p.z - pz;
        const d2 = dx * dx + dz * dz;
        if (lvl < 2 && d2 > near2) continue;
        if (d2 > mapRange * mapRange * 1.02) continue;
        toS(p.x, p.z, tmp);
        g.moveTo(tmp[0] + 3, tmp[1]);
        g.arc(tmp[0], tmp[1], 3, 0, TAU);
      }
      g.fillStyle = '#c4553b';
      g.strokeStyle = 'rgba(0,0,0,.75)';
      g.lineWidth = 1;
      g.fill(); g.stroke();
    }

    // view cone + player
    const cam = ctx.camera;
    let hf = 1.2;
    if (cam && Number.isFinite(cam.fov)) hf = 2 * Math.atan(Math.tan((cam.fov / DEG) / 2) * (cam.aspect || 1.6));
    hf = clamp(hf, 0.5, 2.4);
    g.beginPath();
    g.moveTo(R, R);
    g.arc(R, R, R * 0.62, -Math.PI / 2 - hf / 2, -Math.PI / 2 + hf / 2);
    g.closePath();
    g.fillStyle = mapGrads.cone;
    g.fill();
    g.beginPath();
    g.moveTo(R, R - 7); g.lineTo(R + 5, R + 5); g.lineTo(R, R + 2.5); g.lineTo(R - 5, R + 5); g.closePath();
    g.fillStyle = '#e2dcc6';
    g.strokeStyle = 'rgba(0,0,0,.8)';
    g.lineWidth = 1.2;
    g.fill(); g.stroke();

    // lens vignette
    g.fillStyle = mapGrads.lens;
    g.fillRect(0, 0, MAP_CSS, MAP_CSS);
    g.restore();

    // rim + north
    g.beginPath();
    g.arc(R, R, R - 0.75, 0, TAU);
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(215,209,188,.28)';
    g.stroke();
    const nx = R + sy * (R - 13), ny = R - cy * (R - 13);
    g.beginPath();
    g.arc(nx, ny, 8, 0, TAU);
    g.fillStyle = 'rgba(10,12,9,.8)';
    g.fill();
    g.font = '700 10px system-ui,-apple-system,"Segoe UI",Ubuntu,sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#c9a965';
    g.fillText('N', nx, ny + 0.5);
  }
  const mapTmp = [0, 0];
  function edgeClamp(p, R, m) {
    const dx = p[0] - R, dy = p[1] - R;
    const d = Math.hypot(dx, dy);
    const max = R - m;
    if (d > max) { p[0] = R + dx / d * max; p[1] = R + dy / d * max; return true; }
    return false;
  }

  function currentAlert() {
    const a = ctx.enemies?.alertLevel;
    return Number.isFinite(a) ? clamp(a | 0, 0, 2) : alertLevel;
  }

  // ======================= weapons helpers =======================
  function adsTarget(w) {
    if (!w) return 0;
    for (const k of ['adsT', 'adsAmount', 'aimT', 'adsBlend']) {
      if (typeof w[k] === 'number') return clamp(w[k], 0, 1);
    }
    if (typeof w.aim === 'number') return clamp(w.aim, 0, 1);
    if (typeof w.aiming === 'boolean') return w.aiming ? 1 : 0;
    if (typeof w.ads === 'boolean') return w.ads ? 1 : 0;
    if (typeof w.isAiming === 'boolean') return w.isAiming ? 1 : 0;
    if (typeof w.isAiming === 'function') { try { return w.isAiming() ? 1 : 0; } catch (e) { return 0; } }
    return (w.current === 'rifle' && ctx.input?.mouse?.right) ? 1 : 0;
  }
  function countFor(w, id) {
    switch (id) {
      case 'rifle': return w.ammo ? (w.ammo.mag | 0) + (w.ammo.reserve | 0) : 1;
      case 'shovel': return 1;
      case 'satchel': return Number.isFinite(w.satchels) ? w.satchels : 0;
      case 'grenade': return Number.isFinite(w.grenades) ? w.grenades : 0;
      case 'trap': return Number.isFinite(w.traps) ? w.traps : 0;
    }
    return 0;
  }

  // ======================= per-frame update =======================
  const xhState = { gap: -1 };
  let lastAlertShown = -1;
  let lastItemCounts = { rifle: -1, shovel: -1, satchel: -1, grenade: -1, trap: -1 };
  let lastDigSize = '';
  let lastMag = -1, lastRes = -1;
  let lastHpInt = -1;
  let mapBigOn = false;

  // Why the shovel can't dig where the player is looking ('' when it can, or no clear reason).
  function digRefusal(p, w) {
    if (w?.current !== 'shovel') return '';
    const a = ctx.tunnels?.aim;
    if (!a || !a.hit || a.valid) return '';
    return DIG_REFUSAL[a.reason] || '';
  }

  function update(dt) {
    if (disposed) return;
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0.016;
    time += dt;

    // fallback end screen if main never calls showEnd()
    if (pendingEnd && state === 'playing') {
      endTimer -= dt;
      if (endTimer <= 0) { const p = pendingEnd; showEnd(p.won, p.reason); }
    }

    // pause watchdog (in case pointerlockchange was missed)
    if (state === 'playing') {
      if (isLocked()) { lockedOnce = true; unlockT = 0; if (paused) hidePause(); }
      else if (lockedOnce && !paused && playerAlive() && !pendingEnd) {
        unlockT += dt;
        if (unlockT > 0.35) showPause();
      }
    }

    if (state !== 'playing') return;

    const p = ctx.player;
    const w = ctx.weapons;
    const px = p?.position?.x ?? WORLD.playerStart.x;
    const pz = p?.position?.z ?? WORLD.playerStart.z;
    const yaw = Number.isFinite(p?.yaw) ? p.yaw : 0;
    const underground = !!p?.underground;
    const alive = p ? p.alive !== false : true;
    const bearing = norm360(-yaw * DEG);

    // ---- death ----
    if (!alive && !deadShown) { deadShown = true; hudRoot.classList.add('ug-dead'); }
    else if (alive && deadShown) { deadShown = false; hudRoot.classList.remove('ug-dead'); }

    // ---- vitals ----
    const maxHp = p?.maxHealth || 100;
    const hp = clamp(Number.isFinite(p?.health) ? p.health : 100, 0, maxHp);
    const hpN = hp / maxHp;
    if (hp < hpShown) {
      if (hpGhostV < hpShown) hpGhostV = hpShown;
      ghostHold = 0.55;
    }
    hpShown += (hp - hpShown) * Math.min(1, dt * 14);
    if (ghostHold > 0) ghostHold -= dt;
    else hpGhostV += (hpShown - hpGhostV) * Math.min(1, dt * 3);
    if (hpGhostV < hpShown) hpGhostV = hpShown;
    setScaleX(hpFill, hpShown / maxHp);
    setScaleX(hpGhost, hpGhostV / maxHp);
    const hpInt = Math.ceil(hp);
    if (hpInt !== lastHpInt) { lastHpInt = hpInt; setText(hpNum, String(hpInt)); }
    setClass(vit, 'ug-low', hpN < 0.3 && alive);

    const st = clamp(Number.isFinite(p?.stamina) ? p.stamina : 100, 0, 100);
    setScaleX(stFill, st / 100);
    setClass(vit, 'ug-exh', !!p?.exhausted);
    if (st >= 99.5 && !p?.sprinting) stFullT += dt; else stFullT = 0;
    setOp(stRow, stFullT > 1.6 ? 0.35 : 1);

    const stance = STANCES.includes(p?.stance) ? p.stance : 'stand';
    if (stance !== lastStance) { lastStance = stance; stanceSvg.innerHTML = STANCE_SVG[stance]; }
    setClass(locTag, 'on', underground || !!p?.swimming);
    setText(locTag, underground ? 'Tunnel' : 'Swim');

    // ---- alert + visibility ----
    const lvl = currentAlert();
    if (lvl !== lastAlertShown) {
      lastAlertShown = lvl;
      alertBox.dataset.level = String(lvl);
      setText(alertLbl, ALERT_LABEL[lvl]);
    }
    visT -= dt;
    if (visT <= 0) {
      visT = 0.15;
      let v = 0;
      try { v = typeof p?.visibility === 'function' ? p.visibility() : 0; } catch (e) { v = 0; }
      visVal = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    }
    visShown += (visVal - visShown) * Math.min(1, dt * 6);
    setScaleX(visFill, visShown);

    // ---- weapons ----
    if (w) {
      const cur = ITEMS.includes(w.current) ? w.current : 'rifle';
      if (cur !== curItem) {
        if (curItem && slots[curItem]) setClass(slots[curItem].el, 'on', false);
        curItem = cur;
        setClass(slots[cur].el, 'on', true);
        setText(wName, (cur === 'rifle' && w.rifleName) || ITEM_NAME[cur]);
        lastMag = lastRes = -1;
        lastDigSize = '';
        sizes.style.display = cur === 'shovel' && typeof (ctx.tunnels?.digSize ?? w.digSize) === 'string' ? '' : 'none';
        ammo.style.display = cur === 'shovel' ? 'none' : '';
        const isR = cur === 'rifle';
        ammoSep.style.display = isR ? '' : 'none';
        ammoRes.style.display = isR ? '' : 'none';
        setClass(xh, 'ug-dotonly', !isR);
      }
      for (let i = 0; i < ITEMS.length; i++) {
        const id = ITEMS[i];
        const c = countFor(w, id);
        if (c !== lastItemCounts[id]) {
          lastItemCounts[id] = c;
          const s = slots[id];
          setClass(s.el, 'ug-empty', c <= 0);
          setText(s.cnt, id === 'satchel' || id === 'grenade' || id === 'trap' ? String(c) : '');
        }
      }
      if (cur === 'rifle') {
        const mag = w.ammo ? (w.ammo.mag | 0) : 0, res = w.ammo ? (w.ammo.reserve | 0) : 0;
        if (mag !== lastMag || res !== lastRes) {
          lastMag = mag; lastRes = res;
          setText(ammoMag, String(mag));
          setText(ammoRes, String(res));
          const magSize = w.magSize || w.ammo?.size || 30;
          setClass(ammo, 'ug-lowammo', mag > 0 && mag <= Math.ceil(magSize * 0.25));
          setClass(ammo, 'ug-noammo', mag === 0);
        }
      } else if (cur !== 'shovel') {
        const c = countFor(w, cur);
        if (c !== lastMag) {
          lastMag = c;
          setText(ammoMag, String(c));
          setClass(ammo, 'ug-lowammo', false);
          setClass(ammo, 'ug-noammo', c <= 0);
        }
      } else {
        const ds = ctx.tunnels?.digSize || w.digSize || 'tunnel';
        if (ds !== lastDigSize) {
          lastDigSize = ds;
          for (let i = 0; i < DIG_SIZES.length; i++) setClass(sizeEls[i], 'on', DIG_SIZES[i] === ds);
        }
      }
      // reload
      const reloading = !!(w.reloading || w.isReloading);
      setClass(wState, 'on', reloading && cur === 'rifle');
      setClass(rl, 'on', reloading && cur === 'rifle');
      if (reloading) {
        let rp = NaN;
        if (Number.isFinite(w.reloadProgress)) rp = w.reloadProgress;
        else if (Number.isFinite(w.reloadT) && Number.isFinite(w.reloadTime) && w.reloadTime > 0) rp = w.reloadT / w.reloadTime;
        if (!Number.isFinite(rp)) rp = (time * 0.4) % 1;
        setScaleX(rlFill, rp);
      }
      // polled progress fallback
      if (Number.isFinite(w.digProgress) && w.digProgress > 0 && w.digProgress < 1 && ringAge > 0.05) progressIn({ t: w.digProgress }, 'dig');
      if (Number.isFinite(w.plantProgress) && w.plantProgress > 0 && w.plantProgress < 1 && ringAge > 0.05) progressIn({ t: w.plantProgress }, 'plant');
    }

    // ---- crosshair ----
    adsAmt += (adsTarget(w) - adsAmt) * Math.min(1, dt * 16);
    shotKick = Math.max(0, shotKick - dt * 22);
    const speed = Number.isFinite(p?.speed) ? p.speed : 0;
    let tgt = 4 + Math.min(speed, 6) * 2.1 + shotKick;
    if (p?.sprinting) tgt += 7;
    if (p && p.grounded === false && !p.swimming && !underground) tgt += 7;
    if (stance === 'crouch') tgt -= 1.2; else if (stance === 'prone') tgt -= 2;
    tgt = Math.max(2.5, tgt);
    spread += (tgt - spread) * Math.min(1, dt * 12);
    const gap = Math.round(spread * 2) / 2;
    if (gap !== xhState.gap) {
      xhState.gap = gap;
      xhT.style.transform = 'translateY(' + (-gap) + 'px)';
      xhB.style.transform = 'translateY(' + gap + 'px)';
      xhL.style.transform = 'translateX(' + (-gap) + 'px)';
      xhR.style.transform = 'translateX(' + gap + 'px)';
    }
    const xhVis = alive && !p?.transitioning ? (1 - adsAmt) * (p?.sprinting ? 0.35 : 1) : 0;
    setOp(xh, xhVis < 0.04 ? 0 : xhVis);

    // ---- hitmarker ----
    if (hmT > 0) {
      hmT -= dt;
      const k = clamp(hmT / hmLife, 0, 1);
      setOp(hm, k < 0.5 ? k * 2 : 1);
      const sc = 1 + (1 - k) * (hmKind === 'kill' ? 0.5 : 0.25);
      const q = Math.round(sc * 50) / 50;
      if (hm._sc !== q) { hm._sc = q; hm.style.transform = 'scale(' + q + ')'; }
    } else setOp(hm, 0);

    // ---- damage arcs ----
    const pb = -yaw; // player bearing in radians
    for (let i = 0; i < dmgPool.length; i++) {
      const s = dmgPool[i];
      if (s.t <= 0) { setOp(s.el, 0); continue; }
      s.t -= dt;
      const a = clamp(s.t / s.life, 0, 1);
      setOp(s.el, Math.pow(a, 0.6) * s.str);
      const sb = Math.atan2(s.x - px, -(s.z - pz));
      const deg = Math.round(wrap180((sb - pb) * DEG));
      if (deg !== s.deg) { s.deg = deg; s.el.style.transform = 'rotate(' + deg + 'deg)'; }
    }

    // ---- screen effects ----
    flashT = Math.max(0, flashT - dt);
    setOp(fxFlash, clamp(flashT * 2.4, 0, 1));
    let vig = 0;
    if (hpN < 0.5) vig = smoothstep(0.5, 0.08, hpN);
    if (vig > 0 && hpN < 0.25) vig *= 0.82 + 0.18 * Math.sin(time * 7.5);
    if (!alive) vig = 1;
    setOp(fxVig, vig);
    const supp = clamp(Number.isFinite(p?.suppression) ? p.suppression : 0, 0, 1);
    setOp(fxShade, clamp((underground ? 0.75 : 0.32) + supp * 0.5, 0, 1));

    // ---- progress ring ----
    ringAge += dt;
    if (ringDoneT > 0) ringDoneT -= dt;
    const ringOn = ringAge < 0.3 && (ringT < 1 || ringDoneT > 0) && ringT > 0.001;
    setOp(ring, ringOn ? 1 : 0);
    if (ringOn) {
      const off = Math.round(RING_C * (1 - ringT) * 10) / 10;
      if (ringPr._off !== off) { ringPr._off = off; ringPr.setAttribute('stroke-dashoffset', off); }
    }

    // ---- hatch glyph ----
    hatchT -= dt;
    let near = p?.nearHatch;
    if (near === undefined) {
      if (hatchT <= 0) {
        hatchT = 0.2;
        try { nearHatchCached = p?.position && ctx.tunnels?.nearestHatch ? ctx.tunnels.nearestHatch(p.position, 1.5) : null; }
        catch (e) { nearHatchCached = null; }
      }
      near = nearHatchCached;
    }
    // ---- context tag: hatch > plant > dig refusal ----
    const canAct = alive && !p?.transitioning;
    const held = w ? w.current : '';
    let useKind = 0; // 0 none, 1 hatch, 2 plant, 3 refused
    const digOut = canAct && !near && !!p?.canDigOut;
    if (canAct && (near || digOut)) useKind = 1;
    else if (canAct && held === 'satchel' && w?.canPlant) useKind = 2;
    if (canAct && held === 'shovel') {
      refuseT -= dt;
      if (refuseT <= 0) { refuseT = 0.2; refuseTag = digRefusal(p, w, underground); }
      if (!useKind && refuseTag) useKind = 3;
    } else { refuseT = 0; refuseTag = ''; }
    setOp(useBox, useKind ? 1 : 0);
    if (useKind) {
      setClass(useBox, 'ug-no', useKind === 3);
      if (useKind === 1) { setText(useKey, '[F]'); setText(useLbl, digOut ? 'Dig out' : underground ? 'Climb out' : 'Descend'); }
      else if (useKind === 2) { setText(useKey, '[LMB]'); setText(useLbl, 'Plant'); }
      else setText(useLbl, refuseTag);
    }

    // ---- compass ----
    compMarks.hasCamp = !underground && Math.hypot(WORLD.playerStart.x - px, WORLD.playerStart.z - pz) > 30;
    if (compMarks.hasCamp) compMarks.campB = norm360(Math.atan2(WORLD.playerStart.x - px, -(WORLD.playerStart.z - pz)) * DEG);
    let ox = NaN, oz = NaN;
    const mk = ctx.mission?.marker;
    if (objectiveTextStr && !objectiveDone && mk && Number.isFinite(mk.x)) { ox = mk.x; oz = mk.z; }
    else if (objectiveTextStr && !objectiveDone) {
      if (objTarget === 'dump') { ox = WORLD.ammoDump.x; oz = WORLD.ammoDump.z; }
      else if (objTarget === 'firebase') { ox = WORLD.firebase.x; oz = WORLD.firebase.z; }
      else if (objTarget === 'hatch' && !underground) {
        const hs = ctx.tunnels?.hatches;
        if (Array.isArray(hs)) {
          let bd = Infinity;
          for (let i = 0; i < hs.length; i++) {
            const h = hs[i];
            if (!h || !Number.isFinite(h.x)) continue;
            const d = (h.x - px) * (h.x - px) + (h.z - pz) * (h.z - pz);
            if (d < bd) { bd = d; ox = h.x; oz = h.z; }
          }
        }
      }
    }
    compMarks.hasObj = Number.isFinite(ox);
    if (compMarks.hasObj) {
      compMarks.objB = norm360(Math.atan2(ox - px, -(oz - pz)) * DEG);
      compMarks.objD = Math.round(Math.hypot(ox - px, oz - pz) / 5) * 5;
    }
    const objBq = compMarks.hasObj ? Math.round(compMarks.objB * 4) : -1;
    const campBq = compMarks.hasCamp ? Math.round(compMarks.campB * 4) : -1;
    if (compDirty || Math.abs(bearing - compBearing) > 0.08 || objBq !== compObjB || compMarks.objD !== compObjD || campBq !== compCampB) {
      compDirty = false;
      compBearing = bearing; compObjB = objBq; compObjD = compMarks.objD; compCampB = campBq;
      drawCompass(bearing);
      setText(compHeading, pad3(bearing) + '°');
    }

    // ---- minimap ----
    const big = !!ctx.input?.keys?.has?.('KeyM');
    if (big !== mapBigOn) { mapBigOn = big; hudRoot.classList.toggle('ug-mapbig', big); }
    cellCheckT -= dt;
    if (cellCheckT <= 0 && (cellsDirty || cellCheckT < -2)) { cellCheckT = 0.25; refreshCells(); }
    drawMap(dt, px, pz, yaw, underground, big);
  }

  // ======================= reset / dispose =======================
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const k in handlers) ev.off?.(k, handlers[k]);
    doc.removeEventListener('pointerlockchange', onLockChange);
    window.removeEventListener('resize', onResize);
    clearTimeout(buildTimer); clearTimeout(resizeTimer); clearTimeout(pauseTimer);
    if (parRAF) cancelAnimationFrame(parRAF);
    clearToasts();
    hudRoot.textContent = '';
    menuRoot.textContent = '';
    if (hudRoot.__ugHud === api) hudRoot.__ugHud = null;
  }

  sizeCanvases();
  hudRoot.dataset.state = 'playing';
  if (debugMode) {
    state = 'playing';
    scrTitle.style.display = 'none';
  } else {
    showMenu();
  }
  // first compass/map paint so nothing pops in
  drawCompass(0);

  const api = {
    root: hudRoot,
    menuRoot,
    get state() { return state; },
    get paused() { return paused; },
    update,
    showMenu,
    hideMenu,
    showEnd,
    showPause,
    hidePause,
    fade,
    toast,
    hitmarker,
    setObjective,
    reset: resetRun,
    dispose,
  };
  hudRoot.__ugHud = api;
  return api;
}

export default createHud;
