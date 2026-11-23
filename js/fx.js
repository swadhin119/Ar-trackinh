// Low-level rendering helpers: glow sprites, glowing lines, lightning, particles.

const spriteCache = new Map();

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Cached radial-gradient sprite – much cheaper than shadowBlur at 1080p/4K. */
export function sprite(color, soft = false) {
  const key = color + (soft ? 's' : '');
  let s = spriteCache.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 64;
  const g = s.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (soft) {
    gr.addColorStop(0, hexA(color, 0.55));
    gr.addColorStop(0.5, hexA(color, 0.2));
    gr.addColorStop(1, hexA(color, 0));
  } else {
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.2, color);
    gr.addColorStop(0.5, hexA(color, 0.35));
    gr.addColorStop(1, hexA(color, 0));
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  spriteCache.set(key, s);
  return s;
}

export function glow(ctx, x, y, r, color, a = 1, soft = false) {
  if (r <= 0 || a <= 0) return;
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sprite(color, soft), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = prev;
}

/** Multi-pass additive stroke: wide faint halo -> bright white core. */
export function glowLine(ctx, pts, color, w, a = 1, closed = false) {
  if (pts.length < 2 || w <= 0) return;
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
  draw(ctx) {
    // Pass 1: opaque dust (Thanos-snap style) – normal blending.
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.p) {
      if (p.kind !== 'dust') continue;
      const r = p.age / p.life;
      ctx.globalAlpha = 1 - r * r;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    // Pass 2: additive light.
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.p) {
      if (p.kind === 'dust') continue;
      const r = p.age / p.life;
      const color = p.colors ? p.colors[Math.min(p.colors.length - 1, (r * p.colors.length) | 0)] : p.color;
      const a = (1 - r) * (r < 0.1 ? r * 10 : 1);
      if (p.kind === 'spark') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, p.size * 0.35);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.drawImage(sprite(color, p.soft), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
