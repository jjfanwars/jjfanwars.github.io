'use strict';
// Lucas Space Program UI pieces that need code (26 Nov 2026, "agency manual" look): the stage elevation in the flight HUD.
// A 1px technical side drawing of what is still attached, drawn from the stage geometry: the firing stage is outlined in red and filled to its fuel level,
// later stages are hatched, dropped stages are gone. Loaded after places.js, before polish.js (which calls boot()).

const STK = {t: 0, key: ''};
const SVGNS = 'http://www.w3.org/2000/svg';
function stkDraw(dt) {
  const svg = HUDE.fStk || (HUDE.fStk = $('fStk')); if (!svg || $('fl').classList.contains('hidden') || (STK.t -= dt) > 0) return; STK.t = .2;
  const bs = burnSet(), firing = R.F > 0;
  const key = R.bot + '|' + STAGES.length + '|' + R.fuel.map((f, i) => STAGES[i].fuel ? Math.round(f / STAGES[i].fuel * 60) : 0).join(',') + '|' + firing + '|' + bs.join(',') + '|' + (R.legs > .5) + '|' + R.chute;
  if (key === STK.key) return; STK.key = key;
  const W = 92, H = 170, pad = 9; let y0 = Infinity, y1 = 26.1, rm = 2.5;
  for (let i = R.bot; i < STAGES.length; i++) { const S = STAGES[i]; y0 = Math.min(y0, S.y0); rm = Math.max(rm, S.side ? S.side.off + S.rs : S.r || 0); }
  const sy = (H - pad * 2 - (firing ? 8 : 0)) / (y1 - y0), sx = Math.min(sy * 2.4, (W / 2 - 5) / rm), X = x => (W / 2 + x * sx).toFixed(1), Y = y => (H - pad - (y - y0) * sy).toFixed(1);
  let out = '<defs><pattern id="stkH" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#121314" stroke-width="1" stroke-opacity=".35"/></pattern></defs>';
  const poly = (pts, cls) => { out += '<polygon points="' + pts.map(([x, y]) => X(x) + ',' + Y(y)).join(' ') + '" class="' + cls + '"/>'; };
  const box = (x0, x1, ya, yb, cls) => poly([[x0, ya], [x1, ya], [x1, yb], [x0, yb]], cls);
  const drawItem = (it, ox, cur, fuelK, hatch) => { const p = it.p, r = it.r || 0;
    if (it.k === 'adapt') { poly([[ox - it.rB, it.y0], [ox + it.rB, it.y0], [ox + it.rT, it.y1], [ox - it.rT, it.y1]], cur ? 'c' : 'o'); return; }
    if (it.k === 'dec') { box(ox - Math.max(r, .6), ox + Math.max(r, .6), it.y0, it.y1, 'd'); return; }
    if (!p) return;
    if (p.cat === 'engine') { const top = (p.noz ? Math.max(...p.noz.map(n => Math.hypot(n[0], n[1]))) : 0) + p.rT + .2, yb = it.y0 + p.bl;
      poly([[ox - top, yb], [ox + top, yb], [ox + Math.max(top, r * .8), it.y1], [ox - Math.max(top, r * .8), it.y1]], cur ? 'c' : 'o'); poly([[ox - p.rT, yb], [ox + p.rT, yb], [ox + p.rE, it.y0], [ox - p.rE, it.y0]], cur ? 'c' : 'o'); return; }
    if (p.nose) { poly([[ox - r, it.y0], [ox + r, it.y0], [ox + r * .25, it.y1 - p.h * .1], [ox, it.y1], [ox - r * .25, it.y1 - p.h * .1]], cur ? 'c' : 'o'); return; }
    if (p.cat === 'srb') { const yb = it.y0 + p.bl; poly([[ox - p.rT, yb], [ox + p.rT, yb], [ox + p.rE, it.y0], [ox - p.rE, it.y0]], cur ? 'c' : 'o'); it = {y0: yb, y1: it.y1}; }
    const ya = it.y0, yb = it.y1;
    if ((p.cat === 'tank' || p.cat === 'srb') && fuelK > 0) { if (cur) box(ox - r, ox + r, ya, ya + (yb - ya) * fuelK, 'f'); else if (hatch) box(ox - r, ox + r, ya, ya + (yb - ya) * fuelK, 'h'); }
    box(ox - r, ox + r, ya, yb, cur ? 'c' : 'o'); };
  for (let i = R.bot; i < STAGES.length; i++) { const S = STAGES[i], cur = bs.includes(i) && !S.cap, fk = S.fuel ? R.fuel[i] / S.fuel : 0;
    if (S.cap) { poly([[-2.5, 21.6], [2.5, 21.6], [1, 25.45], [-1, 25.45]], 'o'); box(-.78, .78, 25.45, 26.1, 'o'); if (R.chute === 2) box(-.2, .2, 26.1, 26.1, 'o'); continue; }
    if (S.side) { for (const s of [-1, 1]) for (const it of S.side.items) drawItem(it, s * S.side.off, cur, fk, true); continue; }
    for (const it of S.parts) drawItem(it, 0, cur, fk, true); }
  if (firing) { const yb = botY(); out += '<polygon class="fl" points="' + X(-1) + ',' + Y(yb) + ' ' + X(1) + ',' + Y(yb) + ' ' + X(0) + ',' + (+Y(yb) + 8) + '"/>'; }
  svg.innerHTML = out;
}
{ const st = document.createElement('style'); st.textContent = '#fStk .o { fill:none; stroke:#121314; stroke-width:1; vector-effect:non-scaling-stroke; } #fStk .c { fill:none; stroke:#D8342A; stroke-width:1.6; } #fStk .f { fill:#121314; } #fStk .h { fill:url(#stkH); } #fStk .d { fill:#121314; } #fStk .fl { fill:#D8342A; }'; document.head.appendChild(st); }
{ const h0 = FLIGHT.hud; FLIGHT.hud = function (dt) { h0(dt); stkDraw(dt); }; }
// the builder preview becomes a light drafting board (the sheet around it is the same stock)
{ const i0 = bldInit; bldInit = function () { const first = !BLD.rnd; i0(); if (!first) return; const s = BLD.scene, c = new THREE.Color(0xE4E4DF); s.background = c; s.fog = new THREE.Fog(0xE4E4DF, 160, 460);
    const fc = document.createElement('canvas'); fc.width = fc.height = 512; const x = fc.getContext('2d'); x.fillStyle = '#E9E9E4'; x.fillRect(0, 0, 512, 512); x.strokeStyle = 'rgba(18,19,20,.16)'; x.lineWidth = 2; x.strokeRect(0, 0, 512, 512); x.strokeStyle = 'rgba(18,19,20,.07)'; x.lineWidth = 1; for (let k = 64; k < 512; k += 64) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k, 512); x.moveTo(0, k); x.lineTo(512, k); x.stroke(); }
    const t = new THREE.CanvasTexture(fc); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(24, 24); t.anisotropy = 8; BLD.floor.material.map = t; BLD.floor.material.needsUpdate = true;
    s.traverse(o => { if (o.isMesh && o.geometry && o.geometry.type === 'RingGeometry') o.material.color.setHex(0xD8342A); });
    BLD.hl.material.blending = THREE.NormalBlending; BLD.hl.material.color.setHex(0xD8342A); BLD.rnd.toneMappingExposure = 1.0; }; }
{ const m0 = mapToggle; mapToggle = function (on) { m0(on); document.body.classList.toggle('map', MAPV.on); }; }
Object.assign(window.YE, {stkDraw});
