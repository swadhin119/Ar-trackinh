// Hero-inspired AR effects. Every effect is procedural (no copyrighted art/assets).
// Each character exposes create() -> { draw(api) } and keeps its own state in a closure.
//
// api = { ctx, W, H, t, dt, face, hands, fx, P, show:{hands,face,eyes}, k }
//   face : smoothed face object from scene.js (or null)
//   hands: array of smoothed hand objects (gestures + events)
//   P    : shared particle system, fx: { shake(px), flash(color,a), video, sampleFrame() }
//   k    : intensity multiplier from the UI slider

import { glow, glowLine, glowCircle, glowSegs, bolt, forkedBolt, drawLightning, hexA } from './fx.js';
import { HAND_CONN, BROW_A, BROW_B } from './scene.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a, v, s = 1) => ({ x: a.x + v.x * s, y: a.y + v.y * s });
const unit = (x, y) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const chance = (p) => Math.random() < p;

function path(ctx, pts, close = true) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
}
function smoothPath(ctx, pts) {
  const n = pts.length;
  ctx.beginPath();
  const m0 = lerp(pts[n - 1], pts[0], 0.5);
  ctx.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const m = lerp(pts[i], pts[(i + 1) % n], 0.5);
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  ctx.closePath();
}
const scaled = (pts, c, sx, sy = sx) => pts.map((p) => ({ x: c.x + (p.x - c.x) * sx, y: c.y + (p.y - c.y) * sy }));
const eyes = (f) => [f.eyeA, f.eyeB];

/** Ray from point p along unit dir d -> where it leaves the screen. */
function toEdge(p, d, W, H) {
  let tt = 1e9;
  if (d.x > 1e-4) tt = Math.min(tt, (W - p.x) / d.x);
  if (d.x < -1e-4) tt = Math.min(tt, -p.x / d.x);
  if (d.y > 1e-4) tt = Math.min(tt, (H - p.y) / d.y);
  if (d.y < -1e-4) tt = Math.min(tt, -p.y / d.y);
  if (tt === 1e9 || tt < 0) tt = Math.max(W, H);
  return add(p, d, tt);
}

function eyeGlow(a, color, scale = 1, alpha = 1) {
  for (const e of eyes(a.face)) {
    const o = 1 - clamp((e.blink - 0.35) / 0.3, 0, 1);
    if (o <= 0) continue;
    glow(a.ctx, e.iris.x, e.iris.y, e.w * 1.3 * scale, color, 0.9 * o * alpha);
    glow(a.ctx, e.iris.x, e.iris.y, e.w * 0.35 * scale, '#ffffff', o * alpha);
  }
}

function burst(a, x, y, n, color, speed, opts = {}) {
  n = Math.round(n * a.k);
  for (let i = 0; i < n; i++) {
    const ang = rnd(0, TAU), s = speed * rnd(0.3, 1);
    a.P.emit({ x, y, vx: Math.cos(ang) * s, vy: Math.sin(ang) * s, life: rnd(0.4, 1), size: rnd(3, 8) * (a.W / 1280), color, kind: 'spark', ...opts });
  }
}

function ringsUpdate(a, rings, speed = 1) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.age += a.dt;
    const p = r.age / r.life;
    if (p >= 1) { rings.splice(i, 1); continue; }
    glowCircle(a.ctx, r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - p, 2)) * speed, r.color, r.w * (1 - p), 1 - p);
  }
}

/** Face-tracked armoured helmet built from landmarks (perspective follows the real face). */
function ironHelmet(a, f, C) {
  const { ctx } = a, P = f.P, Wf = f.faceW, up = f.up;
  const inward = (i, k) => lerp(P[i], f.center, k);
  ctx.save();
  // Red outer shell
  const shell = scaled(f.oval, f.center, 1.1, 1.07);
  smoothPath(ctx, shell);
  const hl = add(f.forehead, up, -Wf * 0.05);
  const g = ctx.createRadialGradient(hl.x, hl.y, Wf * 0.05, f.center.x, f.center.y, Wf * 0.85);
  g.addColorStop(0, '#ff5a4a'); g.addColorStop(0.45, '#c3141f'); g.addColorStop(0.85, '#5c060b'); g.addColorStop(1, '#2a0205');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Wf * 0.012; ctx.strokeStyle = '#1a0103'; ctx.stroke();
  // Gold faceplate
  const plate = [
    lerp(P[10], P[168], 0.42),
    add(P[334], up, Wf * 0.07), inward(356, 0.12), inward(454, 0.14), inward(397, 0.12), inward(377, 0.08),
    lerp(P[152], P[17], 0.12),
    inward(148, 0.08), inward(172, 0.12), inward(234, 0.14), inward(127, 0.12), add(P[105], up, Wf * 0.07),
  ];
  smoothPath(ctx, plate);
  const pg = ctx.createLinearGradient(plate[0].x, plate[0].y, plate[6].x, plate[6].y);
  pg.addColorStop(0, '#ffe7a0'); pg.addColorStop(0.35, '#e8b445'); pg.addColorStop(0.75, '#b07a17'); pg.addColorStop(1, '#6b4708');
  ctx.fillStyle = pg;
  ctx.fill();
  ctx.lineWidth = Wf * 0.014; ctx.strokeStyle = '#3a2205'; ctx.stroke();
  // Panel lines
  ctx.lineWidth = Wf * 0.008; ctx.strokeStyle = 'rgba(40,20,0,0.75)'; ctx.lineCap = 'round';
  const lines = [
    [lerp(P[10], P[168], 0.42), P[168], lerp(P[168], P[1], 0.85)],
    [P[129], lerp(P[129], P[234], 0.55)], [P[358], lerp(P[358], P[454], 0.55)],
    [lerp(P[61], P[172], 0.3), P[61], P[291], lerp(P[291], P[397], 0.3)],
    [add(f.forehead, up, Wf * 0.28), lerp(P[10], P[168], 0.42)],
  ];
  for (const ln of lines) { path(ctx, ln, false); ctx.stroke(); }
  // Eye slits: dark socket + glowing slit
  for (const [e, inner, outer] of [[f.eyeA, 133, 33], [f.eyeB, 362, 263]]) {
    const I = P[inner], O = P[outer], u = unit(O.x - I.x, O.y - I.y), w = e.w;
    const slit = [
      add(add(I, u, -w * 0.08), up, w * 0.04), add(add(O, u, w * 0.25), up, w * 0.3),
      add(add(O, u, w * 0.3), up, w * 0.1), add(add(I, u, -w * 0.02), up, -w * 0.12),
    ];
    path(ctx, scaled(slit, e.c, 1.2)); ctx.fillStyle = '#120603'; ctx.fill();
    const on = 1 - clamp((e.blink - 0.4) / 0.3, 0, 0.85);
    path(ctx, slit); ctx.fillStyle = `rgba(215,250,255,${0.35 + 0.65 * on})`; ctx.fill();
    glow(ctx, e.c.x, e.c.y, w * 1.6, C, 0.8 * on);
  }
  ctx.restore();
  glow(ctx, hl.x, hl.y, Wf * 0.35, '#ffffff', 0.12, true);
}

