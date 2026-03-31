// ═══════════════════════════════════════════
//  AIRBRUSH — signup.js  (v3)
//  Fixes:
//   1. Face capture loop now runs continuously
//      until a descriptor is stored — no more
//      "pending forever" issue.
//   2. Pinch (thumb + index together) = start drawing
//      Open palm = stop drawing
//      Start/Stop buttons still work as fallback.
// ═══════════════════════════════════════════

// ── STATE ────────────────────────────────
const state = {
  name: '',
  email: '',
  method: '',
  authData: null,
  faceDescriptor: null,
  isDrawing: false,
  drawPoints: [],
  overlayStrokes: [],
  currentOverlayStroke: null,
  handVisible: false,
  pinDigits: [],
  pinCurrentDigit: 0,
  pinCurrentCount: -1,
  pinTimer: null,
  pinCountdown: 3,
  modelsLoaded: false,
  cameraReady: false,
  faceLoopRunning: false,
  // Gesture state
  wasPinching: false,    // true when pinch was active last frame
  wasOpenPalm: false,    // debounce open-palm stop
  gestureHoldFrames: 0,  // frames held in current gesture
};

// ── DOM REFS ─────────────────────────────
const step1El    = document.getElementById('step1');
const step2El    = document.getElementById('step2');
const step3El    = document.getElementById('step3');
const inpName    = document.getElementById('inp-name');
const inpEmail   = document.getElementById('inp-email');
const methodCards= document.querySelectorAll('.method-card');
const btnNext    = document.getElementById('btn-step1-next');
const btnBack    = document.getElementById('btn-back');
const btnDone    = document.getElementById('btn-done');
const btnStart   = document.getElementById('btn-start');
const btnStop    = document.getElementById('btn-stop');
const btnClear   = document.getElementById('btn-clear-draw');
const err1       = document.getElementById('step1-error');
const err2       = document.getElementById('step2-error');
const statusDot  = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const step2Title = document.getElementById('step2-title');
const step2Sub   = document.getElementById('step2-sub');
const drawBox    = document.getElementById('draw-box');
const pinBox     = document.getElementById('pin-box');
const drawCtrlEl = document.getElementById('draw-controls');
const pinCtrlEl  = document.getElementById('pin-controls');

// Canvases
const webcamEl      = document.getElementById('webcam');
const overlayCanvas = document.getElementById('overlay-canvas');
const drawCanvas    = document.getElementById('draw-canvas');
const overlayCtx    = overlayCanvas.getContext('2d');
const drawCtx       = drawCanvas.getContext('2d');

webcamEl.style.transform      = 'scaleX(-1)';
overlayCanvas.style.transform = 'scaleX(-1)';

// ── STEP 1 ────────────────────────────────
methodCards.forEach(card => {
  card.addEventListener('click', () => {
    methodCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.method = card.dataset.method;
  });
});

btnNext.addEventListener('click', () => {
  const name  = inpName.value.trim();
  const email = inpEmail.value.trim().toLowerCase();
  if (!name)                  return showError(err1, 'Please enter your name.');
  if (!email.includes('@'))   return showError(err1, 'Please enter a valid email.');
  if (!state.method)          return showError(err1, 'Please choose an auth method.');

  const users = JSON.parse(localStorage.getItem('airbrush_users') || '[]');
  if (users.find(u => u.email === email))
    return showError(err1, 'An account with that email already exists. Please log in.');

  hideError(err1);
  state.name  = name;
  state.email = email;
  goToStep2();
});

// ── STEP 2 ────────────────────────────────
function goToStep2() {
  step1El.style.display = 'none';
  step2El.style.display = 'flex';

  const labels = {
    sign:    ['Set up your Signature',  'Pinch (👌 thumb + index together) to draw. Open palm (🖐) to stop.'],
    pattern: ['Set up your Pattern',   'Pinch (👌 thumb + index together) to draw. Open palm (🖐) to stop.'],
    pin:     ['Set up your Finger PIN', 'Show fingers to enter each digit (3-second hold to confirm).'],
  };
  step2Title.textContent = labels[state.method][0];
  step2Sub.textContent   = labels[state.method][1];

  if (state.method === 'pin') {
    drawBox.style.display    = 'none';
    pinBox.style.display     = 'block';
    drawCtrlEl.style.display = 'none';
    pinCtrlEl.style.display  = 'block';
  } else {
    drawBox.style.display    = 'block';
    pinBox.style.display     = 'none';
    drawCtrlEl.style.display = 'flex';
    pinCtrlEl.style.display  = 'none';
  }

  initDrawCanvas();
  startCamera();
}

