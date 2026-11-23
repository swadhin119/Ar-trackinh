// Low-level rendering helpers: glow sprites, glowing lines, lightning, particles.

const spriteCache = new Map();

// All additive "light" (glows, beams, sparks) is routed to a separate layer so main.js can
// add a cinematic bloom pass on top of it. Solids (masks, shields, skull) stay on the main ctx.
let LIGHT = null;
export function setLightLayer(ctx) { LIGHT = ctx; }
const lightCtx = (ctx) => LIGHT || ctx;

// Tiny value-noise for organic fire/smoke textures.
function makeNoise(seed) {
  const N = 16, g = new Float32Array(N * N);
  let x = seed * 9301 + 49297;
  for (let i = 0; i < g.length; i++) { x = (x * 9301 + 49297) % 233280; g[i] = x / 233280; }
  const at = (i, j) => g[((j % N + N) % N) * N + ((i % N + N) % N)];
  return (u, v) => {
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
    return a + (b - a) * sv;
  };
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Cached sprites (cheaper than shadowBlur at 1080p/4K).
 * mode: 'glow' (hot white core) | 'soft' (smooth haze) | 'puff0'..'puff3' (noisy fire/smoke puffs)
 */
export function sprite(color, mode = 'glow') {
  if (mode === true) mode = 'soft';
  if (mode === false) mode = 'glow';
  const key = color + mode;
  let s = spriteCache.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  const S = mode.startsWith('puff') ? 96 : 64;
  s.width = s.height = S;
  const g = s.getContext('2d');
  if (mode.startsWith('puff')) {
    const n = makeNoise(+mode.slice(4) + 1);
    const n2 = makeNoise(+mode.slice(4) + 7);
    const img = g.createImageData(S, S);
    const v = parseInt(color.slice(1), 16), R = (v >> 16) & 255, G = (v >> 8) & 255, B = v & 255;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
      const r = Math.sqrt(dx * dx + dy * dy);
      const fb = n(x / 12, y / 12) * 0.55 + n2(x / 6, y / 6) * 0.3 + n(x / 3, y / 3) * 0.15;
      let a = Math.max(0, 1 - r * (0.75 + fb * 0.7));
      a = Math.pow(a, 1.4) * (0.55 + fb * 0.8);
      const hot = Math.max(0, 1 - r * 2.2) * 0.6; // brighter core
      const o = (y * S + x) * 4;
      img.data[o] = Math.min(255, R + (255 - R) * hot);
      img.data[o + 1] = Math.min(255, G + (255 - G) * hot);
      img.data[o + 2] = Math.min(255, B + (255 - B) * hot);
      img.data[o + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
  } else {
    const c = S / 2;
    const gr = g.createRadialGradient(c, c, 0, c, c, c);
    if (mode === 'soft') {
      gr.addColorStop(0, hexA(color, 0.55));
      gr.addColorStop(0.5, hexA(color, 0.2));
      gr.addColorStop(1, hexA(color, 0));
    } else {
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.15, color);
      gr.addColorStop(0.4, hexA(color, 0.4));
      gr.addColorStop(0.7, hexA(color, 0.1));
      gr.addColorStop(1, hexA(color, 0));
    }
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  spriteCache.set(key, s);
  return s;
}

export function glow(ctx, x, y, r, color, a = 1, soft = false) {
  if (r <= 0 || a <= 0) return;
  ctx = lightCtx(ctx);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sprite(color, soft === true ? 'soft' : soft || 'glow'), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

/** Multi-pass additive stroke: wide faint halo -> bright white core. */
export function glowLine(ctx, pts, color, w, a = 1, closed = false) {
  if (pts.length < 2 || w <= 0) return;
  ctx = lightCtx(ctx);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const passes = [[5, 0.07], [2.6, 0.2], [1.3, 0.55], [0.45, 1]];
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (closed) ctx.closePath();
  for (let i = 0; i < passes.length; i++) {
    ctx.strokeStyle = i === 3 ? '#ffffff' : color;
    ctx.globalAlpha = Math.min(1, a * passes[i][1]);
    ctx.lineWidth = Math.max(1, w * passes[i][0]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

/** Many separate segments in one additive stroke (runes, panel lines). segs = [[p,q], ...] */
export function glowSegs(ctx, segs, color, w, a = 1) {
  if (!segs.length) return;
  ctx = lightCtx(ctx);
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [p, q] of segs) { ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); }
  ctx.strokeStyle = color; ctx.globalAlpha = a * 0.35; ctx.lineWidth = w * 2.5; ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = a; ctx.lineWidth = Math.max(1, w * 0.6); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

export function glowCircle(ctx, x, y, r, color, w, a = 1) {
  const pts = [];
  const n = Math.max(24, Math.min(96, r / 4 | 0));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: x + Math.cos(t) * r, y: y + Math.sin(t) * r });
  }
  glowLine(ctx, pts, color, w, a, true);
}

/** Midpoint-displacement lightning between two points. */
export function bolt(a, b, disp, depth = 5) {
  let pts = [a, b];
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const dx = q.x - p.x, dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = (Math.random() - 0.5) * disp;
      out.push({ x: (p.x + q.x) / 2 - (dy / len) * off, y: (p.y + q.y) / 2 + (dx / len) * off }, q);
    }
    pts = out;
    disp *= 0.55;
  }
  return pts;
}

