import { createTracker } from './tracker.js';
import { Scene, HAND_CONN } from './scene.js';
import { Particles, setLightLayer } from './fx.js';
import { CHARACTERS } from './characters.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#stage');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const video = $('#video');

// Short side of the video. Long side follows the chosen aspect (4:3 = full sensor, no crop/zoom).
const QUALITY = { 720: 720, 1080: 1080, 1440: 1440, 2160: 2160 };

// Light layer: every glow/beam/spark is drawn here, then bloomed + added on top of the video.
const light = document.createElement('canvas');
const lightCtx2 = light.getContext('2d');
const bloomA = document.createElement('canvas');
const bloomB = document.createElement('canvas');
const bloomActx = bloomA.getContext('2d');
const bloomBctx = bloomB.getContext('2d');

const state = {
  facing: 'user',
  show: { hands: true, face: true, eyes: true },
  mesh: false,
  combo: false,
  bloom: true,
  k: 1,
  active: new Map(), // id -> instance
  lastPicked: null,
  stream: null,
  tracker: null,
  recorder: null,
};

const scene = new Scene();
const particles = new Particles(3500);
let shakeAmt = 0, flashA = 0, flashColor = '#ffffff';
const sampleCanvas = document.createElement('canvas');
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

const fx = {
  video,
  shake(v) { shakeAmt = Math.max(shakeAmt, Math.min(v, canvas.width * 0.03)); },
  flash(c, a) { if (a > flashA) { flashA = Math.min(0.8, a); flashColor = c; } },
  sampleFrame() {
    sampleCanvas.width = 192;
    sampleCanvas.height = Math.round(192 * canvas.height / canvas.width) || 108;
    sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);
    return sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
  },
};

// ---------------------------------------------------------------- UI: characters
function buildCarousel() {
  const el = $('#carousel');
  CHARACTERS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'char';
    b.dataset.id = c.id;
    b.style.setProperty('--c', c.color);
    b.title = `${c.name} (${i + 1})`;
    b.innerHTML = `<span class="ring">${c.emoji}</span><b>${c.name}</b><i>${c.hero}</i>`;
    b.onclick = () => pick(c.id);
    el.appendChild(b);
  });
}

function pick(id) {
  const def = CHARACTERS.find((c) => c.id === id);
  if (!def) return;
  if (state.combo) {
    if (state.active.has(id)) state.active.delete(id);
    else state.active.set(id, def.create());
  } else {
    if (state.active.size === 1 && state.active.has(id)) return;
    state.active.clear();
    state.active.set(id, def.create());
  }
  state.lastPicked = state.active.has(id) ? id : [...state.active.keys()].pop() || null;
  particles.clear();
  refreshCarousel();
}

function refreshCarousel() {
  document.querySelectorAll('.char').forEach((b) => b.classList.toggle('on', state.active.has(b.dataset.id)));
  const cur = CHARACTERS.find((c) => c.id === state.lastPicked);
  $('#hint').textContent = cur ? `${cur.emoji} ${cur.name}: ${cur.hint}` : 'Neeche se koi character chuno';
  document.documentElement.style.setProperty('--accent', cur ? cur.color : '#ff3b30');
}

// ---------------------------------------------------------------- Camera
async function startCamera() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  const short = QUALITY[$('#quality').value];
  const ratio = $('#aspect').value === '43' ? 4 / 3 : 16 / 9;
  const long = Math.round(short * ratio);
  const fps = +$('#fpsSel').value;
  const portrait = window.innerHeight > window.innerWidth;
  const video0 = {
    facingMode: state.facing,
    width: { ideal: portrait ? short : long },
    height: { ideal: portrait ? long : short },
    aspectRatio: { ideal: portrait ? 1 / ratio : ratio },
    frameRate: { ideal: fps, max: fps },
  };
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: video0 });
  } catch (e) {
    console.warn('Preferred constraints failed, retrying basic', e);
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.facing }, audio: false });
  }
  video.srcObject = state.stream;
  await video.play();
  setupZoom();
  resize();
}

// Hardware camera zoom (Android Chrome/WebView). Start at the widest setting = no zoom.
function setupZoom() {
  const track = state.stream && state.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  const row = $('#zoomRow'), sl = $('#zoom');
  if (!caps.zoom || caps.zoom.max <= caps.zoom.min) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  sl.min = caps.zoom.min; sl.max = caps.zoom.max; sl.step = caps.zoom.step || 0.1; sl.value = caps.zoom.min;
  track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }).catch(() => {});
  sl.oninput = () => track.applyConstraints({ advanced: [{ zoom: +sl.value }] }).catch(() => {});
}