// ── CANVAS INIT ───────────────────────────
function initDrawCanvas() {
  drawCanvas.width  = drawCanvas.offsetWidth  || 400;
  drawCanvas.height = drawCanvas.offsetHeight || 300;
  drawCtx.fillStyle = '#ffffff';
  drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
  state.drawPoints = [];
  state.overlayStrokes = [];
  state.currentOverlayStroke = null;
}

// ── CAMERA & MEDIAPIPE ───────────────────
async function startCamera() {
  setStatus('loading', 'Loading AI models...');
  state.faceLoopRunning = false;

  try {
    const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    ]);
    state.modelsLoaded = true;
    setStatus('loading', 'Starting webcam...');
  } catch (e) {
    setStatus('error', 'Could not load face models. Check your internet connection.');
    showError(err2, 'Face model load failed: ' + e.message);
    return;
  }

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  hands.onResults(onHandResults);

  const camera = new Camera(webcamEl, {
    onFrame: async () => {
      overlayCanvas.width  = webcamEl.videoWidth  || 640;
      overlayCanvas.height = webcamEl.videoHeight || 480;
      await hands.send({ image: webcamEl });
    },
    width: 640,
    height: 480,
  });

  camera.start().then(() => {
    state.cameraReady = true;
    setStatus('loading', 'Camera ready — scanning for your face...');
    // Start face capture loop immediately
    if (!state.faceLoopRunning) {
      state.faceLoopRunning = true;
      captureFaceLoop();
    }
    if (state.method === 'pin') updatePinUI();
  }).catch(e => {
    setStatus('error', 'Camera access denied. Please allow webcam access.');
    showError(err2, 'Camera error: ' + e.message);
  });
}

// ══════════════════════════════════════════
//  FACE CAPTURE LOOP (FIXED)
//  Runs continuously every 800ms until face
//  is successfully enrolled (5 samples).
//  Shows live feedback in the status bar.
// ══════════════════════════════════════════
const _faceSamples = [];
const FACE_TARGET  = 5;

async function captureFaceLoop() {
  if (!state.faceLoopRunning) return;

  // Already enrolled — stop looping
  if (state.faceDescriptor) return;

  if (!state.modelsLoaded || !webcamEl.videoWidth) {
    setTimeout(captureFaceLoop, 800);
    return;
  }

  try {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: 0.3,   // permissive — works in dim/angled light
    });

    const detection = await faceapi
      .detectSingleFace(webcamEl, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (detection) {
      _faceSamples.push(detection.descriptor);

      if (_faceSamples.length < FACE_TARGET) {
        setStatus('loading',
          `📷 Face scan ${_faceSamples.length}/${FACE_TARGET} — hold still & look at camera...`);
        setTimeout(captureFaceLoop, 500);
        return;
      }

      // Average all samples → stable descriptor
      const len = _faceSamples[0].length;
      const avg = new Float32Array(len);
      for (const s of _faceSamples) {
        for (let i = 0; i < len; i++) avg[i] += s[i];
      }
      for (let i = 0; i < len; i++) avg[i] /= _faceSamples.length;

      state.faceDescriptor = Array.from(avg);
      setStatus('ready', '✅ Face enrolled! Now set up your ' +
        (state.method === 'pin' ? 'PIN.' :
         state.method === 'sign' ? 'signature — pinch to draw, open palm to stop.' :
         'pattern — pinch to draw, open palm to stop.'));
      return; // Done — no more looping
    } else {
      setStatus('loading',
        '👤 Face not detected — face the camera with good lighting...');
    }
  } catch (e) {
    console.warn('[AirBrush] Face scan error:', e.message);
  }

  // Retry
  setTimeout(captureFaceLoop, 800);
}

