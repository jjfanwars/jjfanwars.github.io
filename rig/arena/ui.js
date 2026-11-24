'use strict';
// ui: menus, lobby, HUD (health, ammo, score, feed, minimap, boat panel, prompts), the death/loadout screen, scores, end screen, input, the main loop.
function setT(el, v) { if (typeof el === 'string') el = $(el); if (el && el._t !== v) { el._t = v; el.innerHTML = v; } }
const show = id => { for (const s of ['menu', 'lobby', 'pause', 'dead', 'end']) $(s).classList.toggle('hidden', s !== id); };
function showMsg(t, dur = 2.5) { const e = $('msg'); e.innerHTML = t; e.style.opacity = 1; clearTimeout(showMsg.T); showMsg.T = setTimeout(() => e.style.opacity = 0, dur * 1000); }
function hitMark(k) { const e = $('hm'); e.className = k || ''; e.style.opacity = 1; clearTimeout(hitMark.T); hitMark.T = setTimeout(() => e.style.opacity = 0, k === 'k' ? 380 : 160); if (k !== 'k') Snd.hit(k === 'h'); }
function dmgDir(x, z) { if (!x && !z) return; const a = Math.atan2(-(x - P.x), -(z - P.z)), rel = angD(P.yaw, a), d = document.createElement('div'); d.style.transform = `rotate(${(-rel * 180 / PI).toFixed(0)}deg)`; $('dmgDir').appendChild(d); requestAnimationFrame(() => { d.style.opacity = 1; setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 700); }, 500); }); }
// death card detail: how far away the killer was and how much health they had left (kh comes from the host)
function killInfo(e) { const a = AVS.get(e.by), bits = []; if (a && a.rp && P) { const d = Math.hypot(a.rp[0] - P.x, a.rp[1] - P.y, a.rp[2] - P.z); if (d > 1.5) bits.push(Math.round(d) + ' m away'); } if (e.kh) bits.push(`they had <b style="color:${e.kh <= 30 ? '#ff7a5a' : '#f0d080'}">${e.kh} HP</b> left`); return bits.length ? `<small style="display:block;font-size:14px;color:var(--dim);margin-top:4px">${bits.join(' · ')}</small>` : ''; }
// kills in quick succession (within 4.5 s) and in one life get a callout and a rising chime
function killStreak(vic, e) { const t = G.t; G.streak = (G.streak || 0) + 1; G.multi = t - (G.multiT || -99) < 4.5 ? (G.multi || 1) + 1 : 1; G.multiT = t;
  const m = ['', '', 'Double kill', 'Triple kill', 'Quad kill'][Math.min(4, G.multi)] || 'Rampage', s = G.streak >= 3 && G.streak % 2 === 1 ? G.streak + ' in a row' : '';
  showMsg(`You took out ${esc(vic)}${e.hd ? ' · <b style="color:#ffd060">headshot</b>' : ''}${G.multi > 1 || s ? `<br><b style="color:var(--acc);font-size:1.25em;letter-spacing:.08em">${[G.multi > 1 ? m : '', s].filter(Boolean).join(' · ').toUpperCase()}</b>` : ''}`, G.multi > 1 || s ? 2.6 : 2);
  if (G.multi > 1 || s) Snd.streak(Math.max(G.multi, s ? 2 : 0)); }
const FEED = [];
function feed(e) { const el = document.createElement('div'), me = myId(), nm = id => { const t = teamMode() ? TEAM_CSS[teamOf(id)] : '#fff'; return `<span style="color:${t}">${esc(nameOf(id))}</span>`; };
  if (e.k === 'bs') el.innerHTML = `${e.by ? nm(e.by) + ' sank ' : ''}<b>${BOATS[e.b] && BOATS[e.b].team != null ? TEAM_N[BOATS[e.b].team] + ' ' : ''}gunboat</b> ⚓`;
  else el.innerHTML = e.by && e.by !== e.id ? `${nm(e.by)} <small style="color:#aaa">[${e.w === 'knife' ? 'knife' : WPN[e.w] ? WPN[e.w].n : e.w || ''}${e.hd ? ' ✛' : ''}]</small> ${nm(e.id)}` : `${nm(e.id)} <small style="color:#aaa">${e.w === 'drown' ? 'drowned' : e.w === 'fall' ? 'fell' : 'died'}</small>`;
  if (e.by === me || e.id === me) el.className = 'me'; $('feed').prepend(el); FEED.push(el); setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 600); }, 6500); while ($('feed').children.length > 6) $('feed').lastChild.remove(); }

