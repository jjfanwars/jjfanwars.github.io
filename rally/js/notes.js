'use strict';
// Pace notes (for the solo co-driver and for labels on the map) and the navigator's paper map.
const NUM = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
const Notes = {
  build(S) {
    const out = [];
    for (const c of S.corners) {
      const side = c.dir === 'L' ? 'left' : 'right';
      let say = c.g === 1 ? 'hairpin ' + side : side + ' ' + NUM[c.g], txt = c.g === 1 ? 'HAIRPIN ' + side.toUpperCase() : side.toUpperCase() + ' ' + c.g;
      if (c.g >= 3 && c.ang > 1.7) { say += ' long'; txt += ' LONG'; }
      out.push({ s: c.s0, end: c.s1, k: 'c', c, say, txt });
    }
    for (const j of S.jumps) out.push({ s: j.s - 16, end: j.s, k: 'j', say: j.big ? 'big jump' : 'jump', txt: j.big ? 'BIG JUMP' : 'JUMP' });
    for (const c of S.crests) out.push({ s: c.s - 20, end: c.s, k: 'cr', say: 'over crest', txt: 'OVER CREST' });
    const ob = (S.B && S.B.obs) || 'log'; for (const l of S.logs) out.push({ s: l.s - 4, end: l.s, k: 'l', say: ob + ' ' + (l.side === 'L' ? 'left, keep right' : 'right, keep left'), txt: ob.toUpperCase() + ' ' + (l.side === 'L' ? 'LEFT › KEEP RIGHT' : 'RIGHT › KEEP LEFT') });
    out.sort((a, b) => a.s - b.s);
    // "into": a note that follows the previous one closely gets chained
    for (let i = 1; i < out.length; i++) if (out[i].s - out[i - 1].end < 30) out[i].into = true;
    return out;
  },
  // automatic co-driver: call notes early enough to react
  auto(st, notes, prog, speed, say) {
    if (st.i === undefined) st.i = 0;
    while (st.i < notes.length && notes[st.i].s < prog - 5) st.i++;
    const lead = Math.max(60, speed * 3.3);
    if (st.i < notes.length && notes[st.i].s - prog < lead) {
      let n = notes[st.i], words = n.say, txt = n.txt; st.i++;
      while (st.i < notes.length && notes[st.i].into && notes[st.i].s - prog < lead + 60) { words += ', into ' + notes[st.i].say; txt += '  ›  ' + notes[st.i].txt; st.i++; }
      say(txt, words);
    }
  },
};

