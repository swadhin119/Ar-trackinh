// WebGL2 face-mesh renderer: wraps a UV texture onto the tracked 3D face mesh and re-lights it
// with the *real* camera lighting (luminance of the video under each pixel), so masks pick up
// the true shadows, highlights and skin contours instead of looking like flat stickers.

import { UV, TRI } from './facemesh-data.js';
import { EYE_A, EYE_B } from './scene.js';

const MOUTH_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

function fan(loop) {
  const out = [];
  for (let i = 1; i < loop.length - 1; i++) out.push(loop[0], loop[i], loop[i + 1]);
  return out;
}

const VS = `#version 300 es
in vec3 aPos; in vec2 aUV;
uniform vec2 uRes;
out vec2 vUV; out vec2 vScr;
void main() {
  vUV = aUV;
  vScr = aPos.xy / uRes;
  gl_Position = vec4(vScr.x * 2.0 - 1.0, 1.0 - vScr.y * 2.0, clamp(aPos.z, -0.99, 0.99), 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec2 vScr;
uniform sampler2D uTex, uVideo, uEnv;
uniform float uShade, uMetal, uAlpha, uLumRef, uTintAmt, uGloss;
uniform vec3 uTint;
out vec4 outColor;
void main() {
  vec4 alb = texture(uTex, vUV);
  if (alb.a < 0.003) discard;
  vec3 cam = texture(uVideo, vScr).rgb;
  float lum = dot(cam, vec3(0.299, 0.587, 0.114));
  // real lighting transfer: how bright this skin pixel is vs. the face average
  float rel = clamp(lum / max(uLumRef, 0.05), 0.15, 2.2);
  vec3 col = alb.rgb;
  if (uTintAmt > 0.0) {
    // skin recolour: keep the real skin detail, change the hue
    vec3 skin = (uTint * rel * 0.85 + cam * 0.15) * alb.rgb;
    col = mix(col, skin, uTintAmt);
  } else {
    col *= mix(1.0, rel, uShade);
  }
  // specular: bright spots of the real image become glossy highlights
  float spec = smoothstep(0.62, 1.0, lum) * uGloss;
  col += vec3(spec);
  // metal: reflect the blurred, mirrored scene
  if (uMetal > 0.0) {
    vec3 env = texture(uEnv, vec2(1.0 - vScr.x, vScr.y)).rgb;
    col = mix(col, col * (0.35 + env * 1.6) + env * 0.15, uMetal);
  }
  float a = alb.a * uAlpha;
  outColor = vec4(col * a, a);
}`;

export class FaceMeshRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, depth: true, antialias: true, preserveDrawingBuffer: false });
    this.ok = !!gl;
    if (!gl) return;
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;
    this.u = {};
    for (const n of ['uRes', 'uTex', 'uVideo', 'uEnv', 'uShade', 'uMetal', 'uAlpha', 'uLumRef', 'uTintAmt', 'uTint', 'uGloss']) this.u[n] = gl.getUniformLocation(p, n);

    this.pos = new Float32Array(468 * 3);
    this.posBuf = gl.createBuffer();
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, UV, gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.pos, gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(p, 'aPos'), aUV = gl.getAttribLocation(p, 'aUV');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.enableVertexAttribArray(aUV);
    gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

    // index buffers: base mesh, + eyes, + mouth (holes filled for full-cover masks)
    const base = Array.from(TRI);
    const eyes = [...fan(EYE_A), ...fan(EYE_B)];
    const mouth = fan(MOUTH_INNER);
    this.idx = {};
    for (const [k, arr] of Object.entries({ b: base, be: [...base, ...eyes], bm: [...base, ...mouth], bem: [...base, ...eyes, ...mouth] })) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(arr), gl.STATIC_DRAW);
      this.idx[k] = { buf, n: arr.length };
    }
    gl.bindVertexArray(null);

    const mkTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.videoTex = mkTex();
    this.envTex = mkTex();
    this.texCache = new Map();
    this.mkTex = mkTex;

    this.env = document.createElement('canvas');
    this.env.width = 48; this.env.height = 27;
    this.envCtx = this.env.getContext('2d', { willReadFrequently: true });
    this.lumRef = 0.5;
    this.frameId = -1;
    this.lumTick = 0;
  }

  /** Upload camera frame + tiny blurred env map once per rendered frame. */
  prepare(video, face, W, H, frameId) {
    if (!this.ok || this.frameId === frameId) return;
    this.frameId = frameId;
    const gl = this.gl;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    this.envCtx.drawImage(video, 0, 0, this.env.width, this.env.height);
    gl.bindTexture(gl.TEXTURE_2D, this.envTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.env);
    // Average face brightness (reference for the lighting transfer), refreshed a few times a second.
    if (face && this.lumTick-- <= 0) {
      this.lumTick = 8;
      const c = face.center, r = face.faceW * 0.3;
      const sx = Math.max(0, (c.x - r) / W * this.env.width), sy = Math.max(0, (c.y - r) / H * this.env.height);
      const sw = Math.max(1, Math.min(this.env.width - sx, (2 * r) / W * this.env.width));
      const shh = Math.max(1, Math.min(this.env.height - sy, (2 * r) / H * this.env.height));
      const d = this.envCtx.getImageData(sx | 0, sy | 0, Math.ceil(sw), Math.ceil(shh)).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const v = s / (d.length / 4);
      this.lumRef = this.lumRef * 0.6 + v * 0.4;
    }
  }

  texture(key, paint) {
    let t = this.texCache.get(key);
    if (t) return t;
    const gl = this.gl;
    const c = paint();
    t = this.mkTex();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.texCache.set(key, t);
    return t;
  }

  /**
   * Render one material onto the face and return the GL canvas (raw video coordinates).
   * mat: { key, paint(), cover: 'b'|'be'|'bm'|'bem', shade, metal, gloss, tint:[r,g,b], tintAmt, alpha }
   */
  render(face, W, H, mat) {
    if (!this.ok || !face) return null;
    const gl = this.gl;
    const P = face.P;
    for (let i = 0; i < 468; i++) {
      this.pos[i * 3] = P[i].x;
      this.pos[i * 3 + 1] = P[i].y;
      this.pos[i * 3 + 2] = P[i].z / W * 2.0;
    }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture(mat.key, mat.paint));
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.envTex);
    const u = this.u;
    gl.uniform1i(u.uTex, 0); gl.uniform1i(u.uVideo, 1); gl.uniform1i(u.uEnv, 2);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uShade, mat.shade ?? 0.85);
    gl.uniform1f(u.uMetal, mat.metal ?? 0);
    gl.uniform1f(u.uGloss, mat.gloss ?? 0.25);
    gl.uniform1f(u.uAlpha, mat.alpha ?? 1);
    gl.uniform1f(u.uLumRef, this.lumRef);
    gl.uniform1f(u.uTintAmt, mat.tintAmt ?? 0);
    const tc = mat.tint || [1, 1, 1];
    gl.uniform3f(u.uTint, tc[0], tc[1], tc[2]);

    const ib = this.idx[mat.cover || 'b'];
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib.buf);
    gl.drawElements(gl.TRIANGLES, ib.n, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    return this.canvas;
  }
}
