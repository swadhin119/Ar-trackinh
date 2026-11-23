// MediaPipe Tasks Vision: hand landmarks (21 pts x 2 hands) + face mesh (478 pts incl. iris) + blendshapes.
// Library + models are loaded from ./vendor (bundled inside the Android APK, works offline).
// If they are not present (e.g. plain GitHub Pages deploy) we fall back to the public CDNs.
const VERSION = '0.10.14';
const LOCAL = new URL('../vendor/', import.meta.url).href;
const CDN = {
  lib: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`,
  wasm: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`,
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
};

async function loadVision() {
  try {
    const probe = await fetch(LOCAL + 'ok.txt');
    if (!probe.ok) throw new Error('no local vendor');
    const lib = await import(LOCAL + 'tasks-vision/vision_bundle.mjs');
    return { lib, wasm: LOCAL + 'tasks-vision/wasm', face: LOCAL + 'models/face_landmarker.task', hand: LOCAL + 'models/hand_landmarker.task' };
  } catch (e) {
    const lib = await import(CDN.lib);
    return { lib, ...CDN };
  }
}

async function make(Cls, fileset, opts) {
  try {
    return await Cls.createFromOptions(fileset, {
      ...opts,
      baseOptions: { ...opts.baseOptions, delegate: 'GPU' },
    });
  } catch (e) {
    console.warn('GPU delegate failed, falling back to CPU', e);
    return Cls.createFromOptions(fileset, {
      ...opts,
      baseOptions: { ...opts.baseOptions, delegate: 'CPU' },
    });
  }
}

export async function createTracker(onStatus = () => {}) {
  onStatus('AI engine load ho raha hai…');
  const src = await loadVision();
  const { FilesetResolver, FaceLandmarker, HandLandmarker } = src.lib;
  const fileset = await FilesetResolver.forVisionTasks(src.wasm);
  onStatus('Face + Eye tracking model load ho raha hai…');
  const face = await make(FaceLandmarker, fileset, {
    baseOptions: { modelAssetPath: src.face },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  onStatus('Hand tracking model load ho raha hai…');
  const hands = await make(HandLandmarker, fileset, {
    baseOptions: { modelAssetPath: src.hand },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  let lastTs = 0;
  return {
    detect(video, wantFace, wantHands) {
      let ts = performance.now();
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      return {
        face: wantFace ? face.detectForVideo(video, ts) : null,
        hands: wantHands ? hands.detectForVideo(video, ts) : null,
      };
    },
  };
}