// =========================================================================
// 1. Iron Armor – repulsors, arc HUD, glowing eyes
// =========================================================================
function iron() {
  const charge = {}, rings = [];
  const C = '#4fd2ff';
  return {
    draw(a) {
      const { ctx, t, dt, k } = a;
      if (a.show.hands) for (const h of a.hands) {
        const c = charge[h.id] = clamp((charge[h.id] || 0) + (h.open ? dt * 0.8 : -dt * 2), 0, 1);
        if (!h.open && c < 0.02) continue;
        const r = h.size * (0.3 + c * 0.7);
        glow(ctx, h.palm.x, h.palm.y, r * 2.6, C, 0.45 + 0.55 * c);
        glow(ctx, h.palm.x, h.palm.y, r * 0.9, '#e8fbff', 0.9);
        for (let i = 0; i < 3; i++) {
          const s = t * 2.5 + i * 2.094;
          const R = h.size * 0.75;
          glowLine(ctx, [0, 0.2, 0.4, 0.6, 0.8, 1].map((q) => ({ x: h.palm.x + Math.cos(s + q) * R, y: h.palm.y + Math.sin(s + q) * R })), C, h.size * 0.03, 0.8);
        }
        if (chance(0.9 * k)) {
          const ang = rnd(0, TAU), R = r * 3;
          a.P.emit({ x: h.palm.x + Math.cos(ang) * R, y: h.palm.y + Math.sin(ang) * R, vx: -Math.cos(ang) * R * 3, vy: -Math.sin(ang) * R * 3, life: 0.3, size: h.size * 0.08, color: C, drag: 0 });
        }
        if (c >= 1) { // Repulsor blast
          charge[h.id] = 0.2;
          rings.push({ x: h.palm.x, y: h.palm.y, r0: h.size * 0.4, r1: Math.max(a.W, a.H) * 0.7, w: h.size * 0.25, life: 0.7, age: 0, color: C });
          burst(a, h.palm.x, h.palm.y, 50, C, h.size * 12);
          a.fx.flash(C, 0.22); a.fx.shake(h.size * 0.12);
        }
      }
      ringsUpdate(a, rings);

      const f = a.face;
      if (!f) return;
      if (a.show.face) ironHelmet(a, f, C);
      if (a.show.face && !a.show.eyes) {
        const R = f.faceW * 0.95;
        for (let i = 0; i < 4; i++) {
          const s = -t * 0.8 + i * (TAU / 4);
          glowLine(ctx, Array.from({ length: 8 }, (_, q) => ({ x: f.center.x + Math.cos(s + q * 0.12) * R, y: f.center.y + Math.sin(s + q * 0.12) * R * 1.15 })), C, f.faceW * 0.008, 0.7);
        }
        for (let i = 0; i < 36; i++) {
          const s = t * 0.4 + (i / 36) * TAU, R2 = R * 1.08;
          const L = i % 3 === 0 ? 0.06 : 0.03;
          glowLine(ctx, [{ x: f.center.x + Math.cos(s) * R2, y: f.center.y + Math.sin(s) * R2 * 1.15 },
            { x: f.center.x + Math.cos(s) * R2 * (1 + L), y: f.center.y + Math.sin(s) * R2 * (1 + L) * 1.15 }], C, f.faceW * 0.004, 0.5);
        }
      }
      if (a.show.eyes) {
        if (!a.show.face) eyeGlow(a, C, 1.1);
        // Gaze-driven targeting reticle
        const tgt = add(f.center, f.dir, f.faceW * 2.2);
        const rr = f.faceW * 0.18;
        glowCircle(ctx, tgt.x, tgt.y, rr, '#ff4040', f.faceW * 0.006, 0.9);
        glowLine(ctx, [{ x: tgt.x - rr * 1.5, y: tgt.y }, { x: tgt.x - rr * 0.5, y: tgt.y }], '#ff4040', f.faceW * 0.006);
        glowLine(ctx, [{ x: tgt.x + rr * 0.5, y: tgt.y }, { x: tgt.x + rr * 1.5, y: tgt.y }], '#ff4040', f.faceW * 0.006);
        glowLine(ctx, [{ x: tgt.x, y: tgt.y - rr * 1.5 }, { x: tgt.x, y: tgt.y - rr * 0.5 }], '#ff4040', f.faceW * 0.006);
        glowLine(ctx, [{ x: tgt.x, y: tgt.y + rr * 0.5 }, { x: tgt.x, y: tgt.y + rr * 1.5 }], '#ff4040', f.faceW * 0.006);
      }
    },
  };
}