// ---------------- death / loadout
function loTiles() { $('lo').innerHTML = LOADOUTS.map((L, i) => `<button data-i="${i}" class="${i === SET.lo ? 'on' : ''}"><b>${i + 1} · ${L.n}</b><small>${L.d}</small></button>`).join(''); $('lo').querySelectorAll('button').forEach(b => b.onclick = () => { SET.lo = +b.dataset.i; saveSet(); loTiles(); }); }
function showDead(first) { if (G.over) return; G.deadOpen = true; G.deadFirst = !!first; G.deadT = first ? G.t - 10 : G.t; $('killer').innerHTML = first ? 'Pick a loadout' : (G.deadMsg || 'You died.'); loTiles(); show('dead'); try { document.exitPointerLock(); } catch (e) {} }
function hideDead() { G.deadOpen = false; $('dead').classList.add('hidden'); if (!locked()) lockMouse(); }
function deploy() { if (!G.deadOpen || G.t - G.deadT < 3 || G.over) return; act({a: 'spawn', lo: SET.lo}); lockMouse(); }
function deadFrame() { if (!G.deadOpen) return; const w = Math.max(0, 3 - (G.t - G.deadT)); setT($('deploy'), w > 0 ? 'Deploy in ' + Math.ceil(w) : 'Deploy'); $('deploy').disabled = w > 0; if (!G.deadFirst && G.t - G.deadT > 12) deploy(); }
// ---------------- scores
function boardHTML(st) { st = st || [...Object.entries(G.pl)].map(([id, q]) => ({id, n: nameOf(id), t: q[2], k: q[3], d: q[4], s: q[5], bot: (G.roster.find(r => r.id === id) || {}).bot})).sort((a, b) => b.s - a.s || b.k - a.k);
  const row = (r, i) => `<tr class="${r.id === myId() ? 'me' : ''}"><td>${i + 1}. <span style="color:${teamMode() ? TEAM_CSS[r.t] : '#fff'}">${esc(r.n)}</span></td><td>${r.k}</td><td>${r.d}</td><td><b>${r.s}</b></td></tr>`;
  const head = '<tr><th>Player</th><th>Kills</th><th>Deaths</th><th>Score</th></tr>';
  if (teamMode()) return [0, 1].map(t => `<h3 style="color:${TEAM_CSS[t]};margin:8px 0 2px">${TEAM_N[t]} · ${G.ts[t]}</h3><table>${head}${st.filter(r => r.t === t).map(row).join('')}</table>`).join('');
  return `<table>${head}${st.map(row).join('')}</table>`; }
function showEnd(e) { G.deadOpen = false; const me = myId(), won = teamMode() ? e.ts && e.ts[teamOf(me)] > e.ts[1 - teamOf(me)] : e.st && e.st[0] && e.st[0].id === me; $('endT').innerHTML = esc(won ? (teamMode() ? TEAM_N[teamOf(me)] + ' team wins. You won!' : 'You win!') : e.win); $('endB').innerHTML = boardHTML(e.st); show('end'); try { document.exitPointerLock(); } catch (x) {} G.endShown = G.t; }
function hideEnd() { $('end').classList.add('hidden'); }

