// Procedural UV-space textures for the 3D face mesh (canonical MediaPipe UV layout).
// Each painter draws into a 1024² canvas; features are placed at the exact UV of the
// landmarks (eye corners, nose, mouth) so they stick to the real face when it moves.

import { UV } from './facemesh-data.js';
import { FACE_OVAL } from './scene.js';

const S = 1024;
const u = (i) => ({ x: UV[i * 2] * S, y: UV[i * 2 + 1] * S });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a, v, s = 1) => ({ x: a.x + v.x * s, y: a.y + v.y * s });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (x, y) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };
const UP = { x: 0, y: -1 };

function canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return c;
}
function smoothPath(g, pts) {
  const n = pts.length;
  g.beginPath();
  const m0 = lerp(pts[n - 1], pts[0], 0.5);
  g.moveTo(m0.x, m0.y);
  for (let i = 0; i < n; i++) {
    const m = lerp(pts[i], pts[(i + 1) % n], 0.5);
    g.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  g.closePath();
}
function poly(g, pts, close = true) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (close) g.closePath();
}
/** Fabric / skin micro-texture so surfaces don't look plastic. */
function grain(g, amt = 0.06, n = 26000, seed = 1) {
  let x = seed * 99991;
  const r = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  for (let i = 0; i < n; i++) {
    const v = r() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${amt * r()})`;
    g.fillRect(r() * S, r() * S, 2, 2);
  }
}
/** Soft fade at the face border so the mask blends into the head instead of a hard cut. */
function feather(c, px = 14, scale = 0.985) {
  const m = canvas();
  const g = m.getContext('2d');
  const oval = FACE_OVAL.map(u);
  const cx = S / 2, cy = oval.reduce((s, p) => s + p.y, 0) / oval.length;
  g.filter = `blur(${px}px)`;
  g.fillStyle = '#fff';
  smoothPath(g, oval.map((p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale })));
  g.fill();
  const out = c.getContext('2d');
  out.globalCompositeOperation = 'destination-in';
  out.drawImage(m, 0, 0);
  out.globalCompositeOperation = 'source-over';
  return c;
}
/** Angled hero lens anchored to the eye corners (UV space). */
function lens(inner, outer, k = 1) {
  const I = u(inner), O = u(outer), w = dist(I, O);
  const uo = unit(O.x - I.x, O.y - I.y), c = lerp(I, O, 0.5);
  return [
    add(add(I, uo, -w * 0.14 * k), UP, w * 0.02),
    add(add(c, UP, w * 0.78 * k), uo, -w * 0.05),
    add(add(O, uo, w * 0.55 * k), UP, w * 0.72 * k),
    add(add(O, uo, w * 0.5 * k), UP, -w * 0.12),
    add(add(c, UP, -w * 0.42 * k), uo, w * 0.08),
  ];
}

// ---------------------------------------------------------------------------------------------
export function paintSpider() {
  const c = canvas(), g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, '#c8141f'); bg.addColorStop(1, '#8e0b14');
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  grain(g, 0.07, 40000, 3);
  // Web: rays from the nose bridge + sagging rings
  const ctr = lerp(u(168), u(6), 0.5);
  const rays = 22, rings = [55, 110, 170, 235, 305, 380, 460, 545];
  const ray = (k) => (k / rays) * Math.PI * 2 - Math.PI / 2;
  const P = (k, r) => ({ x: ctr.x + Math.cos(ray(k)) * r, y: ctr.y + Math.sin(ray(k)) * r * 1.05 });
  const webPath = () => {
    g.beginPath();
    for (let k = 0; k < rays; k++) { g.moveTo(ctr.x, ctr.y); const e = P(k, 800); g.lineTo(e.x, e.y); }
    for (const r of rings) {
      for (let k = 0; k < rays; k++) {
        const a = P(k, r), b = P(k + 1, r), m = lerp(ctr, lerp(a, b, 0.5), 0.86);
        g.moveTo(a.x, a.y); g.quadraticCurveTo(m.x, m.y, b.x, b.y);
      }
    }
  };
  g.lineCap = 'round';
  webPath(); g.strokeStyle = 'rgba(255,120,120,0.28)'; g.lineWidth = 6; g.stroke();      // raised ridge
  g.save(); g.translate(-1.5, -1.5); webPath(); g.strokeStyle = '#140103'; g.lineWidth = 3.2; g.stroke(); g.restore();
  // Lenses
  for (const [i, o] of [[133, 33], [362, 263]]) {
    const L = lens(i, o);
    smoothPath(g, L);
    g.lineWidth = 26; g.strokeStyle = '#08080a'; g.stroke();
    const lg = g.createLinearGradient(L[1].x, L[1].y, L[4].x, L[4].y);
    lg.addColorStop(0, '#ffffff'); lg.addColorStop(0.6, '#e4e9ef'); lg.addColorStop(1, '#a9b4c2');
    g.fillStyle = lg; g.fill();
    // fine mesh inside the lens
    g.save(); smoothPath(g, L); g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
    for (let y = 0; y < S; y += 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
    g.restore();
  }
  return feather(c, 10);
}

export function paintIron() {
  const c = canvas(), g = c.getContext('2d');
  const bg = g.createRadialGradient(S / 2, S * 0.3, 40, S / 2, S * 0.5, S * 0.6);
  bg.addColorStop(0, '#e0242c'); bg.addColorStop(1, '#6e0710');
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  const inw = (i, k) => lerp(u(i), { x: S / 2, y: S * 0.5 }, k);
  const plate = [
    lerp(u(10), u(168), 0.42),
    add(u(334), UP, 40), inw(356, 0.2), inw(454, 0.24), inw(397, 0.2), inw(377, 0.14),
    lerp(u(152), u(17), 0.22),
    inw(148, 0.14), inw(172, 0.2), inw(234, 0.24), inw(127, 0.2), add(u(105), UP, 40),
  ];
  // shadow groove around the faceplate
  smoothPath(g, plate); g.lineWidth = 22; g.strokeStyle = '#2a0204'; g.stroke();
  const pg = g.createLinearGradient(0, plate[0].y, 0, plate[6].y);
  pg.addColorStop(0, '#f6dc8c'); pg.addColorStop(0.3, '#d9a944'); pg.addColorStop(0.7, '#b07d22'); pg.addColorStop(1, '#6e4a10');
  g.fillStyle = pg; g.fill();
  grain(g, 0.03, 12000, 5);
  g.strokeStyle = 'rgba(60,32,4,0.85)'; g.lineWidth = 5; g.lineCap = 'round';
  const lines = [
    [lerp(u(10), u(168), 0.42), u(168), lerp(u(168), u(1), 0.85)],
    [u(129), lerp(u(129), u(234), 0.55)], [u(358), lerp(u(358), u(454), 0.55)],
    [lerp(u(61), u(172), 0.3), u(61), u(291), lerp(u(291), u(397), 0.3)],
    [{ x: S / 2, y: 0 }, lerp(u(10), u(168), 0.42)],
  ];
  for (const l of lines) { poly(g, l, false); g.stroke(); }
  // eye slits
  for (const [i, o] of [[133, 33], [362, 263]]) {
    const I = u(i), O = u(o), w = dist(I, O), uo = unit(O.x - I.x, O.y - I.y);
    const slit = [add(add(I, uo, -w * 0.12), UP, w * 0.06), add(add(O, uo, w * 0.32), UP, w * 0.4),
      add(add(O, uo, w * 0.36), UP, w * 0.14), add(add(I, uo, -w * 0.04), UP, -w * 0.16)];
    poly(g, slit); g.lineWidth = 16; g.strokeStyle = '#1a0a02'; g.stroke();
    g.fillStyle = '#e9fcff'; g.fill();
  }
  return feather(c, 8);
}

export function paintSkinTint(extra) {
  const c = canvas(), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  if (extra) extra(g);
  return feather(c, 22, 0.97);
}

export function hulkDetails(g) {
  // heavy brow ridge shadow + forehead veins (darken the tint)
  g.filter = 'blur(14px)';
  g.strokeStyle = 'rgba(40,60,30,0.55)'; g.lineWidth = 46; g.lineCap = 'round';
  poly(g, [lerp(u(70), u(46), 0.5), u(66), lerp(u(107), u(9), 0.6), lerp(u(336), u(9), 0.6), u(296), lerp(u(300), u(276), 0.5)], false);
  g.stroke();
  g.filter = 'blur(2px)';
  g.strokeStyle = 'rgba(30,70,20,0.45)'; g.lineWidth = 6;
  for (const [a, b, bend] of [[u(109), u(67), 30], [u(338), u(297), -30], [u(151), u(9), 20]]) {
    g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo((a.x + b.x) / 2 + bend, (a.y + b.y) / 2, b.x, b.y + 60); g.stroke();
  }
  g.filter = 'none';
}

export function thanosDetails(g) {
  g.strokeStyle = 'rgba(50,25,70,0.6)'; g.lineWidth = 12; g.lineCap = 'round'; g.filter = 'blur(3px)';
  const chin = u(152), lip = u(17);
  for (const dx of [-70, -24, 24, 70]) {
    g.beginPath(); g.moveTo(chin.x + dx * 0.8, lip.y + 30); g.lineTo(chin.x + dx, chin.y - 10); g.stroke();
  }
  g.filter = 'none';
}

export function paintPanther() {
  const c = canvas(), g = c.getContext('2d');
  g.fillStyle = '#17171d'; g.fillRect(0, 0, S, S);
  // woven vibranium micro-pattern
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < S; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < S; x += 12) g.fillRect(x, y, 5, 5);
  grain(g, 0.05, 15000, 9);
  g.strokeStyle = '#b9bccb'; g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round';
  const tracks = [
    [10, 151, 9, 8, 168, 6, 197, 195, 5, 4], [109, 67, 103, 54, 21], [338, 297, 332, 284, 251],
    [234, 93, 132, 58, 172], [454, 323, 361, 288, 397], [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291],
  ];
  for (const t of tracks) { poly(g, t.map(u), false); g.stroke(); }
  g.strokeStyle = 'rgba(177,77,255,0.9)'; g.lineWidth = 3;
  for (const t of tracks) { poly(g, t.map(u), false); g.stroke(); }
  for (const [i, o] of [[133, 33], [362, 263]]) {
    const L = lens(i, o, 0.62);
    smoothPath(g, L); g.lineWidth = 12; g.strokeStyle = '#9da0ad'; g.stroke();
    g.fillStyle = '#f1f3ff'; g.fill();
  }
  return feather(c, 10);
}

export function paintSkull() {
  const c = canvas(), g = c.getContext('2d');
  const bg = g.createRadialGradient(S / 2, S * 0.42, 60, S / 2, S * 0.5, S * 0.55);
  bg.addColorStop(0, '#efe5cf'); bg.addColorStop(0.6, '#bcae92'); bg.addColorStop(1, '#3a2f22');
  g.fillStyle = bg; g.fillRect(0, 0, S, S);
  grain(g, 0.12, 50000, 11);
  // cracks
  let x = 777;
  const r = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  g.strokeStyle = 'rgba(50,35,20,0.6)'; g.lineWidth = 2.5;
  for (let k = 0; k < 14; k++) {
    let p = { x: 250 + r() * 520, y: 80 + r() * 300 };
    g.beginPath(); g.moveTo(p.x, p.y);
    for (let s = 0; s < 7; s++) { p = { x: p.x + (r() - 0.5) * 70, y: p.y + r() * 40 }; g.lineTo(p.x, p.y); }
    g.stroke();
  }
  // cheek hollows
  for (const i of [205, 425]) {
    const p = u(i);
    const cg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 130);
    cg.addColorStop(0, 'rgba(40,25,10,0.65)'); cg.addColorStop(1, 'rgba(40,25,10,0)');
    g.fillStyle = cg; g.fillRect(p.x - 130, p.y - 130, 260, 260);
  }
  // eye sockets
  for (const [i, o] of [[133, 33], [362, 263]]) {
    const I = u(i), O = u(o), cc = lerp(I, O, 0.5), w = dist(I, O);
    const sg = g.createRadialGradient(cc.x, cc.y, w * 0.2, cc.x, cc.y, w * 1.05);
    sg.addColorStop(0, '#000'); sg.addColorStop(0.7, '#0c0603'); sg.addColorStop(1, 'rgba(20,10,5,0)');
    g.fillStyle = sg;
    g.beginPath(); g.ellipse(cc.x, cc.y - w * 0.08, w * 1.0, w * 0.82, 0, 0, Math.PI * 2); g.fill();
  }
  // nose cavity
  const n = u(1), nl = u(98), nr = u(327), nt = lerp(u(168), n, 0.55), nb = u(2);
  g.fillStyle = '#0b0603';
  g.beginPath(); g.moveTo(nt.x, nt.y); g.quadraticCurveTo(nl.x - 10, nl.y, nb.x, nb.y + 6); g.quadraticCurveTo(nr.x + 10, nr.y, nt.x, nt.y); g.fill();
  // teeth
  const L = u(61), R = u(291), mid = lerp(u(13), u(14), 0.5);
  const tw = (R.x - L.x) / 10, th = 46;
  g.fillStyle = '#100804'; g.fillRect(L.x - 20, mid.y - th - 8, R.x - L.x + 40, th * 2 + 16);
  for (let row = -1; row <= 1; row += 2) {
    for (let i = 0; i < 10; i++) {
      const tx = L.x + i * tw, ty = row < 0 ? mid.y - th : mid.y + 3;
      const tg = g.createLinearGradient(tx, ty, tx + tw, ty);
      tg.addColorStop(0, '#b8ab8e'); tg.addColorStop(0.5, '#f4ecd6'); tg.addColorStop(1, '#9c8f74');
      g.fillStyle = tg;
      g.beginPath(); g.roundRect(tx + 3, ty, tw - 6, th - 3, 10); g.fill();
    }
  }
  return feather(c, 16, 1.0);
}