// =========================================================================
// 2. Web Slinger – mask with web pattern, lens eyes, "thwip" web shooters
// =========================================================================
function spider() {
  const webs = [];
  const last = {};
  return {
    draw(a) {
      const { ctx, t, W, H } = a;
      const f = a.face;
      if (f && a.show.face) {
        ctx.save();
        smoothPath(ctx, f.oval);
        const hl = lerp(f.center, f.nose, 0.6);
        const gr = ctx.createRadialGradient(hl.x, hl.y, f.faceW * 0.05, f.center.x, f.center.y, f.faceW * 0.75);
        gr.addColorStop(0, 'rgba(240,40,44,0.97)');
        gr.addColorStop(0.55, 'rgba(190,16,26,0.97)');
        gr.addColorStop(1, 'rgba(70,2,8,0.98)');
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.clip();
        ctx.strokeStyle = 'rgba(10,0,0,0.85)';
        ctx.lineWidth = Math.max(1.5, f.faceW * 0.006);
        const c = f.P[6];
        ctx.beginPath();
        for (const p of f.oval) { ctx.moveTo(c.x, c.y); ctx.lineTo(p.x, p.y); }
        ctx.stroke();
        for (const s of [0.18, 0.36, 0.55, 0.74, 0.92]) {
          ctx.beginPath();
          for (let i = 0; i <= f.oval.length; i++) {
            const p = lerp(c, f.oval[i % f.oval.length], s);
            if (i === 0) { ctx.moveTo(p.x, p.y); continue; }
            const q = lerp(c, f.oval[(i - 1) % f.oval.length], s);
            const m = lerp(c, lerp(p, q, 0.5), 0.88);
            ctx.quadraticCurveTo(m.x, m.y, p.x, p.y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      if (f && (a.show.eyes || a.show.face)) {
        // Classic large angled lenses, anchored to real eye corners
        for (const [e, inner, outer] of [[f.eyeA, 133, 33], [f.eyeB, 362, 263]]) {
          const I = f.P[inner], O = f.P[outer], u = unit(O.x - I.x, O.y - I.y), up = f.up, w = e.w;
          const sq = 1 - 0.65 * e.blink;
          const pts = [
            add(add(I, u, -w * 0.12), up, w * 0.05),
            add(add(e.c, up, w * 0.75 * sq), u, -w * 0.05),
            add(add(O, u, w * 0.55), up, w * 0.7 * sq),
            add(add(O, u, w * 0.5), up, -w * 0.1 * sq),
            add(add(e.c, up, -w * 0.4 * sq), u, w * 0.1),
          ];
          smoothPath(ctx, pts);
          ctx.lineWidth = f.faceW * 0.035;
          ctx.strokeStyle = '#0a0a0e';
          ctx.stroke();
          const lg = ctx.createLinearGradient(pts[1].x, pts[1].y, pts[4].x, pts[4].y);
          lg.addColorStop(0, '#ffffff'); lg.addColorStop(1, '#c9d3df');
          ctx.fillStyle = lg;
          ctx.fill();
        }
        glow(ctx, f.forehead.x, f.forehead.y + f.faceW * 0.15, f.faceW * 0.3, '#ffffff', 0.08, true);
      }
      if (a.show.hands) for (const h of a.hands) {
        if (h.thwip && (h.events.thwipStart || t - (last[h.id] || 0) > 0.45)) {
          last[h.id] = t;
          webs.push({ x0: h.palm.x, y0: h.palm.y, end: toEdge(h.palm, h.dir, W, H), born: t, seed: Math.random() * 10, s: h.size });
          burst(a, h.palm.x, h.palm.y, 14, '#ffffff', h.size * 6);
        }
      }
      for (let i = webs.length - 1; i >= 0; i--) {
        const w = webs[i];
        const age = t - w.born;
        if (age > 3) { webs.splice(i, 1); continue; }
        const p = clamp(age / 0.14, 0, 1);
        const alpha = 1 - clamp((age - 2.2) / 0.8, 0, 1);
        const s = { x: w.x0, y: w.y0 };
        const e = lerp(s, w.end, p);
        const d = unit(e.x - s.x, e.y - s.y), n = { x: -d.y, y: d.x };
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';
        for (let j = -1; j <= 1; j++) {
          ctx.strokeStyle = j ? 'rgba(220,225,235,0.8)' : '#ffffff';
          ctx.lineWidth = Math.max(1, w.s * (j ? 0.012 : 0.022));
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          const m = add(lerp(s, e, 0.5), n, j * w.s * 0.05 + Math.sin(w.seed + j) * w.s * 0.03);
          ctx.quadraticCurveTo(m.x, m.y, e.x, e.y);
          ctx.stroke();
        }
        if (p >= 1) { // splat
          const R = w.s * 1.3;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(1, w.s * 0.015);
          ctx.beginPath();
          const spokes = 10;
          const pts = [];
          for (let q = 0; q < spokes; q++) {
            const ang = (q / spokes) * TAU + w.seed;
            const rr = R * (0.75 + 0.25 * Math.sin(q * 3 + w.seed));
            pts.push({ ang, rr });
            ctx.moveTo(e.x, e.y);
            ctx.lineTo(e.x + Math.cos(ang) * rr, e.y + Math.sin(ang) * rr);
          }
          for (const f2 of [0.35, 0.65, 0.95]) {
            pts.forEach((q, qi) => {
              const x = e.x + Math.cos(q.ang) * q.rr * f2, y = e.y + Math.sin(q.ang) * q.rr * f2;
              if (qi === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.lineTo(e.x + Math.cos(pts[0].ang) * pts[0].rr * f2, e.y + Math.sin(pts[0].ang) * pts[0].rr * f2);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    },
  };
}

// =========================================================================
// 3. Mystic Arts – rotating mandala shields, draw-a-circle sling portals
// =========================================================================
// Procedural "arcane" glyphs (3-4 strokes each) – generated once.
const GLYPHS = Array.from({ length: 24 }, (_, gi) => {
  let x = gi * 7919 + 13;
  const r = () => { x = (x * 16807) % 2147483647; return (x % 1000) / 1000; };
  return Array.from({ length: 3 + (gi % 2) }, () => [[r() - 0.5, r() - 0.5], [r() - 0.5, r() - 0.5]]);
});
function runeRing(a, x, y, R, rot, size, color, alpha) {
  const segs = [];
  const n = GLYPHS.length;
  for (let i = 0; i < n; i++) {
    const ang = rot + (i / n) * TAU;
    const cx = x + Math.cos(ang) * R, cy = y + Math.sin(ang) * R;
    const ca = Math.cos(ang + Math.PI / 2), sa = Math.sin(ang + Math.PI / 2);
    for (const [[x1, y1], [x2, y2]] of GLYPHS[i]) {
      segs.push([{ x: cx + (x1 * ca - y1 * sa) * size, y: cy + (x1 * sa + y1 * ca) * size },
        { x: cx + (x2 * ca - y2 * sa) * size, y: cy + (x2 * sa + y2 * ca) * size }]);
    }
  }
  glowSegs(a.ctx, segs, color, size * 0.08, alpha);
}

function mystic() {
  const C = '#ff9a1f';
  const trails = {}, portals = [];
  function mandala(a, x, y, R, rot, alpha = 1) {
    const ctx = a.ctx, w = R * 0.025;
    glowCircle(ctx, x, y, R, C, w, alpha);
    glowCircle(ctx, x, y, R * 0.86, C, w * 0.7, alpha);
    glowCircle(ctx, x, y, R * 0.5, C, w * 0.7, alpha);
    for (const off of [0, Math.PI / 4]) {
      const sq = [0, 1, 2, 3].map((i) => ({ x: x + Math.cos(rot + off + i * Math.PI / 2) * R * 0.86, y: y + Math.sin(rot + off + i * Math.PI / 2) * R * 0.86 }));
      glowLine(ctx, sq, C, w * 0.7, alpha, true);
    }
    const tri = [0, 1, 2].map((i) => ({ x: x + Math.cos(-rot * 1.7 + i * TAU / 3) * R * 0.5, y: y + Math.sin(-rot * 1.7 + i * TAU / 3) * R * 0.5 }));
    glowLine(ctx, tri, C, w * 0.6, alpha, true);
    runeRing(a, x, y, R * 0.93, -rot * 0.6, R * 0.09, C, alpha);
    runeRing(a, x, y, R * 0.68, rot * 0.9, R * 0.07, C, alpha * 0.8);
    glowCircle(ctx, x, y, R * 1.12, C, w * 0.4, alpha * 0.5);
    glow(ctx, x, y, R * 0.9, C, 0.25 * alpha, true);
  }
  return {
    draw(a) {
      const { ctx, t, k } = a;
      if (a.show.hands) for (const h of a.hands) {
        if (h.open) {
          const R = h.size * 1.5;
          mandala(a, h.palm.x, h.palm.y, R, t * 1.4);
          for (let i = 0; i < 3 * k; i++) {
            const s = rnd(0, TAU);
            a.P.emit({ x: h.palm.x + Math.cos(s) * R, y: h.palm.y + Math.sin(s) * R, vx: -Math.sin(s) * R * 2.5, vy: Math.cos(s) * R * 2.5, gravity: R * 4, life: rnd(0.3, 0.7), size: h.size * 0.06, color: pick([C, '#ffd27a']), kind: 'spark', drag: 2 });
          }
        }
        const tr = trails[h.id] || (trails[h.id] = []);
        if (h.pinch) {
          const p = h.P[8];
          tr.push({ x: p.x, y: p.y });
          if (tr.length > 240) tr.shift();
          for (let i = 0; i < 4 * k; i++) a.P.emit({ x: p.x, y: p.y, vx: rnd(-1, 1) * h.size * 3, vy: rnd(-1, 1) * h.size * 3, gravity: h.size * 6, life: rnd(0.2, 0.6), size: h.size * 0.05, color: pick([C, '#ffd27a', '#ffffff']), kind: 'spark' });
          if (tr.length > 1) glowLine(ctx, tr, C, h.size * 0.05, 0.9);
        } else if (h.events.pinchEnd || (!h.pinch && tr.length)) {
          if (tr.length > 12) {
            let cx = 0, cy = 0;
            for (const p of tr) { cx += p.x; cy += p.y; }
            cx /= tr.length; cy /= tr.length;
            let span = 0, rSum = 0;
            for (let i = 1; i < tr.length; i++) {
              let da = Math.atan2(tr[i].y - cy, tr[i].x - cx) - Math.atan2(tr[i - 1].y - cy, tr[i - 1].x - cx);
              if (da > Math.PI) da -= TAU;
              if (da < -Math.PI) da += TAU;
              span += da;
              rSum += Math.hypot(tr[i].x - cx, tr[i].y - cy);
            }
            const r = rSum / (tr.length - 1);
            if (Math.abs(span) > 4.2 && r > h.size * 0.6) {
              portals.push({ x: cx, y: cy, r: Math.max(r, h.size * 1.2), born: t, spin: Math.sign(span) });
              if (portals.length > 3) portals.shift();
              a.fx.flash(C, 0.15);
            }
          }
          tr.length = 0;
        }
      }
      for (let i = portals.length - 1; i >= 0; i--) {
        const p = portals[i];
        const age = t - p.born;
        if (age > 8) { portals.splice(i, 1); continue; }
        const g = Math.min(1, age / 0.6) * (1 - clamp((age - 7.3) / 0.7, 0, 1));
        const R = p.r * g;
        if (R < 2) continue;
        // "Other dimension" inside the portal: zoomed, rotated, tinted camera feed.
        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, 0, TAU);
        ctx.clip();
        ctx.translate(p.x, p.y);
        ctx.rotate(t * 0.3 * p.spin);
        const z = 1.8;
        ctx.drawImage(a.fx.video, -a.W * z / 2, -a.H * z / 2, a.W * z, a.H * z);
        ctx.fillStyle = 'rgba(60,20,90,0.35)';
        ctx.fillRect(-R, -R, R * 2, R * 2);
        ctx.restore();
        glowCircle(ctx, p.x, p.y, R, C, p.r * 0.06, 1);
        const n = Math.round(30 * k);
        for (let j = 0; j < n; j++) {
          const s = rnd(0, TAU);
          const sp = p.r * rnd(2, 4) * p.spin;
          a.P.emit({ x: p.x + Math.cos(s) * R, y: p.y + Math.sin(s) * R, vx: -Math.sin(s) * sp, vy: Math.cos(s) * sp, gravity: p.r * 3, life: rnd(0.25, 0.6), size: p.r * 0.03, color: pick([C, '#ffcc55', '#ffffff', '#ff7700']), kind: 'spark', drag: 1 });
        }
      }
      const f = a.face;
      if (f && a.show.eyes) eyeGlow(a, '#3dff8a', 0.6, 0.6);
      if (f && a.show.face) {
        const amulet = add(f.chin, f.up, -f.faceW * 0.35);
        mandala(a, amulet.x, amulet.y, f.faceW * 0.16, -t);
        glow(ctx, amulet.x, amulet.y, f.faceW * 0.12, '#3dff8a', 0.8);
      }
    },
  };
}

// =========================================================================
// 4. Thunder God – finger arcs, sky strikes on fist, storm eyes
// =========================================================================
function thunder() {
  const C = '#8fd0ff';
  let strikeT = 0;
  return {
    draw(a) {
      const { ctx, t, W, k } = a;
      const hands = a.show.hands ? a.hands : [];
      for (const h of hands) {
        if (h.open) {
          glow(ctx, h.palm.x, h.palm.y, h.size * 1.2, C, 0.45);
          for (const tip of [8, 12, 16, 20]) {
            if (!chance(0.55 * k)) continue;
            drawLightning(ctx, forkedBolt(h.P[4], h.P[tip], h.size * 0.35, 1, 4), C, h.size * 0.022);
          }
          if (chance(0.25 * k)) {
            const tip = h.P[pick([8, 12, 16, 20])];
            glowLine(ctx, bolt(tip, add(tip, { x: rnd(-1, 1), y: rnd(-1, 0.2) }, h.size * 1.2), h.size * 0.4, 4), C, h.size * 0.016);
          }
        }
        // crackling electric aura over the whole hand
        for (let i = 0; i < 5 * k; i++) {
          const [p, q] = pick(HAND_CONN);
          glowLine(ctx, bolt(h.P[p], h.P[q], h.size * 0.15, 3), C, h.size * 0.012, 0.7);
        }
        if (h.fist) {
          glow(ctx, h.palm.x, h.palm.y, h.size * 1.6, C, 0.6 + 0.3 * Math.sin(t * 30));
          if (chance(0.22 * k)) {
            const top = { x: h.palm.x + rnd(-W * 0.2, W * 0.2), y: -20 };
            drawLightning(ctx, forkedBolt(top, h.palm, h.size * 1.4, 3, 6), C, h.size * 0.05);
            a.fx.flash('#cfe9ff', 0.08);
          }
        }
        if (h.events.fistStart && t - strikeT > 0.4) {
          strikeT = t;
          for (let i = 0; i < 3; i++) drawLightning(ctx, forkedBolt({ x: h.palm.x + rnd(-80, 80), y: -20 }, h.palm, h.size * 2, 4, 7), C, h.size * 0.09);
          burst(a, h.palm.x, h.palm.y, 60, C, h.size * 14);
          a.fx.flash('#e6f4ff', 0.55); a.fx.shake(h.size * 0.35);
        }
      }
      if (hands.length === 2 && (hands[0].open || hands[0].fist) && (hands[1].open || hands[1].fist)) {
        const d = dist(hands[0].palm, hands[1].palm);
        if (d < W * 0.75) {
          for (let i = 0; i < 2; i++) drawLightning(ctx, forkedBolt(hands[0].palm, hands[1].palm, d * 0.25, 2, 6), C, hands[0].size * 0.05);
        }
      }
      const f = a.face;
      if (!f) return;
      if (a.show.eyes) {
        eyeGlow(a, '#bfe6ff', 1.0, 0.65);
        for (const e of eyes(f)) {
          if (e.blink > 0.5 || !chance(0.5 * k)) continue;
          const ang = rnd(0, TAU);
          glowLine(ctx, bolt(e.iris, { x: e.iris.x + Math.cos(ang) * e.w * 1.6, y: e.iris.y + Math.sin(ang) * e.w * 1.6 }, e.w * 0.5, 3), C, e.w * 0.06);
        }
      }
      if (a.show.face && f.jaw > 0.45) {
        for (let i = 0; i < 2 * k; i++) {
          const ang = Math.atan2(f.up.y, f.up.x) + Math.PI + rnd(-1.2, 1.2);
          const end = toEdge(f.mouth, { x: Math.cos(ang), y: Math.sin(ang) }, a.W, a.H);
          glowLine(ctx, bolt(f.mouth, end, dist(f.mouth, end) * 0.25, 6), C, f.faceW * 0.02 * f.jaw);
        }
        glow(ctx, f.mouth.x, f.mouth.y, f.faceW * 0.4 * f.jaw, C, 0.9);
        a.fx.shake(f.faceW * 0.015 * f.jaw);
      }
    },
  };
}

// =========================================================================
// 5. Infinity Gauntlet – golden glove with six stones, SNAP = dust
// =========================================================================
function gauntlet() {
  const STONES = [['#ffd400', null], ['#2f7bff', 5], ['#ff2a2a', 9], ['#a23cff', 13], ['#ff8a00', 17], ['#22ff7a', 2]];
  return {
    draw(a) {
      const { ctx, t, k, W, H } = a;
      if (a.show.hands) for (const h of a.hands) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const [i, j] of HAND_CONN) { ctx.moveTo(h.P[i].x, h.P[i].y); ctx.lineTo(h.P[j].x, h.P[j].y); }
        const gg = ctx.createLinearGradient(h.P[0].x, h.P[0].y, h.P[12].x, h.P[12].y);
        gg.addColorStop(0, '#a87410'); gg.addColorStop(0.5, '#f2c94c'); gg.addColorStop(1, '#c08a14');
        // layered strokes = cylindrical metal: dark rim, gold body, bright specular ridge
        for (const [col, wd] of [['#3d2604', 0.26], ['#7a5208', 0.22], [gg, 0.17], ['#ffe9a3', 0.07]]) {
          ctx.strokeStyle = col; ctx.lineWidth = h.size * wd; ctx.stroke();
        }
        ctx.save();
        ctx.translate(-h.size * 0.025, -h.size * 0.025);
        ctx.strokeStyle = 'rgba(255,255,240,0.85)'; ctx.lineWidth = h.size * 0.025; ctx.stroke();
        ctx.restore();
        const plate = [h.P[0], h.P[1], h.P[5], h.P[9], h.P[13], h.P[17]];
        path(ctx, plate);
        ctx.fillStyle = gg;
        ctx.fill();
        ctx.strokeStyle = '#7a5410';
        ctx.lineWidth = h.size * 0.03;
        ctx.stroke();
        ctx.restore();
        for (const [col, idx] of STONES) {
          const p = idx === null ? h.palm : h.P[idx];
          const r = h.size * (idx === null ? 0.16 : 0.1);
          ctx.fillStyle = '#2a1a00';
          ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.25, 0, TAU); ctx.fill();
          const sg = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.35, r * 0.05, p.x, p.y, r);
          sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.25, col); sg.addColorStop(1, hexA(col, 0.6));
          ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
          ctx.fillStyle = sg;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
          glow(ctx, p.x, p.y, r * (2.6 + 0.4 * Math.sin(t * 4 + r)), col, 0.85);
        }
        if (h.midPinch) glow(ctx, h.P[4].x, h.P[4].y, h.size * 0.6, '#ffe27a', 0.8);
        if (h.events.snap) {
          a.fx.flash('#ffffff', 0.7); a.fx.shake(h.size * 0.25);
          burst(a, h.P[4].x, h.P[4].y, 80, '#ffe27a', h.size * 15);
          const img = a.fx.sampleFrame();
          const f = a.face;
          const n = Math.round(1400 * k);
          for (let i = 0; i < n; i++) {
            let x, y;
            if (f && i < n * 0.7) {
              x = f.center.x + rnd(-0.6, 0.6) * f.faceW; y = f.center.y + rnd(-0.8, 0.8) * f.faceW;
            } else { x = rnd(0, W); y = rnd(0, H); }
            const sx = clamp((x / W) * img.width | 0, 0, img.width - 1), sy = clamp((y / H) * img.height | 0, 0, img.height - 1);
            const o = (sy * img.width + sx) * 4;
            const d = img.data;
            const col = `rgb(${d[o]},${d[o + 1]},${d[o + 2]})`;
            a.P.emit({ x, y, vx: rnd(0.05, 0.4) * W, vy: -rnd(0.02, 0.25) * H, swirl: W * 0.4, drag: 0.8, life: rnd(1.4, 3), size: Math.max(2, W / 260) * rnd(0.6, 1.6), color: col, kind: 'dust' });
          }
        }
      }
      const f = a.face;
      if (f && a.show.eyes) eyeGlow(a, '#c070ff', 0.8, 0.8);
      if (f && a.show.face) {
        ctx.save();
        smoothPath(ctx, f.oval);
        ctx.clip();
        ctx.globalCompositeOperation = 'color';
        ctx.fillStyle = '#7d4bb3';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(f.center.x - f.faceW, f.center.y - f.faceW * 1.2, f.faceW * 2, f.faceW * 2.4);
        ctx.restore();
        // chin ridges
        for (const s of [-0.12, 0, 0.12]) {
          const b = lerp(f.P[17], f.chin, 0.5);
          const p0 = { x: b.x + s * f.faceW, y: b.y };
          glowLine(ctx, [p0, add(p0, f.up, -f.faceW * 0.08)], '#3a1f55', f.faceW * 0.01, 0.6);
        }
      }
    },
  };
}

// =========================================================================
// 6. Optic Blast – ruby visor; open mouth = eye beams steered by head + gaze
// =========================================================================
function optic() {
  const C = '#ff2244';
  let power = 0;
  return {
    draw(a) {
      const { ctx, t, dt, k, W, H } = a;
      const f = a.face;
      if (!f) { power = 0; return; }
      const want = clamp((Math.max(f.jaw, f.browUp * 0.9) - 0.3) / 0.35, 0, 1);
      power += (want - power) * Math.min(1, dt * 10);
      if (a.show.face || a.show.eyes) {
        const A = f.eyeA.c, B = f.eyeB.c;
        const L = add(A, { x: A.x - B.x, y: A.y - B.y }, 0.85), R = add(B, { x: B.x - A.x, y: B.y - A.y }, 0.85);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#2a0a10';
        ctx.lineWidth = f.eyeA.w * 1.25;
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(R.x, R.y); ctx.stroke();
        ctx.strokeStyle = '#8a0f22';
        ctx.lineWidth = f.eyeA.w * 0.75;
        ctx.stroke();
        ctx.restore();
        glowLine(ctx, [lerp(L, A, 0.3), A, B, lerp(R, B, 0.3)], C, f.eyeA.w * (0.22 + 0.3 * power), 0.8 + 0.2 * power);
      }
      if (!a.show.eyes || power < 0.02) return;
      const d = f.dir;
      const mag = Math.hypot(d.x, d.y);
      const u = unit(d.x, d.y);
      for (const e of eyes(f)) {
        const w = e.w * 0.45 * power * (1 + 0.12 * Math.sin(t * 50));
        glow(ctx, e.c.x, e.c.y, e.w * (1.5 + 3 * power * (1 - clamp(mag, 0, 1) * 0.6)), C, power);
        if (mag > 0.12) {
          const end = toEdge(e.c, u, W, H);
          glowLine(ctx, [e.c, end], C, w, power);
          if (chance(0.8 * k)) burst(a, end.x, end.y, 4, pick([C, '#ffaa66']), f.faceW * 3);
          for (let i = 0; i < 2 * k; i++) {
            const p = lerp(e.c, end, Math.random());
            a.P.emit({ x: p.x, y: p.y, vx: rnd(-1, 1) * w * 6, vy: rnd(-1, 1) * w * 6, life: 0.3, size: w * 0.6, color: C });
          }
        }
      }
      if (power > 0.5) { a.fx.shake(f.faceW * 0.012 * power); a.fx.flash(C, 0.05 * power); }
    },
  };
}

// =========================================================================
// 7. Gamma Rage – green skin, angry brows, roar shockwaves, fist smash
// =========================================================================
function gamma() {
  const C = '#5cff3a';
  const rings = [];
  let rage = 0, lastRing = 0;
  return {
    draw(a) {
      const { ctx, t, dt, k, W, H } = a;
      const f = a.face;
      if (f && a.show.face) {
        ctx.save();
        smoothPath(ctx, scaled(f.oval, f.center, 1.04));
        ctx.clip();
        ctx.globalCompositeOperation = 'color';
        ctx.fillStyle = '#3aa832';
        ctx.fillRect(f.center.x - f.faceW, f.center.y - f.faceW * 1.3, f.faceW * 2, f.faceW * 2.6);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = 'rgba(120,200,90,0.35)';
        ctx.fillRect(f.center.x - f.faceW, f.center.y - f.faceW * 1.3, f.faceW * 2, f.faceW * 2.6);
        ctx.restore();
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(15,45,10,0.9)';
        ctx.lineWidth = f.faceW * 0.05;
        for (const brow of [BROW_A, BROW_B]) {
          const pts = brow.map((i) => f.P[i]);
          path(ctx, [add(pts[0], f.up, f.faceW * 0.02), ...pts.slice(1, 4), add(pts[4], f.up, -f.faceW * 0.035)], false);
          ctx.stroke();
        }
        ctx.restore();
        rage += ((f.jaw > 0.5 ? 1 : 0) - rage) * Math.min(1, dt * 5);
        if (f.jaw > 0.5) {
          if (t - lastRing > 0.22) {
            lastRing = t;
            rings.push({ x: f.mouth.x, y: f.mouth.y, r0: f.faceW * 0.3, r1: Math.max(W, H), w: f.faceW * 0.08, life: 0.8, age: 0, color: C });
          }
          a.fx.shake(f.faceW * 0.03 * f.jaw);
          for (let i = 0; i < 6 * k; i++) {
            const ang = rnd(0, TAU);
            a.P.emit({ x: f.mouth.x, y: f.mouth.y, vx: Math.cos(ang) * f.faceW * 4, vy: Math.sin(ang) * f.faceW * 4, life: 0.6, size: f.faceW * 0.03, color: C, kind: 'spark' });
          }
        }
      }
      if (f && a.show.eyes) eyeGlow(a, C, 0.9, 0.7 + rage * 0.3);
      if (a.show.hands) for (const h of a.hands) {
        glowLine(ctx, [h.P[5], h.P[9], h.P[13], h.P[17]], C, h.size * 0.04, 0.5);
        if (h.fist) glow(ctx, h.palm.x, h.palm.y, h.size * 1.4, C, 0.45);
        if (h.events.fistStart) {
          rings.push({ x: h.palm.x, y: h.palm.y, r0: h.size * 0.5, r1: Math.max(W, H) * 0.8, w: h.size * 0.3, life: 0.7, age: 0, color: C });
          a.fx.shake(h.size * 0.4);
          for (let i = 0; i < 50 * k; i++) {
            a.P.emit({ x: h.palm.x, y: h.palm.y, vx: rnd(-1, 1) * h.size * 10, vy: -rnd(0.3, 1.5) * h.size * 10, gravity: H * 1.6, drag: 0.3, life: rnd(0.8, 1.5), size: h.size * rnd(0.05, 0.14), color: pick(['#6b5a45', '#8a7a66', '#3e3a33', '#556b2f']), kind: 'dust' });
          }
        }
      }
      ringsUpdate(a, rings);
      if (rage > 0.02) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, 'rgba(40,255,40,0)');
        g.addColorStop(1, hexA('#1fbf1f', 0.55 * rage * (0.8 + 0.2 * Math.sin(t * 20))));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    },
  };
}

// =========================================================================
// 8. Panther Kinetic – vibranium claws, purple energy veins, absorb & release
// =========================================================================
function panther() {
  const C = '#b14dff';
  const charge = {}, rings = [];
  return {
    draw(a) {
      const { ctx, t, dt, k, W, H } = a;
      const f = a.face;
      if (f && a.show.face) {
        ctx.save();
        smoothPath(ctx, f.oval);
        ctx.fillStyle = 'rgba(18,18,26,0.86)';
        ctx.fill();
        ctx.restore();
        const P = f.P, w = f.faceW * 0.008;
        const lines = [[10, 151, 9, 8, 168, 6, 197, 195, 5, 4], [109, 67, 103, 54, 21], [338, 297, 332, 284, 251], [234, 93, 132, 58, 172], [454, 323, 361, 288, 397], [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]];
        lines.forEach((ln, i) => glowLine(ctx, ln.map((j) => P[j]), '#c8c8d8', w, 0.35 + 0.25 * Math.sin(t * 3 + i)));
        glowLine(ctx, f.oval, C, w * 1.5, 0.5 + 0.3 * Math.sin(t * 2), true);
      }
      if (f && a.show.eyes) {
        for (const e of eyes(f)) {
          const lens = scaled(e.pts, e.c, 1.7, 1.7 * (1 - 0.8 * e.blink));
          smoothPath(ctx, lens);
          ctx.fillStyle = 'rgba(235,240,255,0.95)';
          ctx.fill();
          glow(ctx, e.c.x, e.c.y, e.w * 1.2, C, 0.6);
        }
      }
      if (a.show.hands) for (const h of a.hands) {
        HAND_CONN.forEach(([i, j], n) => glowLine(ctx, [h.P[i], h.P[j]], C, h.size * 0.03, 0.45 + 0.35 * Math.sin(t * 6 - n * 0.5)));
        for (const [tip, dip] of [[4, 3], [8, 7], [12, 11], [16, 15], [20, 19]]) {
          const u = unit(h.P[tip].x - h.P[dip].x, h.P[tip].y - h.P[dip].y), n = { x: -u.y, y: u.x };
          const b = h.P[tip], L = h.size * (tip === 4 ? 0.35 : 0.5), bw = h.size * 0.045;
          const e = add(b, u, L);
          ctx.beginPath();
          ctx.moveTo(b.x + n.x * bw, b.y + n.y * bw);
          ctx.quadraticCurveTo(b.x + u.x * L * 0.6 + n.x * bw * 1.5, b.y + u.y * L * 0.6 + n.y * bw * 1.5, e.x, e.y);
          ctx.lineTo(b.x - n.x * bw, b.y - n.y * bw);
          ctx.closePath();
          const g = ctx.createLinearGradient(b.x, b.y, e.x, e.y);
          g.addColorStop(0, '#6c6c7a'); g.addColorStop(1, '#f2f2ff');
          ctx.fillStyle = g;
          ctx.fill();
          glowLine(ctx, [b, e], C, bw * 0.4, 0.6);
        }
        let c = charge[h.id] || 0;
        if (h.fist) {
          c = Math.min(1, c + dt * 0.6);
          glow(ctx, h.palm.x, h.palm.y, h.size * (0.6 + c * 1.6), C, 0.5 + 0.5 * c);
          for (let i = 0; i < 3 * k; i++) {
            const ang = rnd(0, TAU), R = h.size * 2.2;
            a.P.emit({ x: h.palm.x + Math.cos(ang) * R, y: h.palm.y + Math.sin(ang) * R, vx: -Math.cos(ang) * R * 2.5, vy: -Math.sin(ang) * R * 2.5, life: 0.4, size: h.size * 0.07, color: C, drag: 0 });
          }
        }
        if (h.events.openStart && c > 0.25) {
          rings.push({ x: h.palm.x, y: h.palm.y, r0: h.size * 0.5, r1: Math.max(W, H) * c, w: h.size * 0.35 * c, life: 0.8, age: 0, color: C });
          burst(a, h.palm.x, h.palm.y, 80 * c, C, h.size * 16);
          a.fx.flash(C, 0.35 * c); a.fx.shake(h.size * 0.4 * c);
          c = 0;
        }
        if (!h.fist && !h.events.openStart) c = Math.max(0, c - dt * 0.3);
        charge[h.id] = c;
      }
      ringsUpdate(a, rings);
    },
  };
}

// =========================================================================
// 9. Chaos Magic – crimson wisps, energy sphere between hands, crown
// =========================================================================
function chaos() {
  const C = '#ff1f4b';
  return {
    draw(a) {
      const { ctx, t, k, W } = a;
      const hands = a.show.hands ? a.hands : [];
      for (const h of hands) {
        for (let i = 1; i < 5; i++) {
          const p = h.tips[i];
          if (chance(0.8 * k)) a.P.emit({ x: p.x, y: p.y, vx: rnd(-1, 1) * h.size * 0.6, vy: -rnd(0.3, 1) * h.size * 1.2, swirl: h.size * 6, life: rnd(0.6, 1.2), size: h.size * rnd(0.15, 0.3), grow: h.size * 0.3, color: pick([C, '#d4002a', '#ff4d6d']), tex: 'puff', drag: 0.8 });
        }
        for (let i = 0; i < 4; i++) {
          const p = h.tips[i], q = h.tips[i + 1];
          const n = unit(-(q.y - p.y), q.x - p.x);
          const pts = [];
          for (let s = 0; s <= 10; s++) {
            const u = s / 10;
            const bend = Math.sin(u * Math.PI) * Math.sin(t * 5 + i * 1.7) * h.size * 0.5;
            const b = lerp(p, q, u);
            pts.push({ x: b.x + n.x * bend + Math.sin(t * 11 + s + i) * h.size * 0.03, y: b.y + n.y * bend });
          }
          glowLine(ctx, pts, C, h.size * 0.025, 0.85);
        }
        glow(ctx, h.palm.x, h.palm.y, h.size * 1.3, C, 0.35, true);
      }
      if (hands.length === 2 && hands[0].open && hands[1].open) {
        const d = dist(hands[0].palm, hands[1].palm);
        if (d < W * 0.6) {
          const m = lerp(hands[0].palm, hands[1].palm, 0.5);
          const R = d * 0.32;
          glow(ctx, m.x, m.y, R * 2.2, C, 0.9);
          glow(ctx, m.x, m.y, R * 0.7, '#ffd0d8', 0.9);
          for (let i = 0; i < 5; i++) {
            const s = t * (2 + i * 0.4) + i;
            glowLine(ctx, Array.from({ length: 14 }, (_, q) => {
              const ang = s + q * 0.32;
              return { x: m.x + Math.cos(ang) * R * (0.6 + 0.2 * Math.sin(i + q)), y: m.y + Math.sin(ang * 1.3) * R * 0.7 };
            }), C, R * 0.04, 0.8);
          }
          for (const h of hands) glowLine(ctx, bolt(h.palm, m, R * 0.6, 4), C, h.size * 0.02, 0.8);
        }
      }
      const f = a.face;
      if (!f) return;
      if (a.show.face) {
        const up = f.up, side = { x: -up.y, y: up.x }, Wf = f.faceW;
        const top = add(f.forehead, up, Wf * 0.02);
        const tL = f.P[103], tR = f.P[332];
        const crown = [
          tL, add(add(tL, up, Wf * 0.18), side, -Wf * 0.02), add(lerp(tL, top, 0.55), up, Wf * 0.32),
          add(top, up, Wf * 0.55), add(lerp(tR, top, 0.55), up, Wf * 0.32), add(add(tR, up, Wf * 0.18), side, Wf * 0.02), tR,
          add(lerp(tR, top, 0.5), up, Wf * 0.12), add(top, up, Wf * 0.14), add(lerp(tL, top, 0.5), up, Wf * 0.12),
        ];
        path(ctx, crown);
        const g = ctx.createLinearGradient(top.x, top.y, top.x + up.x * Wf * 0.5, top.y + up.y * Wf * 0.5);
        g.addColorStop(0, '#5a0012'); g.addColorStop(1, '#b0102e');
        ctx.fillStyle = g;
        ctx.fill();
        glowLine(ctx, crown, C, Wf * 0.008, 0.9, true);
      }
      if (a.show.eyes) {
        eyeGlow(a, C, 1.1);
        for (const e of eyes(f)) {
          if (e.blink < 0.4 && chance(0.6 * k)) a.P.emit({ x: e.iris.x, y: e.iris.y, vx: rnd(-1, 1) * e.w, vy: -e.w * rnd(2, 4), swirl: e.w * 8, life: 0.8, size: e.w * 0.4, grow: e.w * 0.5, color: C, soft: true });
        }
      }
    },
  };
}

// =========================================================================
// 10. Hellfire Rider – flaming skull, fire hands, swinging chain on fist
// =========================================================================
function hellfire() {
  const FIRE = ['#ffd860', '#ffb020', '#ff7a10', '#e84a00', '#a01800', '#3a0800'];
  const chains = {};
  function flame(a, x, y, s, up = 1) {
    a.P.emit({ x, y, vx: rnd(-0.3, 0.3) * s, vy: -rnd(1.4, 3.2) * s * up, swirl: s * 4, drag: 0.5, life: rnd(0.4, 0.85), size: s * rnd(0.45, 0.85), grow: -s * 0.35, colors: FIRE, tex: 'puff' });
  }
  return {
    draw(a) {
      const { ctx, dt, k, H } = a;
      const f = a.face;
      if (f && a.show.face) {
        const P = f.P, Wf = f.faceW;
        ctx.save();
        smoothPath(ctx, scaled(f.oval, f.center, 1.02));
        ctx.fillStyle = 'rgba(8,4,2,0.9)';
        ctx.fill();
        smoothPath(ctx, scaled(f.oval, f.center, 0.94, 0.97));
        const g = ctx.createRadialGradient(f.center.x, f.center.y - Wf * 0.2, Wf * 0.1, f.center.x, f.center.y, Wf * 0.7);
        g.addColorStop(0, '#efe6d2'); g.addColorStop(0.7, '#b9ab92'); g.addColorStop(1, '#4b3f30');
        ctx.fillStyle = g;
        ctx.fill();
        // cheek hollows
        for (const s of [-1, 1]) {
          const c = { x: f.center.x + s * Wf * 0.3, y: P[1].y + Wf * 0.02 };
          const cg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Wf * 0.2);
          cg.addColorStop(0, 'rgba(40,25,10,0.6)'); cg.addColorStop(1, 'rgba(40,25,10,0)');
          ctx.fillStyle = cg;
          ctx.fillRect(c.x - Wf * 0.2, c.y - Wf * 0.2, Wf * 0.4, Wf * 0.4);
        }
        // eye sockets
        for (const e of eyes(f)) {
          smoothPath(ctx, scaled(e.pts, e.c, 2.4, 3.6));
          ctx.fillStyle = '#050201';
          ctx.fill();
        }
        // nose cavity
        path(ctx, [P[168], P[98], P[2], P[327]].map((p, i) => (i === 0 ? lerp(p, P[1], 0.55) : p)));
        ctx.fillStyle = '#0a0502';
        ctx.fill();
        // mouth + teeth
        path(ctx, f.lips);
        ctx.fillStyle = '#0a0502';
        ctx.fill();
        const L = P[61], R = P[291];
        const tw = dist(L, R) / 8;
        for (const [row, dirn] of [[P[13], 1], [P[14], -1]]) {
          for (let i = 0; i < 8; i++) {
            const base = lerp(L, R, (i + 0.5) / 8);
            const by = row.y + (base.y - (L.y + R.y) / 2) * 0.5;
            ctx.fillStyle = '#efe7cf';
            ctx.strokeStyle = '#3a2a18';
            ctx.lineWidth = Math.max(1, Wf * 0.004);
            ctx.beginPath();
            ctx.rect(base.x - tw * 0.45, by - (dirn > 0 ? Wf * 0.07 : 0), tw * 0.9, Wf * 0.07);
            ctx.fill(); ctx.stroke();
          }
        }
        ctx.restore();
        // flames from top of head
        const topPts = f.oval.filter((p) => p.y < P[168].y + (P[1].y - P[168].y) * 0.3);
        for (let i = 0; i < 16 * k; i++) {
          const p = pick(topPts);
          const o = lerp(f.center, p, rnd(0.85, 1.05));
          flame(a, o.x, o.y, Wf * 0.18);
        }
      }
      if (f && (a.show.eyes || a.show.face)) {
        for (const e of eyes(f)) {
          glow(a.ctx, e.c.x, e.c.y, e.w * 1.4, '#ff6a00', 0.9);
          glow(a.ctx, e.c.x, e.c.y, e.w * 0.5, '#ffe080', 0.9);
          if (chance(0.7 * k)) flame(a, e.c.x, e.c.y, e.w * 0.6);
        }
      }
      if (a.show.hands) for (const h of a.hands) {
        for (let i = 0; i < 6 * k; i++) {
          const p = h.P[(Math.random() * 21) | 0];
          flame(a, p.x, p.y, h.size * 0.25);
        }
        glow(ctx, h.palm.x, h.palm.y, h.size * 1.3, '#ff5a00', 0.4, true);
        let ch = chains[h.id];
        if (h.fist) {
          const N = 18, seg = h.size * 0.32;
          if (!ch) {
            ch = chains[h.id] = Array.from({ length: N }, (_, i) => ({ x: h.palm.x, y: h.palm.y + i * seg, px: h.palm.x, py: h.palm.y + i * seg }));
          }
          ch[0].x = ch[0].px = h.palm.x; ch[0].y = ch[0].py = h.palm.y;
          const g = H * 2.2 * dt * dt;
          for (let i = 1; i < N; i++) {
            const p = ch[i];
            const vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985;
            p.px = p.x; p.py = p.y;
            p.x += vx; p.y += vy + g;
          }
          for (let it = 0; it < 6; it++) {
            for (let i = 1; i < N; i++) {
              const p = ch[i - 1], q = ch[i];
              const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
              const diff = (d - seg) / d;
              if (i === 1) { q.x -= dx * diff; q.y -= dy * diff; } else {
                p.x += dx * diff * 0.5; p.y += dy * diff * 0.5; q.x -= dx * diff * 0.5; q.y -= dy * diff * 0.5;
              }
            }
            ch[0].x = h.palm.x; ch[0].y = h.palm.y;
          }
          glowLine(ctx, ch, '#ff7a1a', h.size * 0.07);
          ch.forEach((p, i) => {
            if (i % 2) return;
            ctx.strokeStyle = '#2a1a10';
            ctx.lineWidth = h.size * 0.04;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, seg * 0.45, seg * 0.25, Math.atan2(ch[Math.min(i + 1, N - 1)].y - p.y, ch[Math.min(i + 1, N - 1)].x - p.x), 0, TAU); ctx.stroke();
            if (chance(0.25 * k)) flame(a, p.x, p.y, h.size * 0.2);
          });
        } else delete chains[h.id];
      }
    },
  };
}

// =========================================================================
// 11. Star Shield – round star shield on open palm, point to THROW (bounces)
// =========================================================================
function starShield() {
  let thrown = null;
  function shield(ctx, x, y, R, rot, sx) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sx, 1);
    const rings = [[1, '#b5122b'], [0.8, '#eef0f4'], [0.6, '#b5122b'], [0.42, '#1d3c8f']];
    for (const [r, c] of rings) {
      ctx.beginPath(); ctx.arc(0, 0, R * r, 0, TAU);
      ctx.fillStyle = c; ctx.fill();
    }
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? R * 0.16 : R * 0.4;
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#f4f6fa'; ctx.fill();
    const g = ctx.createLinearGradient(-R, -R, R, R);
    g.addColorStop(0, 'rgba(255,255,255,0.45)'); g.addColorStop(0.45, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = R * 0.04; ctx.strokeStyle = '#8a8f99'; ctx.stroke();
    ctx.restore();
  }
  return {
    draw(a) {
      const { ctx, t, dt, k, W, H } = a;
      const hands = a.show.hands ? a.hands : [];
      for (const h of hands) {
        if (thrown) break;
        if (h.open || h.fist) {
          const ratio = dist(h.P[5], h.P[17]) / (h.size * 0.85);
          shield(ctx, h.palm.x, h.palm.y, h.size * 1.6, Math.atan2(h.dir.y, h.dir.x) + Math.PI / 2, clamp(ratio, 0.35, 1));
        }
        if (h.events.pointStart) {
          const d = unit(h.P[8].x - h.P[5].x, h.P[8].y - h.P[5].y);
          const sp = Math.max(W, H) * 1.5;
          thrown = { x: h.palm.x, y: h.palm.y, vx: d.x * sp, vy: d.y * sp, age: 0, spin: 0, R: h.size * 1.4, owner: h.id };
          a.fx.shake(h.size * 0.1);
        }
      }
      if (thrown) {
        const s = thrown;
        s.age += dt; s.spin += dt * 18;
        const owner = hands.find((h) => h.id === s.owner) || hands[0];
        if (s.age > 1.4) {
          const tgt = owner ? owner.palm : { x: W / 2, y: H };
          const d = unit(tgt.x - s.x, tgt.y - s.y);
          const sp = Math.max(W, H) * 1.8;
          s.vx += (d.x * sp - s.vx) * Math.min(1, dt * 6);
          s.vy += (d.y * sp - s.vy) * Math.min(1, dt * 6);
          if (dist(s, tgt) < s.R || s.age > 4) {
            thrown = null;
            if (owner) { burst(a, owner.palm.x, owner.palm.y, 20, '#ffffff', owner.size * 8); a.fx.shake(owner.size * 0.15); }
          }
        }
        if (thrown) {
          s.x += s.vx * dt; s.y += s.vy * dt;
          let hit = false;
          if (s.x < s.R) { s.x = s.R; s.vx = Math.abs(s.vx); hit = true; }
          if (s.x > W - s.R) { s.x = W - s.R; s.vx = -Math.abs(s.vx); hit = true; }
          if (s.y < s.R) { s.y = s.R; s.vy = Math.abs(s.vy); hit = true; }
          if (s.y > H - s.R) { s.y = H - s.R; s.vy = -Math.abs(s.vy); hit = true; }
          if (hit) { burst(a, s.x, s.y, 30, '#ffe9a8', s.R * 6); a.fx.shake(s.R * 0.12); }
          for (let i = 0; i < 3 * k; i++) a.P.emit({ x: s.x + rnd(-s.R, s.R) * 0.5, y: s.y + rnd(-s.R, s.R) * 0.5, life: 0.35, size: s.R * 0.35, color: '#3f7bff', soft: true });
          shield(ctx, s.x, s.y, s.R, s.spin * 0.2, 0.35 + 0.65 * Math.abs(Math.cos(s.spin)));
        }
      }
      const f = a.face;
      if (f && a.show.eyes) {
        for (const e of eyes(f)) {
          if (e.blink > 0.5) continue;
          const g = { x: e.iris.x - e.w * 0.12, y: e.iris.y - e.w * 0.1 };
          glow(ctx, g.x, g.y, e.w * 0.5, '#9cc0ff', 0.8);
          const r = e.w * 0.6;
          glowLine(ctx, [{ x: g.x - r, y: g.y }, { x: g.x + r, y: g.y }], '#cfe0ff', e.w * 0.03, 0.6 + 0.4 * Math.sin(t * 3));
          glowLine(ctx, [{ x: g.x, y: g.y - r }, { x: g.x, y: g.y + r }], '#cfe0ff', e.w * 0.03, 0.6 + 0.4 * Math.sin(t * 3));
        }
      }
      if (f && a.show.face) {
        const p = add(f.forehead, f.up, -f.faceW * 0.05);
        glow(ctx, p.x, p.y, f.faceW * 0.25, '#2f6bff', 0.35, true);
      }
    },
  };
}