// ---------------- HUD
function startHud() { $('hud').classList.remove('hidden'); show(null); miniBase(); }
let MINI = null; const MS = 300 / 280;
function miniBase() { if (MINI) return; MINI = cv(300, 300, (g, w, h) => { const im = g.createImageData(w, h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const x = (i - w / 2) / MS, z = (j - h / 2) / MS - 10, gh = groundH(x, z), k = (j * w + i) * 4, c = gh > 1.4 ? [70, 110, 60] : gh > -.2 ? [200, 185, 140] : gh > -3 ? [60, 150, 150] : [20, 50, 70]; im.data[k] = c[0]; im.data[k + 1] = c[1]; im.data[k + 2] = c[2]; im.data[k + 3] = Math.hypot(i - w / 2, j - h / 2) < w / 2 ? 200 : 0; } g.putImageData(im, 0, 0); g.strokeStyle = 'rgba(80,70,60,.9)'; g.lineWidth = 2; g.strokeRect(w / 2 - 20 * MS, h / 2 - 28 * MS, 40 * MS, 36 * MS); }); }
function miniFrame() { const c = $('mini'), g = c.getContext('2d'), W = 300; g.clearRect(0, 0, W, W); g.drawImage(MINI, 0, 0); const px = x => W / 2 + x * MS, pz = z => W / 2 + (z + 10) * MS;
  for (const b of BOATS) { if (!b.vis) continue; g.save(); g.translate(px(b.rx), pz(b.rz)); g.rotate(-b.ryaw); g.fillStyle = b.team == null ? '#ddd' : TEAM_CSS[b.team]; g.fillRect(-3, -8, 6, 16); g.restore(); }
  for (const a of AVS.values()) { if (!a.vis || !a.alive || !a.rp) continue; const en = isEnemy(a.id); if (en && !(a.flT > -1.5 && a.shT > G.t)) continue; g.fillStyle = en ? '#ff5040' : '#7fd0ff'; g.beginPath(); g.arc(px(a.rp[0]), pz(a.rp[2]), 4, 0, TAU); g.fill(); }
  PICKS.forEach((q, i) => { if (PK[i] || !WPN[q.k]) return; g.fillStyle = '#f0b040'; g.fillRect(px(q.x) - 2.5, pz(q.z) - 2.5, 5, 5); });
  if (P.alive) { g.save(); g.translate(px(P.x), pz(P.z)); g.rotate(-P.yaw); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(-5, 6); g.fill(); g.restore(); } }
// reload progress under the ammo count, and what to do when the magazine is empty
function ammoExtra(W, a) { const r = $('relBar'), on = !P.seat && P.alive && P.relT > 0; r.classList.toggle('hidden', !on); if (on) r.firstChild.style.width = clamp(1 - P.relT / (W.rel || 1), 0, 1) * 100 + '%';
  setT('ammoH', P.seat || !P.alive || on ? '' : a[0] <= 0 && a[1] <= 0 ? 'OUT OF AMMO · Q switch weapon' : a[0] <= 0 ? 'R reload' : a[0] <= Math.ceil(W.mag * .25) && a[1] > 0 && W.mag > 2 ? 'Low · R reload' : ''); }