// ══════════════════════════════════════════
//  GESTURE HELPERS
// ══════════════════════════════════════════

/**
 * isPinching: thumb tip (4) and index tip (8) close together.
 * Distance < 8% of hand width (wrist→middle-mcp span).
 */
function isPinching(landmarks) {
  const thumb = landmarks[4];
  const index = landmarks[8];
  const wrist = landmarks[0];
  const midMcp = landmarks[9];

  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const pinchDist = Math.sqrt(dx * dx + dy * dy);

  // normalise by hand size
  const hx = wrist.x - midMcp.x;
  const hy = wrist.y - midMcp.y;
  const handSize = Math.sqrt(hx * hx + hy * hy) || 0.1;

  return (pinchDist / handSize) < 0.35; // threshold tuned to feel natural
}

/**
 * isOpenPalm: all 4 fingers AND thumb extended.
 * Uses y-position of tips vs their PIP joints.
 */
function isOpenPalm(landmarks) {
  // Finger tips and their PIP joints
  const fingers = [
    [8, 6],   // index
    [12, 10], // middle
    [16, 14], // ring
    [20, 18], // pinky
  ];
  const allExtended = fingers.every(([tip, pip]) => landmarks[tip].y < landmarks[pip].y);
  // thumb: tip x vs ip x (mirrored logic)
  const thumbExtended = Math.abs(landmarks[4].x - landmarks[3].x) > 0.04;
  return allExtended && thumbExtended;
}

// ── HAND RESULTS ─────────────────────────
function onHandResults(results) {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  const handDetected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

  if (!handDetected) {
    // Lift ends current stroke
    if (state.currentOverlayStroke && state.currentOverlayStroke.length > 1)
      state.overlayStrokes.push([...state.currentOverlayStroke]);
    state.currentOverlayStroke = null;
    state.handVisible = false;
    state.wasPinching = false;
    state.wasOpenPalm = false;
    state.gestureHoldFrames = 0;
    redrawOverlayTrail();
    return;
  }

  state.handVisible = true;
  const landmarks = results.multiHandLandmarks[0];

  // Draw skeleton
  drawConnectors(overlayCtx, landmarks, HAND_CONNECTIONS,
    { color: 'rgba(124,58,237,0.75)', lineWidth: 2 });
  drawLandmarks(overlayCtx, landmarks,
    { color: '#06B6D4', lineWidth: 1, radius: 3 });

  if (state.method === 'pin') {
    handlePIN(results);
  } else {
    handleGestureDrawing(landmarks);
  }

  redrawOverlayTrail();
}

// ── GESTURE-BASED DRAWING ─────────────────
function handleGestureDrawing(landmarks) {
  const pinching  = isPinching(landmarks);
  const openPalm  = isOpenPalm(landmarks);

  // ── PINCH → Start / continue drawing ──
  if (pinching) {
    state.wasOpenPalm = false;

    if (!state.isDrawing) {
      // Transition: not drawing → drawing
      startDrawing();
    }

    // Draw at index fingertip position
    const tip = landmarks[8];
    const drawX = (1 - tip.x) * drawCanvas.width;
    const drawY = tip.y * drawCanvas.height;
    state.drawPoints.push({ x: drawX, y: drawY });

    drawCtx.strokeStyle = '#6C63FF';
    drawCtx.lineWidth   = 3;
    drawCtx.lineCap     = 'round';
    drawCtx.lineJoin    = 'round';
    if (state.drawPoints.length > 1) {
      const prev = state.drawPoints[state.drawPoints.length - 2];
      drawCtx.beginPath();
      drawCtx.moveTo(prev.x, prev.y);
      drawCtx.lineTo(drawX, drawY);
      drawCtx.stroke();
    }

    const overlayX = tip.x * overlayCanvas.width;
    const overlayY = tip.y * overlayCanvas.height;
    if (!state.currentOverlayStroke) state.currentOverlayStroke = [];
    state.currentOverlayStroke.push({ x: overlayX, y: overlayY });

    state.wasPinching = true;

    // Show pinch dot on overlay
    overlayCtx.beginPath();
    overlayCtx.arc(overlayX, overlayY, 10, 0, Math.PI * 2);
    overlayCtx.fillStyle = 'rgba(255, 80, 80, 0.85)';
    overlayCtx.fill();

    setStatus('ready', '👌 Drawing... open your palm to stop');
    return;
  }

  // ── OPEN PALM → Stop drawing ──
  if (openPalm && state.isDrawing) {
    state.gestureHoldFrames++;
    // Require 3 consistent frames to avoid accidental stops
    if (state.gestureHoldFrames >= 3) {
      stopDrawing();
      state.wasOpenPalm = true;
      state.gestureHoldFrames = 0;
    }
    return;
  }

  // ── Neither gesture ──
  if (!pinching) {
    // If we were pinching and now lifted, end stroke segment
    if (state.wasPinching && state.isDrawing) {
      if (state.currentOverlayStroke && state.currentOverlayStroke.length > 1) {
        state.overlayStrokes.push([...state.currentOverlayStroke]);
      }
      state.currentOverlayStroke = null;
    }
    state.wasPinching = false;
    state.gestureHoldFrames = 0;
  }
}

