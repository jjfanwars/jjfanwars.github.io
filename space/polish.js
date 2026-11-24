'use strict';
// YeShip polish (second pass, 24 Nov 2026): attitude dial on the flight HUD, flight report after every landing or crash,
// time warp that slows down before big moments (air, the Moon's pull, impact), callouts when the frame body changes.
// Loaded after extras.js; calls boot() at the end.

// ---------------- attitude dial: where the nose points, seen from above (zenith in the middle, horizon ring, ground outside)
const ATT = {t: 0, up: new V3(), no: new V3(), ea: new V3(), d: new V3(), v: new V3(), Y: new V3(0, 1, 0)};
function attFrame() { const b = domBody(R.pos), A = ATT; A.up.copy(R.pos).sub(b.c).normalize(); A.no.copy(A.Y).addScaledVector(A.up, -A.up.y);
  if (A.no.lengthSq() < 1e-8) A.no.set(1, 0, 0).addScaledVector(A.up, -A.up.x); A.no.normalize(); A.ea.crossVectors(A.no, A.up); }
function attPolar(d) { const A = ATT, el = Math.asin(clamp(d.dot(A.up), -1, 1)), az = Math.atan2(d.dot(A.ea), d.dot(A.no)); return {el, az, r: (Math.PI / 2 - el) / Math.PI}; } // r: 0 zenith, .5 horizon, 1 straight down
function attDial(dt) {
  const cv = HUDE.fAtt || (HUDE.fAtt = $('fAtt')); if (!cv || (ATT.t -= dt) > 0) return; ATT.t = .1;
  const S = 88, dpr = Math.min(2, devicePixelRatio || 1); if (cv.width !== S * dpr) { cv.width = cv.height = S * dpr; }
  const x = cv.getContext('2d'), c = S / 2, Rr = S / 2 - 4; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, S, S); attFrame();
  // ground (outer half) and sky (inner half)
  x.fillStyle = 'rgba(120,84,52,.5)'; x.beginPath(); x.arc(c, c, Rr, 0, 7); x.fill();
  const sky = x.createRadialGradient(c, c, 0, c, c, Rr / 2); sky.addColorStop(0, 'rgba(40,90,170,.55)'); sky.addColorStop(1, 'rgba(90,160,230,.55)'); x.fillStyle = sky; x.beginPath(); x.arc(c, c, Rr / 2, 0, 7); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.18)'; x.lineWidth = 1; for (const k of [1 / 6, 1 / 3, 2 / 3, 5 / 6]) { x.beginPath(); x.arc(c, c, Rr * k, 0, 7); x.stroke(); }
  x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 1.5; x.beginPath(); x.arc(c, c, Rr / 2, 0, 7); x.stroke(); // horizon
  x.strokeStyle = 'rgba(255,255,255,.3)'; x.lineWidth = 1; x.beginPath(); x.arc(c, c, Rr, 0, 7); x.stroke();
  x.font = '600 9px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = 'rgba(234,244,255,.8)';
  [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]].forEach(([l, a]) => x.fillText(l, c + Math.sin(a) * (Rr * .5 + 7.5), c - Math.cos(a) * (Rr * .5 + 7.5)));
  const at = d => { const p = attPolar(d); return [c + Math.sin(p.az) * p.r * Rr, c - Math.cos(p.az) * p.r * Rr, p]; };
  // markers: prograde (green), retrograde (orange), guide (blue)
  const v = relVel(ATT.v), fly = R.st === 'fly' && v.length() > 3; v.normalize();
  if (fly) { let [px, py] = at(v); x.strokeStyle = '#c8f25a'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, 4.5, 0, 7); x.stroke();
    [px, py] = at(ATT.d.copy(v).negate()); x.strokeStyle = '#ffb347'; x.beginPath(); x.moveTo(px - 4, py - 4); x.lineTo(px + 4, py + 4); x.moveTo(px + 4, py - 4); x.lineTo(px - 4, py + 4); x.stroke(); }
  if (R.sas === 'guide' || guideOn()) { const [gx, gy] = at(guideDir(ATT.d)); x.strokeStyle = '#5ad1ff'; x.lineWidth = 2; x.strokeRect(gx - 4, gy - 4, 8, 8); }
  // the nose: yellow pointer from the middle
  const [nx, ny, np] = at(nose(ATT.d)); x.strokeStyle = 'rgba(255,207,74,.55)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(c, c); x.lineTo(nx, ny); x.stroke();
  x.fillStyle = '#ffcf4a'; x.strokeStyle = '#000'; x.lineWidth = 1.5; x.beginPath(); x.arc(nx, ny, 4, 0, 7); x.fill(); x.stroke();
  const pit = Math.round(np.el * 180 / Math.PI), hdg = Math.round(((np.az * 180 / Math.PI) + 360) % 360);
  setTxt('fAttT', (pit >= 0 ? '▲ ' : '▼ ') + Math.abs(pit) + '° · ' + (Math.abs(pit) > 85 ? '—' : String(hdg).padStart(3, '0') + '°'));
}