const fmtT = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function hud(dt) {
  const k = wNow(), W = WPN[k], a = P.ammo[k] || [0, 0];
  setT('hpN', Math.max(0, Math.ceil(P.alive ? P.hp : 0)) + '<small>' + (P.alive && (HS.get(P.id) || {}).prot > G.t ? 'PROTECTED' : '') + '</small>'); $('hpBar').firstChild.style.width = clamp(P.hp, 0, 100) + '%';
  $('airBar').classList.toggle('hidden', !(P.uw || P.air < 1)); $('airBar').firstChild.style.width = P.air * 100 + '%';
  setT('wName', P.seat ? (P.seat.r === 'd' ? 'Helm' : 'Deck gun') : W.n + (P.relT > 0 ? ' · reloading' : '')); setT('ammoN', P.seat ? '' : `<span style="color:${a[0] <= 0 ? '#ff5a4a' : a[0] <= Math.max(1, Math.ceil(W.mag * .25)) ? '#ffb040' : 'inherit'}">${a[0]}</span><small> / ${a[1]}</small>`); ammoExtra(W, a); setT('nades', P.seat ? '' : '● '.repeat(P.nades) + '<small style="color:#999"> grenades (G)</small>');
  const tl = G.set.time ? fmtT(Math.max(0, G.tl)) : '';
  if (teamMode()) setT('score', `<span style="color:${TEAM_CSS[0]}">RED ${G.ts[0]}</span> &nbsp;—&nbsp; <span style="color:${TEAM_CSS[1]}">${G.ts[1]} BLUE</span><small>${G.set.goal ? 'FIRST TO ' + G.set.goal : 'NO LIMIT'}${tl ? ' · ' + tl : ''}</small>`);
  else { const L = Object.entries(G.pl).sort((x, y) => y[1][5] - x[1][5]), mine = (G.pl[myId()] || [])[5] || 0, top = L[0]; setT('score', `YOU ${mine} &nbsp;·&nbsp; ${top && top[0] !== myId() ? esc(nameOf(top[0])) + ' ' + top[1][5] : (L[1] ? 'NEXT ' + L[1][1][5] : 'LEADING')}<small>${G.set.goal ? 'FIRST TO ' + G.set.goal : 'NO LIMIT'}${tl ? ' · ' + tl : ''}</small>`); }
  // boat panel
  const bh = $('boatHud'); if (P.seat) { const b = BOATS[P.seat.b]; bh.classList.remove('hidden'); const tp = b.tpc || [b.tp[0] > G.t ? Math.ceil(b.tp[0] - G.t) : 0, b.tp[1] > G.t ? Math.ceil(b.tp[1] - G.t) : 0];
    setT(bh, `${b.team != null ? TEAM_N[b.team].toUpperCase() + ' ' : ''}GUNBOAT · HULL ${Math.ceil(b.hp)}<div class="bar"><i style="width:${b.hp / BT.HP * 100}%"></i></div>${P.seat.r === 'd' ? `${Math.round(Math.abs(b.rv || 0) * 1.94)} kn · TORPEDOES ${tp.map(t => t ? '<span style="color:#888">' + t + 's</span>' : '<span style="color:#7f7">READY</span>').join(' ')} (F)<br><small>W/S throttle · A/D steer · E get up</small>` : 'Click to fire · E get up'}`); } else bh.classList.add('hidden');
  // prompt
  let pr = ''; const ns = nearSeat(); if (ns) pr = ns.t; else if (P.sw && !P.uw) { const f = fwd(P.yaw, 0), top = floorAll(P.x + f[0], P.z + f[2], 1.9); if (top > -.4 && top < 1.95) pr = 'Space  climb out'; } else if (!P.seat && ladderAt(P.x, P.z, P.y) && !P.lad && !P.onG) pr = 'W  climb'; else if (!P.seat && ladderAt(P.x, P.z, P.y) && P.onG && P.y < ladderAt(P.x, P.z, P.y).y1 - .3) pr = 'W  climb the ladder';
  if (P.alive && P.seat) pr = ''; $('prompt').classList.toggle('hidden', !pr || !P.alive); setT('prompt', pr);
  // crosshair
  const xs = clamp(((W.spr || .01) * P.spr) * 900, 4, 60), xh = $('xh'); xh.style.display = P.alive && !(P.ads && W.zoom >= 4 && !P.seat) && !G.deadOpen ? '' : 'none'; if (xh._s !== Math.round(xs)) { xh._s = Math.round(xs); const L = xh.children; L[0].style.top = (-xs - 8) + 'px'; L[1].style.top = xs + 'px'; L[2].style.left = (-xs - 8) + 'px'; L[3].style.left = xs + 'px'; }
  if (P.alive && P.hp < 30 && !G.pausedAt && (G.hbT = (G.hbT || 0) - dt) <= 0) { G.hbT = .55 + P.hp / 30 * .5; Snd.heart(1 - P.hp / 40); }
  G.hurt = Math.max(0, (G.hurt || 0) - dt * 2); $('vigD').style.opacity = Math.max(G.hurt * .8, P.alive ? clamp((45 - P.hp) / 45, 0, 1) * .6 : 0);
  $('board').classList.toggle('hidden', !(K.Tab && G.on)); if (K.Tab && (G.bT = (G.bT || 0) - dt) <= 0) { G.bT = .3; setT('boardT', boardHTML()); }
  if (G.over && G.endShown != null) setT('endS', isHost() ? `Next match in ${Math.max(0, Math.ceil(14 - (G.t - G.endT)))} s` : 'Next match starts soon');
  if ((G.miniT = (G.miniT || 0) - dt) <= 0) { G.miniT = .1; miniFrame(); }
}

