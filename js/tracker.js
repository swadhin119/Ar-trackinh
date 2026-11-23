// MediaPipe Tasks Vision: hand landmarks (21 pts x 2 hands) + face mesh (478 pts incl. iris) + blendshapes.
import {
  FilesetResolver,
  FaceLandmarker,
  HandLandmarker,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

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
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  onStatus('Face + Eye tracking model load ho raha hai…');
  const face = await make(FaceLandmarker, fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  onStatus('Hand tracking model load ho raha hai…');
  const hands = await make(HandLandmarker, fileset, {
    baseOptions: { modelAssetPath: HAND_MODEL },
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
