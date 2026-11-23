// Converts raw MediaPipe results into smoothed, pixel-space "scene" objects
// with derived features: gestures, events, eye/iris gaze, head direction, blendshapes.

export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const EYE_A = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const EYE_B = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
export const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
export const BROW_A = [46, 53, 52, 65, 55];
export const BROW_B = [276, 283, 282, 295, 285];
export const HAND_CONN = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11],
  [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
export const TIPS = [4, 8, 12, 16, 20];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const avg = (pts) => {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
};
const unit = (x, y) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };

/** Adaptive EMA: smooth when still, responsive when moving fast (cheap 1€-filter). */
function smooth(prev, next, W) {
  if (!prev || prev.length !== next.length) return next;
  const out = new Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const p = prev[i], n = next[i];
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    const a = Math.min(1, 0.35 + d / (W * 0.012));
    out[i] = { x: p.x + (n.x - p.x) * a, y: p.y + (n.y - p.y) * a, z: p.z + (n.z - p.z) * a };
  }
  return out;
}

export class Scene {
  constructor() {
    this.prevFace = null;
    this.prevHands = new Map();
    this.handMem = new Map();
    this.face = null;
    this.hands = [];
  }

  update(res, W, H, t, mirror) {
    if (res.face !== null && res.face !== undefined) this.face = this.buildFace(res.face, W, H);
    if (res.hands !== null && res.hands !== undefined) this.hands = this.buildHands(res.hands, W, H, t, mirror);
  }

  buildFace(r, W, H) {
    if (!r.faceLandmarks || !r.faceLandmarks.length) { this.prevFace = null; return null; }
    const raw = r.faceLandmarks[0].map((p) => ({ x: p.x * W, y: p.y * H, z: p.z * W }));
    const P = smooth(this.prevFace, raw, W);
    this.prevFace = P;

    const blend = {};
    const cats = r.faceBlendshapes && r.faceBlendshapes[0] ? r.faceBlendshapes[0].categories : [];
    for (const c of cats) blend[c.categoryName] = c.score;

    const mkEye = (idx, c1, c2, top, bot, iris, blink) => {
      const pts = idx.map((i) => P[i]);
      const c = { x: (P[c1].x + P[c2].x) / 2, y: (P[c1].y + P[c2].y) / 2 };
      const w = dist(P[c1], P[c2]);
      const ir = P[iris] || c;
      return {
        pts, c, w, iris: ir,
        h: dist(P[top], P[bot]),
        gx: (ir.x - c.x) / w, gy: (ir.y - c.y) / w,
        blink: blend[blink] || 0,
      };
    };
    const eyeA = mkEye(EYE_A, 33, 133, 159, 145, 468, 'eyeBlinkRight');
    const eyeB = mkEye(EYE_B, 362, 263, 386, 374, 473, 'eyeBlinkLeft');

    const cheekMid = { x: (P[234].x + P[454].x) / 2, y: (P[234].y + P[454].y) / 2, z: (P[234].z + P[454].z) / 2 };
    const faceW = dist(P[234], P[454]);
    // Head direction: vector from cheek plane to nose tip (3D), projected to screen.
    const hx = P[1].x - cheekMid.x, hy = P[1].y - cheekMid.y, hz = P[1].z - cheekMid.z;
    const hm = Math.hypot(hx, hy, hz) || 1;
    const head = { x: hx / hm, y: hy / hm - 0.18 }; // small pitch bias: nose sits below cheek line
    const gaze = { x: (eyeA.gx + eyeB.gx) * 2.2, y: (eyeA.gy + eyeB.gy) * 3.0 };
    const dir = { x: head.x * 1.6 + gaze.x, y: head.y * 1.6 + gaze.y };

    return {
      P, blend, eyeA, eyeB, faceW,
      oval: FACE_OVAL.map((i) => P[i]),
      lips: LIPS.map((i) => P[i]),
      center: avg([P[234], P[454], P[10], P[152]]),
      nose: P[1], forehead: P[10], chin: P[152],
      mouth: { x: (P[13].x + P[14].x) / 2, y: (P[13].y + P[14].y) / 2 },
      up: unit(P[10].x - P[152].x, P[10].y - P[152].y),
      head, gaze, dir,
      jaw: blend.jawOpen || 0,
      browUp: blend.browInnerUp || 0,
      smile: ((blend.mouthSmileLeft || 0) + (blend.mouthSmileRight || 0)) / 2,
      eyesClosed: Math.min(eyeA.blink, eyeB.blink),
    };
  }

  buildHands(r, W, H, t) {
    const out = [];
    const seen = new Set();
    const n = r.landmarks ? r.landmarks.length : 0;
    for (let k = 0; k < n; k++) {
      let id = (r.handedness && r.handedness[k] && r.handedness[k][0] && r.handedness[k][0].categoryName) || 'H';
      if (seen.has(id)) id += k;
      seen.add(id);
      const raw = r.landmarks[k].map((p) => ({ x: p.x * W, y: p.y * H, z: p.z * W }));
      const P = smooth(this.prevHands.get(id), raw, W);
      this.prevHands.set(id, P);

      const size = dist(P[0], P[9]) || 1;
      const palm = avg([P[0], P[5], P[9], P[13], P[17]]);
      const ratio = (tip, pip) => dist(P[tip], P[0]) / (dist(P[pip], P[0]) || 1);
      const ext = [
        dist(P[4], P[17]) > dist(P[2], P[17]) * 1.25,
        ratio(8, 6) > 1.12, ratio(12, 10) > 1.12, ratio(16, 14) > 1.12, ratio(20, 18) > 1.12,
      ];
      const nExt = ext[1] + ext[2] + ext[3] + ext[4];
      const fist = nExt === 0;
      const g = {
        open: nExt === 4,
        fist,
        point: ext[1] && !ext[2] && !ext[3] && !ext[4],
        thwip: ext[1] && ext[4] && !ext[2] && !ext[3],
        pinch: !fist && dist(P[4], P[8]) < size * 0.3,
        midPinch: dist(P[4], P[12]) < size * 0.3 && dist(P[4], P[8]) > size * 0.4,
      };

      const mem = this.handMem.get(id) || { g: {}, since: {}, cool: {}, palm };
      const events = {};
      for (const key of Object.keys(g)) {
        if (g[key] && !mem.g[key] && t - (mem.cool[key + 'S'] || 0) > 0.25) {
          events[key + 'Start'] = true; mem.cool[key + 'S'] = t; mem.since[key] = t;
        }
        if (!g[key] && mem.g[key]) {
          events[key + 'End'] = true;
          events[key + 'Held'] = t - (mem.since[key] || t);
        }
      }
      // Snap = thumb+middle pinch, then released.
      if (events.midPinchEnd && events.midPinchHeld > 0.06 && t - (mem.cool.snap || 0) > 0.8) {
        events.snap = true; mem.cool.snap = t;
      }
      const vel = { x: palm.x - mem.palm.x, y: palm.y - mem.palm.y };
      mem.g = g; mem.palm = palm;
      this.handMem.set(id, mem);

      out.push({
        id, P, size, palm, ext, ...g, events, vel,
        dir: unit(P[9].x - P[0].x, P[9].y - P[0].y),
        tips: TIPS.map((i) => P[i]),
      });
    }
    for (const key of [...this.prevHands.keys()]) {
      if (!seen.has(key)) { this.prevHands.delete(key); this.handMem.delete(key); }
    }
    return out;
  }
}