// ---------------- menu + lobby
const myName = () => (($('name').value || SET.name || '').trim().replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 14));
const LOB = {team: {}};
function segInit() {
  document.querySelectorAll('.seg[data-k]').forEach(sg => { const k = sg.dataset.k; const upd = () => sg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(SET[k]))); sg.querySelectorAll('button').forEach(b => b.onclick = () => { SET[k] = b.dataset.v; saveSet(); upd(); if (k === 'gfx') applyGfx(); }); upd(); });
  document.querySelectorAll('.seg[data-s]').forEach(sg => { const k = sg.dataset.s; sg.querySelectorAll('button').forEach(b => b.onclick = () => { if (Net.role === 'guest') return; SET[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; saveSet(); lobbyDraw(); sendLobby(); }); });
}
function lobbySet() { return {mode: SET.mode, goal: +SET.goal, time: +SET.time, bots: +SET.bots, skill: +SET.skill}; }
function lobbyCrew() { const L = [{id: 'H', name: myName() || 'Host'}].concat([...Net.peers.values()].map(p => ({id: p.id, name: p.name}))); let r = 0, b = 0; for (const c of L) { if (LOB.team[c.id] == null) LOB.team[c.id] = r <= b ? 0 : 1; c.team = LOB.team[c.id]; if (c.team) b++; else r++; } return L; }
function lobbyDraw(m) {
  const set = m ? m.set : lobbySet(), crew = m ? m.crew : lobbyCrew(), boat = set.mode === 'boat';
  document.querySelectorAll('.seg[data-s]').forEach(sg => { sg.classList.toggle('ro', Net.role === 'guest'); sg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(set[sg.dataset.s]))); });
  $('crew').innerHTML = crew.map(c => `<div class="pl"><i style="background:${boat ? TEAM_CSS[c.team] : '#bbb'}"></i><span>${esc(c.name)}${c.id === myId() ? ' (you)' : ''}</span><small>${c.id === 'H' ? 'host' : ''}${boat ? ' · ' + TEAM_N[c.team] : ''}</small></div>`).join('') + (set.bots ? `<div class="pl"><i style="background:#666"></i><span>${set.bots} bots</span><small>${['', 'easy', 'normal', 'hard'][set.skill]}</small></div>` : '');
  $('teamPick').classList.toggle('hidden', !boat);
}
function sendLobby() { if (Net.role !== 'host') return; lobbyDraw(); Net.send({t: 'lobby', set: lobbySet(), crew: lobbyCrew()}); }
function buildRoster(set, crew) { const R = crew.map((c, i) => ({id: c.id, name: c.name, c: i, team: set.mode === 'boat' ? c.team : 0})); let red = R.filter(r => r.team === 0).length, blue = R.length - red;
  for (let i = 0; i < set.bots; i++) { const team = set.mode === 'boat' ? (red <= blue ? 0 : 1) : 0; if (team) blue++; else red++; R.push({id: 'b' + i, name: BOT_NAMES[i % BOT_NAMES.length] + ' (bot)', c: R.length, team, bot: 1}); } return R; }