// Start drawing (called by pinch gesture OR Start button)
function startDrawing() {
  if (state.isDrawing) return;
  state.isDrawing = true;
  state.currentOverlayStroke = null;
  btnStart.disabled = true;
  btnStop.disabled  = false;
  setStatus('ready', '👌 Pinch to draw — open palm to stop');
}

// Stop drawing (called by open-palm gesture OR Stop button)
function stopDrawing() {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  if (state.currentOverlayStroke && state.currentOverlayStroke.length > 1)
    state.overlayStrokes.push([...state.currentOverlayStroke]);
  state.currentOverlayStroke = null;
  btnStart.disabled = false;
  btnStop.disabled  = true;

  if (state.drawPoints.length > 10) {
    state.authData = state.drawPoints.map(p => ({ x: p.x, y: p.y }));
    btnDone.disabled = false;
    setStatus('ready', '✅ Drawing captured — click Done to save, or pinch to keep drawing');
  } else {
    showError(err2, 'Drawing too short — pinch and draw a longer gesture.');
    setStatus('ready', 'Too short — try again');
  }
}

// ── REDRAW TRAIL ──────────────────────────
function redrawOverlayTrail() {
  const drawStroke = (pts) => {
    if (!pts || pts.length < 2) return;
    overlayCtx.save();
    overlayCtx.strokeStyle = 'rgba(99, 255, 200, 0.95)';
    overlayCtx.lineWidth   = 3.5;
    overlayCtx.lineCap     = 'round';
    overlayCtx.lineJoin    = 'round';
    overlayCtx.shadowColor = 'rgba(6,182,212,0.6)';
    overlayCtx.shadowBlur  = 8;
    overlayCtx.beginPath();
    overlayCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) overlayCtx.lineTo(pts[i].x, pts[i].y);
    overlayCtx.stroke();
    overlayCtx.restore();
  };
  state.overlayStrokes.forEach(drawStroke);
  if (state.currentOverlayStroke) drawStroke(state.currentOverlayStroke);
}

// ── PIN HANDLER ──────────────────────────
function handlePIN(results) {
  if (state.pinCurrentDigit >= 4) return;

  let totalFingers = 0;
  results.multiHandLandmarks.forEach((landmarks, i) => {
    totalFingers += countFingers(landmarks, results.multiHandedness[i].label);
  });

  document.getElementById('finger-count').textContent = totalFingers;
  if (totalFingers === state.pinCurrentCount) return;

  state.pinCurrentCount = totalFingers;
  clearPinTimer();

  if (totalFingers > 0) {
    document.getElementById('pin-timer-wrap').style.display = 'block';
    state.pinCountdown = 3;
    document.getElementById('pin-timer').textContent = 3;
    state.pinTimer = setInterval(() => {
      state.pinCountdown--;
      document.getElementById('pin-timer').textContent = state.pinCountdown;
      if (state.pinCountdown <= 0) {
        clearPinTimer();
        confirmPinDigit(totalFingers);
      }
    }, 1000);
  } else {
    document.getElementById('pin-timer-wrap').style.display = 'none';
  }
}