/** Lightning with side branches – returns a list of polylines (main bolt first). */
export function forkedBolt(a, b, disp, forks = 2, depth = 5) {
  const main = bolt(a, b, disp, depth);
  const out = [main];
  for (let i = 0; i < forks; i++) {
    const k = 2 + ((Math.random() * (main.length - 4)) | 0);
    const s = main[k];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.6;
    const len = L * (0.15 + Math.random() * 0.25);
    out.push(bolt(s, { x: s.x + Math.cos(ang) * len, y: s.y + Math.sin(ang) * len }, disp * 0.4, depth - 2));
  }
  return out;
}

/** Draw a lightning set with flicker: wide coloured halo + white-hot core. */
export function drawLightning(ctx, paths, color, w, a = 1) {
  paths.forEach((p, i) => glowLine(ctx, p, color, i ? w * 0.5 : w, a * (i ? 0.7 : 1)));
}

export class Particles {
  constructor(max = 3000) {
    this.p = [];
    this.max = max;
  }
  emit(o) {
    if (this.p.length >= this.max) this.p.splice(0, 64);
    this.p.push({
      x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0,
      life: o.life || 1, age: 0, size: o.size || 8, grow: o.grow || 0,
      color: o.color || '#ffffff', colors: o.colors || null,
      gravity: o.gravity || 0, drag: o.drag ?? 1.5, soft: !!o.soft,
      kind: o.kind || 'glow', swirl: o.swirl || 0, seed: Math.random() * 6.283,
      tex: o.tex ? (o.tex === 'puff' ? 'puff' + ((Math.random() * 4) | 0) : o.tex) : (o.soft ? 'soft' : 'glow'),
    });
  }
  clear() { this.p.length = 0; }
  update(dt) {
    const arr = this.p;
    let j = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy += p.gravity * dt;
      if (p.swirl) {
        p.vx += Math.sin(p.age * 7 + p.seed) * p.swirl * dt;
        p.vy += Math.cos(p.age * 5 + p.seed) * p.swirl * dt * 0.5;
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vy *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.size = Math.max(0.5, p.size + p.grow * dt);
      arr[j++] = p;
    }
    arr.length = j;
  }
  draw(ctx, light = ctx) {
    // Pass 1: opaque dust (Thanos-snap style) – normal blending.
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.p) {
      if (p.kind !== 'dust') continue;
      const r = p.age / p.life;
      ctx.globalAlpha = 1 - r * r;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    // Pass 2: additive light (goes to the bloom layer).
    ctx.globalAlpha = 1;
    ctx = light;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.p) {
      if (p.kind === 'dust') continue;
      const r = p.age / p.life;
      const color = p.colors ? p.colors[Math.min(p.colors.length - 1, (r * p.colors.length) | 0)] : p.color;
      let a = (1 - r) * (r < 0.1 ? r * 10 : 1);
      if (p.tex[0] === 'p') a *= 0.55; // noisy puffs overlap a lot – keep fire from blowing out to white
      if (p.kind === 'spark') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, p.size * 0.35);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.drawImage(sprite(color, 'glow'), p.x - p.size * 0.8, p.y - p.size * 0.8, p.size * 1.6, p.size * 1.6);
        continue;
      }
      ctx.globalAlpha = a;
      ctx.drawImage(sprite(color, p.tex), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