// =========================================================================
// 12. Photon Binary – golden cosmic aura, photon beams from open palms
// =========================================================================
function photon() {
  const C = '#ffb43a', C2 = '#ffe8a0';
  const rings = [];
  let lastJaw = 0;
  return {
    draw(a) {
      const { ctx, t, k, W, H } = a;
      const f = a.face;
      if (f && a.show.face) {
        for (let i = 0; i < 6 * k; i++) {
          const p = pick(f.oval);
          const d = unit(p.x - f.center.x, p.y - f.center.y);
          a.P.emit({ x: p.x, y: p.y, vx: d.x * f.faceW * rnd(0.3, 1), vy: d.y * f.faceW * rnd(0.3, 1) - f.faceW * 0.5, life: rnd(0.4, 0.9), size: f.faceW * rnd(0.05, 0.12), color: pick([C, C2, '#ff7a1a']), drag: 1, tex: chance(0.5) ? 'puff' : 'glow' });
        }
        glowLine(ctx, scaled(f.oval, f.center, 1.06), C, f.faceW * 0.012, 0.5 + 0.2 * Math.sin(t * 6), true);
        if (f.jaw > 0.55 && t - lastJaw > 0.6) {
          lastJaw = t;
          rings.push({ x: f.center.x, y: f.center.y, r0: f.faceW * 0.6, r1: Math.max(W, H), w: f.faceW * 0.12, life: 0.9, age: 0, color: C });
          a.fx.flash(C2, 0.3); a.fx.shake(f.faceW * 0.05);
        }
      }
      if (f && a.show.eyes) {
        for (const e of eyes(f)) {
          const o = 1 - clamp((e.blink - 0.35) / 0.3, 0, 1);
          if (o <= 0) continue;
          glow(ctx, e.iris.x, e.iris.y, e.w * 1.6, C, 0.8 * o);
          glow(ctx, e.iris.x, e.iris.y, e.w * 0.6, '#ffffff', o);
          for (let r = 0; r < 6; r++) {
            const ang = t * 0.8 + r * (TAU / 6);
            const L = e.w * (1.6 + 0.5 * Math.sin(t * 7 + r));
            glowLine(ctx, [e.iris, { x: e.iris.x + Math.cos(ang) * L, y: e.iris.y + Math.sin(ang) * L }], C2, e.w * 0.04, 0.7 * o);
          }
        }
      }
      if (a.show.hands) for (const h of a.hands) {
        for (const p of h.tips) glow(ctx, p.x, p.y, h.size * 0.35, C, 0.7);
        glow(ctx, h.palm.x, h.palm.y, h.size * 1.4, C, 0.55);
        if (h.open) {
          const s = h.palm, d = h.dir, e = toEdge(s, d, W, H);
          const w = h.size * (0.16 + 0.03 * Math.sin(t * 40));
          glowLine(ctx, [s, e], C, w);
          for (let i = 0; i < 3 * k; i++) {
            const p = lerp(s, e, Math.random());
            a.P.emit({ x: p.x, y: p.y, vx: d.x * h.size * 10 + rnd(-1, 1) * h.size * 2, vy: d.y * h.size * 10 + rnd(-1, 1) * h.size * 2, life: 0.4, size: h.size * 0.12, color: pick([C, C2]), kind: 'spark' });
          }
          if (chance(0.5 * k)) burst(a, e.x, e.y, 6, C2, h.size * 6);
        }
        for (let i = 0; i < 3 * k; i++) {
          const p = h.P[(Math.random() * 21) | 0];
          a.P.emit({ x: p.x, y: p.y, vx: rnd(-1, 1) * h.size, vy: -h.size * rnd(1, 2.5), life: 0.6, size: h.size * 0.12, color: pick([C, '#ff7a1a']), soft: true });
        }
      }
      ringsUpdate(a, rings);
    },
  };
}

