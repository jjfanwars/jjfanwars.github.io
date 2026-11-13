// DOM heads-up display.
import * as THREE from 'three';
import { FACTIONS } from './game.js';

const $ = id => document.getElementById(id);
const _v = new THREE.Vector3();
const mmss = t => { t = Math.max(0, Math.ceil(t)); return `${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}`; };

export class HUD {
  constructor(camera) {
    this.cam = camera; this.bT = 0; this.hurtA = 0; this.hitT = 0; this.markers = [];
    for (let i = 0; i < 3; i++) { const d = document.createElement('div'); d.className = 'marker'; $('hud').appendChild(d); this.markers.push(d); }
  }
  show(on) { $('hud').style.display = on ? 'block' : 'none'; }
  banner(title, sub, dur, good = true) {
    $('bTitle').textContent = title; $('bSub').textContent = sub;
    $('banner').className = good ? 'good' : 'bad'; $('banner').style.opacity = 1; this.bT = dur;
  }
  hurt(a) { this.hurtA = Math.min(1, this.hurtA + 0.35 + a * 0.5); }
  hitmarker(kill, head) { const h = $('hit'); h.className = kill ? 'kill' : head ? 'head' : ''; this.hitT = kill ? 0.35 : 0.15; }
  feed(att, vic, head, attFriend, vicFriend) {
    const d = document.createElement('div');
    d.innerHTML = `<b class="${attFriend ? 'fr' : 'en'}">${att}</b> <span>${head ? '⌖' : '▸'}</span> <b class="${vicFriend ? 'fr' : 'en'}">${vic}</b>`;
    $('feed').prepend(d);
    setTimeout(() => d.remove(), 6000);
  }
  matchEnd(won) { $('again').style.display = 'block'; }

  mark(i, label, x, y, z, cls) {
    const m = this.markers[i];
    _v.set(x, y, z).project(this.cam);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { m.style.display = 'none'; return; }
    const d = Math.round(this.cam.position.distanceTo(_v.set(x, y, z)));
    _v.project(this.cam);
    m.style.display = 'block'; m.className = 'marker ' + cls;
    m.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; m.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
    m.innerHTML = `<i>${label}</i><small>${d}m</small>`;
  }

  update(g, dt) {
    const s = g.player, pc = g.pc, pt = g.playerTeam;
    // top bar
    $('timer').textContent = mmss(g.time);
    $('timer').className = g.phase === 'planted' ? 'hot' : (g.phase === 'action' && g.time < 30 ? 'warn' : '');
    $('phase').textContent = { prep: 'PREPARATION', action: s.isAtk ? 'ATTACK' : 'DEFEND', planted: 'DEFUSER PLANTED', end: 'ROUND OVER', matchEnd: 'MATCH OVER' }[g.phase] || '';
    $('scL').textContent = g.score[pt]; $('scR').textContent = g.score[1 - pt];
    $('nmL').textContent = FACTIONS[pt].name; $('nmR').textContent = FACTIONS[1 - pt].name;
    const pips = (t) => g.team(t, false).map(o => `<i class="${o.alive ? '' : 'dead'}"></i>`).join('');
    $('pipL').innerHTML = pips(pt); $('pipR').innerHTML = pips(1 - pt);
    // weapon
    const fp = pc.mode === 'fp', w = s.wpn();
    $('wpn').style.opacity = fp ? 1 : 0.25;
    $('wName').textContent = w.def.name; $('mag').textContent = w.mag; $('res').textContent = '/ ' + w.reserve;
    $('mag').className = w.mag <= w.def.mag * 0.25 ? 'low' : '';
    $('gad').textContent = s.isAtk ? `[G] Breach ×${s.gad.charges}   [4] Frag ×${s.gad.frags}` : `[G] Reinforce ×${s.gad.reinf}   [4] Impact ×${s.gad.impacts}`;
    $('hp').textContent = Math.ceil(s.hp); $('hpBar').style.width = s.hp + '%';
    // crosshair
    const ch = $('cross');
    ch.style.display = fp && pc.ads < 0.6 && !pc.sprinting ? 'block' : 'none';
    if (fp) { const gap = 4 + (pc.spread || 0) * 900; ch.style.setProperty('--g', gap + 'px'); }
    this.hitT -= dt; $('hit').style.opacity = this.hitT > 0 ? 1 : 0;
    this.hurtA = Math.max(0, this.hurtA - dt * 0.8); $('hurt').style.opacity = Math.max(this.hurtA, s.alive && s.hp < 35 ? 0.35 : 0);
    $('hint').textContent = pc.hint || '';
    const pr = pc.prog;
    $('prog').style.display = pr ? 'block' : 'none';
    if (pr) { $('progL').textContent = pr.label; $('progB').style.width = Math.min(100, pr.v * 100) + '%'; }
    $('droneFx').style.display = pc.mode === 'drone' ? 'block' : 'none';
    // banner
    if (this.bT > 0) { this.bT -= dt; if (this.bT <= 0) $('banner').style.opacity = 0; }
    // markers
    const st = g.map.sites;
    if (g.phase === 'planted') { this.mark(0, '◆', g.bomb.x, 0.5, g.bomb.z, 'bomb'); this.markers[1].style.display = this.markers[2].style.display = 'none'; }
    else { this.mark(0, 'A', st[0].x, 1.6, st[0].z, 'site'); this.mark(1, 'B', st[1].x, 1.6, st[1].z, 'site'); this.markers[2].style.display = 'none'; }
    // scoreboard
    const sb = $('board');
    if (pc.keys.Tab || g.phase === 'matchEnd') {
      sb.style.display = 'block';
      const rows = t => g.team(t, false).map(o => `<tr class="${o.alive ? '' : 'dead'} ${o.isPlayer ? 'me' : ''}"><td>${o.name}</td><td>${o.kills}</td><td>${o.deaths}</td></tr>`).join('');
      sb.innerHTML = [pt, 1 - pt].map(t => `<table><tr><th>${FACTIONS[t].name} — ${t === g.atkTeam ? 'Attack' : 'Defence'} (${g.score[t]})</th><th>K</th><th>D</th></tr>${rows(t)}</table>`).join('');
    } else sb.style.display = 'none';
  }
}