function hostStart() { const set = lobbySet(), roster = buildRoster(set, lobbyCrew()); Net.meta(Net.peers.size < MAXP - 1); Net.send({t: 'start', v: AV, set, roster}); matchStart(set, roster); }
function practice() { Net.close(); const set = lobbySet(); if (!set.bots) set.bots = 4; const roster = buildRoster(set, [{id: 'H', name: myName() || 'You', team: 0}]); matchStart(set, roster); }
function toMenu(msg) { setPause(false); Net.close(); G.on = false; G.over = false; G.deadOpen = false; P.alive = false; P.seat = null; for (const id of [...AVS.keys()]) dropAvatar(id); for (const p of [...PJ.values()]) pjDrop(p); $('hud').classList.add('hidden'); $('scope').classList.add('hidden'); show('menu'); $('err').textContent = msg || ''; try { document.exitPointerLock(); } catch (e) {} buildBoats('ffa'); refreshRooms(); }
async function refreshRooms() { if (G.on || $('menu').classList.contains('hidden')) return; const L = await Net.rooms(); const el = $('rooms'); el.innerHTML = L.length ? '' : '<small style="color:var(--dim)">None open right now. Host one!</small>'; for (const r of L) { const b = document.createElement('button'); b.textContent = r.name.replace(/^\[?Arena\]? /, '') + ' · ' + (r.n || 1) + ' in'; b.onclick = () => joinCode(r.code); el.appendChild(b); } }
function needName() { const n = myName(); if (!n) { $('err').textContent = 'Type a name first.'; $('name').focus(); return null; } SET.name = n; saveSet(); return n; }
function joinCode(code) { const n = needName(); if (!n) return; aInit(); code = String(code || '').toUpperCase().trim(); if (code.length !== 5) { $('err').textContent = 'Codes are 5 letters.'; return; } $('code').textContent = code; show('lobby'); $('bGo').classList.add('hidden'); $('lset').style.pointerEvents = 'none'; $('lmsg').textContent = 'Connecting…'; $('crew').innerHTML = ''; Net.join(code, n, why => { if (!G.on) { show('menu'); $('err').textContent = why; } else toMenu(why); }); }
Net.on('_lobby', () => sendLobby());
Net.on('_join', m => { if (Net.role !== 'host') return; if (G.on) { const p = Net.peers.get(m.id); if (!G.roster.some(r => r.id === m.id)) rosterAdd(m.id, p ? p.name : 'Player'); avatar(m.id); Net.send1(m.id, {t: 'start', v: AV, set: G.set, roster: G.roster, late: 1}); showMsg(`${esc(p ? p.name : 'Someone')} joined`, 2); } else sendLobby(); });
Net.on('_left', m => { if (Net.role !== 'host') return; if (G.on) { const i = G.roster.findIndex(r => r.id === m.id); if (i >= 0) G.roster.splice(i, 1); HS.delete(m.id); for (const b of BOATS) { if (b.drv === m.id) emit({k: 'unseat', b: b.i, r: 'd', id: m.id}); if (b.gun === m.id) emit({k: 'unseat', b: b.i, r: 'g', id: m.id}); } emit({k: 'ro', ro: G.roster}); dropAvatar(m.id); showMsg(`${esc(m.name || 'Someone')} left`, 2); } else { delete LOB.team[m.id]; sendLobby(); } });
Net.on('team', (m, from) => { if (Net.role === 'host' && !G.on) { LOB.team[from] = m.team ? 1 : 0; sendLobby(); } });
Net.on('lobby', m => { if (Net.role !== 'guest' || G.on) return; $('lmsg').textContent = 'Waiting for the host to start…'; lobbyDraw(m); });
Net.on('start', m => { if (Net.role !== 'guest') return; if (m.v !== AV) { toMenu('You and the host have different versions. Reload the page.'); return; } matchStart(m.set, m.roster); });
Net.on('_hostlost', () => { if (G.on || Net.role === 'guest') toMenu('The host left the match.'); });
function menuInit() {
  $('name').value = SET.name || ''; $('mKeys').innerHTML = KEYMAP.map(([k, a]) => `<div><b>${k}</b>${a}</div>`).join('');
  for (const [id, k] of [['sens', 'sens'], ['vol', 'vol'], ['fov', 'fov'], ['pSens', 'sens'], ['pVol', 'vol']]) { const e = $(id); e.value = SET[k]; e.oninput = () => { SET[k] = +e.value; saveSet(); if (k === 'vol' && A.master) A.master.gain.value = .8 * SET.vol; if (k === 'fov') { cam.fov = SET.fov; cam.updateProjectionMatrix(); } }; }
  segInit();
  $('bHost').onclick = () => { const n = needName(); if (!n) return; aInit(); LOB.team = {}; const code = Net.host(n, s => { if (G.on) { if (s !== 'open') showMsg('Relay connection dropped. Reconnecting…', 4); return; } $('lmsg').textContent = s === 'open' ? 'Share the code. Up to 8 players. Friends can join mid-match.' : 'Connection lost, retrying…'; }); $('code').textContent = code; show('lobby'); $('bGo').classList.remove('hidden'); $('lset').style.pointerEvents = ''; $('lmsg').textContent = 'Connecting…'; sendLobby(); };
  $('bJoin').onclick = () => joinCode($('joinC').value); $('joinC').onkeydown = e => { if (e.key === 'Enter') joinCode($('joinC').value); };
  $('bPractice').onclick = () => { SET.name = myName() || SET.name; saveSet(); aInit(); practice(); };
  $('bGo').onclick = () => { aInit(); hostStart(); }; $('bLeave').onclick = () => toMenu();
  $('tRed').onclick = () => { if (Net.role === 'host') { LOB.team.H = 0; sendLobby(); } else Net.send({t: 'team', team: 0}); };
  $('tBlue').onclick = () => { if (Net.role === 'host') { LOB.team.H = 1; sendLobby(); } else Net.send({t: 'team', team: 1}); };
  $('deploy').onclick = deploy; $('resume').onclick = () => { setPause(false); lockMouse(); };
  $('quit').onclick = () => { if (Net.role === 'host' && Net.peers.size && !confirm('Leave? The match ends for everyone.')) return; toMenu(); }; $('endLeave').onclick = () => toMenu();
  setInterval(refreshRooms, 5000); refreshRooms();
}