// ---------------- flight report: a card after every landing or crash (stats, landing grade, missions done on the way)
const REP = {prev: 'pad', why: '', v: new V3(), hideT: 0};
{ const e1 = explode; explode = function (why) { REP.why = why || R.why || ''; e1(why); }; }
{ const mc = misComplete; misComplete = function (m) { mc(m); (FLOG.misNow || (FLOG.misNow = [])).push(m.name); }; }
function repTrack() { if (R.st !== 'fly' || !G.dt) return; const F = FLOG; F.topAlt = Math.max(F.topAlt || 0, R.pos.length() - PLANET.R);
  F.topV = Math.max(F.topV || 0, relVel(REP.v).length()); F.topQ = Math.max(F.topQ || 0, R.qd || 0); if (G.warp <= 4) F.topG = Math.max(F.topG || 0, R.felt.length() / 9.81);
  if (domBody(R.pos) === MOON) F.wentMoon = true; }
function repShow(kind) {
  const F = FLOG, el = $('rep'); if (!el || !F.launched) return; const t = Math.max(0, G.t - (F.t0 || R.t0 || G.t)), b = R.body;
  let head, sub = '', stars = 0;
  if (kind === 'crash') { head = 'Vehicle lost'; sub = REP.why || 'Crashed'; }
  else { const sp = R.landV || 0, wet = b === PLANET && (() => { const d = R.lp.clone().normalize(); return heightAt(PLANET, d.x, d.y, d.z) < -.5; })();
    head = b === MOON ? 'Landed on the Moon' : wet ? 'Splashdown' : 'Landed'; stars = sp < 3 ? 3 : sp < 7 ? 2 : 1; sub = sp.toFixed(1) + ' m/s · ' + ['', 'hard', 'firm', 'soft'][stars] + ' touchdown';
    if (b === PLANET) { const d = R.lp.distanceTo(site.p); sub += ' · ' + (d < 2000 ? Math.round(d) + ' m' : fmtD(d)) + ' from the pad'; } }
  const row = (k, v) => '<div><span>' + k + '</span><b>' + v + '</b></div>';
  const mis = F.misNow && F.misNow.length ? '<div class="rm">Missions done: <b>' + F.misNow.join(', ') + '</b></div>' : '';
  el.innerHTML = '<div class="rh"><small>' + (F.test ? 'Test flight report' : 'Flight report') + '</small>' + (stars ? '<i>' + '★'.repeat(stars) + '<u>' + '★'.repeat(3 - stars) + '</u></i>' : '') + '</div>'
    + '<b class="rt' + (kind === 'crash' ? ' bad' : '') + '">' + head + '</b><div class="rs">' + sub + '</div><div class="rg">'
    + row('Flight time', fmtS(t)) + row(F.wentMoon ? 'Farthest out' : 'Highest', fmtD(F.topAlt || 0)) + row('Top speed', Math.round(F.topV || 0).toLocaleString('en') + ' m/s')
    + row('Peak g', (F.topG || 0).toFixed(1) + ' g') + row('Max Q', ((F.topQ || 0) / 1000).toFixed(1) + ' kPa') + row('Fuel left', (R.fuel.slice(R.bot).reduce((a, f) => a + f, 0) / 1000).toFixed(1) + ' t') + '</div>' + mis
    + '<div class="rf">' + (kind === 'crash' ? 'Back to the space centre...' : b === MOON ? 'F: get up · then F at the hatch to step out' : 'F: get up · Backspace: new rocket') + '</div>';
  el.classList.remove('hidden'); requestAnimationFrame(() => el.classList.add('on')); clearTimeout(REP.hideT); REP.hideT = setTimeout(repHide, kind === 'crash' ? 7000 : 11000); }