function applyFit() {
  canvas.style.objectFit = $('#fit').value;
}

function resize() {
  if (!video.videoWidth) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  if (light.width !== canvas.width || light.height !== canvas.height) {
    light.width = canvas.width; light.height = canvas.height;
    bloomA.width = Math.max(1, canvas.width >> 3); bloomA.height = Math.max(1, canvas.height >> 3);
    bloomB.width = Math.max(1, canvas.width >> 4); bloomB.height = Math.max(1, canvas.height >> 4);
  }
  const label = canvas.height >= 2160 || canvas.width >= 2160 ? '4K' : Math.min(canvas.width, canvas.height) >= 1440 ? '2K'
    : Math.min(canvas.width, canvas.height) >= 1080 ? 'FHD' : Math.min(canvas.width, canvas.height) >= 720 ? 'HD' : 'SD';
  $('#res').textContent = `${label} ${canvas.width}×${canvas.height}`;
}

// ---------------------------------------------------------------- Render loop
let lastT = performance.now(), lastVT = -1, fpsAcc = 0, fpsN = 0, slowFor = 0;
let detecting = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (!video.videoWidth) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) resize();
  const W = canvas.width, H = canvas.height;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const t = now / 1000;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    const fps = fpsN / fpsAcc;
    $('#fps').textContent = `${Math.round(fps)} fps`;
    // Weak phone? Drop the bloom pass automatically after ~4s of low frame-rate.
    slowFor = fps < 22 && state.bloom && state.tracker ? slowFor + fpsAcc : 0;
    if (slowFor > 4) {
      state.bloom = false; $('#bloom').checked = false; slowFor = 0;
      $('#hint').textContent = '⚡ Phone thoda slow hai — smooth chalane ke liye Cinematic glow off kiya (Settings me on kar sakte ho)';
    }
    fpsAcc = 0; fpsN = 0;
  }

  const mirror = state.facing === 'user';
  if (state.tracker && video.currentTime !== lastVT && !detecting) {
    lastVT = video.currentTime;
    detecting = true;
    try {
      const res = state.tracker.detect(video, state.show.face || state.show.eyes, state.show.hands);
      scene.update(res, W, H, t, mirror);
    } catch (e) { console.error(e); }
    detecting = false;
  }
  if (!state.show.hands) scene.hands = [];
  if (!state.show.face && !state.show.eyes) scene.face = null;

  // Camera-shake + mirroring transform. Effects draw in raw video coordinates.
  shakeAmt *= Math.exp(-dt * 9);
  const sx = (Math.random() - 0.5) * 2 * shakeAmt, sy = (Math.random() - 0.5) * 2 * shakeAmt;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (shakeAmt > 0.5) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  if (mirror) ctx.setTransform(-1, 0, 0, 1, W + sx, sy); else ctx.setTransform(1, 0, 0, 1, sx, sy);
  ctx.drawImage(video, 0, 0, W, H);
  const L = lightCtx2;
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.globalCompositeOperation = 'source-over';
  L.globalAlpha = 1;
  L.clearRect(0, 0, W, H);
  L.setTransform(ctx.getTransform());
  setLightLayer(L);

  const api = { ctx, W, H, t, dt, face: scene.face, hands: scene.hands, fx, P: particles, show: state.show, k: state.k };
  for (const inst of state.active.values()) {
    ctx.save();
    try { inst.draw(api); } catch (e) { console.error(e); }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  particles.update(dt);
  particles.draw(ctx, L);
  setLightLayer(null);
  composeLight(W, H);
  if (state.mesh) drawMesh(W);

  if (flashA > 0.005) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flashA;
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    flashA *= Math.exp(-dt * 6);
  }
}