// ---------------- pause: offline practice really stops (sim, clock and sound); online matches keep running
function setPause(on) { $('pause').classList.toggle('hidden', !on);
  if (on) { clearKeys(); const solo = Net.role === 'solo'; $('pauseN').textContent = solo ? 'Practice is paused.' : 'The match keeps running.'; if (solo && !G.pausedAt) { G.paused = true; G.pausedAt = performance.now(); try { A.ctx && A.ctx.suspend(); } catch (e) {} } }
  else if (G.pausedAt) { CLKO -= performance.now() - G.pausedAt; G.pausedAt = 0; G.paused = false; mdx = mdy = 0; try { A.ctx && A.ctx.resume(); } catch (e) {} } }
// ---------------- input
addEventListener('keydown', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (e.code === 'Tab') e.preventDefault(); K[e.code] = true; aInit(); if (!G.on || e.repeat) return;
  if (G.deadOpen) { const d = +e.key; if (d >= 1 && d <= LOADOUTS.length) { SET.lo = d - 1; saveSet(); loTiles(); } if (e.code === 'Space' || e.code === 'Enter') deploy(); return; }
  if (!P.alive) return;
  if (e.code === 'KeyE') { if (P.seat) act({a: 'unseat', b: P.seat.b}); else { const s = nearSeat(); if (s) act({a: 'seat', b: s.b, r: s.r}); } }
  if (e.code === 'KeyF' && P.seat && P.seat.r === 'd') act({a: 'tp', b: P.seat.b});
  if (e.code === 'KeyR') reload(); if (e.code === 'Digit1') swapSlot(0); if (e.code === 'Digit2') swapSlot(1); if (e.code === 'KeyQ') swapSlot(1 - P.slot);
  if (e.code === 'KeyG') throwNade(); if (e.code === 'KeyV') knife();
});
addEventListener('keyup', e => { K[e.code] = false; });
canvas.addEventListener('mousedown', e => { aInit(); if (!G.on) return; if (!locked() && !TEST && !G.deadOpen && !G.over) { lockMouse(); return; } if (e.button === 0) mouseL = true; if (e.button === 2) mouseR = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
addEventListener('contextmenu', e => { if (G.on) e.preventDefault(); });
addEventListener('wheel', e => { if (!G.on || !P.alive || !locked()) return; const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1), n = performance.now(); if (!d) return; if (Math.sign(d) !== Math.sign(G.whA || 0)) G.whA = 0; G.whA += d; if (Math.abs(G.whA) < 40 || n - (G.whN || 0) < 150) return; G.whA = 0; G.whN = n; swapSlot(1 - P.slot); }, {passive: true});
document.addEventListener('pointerlockchange', () => { if (!G.on) return; if (!locked() && P.alive && !G.deadOpen && !G.over) setPause(true); else if (locked()) setPause(false); });
addEventListener('blur', clearKeys);

// ---------------- main loop
let last = performance.now();
function frame(t) {
  const dt = Math.min(.05, Math.max(0, (t - last) / 1000)); last = t;
  if (G.on && !G.pausedAt) simFrame(dt);
  else { G.t += dt; const a = t / 1000 * .05; cam.position.set(Math.sin(a) * 120, 34, -20 + Math.cos(a) * 120); cam.lookAt(0, 2, -15); waterFrame(dt); boatsFrame(dt); fxFrame(dt); sun.position.set(SUNDIR.x * 160, SUNDIR.y * 160, SUNDIR.z * 160); sun.target.position.set(0, 0, 0); }
  frameRest(); RND.render(scene, cam); requestAnimationFrame(frame);
}
function simFrame(dt) {
  {
    G.t += dt; const zoom = P.ads && WPN[wNow()].zoom && !P.seat ? WPN[wNow()].zoom : 1, s = .0022 * SET.sens / zoom;
    if (P.alive && !G.deadOpen) { P.yaw -= mdx * s; P.pitch = clamp(P.pitch - mdy * s, -1.5, 1.5); } mdx = mdy = 0;
    if (isHost()) hostTick(dt);
    boatsFrame(dt); playerStep(dt); weaponStep(dt); avatarsFrame(dt); pjFrame(dt); pkFrame(dt); fxFrame(dt); waterFrame(dt); camStep(dt); vmFrame(dt); deadFrame(); hud(dt);
    if (G.shake > 0) { G.shake = Math.max(0, G.shake - dt * 2.5); cam.position.x += (Math.random() - .5) * G.shake * .25; cam.position.y += (Math.random() - .5) * G.shake * .25; }
    if (Net.role !== 'solo') { if ((G.poseT = (G.poseT || 0) - dt) <= 0) { G.poseT = .05; sendPose(); } if (Net.role === 'host' && (G.snapT = (G.snapT || 0) - dt) <= 0) { G.snapT = 1 / 15; Net.send(packSnap()); } }
    else G.evq.length = 0;
  }
}
function frameRest() {
  // under water: thick teal fog
  const uw = cam.position.y < waterY(cam.position.x, cam.position.z) - .02; if (uw !== G.uwView) { G.uwView = uw; scene.fog.color.set(uw ? 0x1a5560 : FOGC); scene.fog.density = uw ? .06 : .0032; scene.background.set(uw ? 0x1a5560 : FOGC); $('uwV').style.opacity = uw ? 1 : 0; }
  if (A.on && A.ctx.listener) { const L = A.ctx.listener; cam.getWorldDirection(_cv); if (L.positionX) { L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z; L.forwardX.value = _cv.x; L.forwardY.value = _cv.y; L.forwardZ.value = _cv.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(_cv.x, _cv.y, _cv.z, 0, 1, 0); } }
}
// boot
setTimeout(() => { buildWorld(); applyGfx(); buildBoats('ffa'); menuInit(); $('load').classList.add('hidden'); requestAnimationFrame(frame); }, 30);
if (TEST) window.__A = {RND, sim: (n, dt = .033) => { for (let i = 0; i < n; i++) { CLKO += dt * 1000; simFrame(dt); } }, G, P, BOATS, HS, BOTS, AVS, PJ, PICKS, PK, NAV, K, Net, act, hostAct, practice, matchStart, buildRoster, lobbySet, groundH, floorStatic, simBoat, shootRay, SET, teamMode};