// ---- the paper map ----
const MapDraw = {
  init(S, notes) {
    this.S = S; this.notes = notes;
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9; for (const p of S.P) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
    this.bb = { mnx, mxx, mnz, mxz };
    // paper texture (static)
    const pc = this.paper = document.createElement('canvas'); pc.width = 1024; pc.height = 1280; const g = pc.getContext('2d'), R = mulberry(3);
    g.fillStyle = '#efe6d0'; g.fillRect(0, 0, 1024, 1280);
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${120 + R() * 60 | 0},${100 + R() * 40 | 0},${70 + R() * 30 | 0},${R() * 0.035})`; const r = 2 + R() * 26; g.beginPath(); g.arc(R() * 1024, R() * 1280, r, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(80,110,140,.13)'; g.lineWidth = 1; for (let x = 0; x < 1024; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1280); g.stroke(); } for (let y = 0; y < 1280; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
    g.fillStyle = 'rgba(120,70,30,.12)'; g.beginPath(); g.arc(860, 1130, 90, 0, 7); g.lineWidth = 10; g.strokeStyle = 'rgba(120,70,30,.10)'; g.stroke(); // coffee ring
  },
  draw(ctx, car, opts) {
    const S = this.S, g = ctx; g.drawImage(this.paper, 0, 0);
    const h = car.h, sh = Math.sin(h), ch = Math.cos(h), cx = 512, cy = 860, sc = 1.75; // px per metre, heading up
    const toM = (x, z) => { const dx = x - car.x, dz = z - car.z, f = dx * sh + dz * ch, r = -dx * ch + dz * sh; return [cx + r * sc, cy - f * sc]; };
    g.save(); g.beginPath(); g.rect(24, 90, 976, 960); g.clip();
    // contour-ish shading of the forest
    g.fillStyle = 'rgba(70,110,60,.10)'; g.fillRect(24, 90, 976, 960);
    // road: outline then fill, in the visible window
    const P = S.P, step = 2, path = () => { g.beginPath(); let on = false; for (let i = 0; i < P.length; i += step) { const [X, Y] = toM(P[i].x, P[i].z); if (X < -200 || X > 1224 || Y < -200 || Y > 1300) { on = false; continue; } if (!on) { g.moveTo(X, Y); on = true; } else g.lineTo(X, Y); } };
    g.lineJoin = g.lineCap = 'round';
    path(); g.strokeStyle = '#3b2f22'; g.lineWidth = 2 * ROAD_HW * sc + 7; g.stroke();
    path(); g.strokeStyle = '#d9b77c'; g.lineWidth = 2 * ROAD_HW * sc; g.stroke();
    // driven part a little darker
    g.beginPath(); for (let i = 0; i < P.length && i * STEP < car.prog; i += step) { const [X, Y] = toM(P[i].x, P[i].z); i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.strokeStyle = 'rgba(90,60,30,.35)'; g.lineWidth = 2 * ROAD_HW * sc; g.stroke();
    // 100 m ticks
    g.fillStyle = '#3b2f22'; g.font = '600 18px Georgia,serif'; g.textAlign = 'center';
    for (let s = 100; s < S.L; s += 100) { const p = S.at(s), [X, Y] = toM(p.x, p.z); if (X < 0 || X > 1024 || Y < 80 || Y > 1060) continue; const rx = -Math.cos(p.h), rz = Math.sin(p.h), [X2, Y2] = toM(p.x + rx * 7, p.z + rz * 7); g.beginPath(); g.moveTo(X, Y); g.lineTo(X2, Y2); g.lineWidth = 2; g.strokeStyle = '#3b2f22'; g.stroke(); if (s % 500 === 0) g.fillText((s / 1000).toFixed(1) + 'k', X2 + (X2 - X) * 1.4, Y2 + (Y2 - Y) * 1.4 + 6); }
    // hazards
    for (const n of this.notes) {
      if (n.k === 'c') continue;
      const s = n.end, p = S.at(s), [X, Y] = toM(p.x, p.z); if (X < 0 || X > 1024 || Y < 80 || Y > 1060) continue;
      if (n.k === 'l') { const l = S.logs.find(q => q.s === s); if (l) { const [ax, ay] = toM(l.ax, l.az), [bx, by] = toM(l.bx, l.bz); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.strokeStyle = '#6b3d16'; g.lineWidth = 11; g.lineCap = 'butt'; g.stroke(); g.lineCap = 'round'; g.fillStyle = '#6b3d16'; g.font = '800 22px system-ui'; const lx = ax + (ax - bx) * 0.25, ly = ay + (ay - by) * 0.25; g.textAlign = Math.abs(ax - bx) > Math.abs(ay - by) ? (ax < bx ? 'right' : 'left') : 'center'; g.fillText(((S.B && S.B.obs) || 'log').toUpperCase(), lx, ly + 8); g.textAlign = 'center'; } }
      else { g.save(); g.translate(X, Y); g.fillStyle = n.k === 'j' ? '#c0281c' : '#1c4fa0'; g.beginPath(); if (n.k === 'j') { g.moveTo(-16, 10); g.lineTo(16, 10); g.lineTo(16, -14); g.closePath(); } else { g.arc(0, 4, 15, Math.PI, 0); g.closePath(); } g.fill(); g.font = '800 20px system-ui'; g.fillText(n.k === 'j' ? n.txt : 'CREST', 0, 34); g.restore(); }
    }
    // corner grades in circles on the outside of each corner
    if (opts.grades) for (const n of this.notes) {
      if (n.k !== 'c') continue; const c = n.c, mid = (c.s0 + c.s1) / 2, p = S.at(mid), out = c.dir === 'L' ? 1 : -1, off = 2 * ROAD_HW + 14 / sc;
      const [X, Y] = toM(p.x - Math.cos(p.h) * out * off, p.z + Math.sin(p.h) * out * off); if (X < 20 || X > 1004 || Y < 90 || Y > 1050) continue;
      g.beginPath(); g.arc(X, Y, 21, 0, 7); g.fillStyle = c.g <= 2 ? '#c0281c' : c.g <= 4 ? '#d08a10' : '#2f7d32'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#fff6'; g.stroke();
      g.fillStyle = '#fff'; g.font = '900 26px system-ui'; g.textAlign = 'center'; g.fillText(c.g === 1 ? 'H' : String(c.g), X, Y + 9);
    }
    // start/finish
    for (const [s, t] of [[40, 'START'], [S.L - 60, 'FINISH']]) { const p = S.at(s), [X, Y] = toM(p.x, p.z); if (X < 0 || X > 1024 || Y < 80 || Y > 1060) continue; g.fillStyle = '#111'; g.fillRect(X - 30, Y - 4, 60, 8); g.font = '900 22px system-ui'; g.fillText(t, X, Y - 12); }
    // the car
    g.save(); g.translate(cx, cy); g.fillStyle = '#c0281c'; g.beginPath(); g.moveTo(0, -22); g.lineTo(13, 14); g.lineTo(0, 7); g.lineTo(-13, 14); g.closePath(); g.fill(); g.restore();
    g.restore();
    // frame, header
    g.strokeStyle = '#3b2f22'; g.lineWidth = 3; g.strokeRect(24, 90, 976, 960);
    g.fillStyle = '#2a2118'; g.textAlign = 'left'; g.font = '900 italic 46px Georgia,serif'; g.fillText(S.cfg.name.toUpperCase(), 30, 64);
    g.textAlign = 'right'; g.font = '700 28px ui-monospace,monospace'; g.fillText((car.prog / 1000).toFixed(2) + ' / ' + (S.L / 1000).toFixed(2) + ' km', 994, 64);
    // scale bar
    g.textAlign = 'left'; g.fillStyle = '#2a2118'; g.fillRect(44, 1020, 100 * sc, 6); g.font = '600 18px system-ui'; g.fillText('100 m', 44 + 100 * sc + 10, 1028);
    // overview strip (north up)
    const bb = this.bb, ow = 560, oh = 190, ox = 30, oy = 1068, k = Math.min(ow / (bb.mxx - bb.mnx), oh / (bb.mxz - bb.mnz));
    const toO = (x, z) => [ox + (x - bb.mnx) * k + (ow - (bb.mxx - bb.mnx) * k) / 2, oy + oh - (z - bb.mnz) * k];
    g.beginPath(); for (let i = 0; i < P.length; i += 4) { const [X, Y] = toO(P[i].x, P[i].z); i ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.strokeStyle = '#3b2f22'; g.lineWidth = 4; g.stroke();
    { const [X, Y] = toO(car.x, car.z); g.beginPath(); g.arc(X, Y, 9, 0, 7); g.fillStyle = '#c0281c'; g.fill(); }
    // key
    g.fillStyle = '#2a2118'; g.font = '600 22px system-ui'; const kx = 620; let ky = 1092;
    for (const [c, t] of [['#c0281c', '1-2  hairpin / very slow'], ['#d08a10', '3-4  medium'], ['#2f7d32', '5-6  fast / nearly flat']]) { g.fillStyle = c; g.beginPath(); g.arc(kx + 10, ky - 7, 10, 0, 7); g.fill(); g.fillStyle = '#2a2118'; g.fillText(t, kx + 28, ky); ky += 34; }
    g.fillText('Call it early. The driver sees ~' + (opts.vis || 100) + ' m.', kx, ky + 8);
  },
};