function countFingers(landmarks, handedness) {
  const fingerPairs = [[8,6],[12,10],[16,14],[20,18]];
  let count = fingerPairs.filter(([tip, pip]) => landmarks[tip].y < landmarks[pip].y).length;
  const thumbTip = landmarks[4], thumbIp = landmarks[3];
  if (handedness === 'Right') { if (thumbTip.x < thumbIp.x) count++; }
  else                        { if (thumbTip.x > thumbIp.x) count++; }
  return count;
}

function clearPinTimer() {
  if (state.pinTimer) { clearInterval(state.pinTimer); state.pinTimer = null; }
  document.getElementById('pin-timer-wrap').style.display = 'none';
}

function confirmPinDigit(value) {
  const clamped = Math.min(value, 9);
  state.pinDigits.push(clamped);
  const digitEl = document.getElementById(`pd${state.pinCurrentDigit}`);
  digitEl.textContent = clamped;
  digitEl.classList.add('filled');
  digitEl.classList.remove('active');
  state.pinCurrentDigit++;
  state.pinCurrentCount = -1;

  if (state.pinCurrentDigit >= 4) {
    state.authData = state.pinDigits.slice();
    setStatus('ready', 'PIN set ✓ — click Done');
    document.getElementById('pin-current').textContent = 'PIN complete! ✓';
    btnDone.disabled = false;
  } else {
    updatePinUI();
  }
}

function updatePinUI() {
  document.getElementById('pin-current').textContent = `Entering digit ${state.pinCurrentDigit + 1} of 4`;
  const nextDigit = document.getElementById(`pd${state.pinCurrentDigit}`);
  if (nextDigit) nextDigit.classList.add('active');
}

// ── DRAW CONTROLS (buttons remain as fallback) ──
btnStart.addEventListener('click', () => {
  startDrawing();
  state.drawPoints = [];
  state.overlayStrokes = [];
  state.currentOverlayStroke = null;
  initDrawCanvas();
  setStatus('ready', '👌 Pinch to draw — or just move your finger (button mode)');
});

btnStop.addEventListener('click', () => {
  stopDrawing();
});

btnClear.addEventListener('click', () => {
  state.drawPoints = [];
  state.overlayStrokes = [];
  state.currentOverlayStroke = null;
  state.authData = null;
  btnDone.disabled = true;
  initDrawCanvas();
  setStatus('ready', 'Canvas cleared — pinch to draw again');
});

// ── DONE ─────────────────────────────────
btnDone.addEventListener('click', () => {
  if (!state.faceDescriptor)
    return showError(err2, '⚠ Face not enrolled yet. Keep your face visible in the webcam.');
  if (!state.authData)
    return showError(err2, '⚠ Please complete your drawing or PIN first.');

  const users = JSON.parse(localStorage.getItem('airbrush_users') || '[]');
  users.push({
    name:           state.name,
    email:          state.email,
    method:         state.method,
    authData:       state.authData,
    faceDescriptor: state.faceDescriptor,
  });
  localStorage.setItem('airbrush_users', JSON.stringify(users));

  step2El.style.display = 'none';
  step3El.style.display = 'flex';
});

// ── BACK ──────────────────────────────────
btnBack.addEventListener('click', () => {
  stopCameraAndReset();
  step2El.style.display = 'none';
  step1El.style.display = 'flex';
});

function stopCameraAndReset() {
  state.faceLoopRunning = false;
  if (webcamEl.srcObject)
    webcamEl.srcObject.getTracks().forEach(t => t.stop());
  webcamEl.srcObject = null;
}

// ── HELPERS ──────────────────────────────
function setStatus(type, msg) {
  statusDot.className = 'status-dot ' + type;
  statusText.textContent = msg;
}
function showError(el, msg) { el.textContent = msg; el.style.display = 'block'; }
function hideError(el) { el.style.display = 'none'; }