// Bloom: downsample the light layer twice (cheap blur via bilinear scaling), add it back wide,
// then add the sharp light on top. Gives a filmic glow around beams, fire and magic.
function composeLight(W, H) {
  const T = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  if (state.bloom) {
    bloomActx.globalCompositeOperation = 'copy';
    bloomActx.filter = 'blur(1.5px)';
    bloomActx.drawImage(light, 0, 0, bloomA.width, bloomA.height);
    bloomActx.filter = 'none';
    bloomBctx.globalCompositeOperation = 'copy';
    bloomBctx.filter = 'blur(2px)';
    bloomBctx.drawImage(bloomA, 0, 0, bloomB.width, bloomB.height);
    bloomBctx.filter = 'none';
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(bloomB, 0, 0, W, H);
    ctx.globalAlpha = 0.55;
    ctx.drawImage(bloomA, 0, 0, W, H);
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(light, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(T); // back to mirrored video space (mesh overlay uses it)
}

function drawMesh(W) {
  const r = Math.max(1.5, W / 900);
  ctx.globalCompositeOperation = 'source-over';
  const f = scene.face;
  if (f) {
    ctx.fillStyle = 'rgba(0,255,200,0.7)';
    for (const p of f.P) ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
    ctx.fillStyle = '#ffee00';
    for (const e of [f.eyeA, f.eyeB]) { ctx.beginPath(); ctx.arc(e.iris.x, e.iris.y, r * 3, 0, Math.PI * 2); ctx.fill(); }
  }
  for (const h of scene.hands) {
    ctx.strokeStyle = 'rgba(0,255,120,0.9)';
    ctx.lineWidth = r * 1.5;
    ctx.beginPath();
    for (const [i, j] of HAND_CONN) { ctx.moveTo(h.P[i].x, h.P[i].y); ctx.lineTo(h.P[j].x, h.P[j].y); }
    ctx.stroke();
    ctx.fillStyle = '#ff2d55';
    for (const p of h.P) { ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2); ctx.fill(); }
  }
}

// ---------------------------------------------------------------- Recording
let recChunks = [], recStart = 0, recTimerId = 0, micStream = null;

function pickMime() {
  const types = [
    'video/mp4;codecs=avc1.640033,mp4a.40.2',
    'video/mp4;codecs=avc1.4d0033,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

async function startRecording() {
  const fps = +$('#fpsSel').value;
  const stream = canvas.captureStream(fps);
  if ($('#mic').checked) {
    try {
      micStream = micStream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micStream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    } catch (e) { console.warn('Mic not available', e); }
  }
  const mimeType = pickMime();
  // High bitrate for crisp HD: ~0.1 bits/pixel/frame (1080p60 ≈ 12 Mbps, 4K ≈ 40 Mbps).
  const bps = Math.round(Math.min(60e6, Math.max(5e6, canvas.width * canvas.height * fps * 0.1)));
  const rec = new MediaRecorder(stream, { mimeType: mimeType || undefined, videoBitsPerSecond: bps, audioBitsPerSecond: 192000 });
  recChunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  rec.onstop = () => {
    const type = rec.mimeType || mimeType || 'video/webm';
    const blob = new Blob(recChunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    showResult({ blob, kind: 'video', name: `hero-ar-${stamp()}.${ext}`, info: `${canvas.width}×${canvas.height} · ${(bps / 1e6).toFixed(0)} Mbps · ${ext.toUpperCase()} · ${(blob.size / 1e6).toFixed(1)} MB` });
    stream.getVideoTracks().forEach((t) => t.stop());
  };
  rec.start(500);
  state.recorder = rec;
  recStart = performance.now();
  $('#recBtn').classList.add('recording');
  $('#recTimer').classList.remove('hidden');
  recTimerId = setInterval(() => {
    const s = Math.floor((performance.now() - recStart) / 1000);
    $('#recTime').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
}

function stopRecording() {
  if (!state.recorder) return;
  state.recorder.stop();
  state.recorder = null;
  clearInterval(recTimerId);
  $('#recBtn').classList.remove('recording');
  $('#recTimer').classList.add('hidden');
  $('#recTime').textContent = '00:00';
}

function snapshot() {
  canvas.toBlob((blob) => {
    if (blob) showResult({ blob, kind: 'image', name: `hero-ar-${stamp()}.png`, info: `${canvas.width}×${canvas.height} PNG` });
  }, 'image/png');
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let lastResult = null;

function showResult(r) {
  if (lastResult) URL.revokeObjectURL(lastResult.url);
  r.url = URL.createObjectURL(r.blob);
  lastResult = r;
  const v = $('#resultVideo'), img = $('#resultImg');
  v.classList.toggle('hidden', r.kind !== 'video');
  img.classList.toggle('hidden', r.kind !== 'image');
  if (r.kind === 'video') { v.src = r.url; v.play().catch(() => {}); } else { img.src = r.url; }
  $('#downloadBtn').href = r.url;
  $('#downloadBtn').download = r.name;
  $('#resultInfo').textContent = r.info;
  $('#result').classList.remove('hidden');
  if (window.AndroidBridge) saveToGallery(r);
}

// Android APK: WebView can't download blob: URLs, so stream the file to native code in chunks.
function saveToGallery(r) {
  if (!r.saving) r.saving = writeToGallery(r);
  return r.saving;
}
async function writeToGallery(r) {
  const B = window.AndroidBridge;
  const type = (r.blob.type || 'video/webm').split(';')[0];
  if (!B.begin(r.name, type)) return false;
  const CH = 3 * 1024 * 1024; // multiple of 3 -> clean base64 chunks
  for (let off = 0; off < r.blob.size; off += CH) {
    const buf = new Uint8Array(await r.blob.slice(off, off + CH).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    if (!B.append(btoa(bin))) return false;
  }
  r.saved = B.finish();
  return r.saved;
}

// ---------------------------------------------------------------- Wiring
function wire() {
  document.querySelectorAll('[data-track]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.track;
      state.show[k] = !state.show[k];
      b.classList.toggle('on', state.show[k]);
    };
  });
  $('#meshBtn').onclick = () => { state.mesh = !state.mesh; $('#meshBtn').classList.toggle('on', state.mesh); };
  $('#settingsBtn').onclick = () => $('#settings').classList.toggle('hidden');
  $('#intensity').oninput = (e) => { state.k = +e.target.value; };
  $('#combo').onchange = (e) => {
    state.combo = e.target.checked;
    if (!state.combo && state.active.size > 1) pick(state.lastPicked || CHARACTERS[0].id);
  };
  $('#quality').onchange = () => startCamera().catch(showError);
  $('#fpsSel').onchange = () => startCamera().catch(showError);
  $('#aspect').onchange = () => startCamera().catch(showError);
  $('#fit').onchange = applyFit;
  $('#bloom').onchange = (e) => { state.bloom = e.target.checked; };
  $('#flipBtn').onclick = () => {
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    startCamera().catch(showError);
  };
  $('#recBtn').onclick = () => (state.recorder ? stopRecording() : startRecording().catch(showError));
  $('#shotBtn').onclick = snapshot;
  $('#closeResult').onclick = () => { $('#result').classList.add('hidden'); $('#resultVideo').pause(); };
  $('#shareBtn').onclick = async () => {
    if (!lastResult) return;
    if (window.AndroidBridge) {
      await saveToGallery(lastResult);
      window.AndroidBridge.share();
      return;
    }
    const file = new File([lastResult.blob], lastResult.name, { type: lastResult.blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Hero AR' }); } catch (e) { /* cancelled */ }
    } else {
      alert('Is browser me direct share support nahi hai — Download use karo.');
    }
  };
  if (window.AndroidBridge) {
    $('#downloadBtn').textContent = '⬇ Gallery me Save';
    $('#downloadBtn').onclick = (e) => { e.preventDefault(); if (lastResult) saveToGallery(lastResult); };
  }
  // Android back button: close panels first, then exit.
  window.heroBack = () => {
    if (!$('#result').classList.contains('hidden')) { $('#closeResult').click(); return true; }
    if (!$('#settings').classList.contains('hidden')) { $('#settings').classList.add('hidden'); return true; }
    if (state.recorder) { stopRecording(); return true; }
    return false;
  };
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9) pick(CHARACTERS[n - 1].id);
    if (e.key === '0') pick(CHARACTERS[9].id);
    if (e.key === '-') pick(CHARACTERS[10].id);
    if (e.key === '=') pick(CHARACTERS[11].id);
    if (e.key === 'r' || e.key === 'R') $('#recBtn').click();
    if (e.key === 'p' || e.key === 'P') snapshot();
    if (e.key === 'm' || e.key === 'M') $('#meshBtn').click();
  });
  $('#startBtn').onclick = boot;
}

function showError(e) {
  console.error(e);
  const msg = e && e.name === 'NotAllowedError' ? 'Camera permission deny ho gayi. Browser settings me allow karo.'
    : e && e.name === 'NotFoundError' ? 'Koi camera nahi mila.'
    : `Error: ${e && e.message ? e.message : e}`;
  $('#status').textContent = msg;
  $('#start').classList.remove('hidden');
}

async function boot() {
  const btn = $('#startBtn');
  btn.disabled = true;
  const status = (s) => { $('#status').textContent = s; };
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera ke liye HTTPS (ya localhost) chahiye.');
    }
    status('Camera start ho raha hai…');
    await startCamera();
    requestAnimationFrame(frame);
    state.tracker = await createTracker(status);
    status('Ready!');
    $('#start').classList.add('hidden');
  } catch (e) {
    btn.disabled = false;
    showError(e);
  }
}

buildCarousel();
wire();
applyFit();
pick(CHARACTERS[0].id);