function repHide() { const el = $('rep'); el.classList.remove('on'); clearTimeout(REP.hideT); REP.hideT = setTimeout(() => el.classList.add('hidden'), 400); }
function repStep() { repTrack(); const st = R.st; if (REP.prev === 'fly' && st !== 'fly' && G.on) { if (st === 'landed') repShow('land'); else if (st === 'dead') repShow('crash'); }
  if (st === 'fly' && REP.prev !== 'fly' && !$('rep').classList.contains('hidden')) repHide(); REP.prev = st; }

// ---------------- time warp that slows down before big moments (one fast frame could jump past them)
const WG = {key: '', t: 0};
function warpGuard() {
  if (!G.on || !R.on || R.st !== 'fly' || G.wi <= 2) return; const ev = [], P_ = PRED, now = G.t;
  if (P_.air && P_.air.t > now) ev.push([P_.air.t, 'entering the air', 2]);
  if (P_.imp && P_.imp.t > now) ev.push([P_.imp.t, P_.imp.b === MOON ? 'about to hit the Moon' : 'about to hit the ground', 2]);
  if (P_.enc && P_.start === 0 && P_.enc.t > now) ev.push([P_.enc.t, "entering the Moon's pull", 4]);
  if (P_.exit && P_.exit.t > now) ev.push([P_.exit.t, "leaving the Moon's pull", 4]);
  let wi = G.wi, why = null;
  for (const [t, name, floor] of ev) { const left = t - now; let i = G.wi; while (i > floor && WARPS[i] * .05 * 6 > left) i--; if (i < wi) { wi = i; why = [name, left, t]; } }
  if (wi < G.wi) { G.wi = wi; G.warp = WARPS[wi]; if (WG.key !== why[0] || Math.abs(WG.t - why[2]) > 120) { WG.key = why[0]; WG.t = why[2]; showHint('Time slowed to ×' + G.warp + ': ' + why[0] + ' in ' + fmtS(why[1]), 3000); } } }
// callouts when the body you orbit changes (the HUD's Ap / Pe jump to the new body)
let lastDom = null;
function domCall() { if (R.st !== 'fly' || !R.on) { lastDom = null; return; } const b = domBody(R.pos); if (lastDom && b !== lastDom) {
    showHint(b === MOON ? "In the Moon's pull: Ap / Pe now measure from the Moon" : "Left the Moon's pull: Ap / Pe now measure from " + PLANET.name, 4000); stepTick(); } lastDom = b; }

// ---------------- hooks
{ const s0 = FLIGHT.step; FLIGHT.step = dt => { s0(dt); warpGuard(); }; }
{ const v0 = FLIGHT.visuals; FLIGHT.visuals = dt => { v0(dt); repStep(); domCall(); }; }
{ const h0 = FLIGHT.hud; FLIGHT.hud = dt => { h0(dt); if (!$('fl').classList.contains('hidden')) attDial(dt); }; }
$('rep').onclick = repHide;
Object.assign(window.YE, {attDial, attPolar, attFrame, repShow, repHide, warpGuard, REP});
boot();