export const CHARACTERS = [
  { id: 'iron', name: 'Repulsor Armor', hero: 'Iron Man style', emoji: '🦾', color: '#ff3b30', create: iron,
    hint: '✋ Haath khola rakho → repulsor charge → BLAST · 👁 aankh ghumao → target reticle' },
  { id: 'spider', name: 'Web Slinger', hero: 'Spider-Man style', emoji: '🕸️', color: '#e2231a', create: spider,
    hint: '🤟 Index + pinky ungli seedhi (beech ki 2 band) → WEB shoot · face pe mask, aankh band → lens squint' },
  { id: 'mystic', name: 'Mystic Arts', hero: 'Doctor Strange style', emoji: '🌀', color: '#ff9a1f', create: mystic,
    hint: '✋ Haath khola → magic shield · 🤏 Pinch karke hawa me gol circle banao → PORTAL' },
  { id: 'thunder', name: 'Thunder God', hero: 'Thor style', emoji: '⚡', color: '#5ab8ff', create: thunder,
    hint: '✋ Khule haath me bijli · ✊ Mutthi band → aasmaan se THUNDER · 😮 muh kholo → mouth lightning' },
  { id: 'gauntlet', name: 'Infinity Gauntlet', hero: 'Thanos style', emoji: '💎', color: '#ffcc33', create: gauntlet,
    hint: '🫰 Thumb + middle finger milao, phir chhodo → SNAP → sab dhool ban jayega' },
  { id: 'optic', name: 'Optic Blast', hero: 'Cyclops style', emoji: '🔴', color: '#ff2244', create: optic,
    hint: '😮 Muh kholo / eyebrow upar → EYE LASER · sir aur aankh ghuma ke beam aim karo' },
  { id: 'gamma', name: 'Gamma Rage', hero: 'Hulk style', emoji: '💚', color: '#3ddc2f', create: gamma,
    hint: '😮 Zor se muh kholo → RAGE ROAR shockwave · ✊ Mutthi → SMASH' },
  { id: 'panther', name: 'Kinetic Panther', hero: 'Black Panther style', emoji: '🐾', color: '#b14dff', create: panther,
    hint: '✊ Mutthi band → energy absorb · ✋ phir khol do → KINETIC BLAST · ungliyon pe claws' },
  { id: 'chaos', name: 'Chaos Magic', hero: 'Scarlet Witch style', emoji: '🔮', color: '#ff1f4b', create: chaos,
    hint: '✋✋ Dono haath khol ke paas lao → CHAOS SPHERE · ungliyon se red magic' },
  { id: 'hellfire', name: 'Hellfire Rider', hero: 'Ghost Rider style', emoji: '💀', color: '#ff6a00', create: hellfire,
    hint: '💀 Face → flaming skull · ✊ Mutthi band → jalti CHAIN, haath ghuma ke whip karo' },
  { id: 'shield', name: 'Star Shield', hero: 'Captain America style', emoji: '🛡️', color: '#2f6bff', create: starShield,
    hint: '✋ Haath khola → shield · ☝️ Sirf index ungli point karo → shield THROW (bounce karke wapas)' },
  { id: 'photon', name: 'Photon Binary', hero: 'Captain Marvel style', emoji: '✨', color: '#ffb43a', create: photon,
    hint: '✋ Haath khola → PHOTON BEAM · 😮 muh kholo → cosmic pulse · golden eyes' },
];
